# Parked: decouple authentication from inference adapters (2026-11-24)

Status: **parked design note, not a ticket** (maintainer, 2026-11-24, lane A MC-4185). Follow-ups filed: #767 and #768, with notes on #540, #153 and #152.

## The proposal

A side agent proposed an authentication subsystem that sits between connection config and outgoing requests:
- an `AuthStrategy` registry and a `PreparedRequest`/`AuthContext` request type;
- a typed `AuthConfig` union on `Connection` (static key, service account, OAuth, external, none);
- expiry-aware caching, 401/403 classification and bounded auth retry;
- optional provider OAuth PKCE, workload identity federation and external credential helpers.

## What lane A's review found

The review ran against main c33cfb061. Six agents: four investigators, then a senior-advisor skeptic and an adversarial refuter.
- Chat key read, lease, rotation, preview and limit classification are **already central** (`secretKey.ts`, `keyRing.ts`, the rotation loop in `request.ts`).
- What is adapter-local is header or URL placement, the Vertex token mint (`google.ts`) and Bedrock SigV4 signing (`anthropic.ts`).
- **No 401/403 handling exists** in any inference adapter. Classification would be new behaviour, and it collides with MC-2158 (rotate on 429/402 only), MC-2397 (no retry for hidden sends) and the native first-attempt grant (MC-1451).
- An OAuth precedent exists: MCP has PKCE, dynamic client registration and refresh (`mcplib.ts`). Its refresh-record store neither dedupes records nor stores a rotated refresh token.
- `Connection.key: string` is a deliberate persistence rule. `Connection.options` is reserved for method parameters (MC-3066). A typed auth union would be a persisted-format change under MC-350, MC-774, MC-223 and MC-3070/3074/3076.
- About 13 non-connection credential fields, Google Search credentials in plain localforage, and 17 or more credential-bearing bare `fetch` sites remain. That work belongs to #540/#153/#152.

## What was filed instead

- #767: a Vertex request preview never mints a token or writes the database (Tier 1, reproduce first).
- #768: Vertex token service extraction (blocked by #767; two maintainer questions when it starts).
- Audit notes on #540, #153 and #152.
- All in the backlog after MVP blockers and performance work.

## Reopen when

- the maintainer wants provider OAuth (for example OpenRouter PKCE) as a product feature;
- a second provider needs non-key auth beyond Vertex and Bedrock; or
- #540 has landed and connections hold every key, so an auth step would have one input.

Even then, start from a design-only Tier 2 ticket with opus review of the persisted shape, not the original phases.

Evidence (lane A scratch): `%TEMP%\risu-b715\b61\auth-proposal\` (proposal.md, map-*.md, challenge-skeptic.md, challenge-refuter.md, review.json).
