import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import {
  Kinemica,
  KinemicaDevice,
  KinemicaApiError,
  KinemicaConnectionError,
  KinemicaTimeoutError,
  KinemicaRequestAbortedError,
} from "../src/index.js";

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (url: string) => Promise<void>,
) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test address");
    await run(`http://127.0.0.1:${address.port}/api/v1`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("native Fetch HTTP boundary", () => {
  it("never follows redirects or forwards credentials to another endpoint", async () => {
    const paths: string[] = [];
    await withServer(
      (request, response) => {
        paths.push(request.url ?? "");
        response.writeHead(307, { location: "/credential-sink" });
        response.end();
      },
      async (baseUrl) => {
        await expect(
          new Kinemica({ apiKey: "local-test-key", baseUrl }).work.retrieve(
            "job_123",
          ),
        ).rejects.toMatchObject({ status: 307 });
      },
    );
    expect(paths).toEqual(["/api/v1/work/job_123"]);
  });

  it.each(["timeout", "abort"] as const)(
    "stops a stalled body after %s",
    async (kind) => {
      const caller = new AbortController();
      let requests = 0;
      await withServer(
        (_request, response) => {
          requests++;
          response.writeHead(200, { "content-type": "application/json" });
          response.write('{"data":');
          if (kind === "abort") caller.abort();
        },
        async (baseUrl) => {
          const client = new Kinemica({
            apiKey: "local-test-key",
            baseUrl,
            timeoutMs: 100,
          });
          await expect(
            client.work.retrieve("job_123", { signal: caller.signal }),
          ).rejects.toBeInstanceOf(
            kind === "timeout"
              ? KinemicaTimeoutError
              : KinemicaRequestAbortedError,
          );
        },
      );
      expect(requests).toBe(1);
    },
  );

  it("classifies a broken response stream as a connection failure", async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"data":');
        setImmediate(() => response.destroy());
      },
      async (baseUrl) => {
        await expect(
          new Kinemica({ apiKey: "local-test-key", baseUrl }).work.retrieve(
            "job_123",
          ),
        ).rejects.toBeInstanceOf(KinemicaConnectionError);
      },
    );
  });

  it("sends only the requested Buffer slice as raw evidence bytes", async () => {
    const bytes = Buffer.from([99, 1, 2, 3, 88]).subarray(1, 4);
    const chunks: Buffer[] = [];
    await withServer(
      (request, response) => {
        expect(request.headers["content-type"]).toBe("image/png");
        expect(request.headers["idempotency-key"]).toBe("slice-evidence-001");
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end("{}");
        });
      },
      async (baseUrl) => {
        const device = new KinemicaDevice({
          credential: `kin_device_${"A".repeat(43)}`,
          baseUrl,
        });
        await expect(
          device.evidence.upload({
            bytes,
            mediaType: "image/png",
            observedAt: new Date().toISOString(),
            idempotencyKey: "slice-evidence-001",
          }),
        ).rejects.toBeInstanceOf(KinemicaApiError);
      },
    );
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3]));
  });
});
