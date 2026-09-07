# Security policy

## Supported version

Security fixes target the latest published `0.3.x` release. Use the latest patch in that series; earlier 0.1/0.2 releases are not independently maintained.

## Reporting a vulnerability

Please use [GitHub's private vulnerability reporting](https://github.com/kinemica/kinemica-sdk/security/advisories/new) for this repository. Do not open a public issue containing a credential, exploit, customer detail or sensitive response.

Never include a Kinemica API key, device credential or pairing code in a report. Revoke any credential that may have been exposed before sharing redacted reproduction details.

Kinemica is currently a prototype and is not approved for live safety-critical work.

## Client boundary

Developer API keys belong only in the project client; device credentials belong only in a device/server process. Explicitly choosing `baseUrl` or supplying `fetch` is a trust decision: that transport receives the credential. The SDK does not persist credentials or log requests. Diagnostic redaction covers known/reflected Kinemica credentials and pairing codes, but cannot protect secrets logged directly by application code or by a custom fetch implementation.

The server alone owns device/workspace scope, policy, evidence ownership, idempotency records and work completion. Cancellation or connection loss cannot roll back a server operation. Never translate a transport error into a policy decision or physical action.
