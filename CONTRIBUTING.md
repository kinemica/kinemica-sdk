# Contributing

The SDK deliberately mirrors only Kinemica's reviewed public Developer and Connected Devices API contracts. Changes must not add local policy, undocumented endpoints, automatic request retries or direct database access.

Before proposing a change:

1. Create a focused branch.
2. Add or update tests for public behavior.
3. Run `pnpm verify`.
4. Run `pnpm test:package` to inspect the tarball, source maps, runtime dependency footprint and strict public consumer types.

Do not commit API keys or use customer data for integration tests. Authorized live verification must use disposable synthetic DEV/Production fixtures and revoke all test credentials, remove uploaded objects and clean scopes/users afterward. Production verification is an operator gate, not a public CI job.

Release only after a reviewed PR and CI pass. Tag the release commit and dispatch `publish-to-npm.yml` for that existing tag; npm publication uses GitHub OIDC with provenance. Verify public registry installation and a disposable Production run before declaring developer readiness. Never move a published release tag or overwrite a published package.
