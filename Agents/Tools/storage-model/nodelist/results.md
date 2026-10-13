# Node /api/list at maintainer scale (2026-10-13)

## Environment
- i9-13900KF-class (13th Gen Intel), 64 GB RAM, Windows 11, NTFS (C:), Node v24.19.0. Best-case hardware; Defender real-time scanning not disabled.
- Server: copy of C:\Projects\RisuAI\.claude\worktrees\alite\server\node\*.cjs in this folder, run from scratch cwd `cwd-main` (NODE_PATH to repo node_modules, read only), ports 6041/6042/6043, own child PID killed by harness. Plus one scratch-only route `/api/list-prefix` (patch in this copy's server.cjs; worktree untouched).
- Fixture: `cwd-main/save`: 383,000 `assets/<64hex>.png` + 4,500 `store2/uNNNNN/<16hex>` + 4 root keys + `__password`, `__known_public_key_hashes.json` = 387,504 keys listed (387,506 files). Bodies 16 bytes. Generation took 793 s (NTFS file creation ~2.0 ms/file).
- Handler (server.cjs `/api/list`): `fs.readdir(save)` -> regex filter `^(?:[0-9a-fA-F]{2})+$` -> `Buffer.from(v,'hex').toString` -> `res.send({success,content})`. Auth: `risu-auth` JWT, rate limiter 20000/min (not a constraint). Key names are hex of the key, so key `assets/<64hex>.png` = 150 hex chars on disk.
- Harness: bench.cjs (HTTP via node http, hrtime), rd.cjs (readdir isolation). Raw: bench-run1.json, bench-run2.json.
- NOT measured: truly cold OS cache (needs admin/reboot; "cold-ish" = fresh server process only, dentries warm), Pi/ARM/SD-card, Defender off, concurrent load.

## Results (ms, n=30 unless stated)

| Metric | Run 1 | Run 2 |
|---|---|---|
| Server start | 4949 | 237 |
| First /api/list after fresh start ("cold-ish") | 4163 | 524 |
| /api/list HTTP wall p50 | 2186 | 1168 |
| /api/list HTTP wall p95 | 3606 | 3197 |
| /api/list HTTP wall min / max | 862 / 3798 | 491 / 3242 |
| Client JSON.parse p50 / p95 | 206 / 314 | 127 / 289 |
| Client filter to `store2/` p50 / p95 | 27.8 / 37.6 | 19.8 / 33.4 |
| Wall + parse + filter p50 / p95 | 2458 / 3897 | 1315 / 3452 |
| Response size | 30,022,602 B (28.6 MiB) | same |
| Server RSS idle -> after 1st list -> after 30 lists (peak) | 72 -> 315 -> 658 (767) MB | 70 -> 312 -> 713 (716) MB |

Variance is large (bimodal: ~0.5-0.9 s fast, 2-3.8 s slow samples); I did not isolate the cause (likely Defender/NTFS metadata scanning and V8 GC of ~390k strings; unverified). Treat the range, not p50, as the signal.

Isolation (rd.cjs, 20 iterations, server-free): `readdir` alone p50 610 / p95 663; regex+decode of all names p50 224 / p95 264; startsWith(hex prefix) over names p50 9.0 / p95 16.3.

## Prototype prefix route `/api/list-prefix?prefix=store2/`
Server: readdir -> keep names with `startsWith(hex(prefix))` and even-length hex -> decode only those.

| Metric | Run 1 | Run 2 |
|---|---|---|
| first call after fresh start | 2785 (4500 keys) | 323 |
| p50 / p95 (store2/, 4,500 keys, n=30) | 613 / 648 | 1056 / 2211 |
| Response size | 148,528 B | same |
| `assets/` prefix (383,000 keys, n=10) p50 / p95 | 935 / 964 | 3122 / 3439 |

Prefix filtering removes the 30 MB payload, client parse (~130-210 ms) and server decode (~220 ms) but not the `readdir` (~0.6 s warm floor), which still scales with total directory entries. Run-2 prefix numbers were slower than run 1 because of the same noise, so do not read them as the route being slower.

## Verdict: prefix route needed: NO (conditional on host), with reasoning
- On this i9, unfiltered list is ~0.5-0.9 s fast case and 2-3.8 s slow case, median 1.2-2.2 s at 383k assets. That exceeds the 1 s trigger on the median, and per the brief's rule of thumb a Pi-class host is several times slower. So by the stated threshold it is measured "slow".
- However, the prefix route only buys back ~40-60% (payload, parse, decode, ~400 MB transient RSS growth); the readdir floor (~0.6 s here) is paid either way and is the dominant, irreducible part. GC (once per pass) and boot sweep (once per boot) list assets anyway, so asset listing needs the full 383k-entry readdir regardless.
- Where it does matter: A-lite lists store2/ (4,500 keys) per boot/refresh. Unfiltered that costs the whole 30 MB list to learn 148 KB. If A-lite must list store2/ on any hot or per-boot path, the additive route is justified (wall ~0.3-1 s dominated by readdir, payload 200x smaller, no ~400 MB server RSS spike). If it lists store2/ only rarely, the existing list suffices (client filter 20-38 ms is negligible; the cost is the fetch).
- Recommended call: YES if A-lite lists store2/ on boot (cheap additive route, reduces memory spike and transfer markedly); NO if listing is only at the GC/sweep cadence where the full asset list is needed anyway. The maintainer's rule ("only if measured slow") is met by the median (>1 s) on best-case hardware, so I lean yes for the boot path. The route does not fix asset listing cost.
- Note the larger lever for assets, outside this question: a sharded dir or a server-kept index, since readdir over 383k flat entries is the floor.

## Sketch of the smallest additive route
- `GET /api/list-prefix?prefix=<utf-8 key prefix, URL-encoded>`; same `storageRouteLimiter` and `checkAuth` (`risu-auth`) as `/api/list`.
- Response: `{ "success": true, "content": ["store2/...", ...] }` (same shape as /api/list, so client parsing is shared). Keys are full keys, not stripped.
- Server: hexPrefix = hex(utf8(prefix)); readdir; keep `name.startsWith(hexPrefix)` (names are lowercase hex as written) AND the existing whole-even-length-hex rule (excludes `.tmp-` temps and `__` files); decode survivors. Empty prefix equals /api/list.
- Advertise via the existing `/api/caps` (`{ ..., listPrefix: true }`); client probes caps first (an old server omits the flag).
- Old server: `/api/list-prefix` is unknown, so it falls to its fallthrough (404 or SPA handler, not JSON `success`); client must treat anything other than `success:true` + array as "unsupported" and fall back to `/api/list` + client `startsWith` filter. Never trust an unfiltered answer: client re-filters by prefix anyway (20-38 ms).
- Case: callers use lowercase-hex-producing prefix; if upper-case-named files ever exist the server should compare on `v.toLowerCase()` (prototype does not).
