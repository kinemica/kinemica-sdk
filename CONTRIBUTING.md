# Contributing

The v0.1 SDK deliberately mirrors only Kinemica's reviewed public Developer API contract. Changes must not add local policy, undocumented endpoints, automatic authorization retries or direct database access.

Before proposing a change:

1. Create a focused branch.
2. Add or update tests for public behavior.
3. Run `pnpm verify`.
4. Inspect `pnpm pack --dry-run` and confirm no credentials, fixtures or internal platform files are included.

Do not commit API keys or use Production data for integration tests. Live verification must use disposable synthetic DEV data and revoked test keys.
