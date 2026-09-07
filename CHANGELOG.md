# Changelog

## 0.3.1

- Preserve timeout and caller-cancellation errors through response-body reads; skip pre-aborted requests and bound waiting for custom transports.
- Redact reflected credentials in diagnostics and parsed results; validate request IDs, bound validation details, and reject device credentials supplied as project API keys.
- Preserve HTTP error classes for non-JSON failures and safe request metadata for incompatible responses.
- Copy bounded binary upload inputs and reject ambiguous event response variants.
- Add public declaration, real HTTP, packaging and compatibility regressions; include public TypeScript sources so source/declaration maps resolve.
- Clarify pairing, replay, error handling, device evidence and browser/server boundaries; harden the trusted publishing and registry-install checks.

The public methods and server authority model are unchanged.

## 0.3.0

- Add bounded JPEG, PNG and WebP device evidence upload and evidence references in device events.
- Return server-owned review episode and work metadata for configured evidence events.

## 0.2.0

- Add device pairing, heartbeat and event submission using device-scoped credentials.

## 0.1.0

- Add the Node.js TypeScript project client with `work.retrieve`, `actions.authorize`, typed errors and explicit idempotency keys.
