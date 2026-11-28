# Theme-pack apply cost: #363 (light-pack judgement) and #325 (size caps)

Date 2026-11-28. Session: `claude/363-325-apply-cost`, snapshot origin/main `2bd29b9fe`. Report only: no application code, registries or fixtures changed (the Theme V + D + A823 session owns `apply.ts`). Refs #363, refs #325; the PR closes neither. Decisions: MC-4790 in `Agents/mc/363-325.md`.

## 1. Setup (applies to every number below)

- Host: i9-13900KF, 32 logical cores, 64 GB, Windows 11; headless Chrome 158 (`--headless=new`, fresh profile). Best-case hardware: the numbers are lower bounds, not phone figures.
- Build: a production bundle (Vite 8 build, oxc minify, worker as its own chunk) of the real `preparePackSheet` plus `openJudgeSession`, `BUILTIN_PACKS` and `injectAppStore`. It is **not the full app bundle** (no `pnpm build` of `index.html`, no Tauri); the apply code, judge worker and validator are the shipped sources, minified. Harness: `Agents/Tools/apply-cost/` (README gives the commands).
- Inputs: the four shipped built-in packs (#363); four synthetic archives (#325, random bytes behind a `wOF2` magic, stored zip, one `@font-face` per font, `pack-` family names): `small` 1 MiB / 3 entries / 1 font, `mid` 64 MiB / 4 fonts, `bytecap` 249.6 MiB / 16 fonts of 15.6 MiB (the issue's byte-cap shape), `entrycap` 175.1 MiB / 512 entries (8 fonts of 20 MiB named by CSS, 502 small unreferenced PNGs).
- What a row is: wall time of `preparePackSheet` (read, hash, intake, judge, mint) with a fresh judge session per call, two warm-up applies dropped. It excludes `commitPackSheet`, style recalculation and paint.

## 2. #363: the light-pack apply cost on a production build

Command: `node drive.mjs <dist> out.json 15`, two repetitions, 15 timed applies each. "Without light job" is the same built-in with `modes` forced to `['dark']`, which drops only the `chat#light` job from the single judge request (`judgeVariants`, `wantsLightBase`).

| Pack | median ms with light job (rep 1 / rep 2) | median ms without (rep 1 / rep 2) | delta |
|---|---|---|---|
| Scratch White | 62.6 / 58.3 | 49.7 / 48.6 | +12.9 / +9.7 ms (+26% / +20%) |
| Office Sheet | 72.5 / 69.2 | 60.6 / 55.4 | +11.9 / +13.8 ms (+20% / +25%) |
| Origin Navy (dark, reference) | 41.6 / 41.1 | n/a | n/a |

- Long tasks: 0 on the main thread in every run (`PerformanceObserver` `longtask`, threshold 50 ms). The judging runs in the worker, so the main thread never blocks for it.
- The dev-build figures of the issue (233 and 236 ms, about +100%) do not reproduce on production: the absolute cost of the second judgement is about 10 to 14 ms here against 90 to 120 ms there. The +50% tripwire reads +20% to +26% on this host, a different base, so only the absolute delta compares across builds.
- Where the rest goes (`risu:judge:*` marks, `small` archive): the cold worker spawn and validator load is 17 to 38 ms of a 41 to 69 ms apply, the single judge job about 16 ms. A new worker is spawned for every apply (`run()` in `activePack.svelte.ts` closes the session after each preparation; `openJudgeSession` spawns on first `jobs`).
- **Not measured**: the Note 9 cold-start row N9-D2 (tripwire +150 ms). Device row owed; see section 5.

Cheapest cut if the Note 9 row trips (not recommended before it does): the verdict of a built-in is a pure function of its bundled text, so `prepareBuiltin` in `src/ts/themePack/apply.ts` could skip the `chat#light` job for a pre-proven light built-in, with the proven base held on the `BuiltinPack` entry in `src/ts/themePack/builtins.ts` and a unit test that re-judges every built-in and compares (the plan fallback of the issue). It saves the ~10 to 14 ms PC delta, about 15 to 25% of the apply. Larger and independent of it: reusing one judge worker across applies (`openJudgeSession` / `run()`), which removes the 17 to 38 ms cold start. Both touch `apply.ts` or `activePack.svelte.ts`, which the theme session is changing.

## 3. #325: peak memory and apply time at the caps

Time: `NOPOLL=1 SLEEP=300 REPS=5 node drive3.mjs <dist> <packs> time1.json` (real `prepareArchive`: store read, SHA-256 of the whole archive, `intakePack`, `mintMissing` per named font). Archive bytes come from an injected in-memory store (`injectAppStore`), so the Tauri or Node store copy is not in these numbers.

| Pack | apply ms (5 applies) | fonts minted |
|---|---|---|
| small, 1 MiB | 67, 201, 191, 240, 68 (first run cold; others include timer jitter) | 1 |
| mid, 64 MiB | 474, 480, 480, 477, 433 | 4 |
| bytecap, 249.6 MiB | 1352, 1336, 1329, 1284, 1231 | 16 |
| entrycap, 175.1 MiB | 846, 837, 829, 852, 824 | 8 |

Phase split at the byte cap (`runPhases`, one run): SHA-256 186 ms; `intakePack` 485 ms (pass 1 reads and CRC-checks every entry body, discarding it); sixteen `readVerifiedFile` re-reads 497 ms (30 ms each: allocate `Uint8Array(size)`, copy out, CRC again); sixteen `new Blob` 61 ms. Entry cap: 137 / 412 / 329 / 45 ms. The Note 9 apply of about 48 s at the byte cap is roughly 35 times the PC figure, so the work is CPU and copy bound, not a PC-only artefact.

Memory: renderer RSS (working set of the renderer process from `tasklist`, sampled at stage boundaries after 700 ms; `drive4.mjs`), baseline about 130 MiB.

| Pack | after fetch (archive held) | after hash | after intake | after mint (blobs live) | after revoke |
|---|---|---|---|---|---|
| mid | 200 | 200 | 205 | 262 | 259 |
| bytecap | 380 | 380 | 385 | 429 | 423 |
| entrycap | 303 | 303 | 299 | 459 | 457 |

Peak during the real apply, sampled every 150 ms while it ran (a sampling run also slows the apply, so its times are not used): 549 to 563 MiB at the byte cap in three runs, one run 812 MiB; 459 to 461 MiB at the entry cap. The at-rest steps explain 380 to 430 MiB; the extra 130 to 380 MiB is transient: each font is copied into a fresh `Uint8Array(size)` (`readWhole` in `src/ts/themePack/intake.ts`) and then copied again into a `Blob` (`mintMissing` in `apply.ts`), and the copies stay until a garbage collection. So the peak is about the archive plus the garbage of every font minted so far, 2.1 to 3.1 times the archive here. The device peak (1.10 GiB over a 286 MiB baseline, +0.8 GiB) is of the same order; the device store read (Tauri IPC or Node server) adds copies this harness does not have, unmeasured.

Cheapest cuts, in order of cost, all in files the theme session may touch:

1. **Mint from the archive bytes, no per-font copy.** For a stored (method 0) entry `readVerifiedFile` could return a `subarray` of the archive and `mintMissing` build the `Blob` from it; for a deflated entry keep today's path. Removes the transient `Uint8Array(size)` per font (about 250 MiB of garbage at the byte cap) and one CRC pass for a stored entry the whole-archive SHA-256 already vouches for (the archive key is the content hash). Files: `readVerifiedFile` / `readWhole` (`intake.ts`), `mintMissing` (`apply.ts`). Needs a decision whether the second CRC pass is a contract (opus-reviewer: blob lifecycle, verified-bytes invariant). Estimated saving, not measured: roughly 0.5 s of 1.3 s and 100 to 250 MiB of the transient peak on this host.
2. **Drop the whole-archive hold**: `prepareArchive` reads the whole archive (`getAppStore().read`) then `sha256Hex(bytes)`. Reading by range (the store has ranged reads on some platforms, `contract.ts`) would need an incremental hash and a platform check; larger, apply path and persisted-read contract.
3. **Lower the 256 MiB cap** (`PACK_MAX_UNPACKED_BYTES`, `PACK_FILE_MAX_BYTES` in `zipTail.ts`): the maintainer's call (issue text); no code to plan until decided. Memory is roughly linear in the archive, so the cap sets the ceiling directly.

The entry cap needs no cut of its own: 512 entries cost nothing beyond the bytes (unreferenced images are only read once in pass 1), so the cost follows referenced font bytes, not the entry count.

## 4. Verification and limits

- Numbers are from one host, one Chrome build and two to five repetitions each; no confidence interval; the raw JSON outputs stayed in scratch, only medians and the listed runs are quoted. The PC-first order of the device checklist applies, so these are the PC rows.
- Synthetic fonts are random bytes behind a font magic: they exercise bytes and copies, not font decoding by the engine (apply does not decode them either; the browser decodes when a screen uses the family).
- The prod bundle includes the module graph that `apply.ts` imports (store, hashing), not the whole app: app-level costs (Svelte, `DBState`) are outside it.
- Not run: `pnpm check` and tests (docs and scratch harness only; no `src` change).

## 5. Device row owed (not started)

Note 9 cold-start apply, N9-D2: Scratch White and Office Sheet, before/after the `chat#light` job (tripwire +150 ms, #363), and one byte-cap synthetic pack for #325 if its cut ships. A lease holder runs it after the device lane frees; none started here.

## 6. Recommendation

- #363: the production-build discriminator says the cost is about 10 to 14 ms on PC, with 0 main-thread long tasks. Do nothing until the N9-D2 row on the Note 9 trips; then the built-in proven-base skip (section 2) is the small cut, and a reused worker the larger one.
- #325: cut 1 above is small but not file-disjoint from the theme session: it edits `intake.ts` and `mintMissing` in `apply.ts`, which that session is changing. Not implemented; lane A decides when to schedule it, probably after stages D and C0. The cap change is the maintainer's.

