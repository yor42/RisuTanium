# RisuTanium Node Server

> Warning: Node server may be deprecated in future versions, replaced with [Hono](https://hono.dev/) based server which could run in multiple environments including nodejs, deno, and serverless platforms such as Cloudflare Workers, Vercel Edge Functions, etc.

This is the Node.js server for RisuTanium, for self-hosting purposes, who want to run RisuTanium on their own server remotely instead of using the hosted upstream RisuAI site, for privacy or other reasons.

## Environment variables

- `PORT`: the port the server listens on. Default `6001`.
- `TRUST_PROXY`: set this when the server runs behind a reverse proxy, so the rate limits see the client's address and not the proxy's. It is read as follows: `true` or `false` (any case) set the Express `trust proxy` setting to that boolean; a whole number is a hop count (`1` trusts one proxy in front of the server, `0` trusts none); any other value (an address, a subnet such as `10.0.0.0/8`, a comma-separated list, `loopback`) is passed to Express unchanged. Unset or blank leaves the setting off. Prefer a hop count or a subnet: `true` trusts every proxy, so a client can send its own `X-Forwarded-For` to get around the per-IP rate limits, and express-rate-limit logs `ERR_ERL_PERMISSIVE_TRUST_PROXY` for it. Without this setting, a request that carries `X-Forwarded-For` logs `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.
- `RISU_ALLOWED_ENV`: a comma-separated list of extra environment variable names that `/api/env-secret` may return to an authorized client. Names of the form `RISU_<NAME>_KEY` and `RISU_<NAME>_TOKEN` are always readable; any other name must be listed here.
- `RISU_PROXY_ALLOW_PRIVATE`: set to `1` to let the server's proxy (`/proxy`, `/proxy2` and the stream jobs) reach devices on the local network (`192.168.x`, `10.x`, `172.16-31.x`, link-local, `*.local` names and the `100.64.0.0/10` range VPN overlays such as Tailscale use). LAN model servers need it. Without it only loopback (`localhost`, `127.x`, `::1`) and, for `/proxy` and `/proxy2`, public addresses are reachable; a private target answers 403 `PROXY_DESTINATION_BLOCKED`. The setting is checked on every redirect hop and on every address a name resolves to. While it is on, the Advanced settings page of the app shows a warning, because character cards, scripts and plugins can then send requests to those devices through the server.
- `RISU_REVISION_LOG_COMPACT_AT`: the number of records the revision log may hold before it is compacted. Default `20000`; a value that is not a positive integer is ignored.

## Node version

Run a Node.js version that has the fix for CVE-2026-111497, a High-severity out-of-bounds write in the Brotli decoder behind `node:zlib`. The server fetches the URLs clients give it, and a hostile remote server can answer with `Content-Encoding: br`. The minimum fixed versions are 22.23.4, 24.22.1 and 26.12.1; any newer release of those lines, or a later major, is also fixed. Other lines (20, 23, 25 and older) have no fix. The server prints a warning at startup on an affected version and still starts.

## Realm proxy

`/hub-proxy/*` forwards Realm requests to the hub. Only the `accept`, `accept-language`, `content-type`, `user-agent` and `x-risuai-info` request headers are sent on, so `risu-auth`, cookies, `authorization`, `x-forwarded-for` and `referer` never reach the hub. The request body is sent as the client wrote it. A hub `Set-Cookie` header is not passed back to the client.
