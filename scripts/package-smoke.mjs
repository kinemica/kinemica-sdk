import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const temporary = mkdtempSync(join(tmpdir(), "kinemica-package-"));
const run = (command, args, cwd = temporary) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32" && /^(npm|pnpm)$/.test(command),
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status ?? "launch"}): ${result.stderr ?? ""}\n${result.stdout ?? ""}`,
    );
  }
  return result.stdout;
};

try {
  let tarball = process.argv[2] && resolve(process.argv[2]);
  if (!tarball) {
    run("pnpm", ["pack", "--pack-destination", temporary], root);
    const filename = readdirSync(temporary).find((name) =>
      name.endsWith(".tgz"),
    );
    assert(filename, "No release tarball");
    tarball = join(temporary, filename);
  }
  const entries = run("tar", ["-tzf", tarball]).trim().split(/\r?\n/);
  assert(
    entries.length > 10 && entries.length < 100,
    "Unexpected package size",
  );
  for (const entry of entries) {
    assert(
      /^package\/(?:package\.json|README\.md|LICENSE|CHANGELOG\.md|SECURITY\.md|src\/[a-z-]+\.ts|dist\/[a-z-]+\.(?:js|d\.ts)(?:\.map)?)$/.test(
        entry,
      ),
      `Unexpected tarball entry: ${entry}`,
    );
  }
  run("tar", ["-xzf", tarball, "-C", temporary]);
  const unpacked = join(temporary, "package");
  const packedManifest = JSON.parse(
    readFileSync(join(unpacked, "package.json"), "utf8"),
  );
  assert.equal(packedManifest.name, "@kinemica/sdk");
  assert.equal(packedManifest.version, manifest.version);
  assert.equal(
    packedManifest.repository.url,
    "git+https://github.com/kinemica/kinemica-sdk.git",
  );
  assert.equal(
    Object.keys(packedManifest.dependencies ?? {}).length,
    0,
    "Unexpected runtime dependency",
  );
  assert.equal(
    Object.keys(packedManifest.optionalDependencies ?? {}).length,
    0,
  );
  for (const entry of entries) {
    const path = join(temporary, entry);
    const content = readFileSync(path, "utf8");
    assert(
      !/(?:kin_(?:live|test|device)_|sb_secret_)[A-Za-z0-9_-]{32,}|-----BEGIN .*PRIVATE KEY-----|sylvesterkaczmarek\/kinemica-sdk|kinemica-platform|\/Users\//.test(
        content,
      ),
      `Unsafe package content: ${entry}`,
    );
    if (entry.endsWith(".map")) {
      const map = JSON.parse(content);
      for (const source of map.sources)
        assert(
          existsSync(resolve(dirname(path), source)),
          `Missing map source: ${entry}`,
        );
    }
  }
  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--registry=https://registry.npmjs.org",
    tarball,
  ]);
  // The installed declarations are checked without source aliases or skipLibCheck.
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--save-dev",
    "typescript@5.9.2",
    "@types/node@24.3.0",
  ]);
  writeFileSync(
    join(temporary, "public-api.mts"),
    readFileSync(join(root, "tests/consumer/public-api.mts")),
  );
  writeFileSync(
    join(temporary, "smoke.mjs"),
    `
    import assert from "node:assert/strict";
    import { Kinemica, KinemicaDevice, KinemicaValidationError } from "@kinemica/sdk";
    const client = new Kinemica({apiKey:"consumer-test-key"});
    const device = new KinemicaDevice({credential:"kin_device_"+"A".repeat(43)});
    assert.equal(typeof client.work.retrieve,"function");
    assert.equal(typeof client.actions.authorize,"function");
    assert.equal(typeof KinemicaDevice.pair,"function");
    assert.equal(typeof device.heartbeat,"function");
    assert.equal(typeof device.events.submit,"function");
    assert.equal(typeof device.evidence.upload,"function");
    assert.throws(()=>new Kinemica({apiKey:""}),KinemicaValidationError);
    await assert.rejects(import("@kinemica/sdk/dist/client.js"),{code:"ERR_PACKAGE_PATH_NOT_EXPORTED"});
  `,
  );
  run(process.execPath, [join(temporary, "smoke.mjs")]);
  for (const [module, resolution] of [
    ["NodeNext", "NodeNext"],
    ["ESNext", "Bundler"],
  ]) {
    run(process.execPath, [
      join(temporary, "node_modules/typescript/bin/tsc"),
      "--strict",
      "--exactOptionalPropertyTypes",
      "--noEmit",
      "--target",
      "ES2022",
      "--module",
      module,
      "--moduleResolution",
      resolution,
      "public-api.mts",
    ]);
  }
  console.log(
    `Package ${manifest.version}: ${entries.length} allowed files, zero runtime dependencies, maps resolved, clean ESM import and NodeNext/Bundler public types passed.`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
