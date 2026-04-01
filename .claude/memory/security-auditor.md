# Security Auditor Agent Memory

## Patterns Discovered
- 2026-03-27: SQL IN clauses must use parameterized placeholders, even when values come from prior queries
- 2026-03-27: Error responses should return generic messages, never `String(error)` with stack traces
- 2026-03-27: Extension ingest API needs CORS headers for chrome-extension:// origin

## Common Mistakes Found
- 2026-03-27: `detail: String(error)` in API error responses exposes database internals

## User Preferences
- Owner plans to make this a multi-tenant product — security is not optional
- API_KEY env var guards all routes when set — unset means open (local dev only)
- Never store API tokens in code — always env vars or database settings table
