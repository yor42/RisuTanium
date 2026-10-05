# Report 58 — Save layer Stage 1a (durable Tauri write) and Stage 1b (block-store core, no callers): implementation and gate record

**STATUS:** both stages are implemented and passed their Gate 2 on 2026-10-05. Stage 1a ended `[EDITORIAL]` (round 1, then
a re-check; both `[EDITORIAL]`, no `[REJECT]`). Stage 1b ended `[APPROVE]` after one `[REJECT]` (round 1) and one remediation
(round 2). The maintainer typed "start records batch, then commit 1a and 1b" (`MC-195` 9). Both stages are committed, on top of
`80138f0d` and not pushed: 1a as `a7c0ef06` (14 files) and 1b as `15f01783` (19 files). The records commit follows them. **Stage 1c is next and is not started.** Nothing in 1a or 1b is called
by the running application except what 1a changes on the Tauri write path (section 2.1); 1b has no callers.

This report is a dated snapshot, written against the tree that was committed as `a7c0ef06` and `15f01783`; the records commit follows them. It is the
gate record for the plan in Report 57 (sections 6.7 and 10). It does not restate that plan.

**Evidence labels.** Three kinds of statement appear below, and each is labelled where it matters:
- *Implementer's claim:* from the `sonnet-coder` hand-back. The Orchestrator saved those reports to scratch because the
  agents' own `Write` was refused. A reviewer did not re-run these unless the text says so.
- *Reviewer-run:* the `opus-reviewer` ran or opened it itself.
- *Orchestrator-run:* the full-suite checks the Orchestrator ran on the working tree.

All performance figures cited here (the reviewer's 33 ms per 64 MiB, below) come from one i9-class machine, best-case
hardware (`MC-003`, `MC-010`). Test data is synthetic (`MC-131`).

**Sources** (the session scratchpad `stage1/`; not durable, so this report and ledger rows 1089 to 1098 are the durable
record): `impl1a/report.md`, `impl1a-r2/report.md`, `gate2-1a/review.md` (round 1 and the re-check),
`impl1b/report.md`, `impl1b-r2/report.md`, `gate2-1b/review.md` (round 1 and round 2), `step6/pending-records.md`.
Maintainer decisions: `MC-195` (item 8: 1a and 1b run in parallel after the records batch; item 9: the commit word), `MC-175`, `MC-011`.

## 1. Outcome at a glance

| | Stage 1a | Stage 1b |
|---|---|---|
| What | A Rust command, `write_durable`, and the routing of `blocks/`, `coldstorage/` and numbered-backup writes through it on Tauri | The block-store core: key mapping, framing, head swap, `BlockStoreOwner` (load, commit, replace, seed, inventory), fingerprint and rename decision. No callers. |
| Gate 2 | Round 1 `[EDITORIAL]`; re-check `[EDITORIAL]` (one title fix, made by the Orchestrator) | Round 1 `[REJECT]` (B1, B2); round 2 `[APPROVE]` |
| Substantive `[REJECT]` rounds | 0 | 1 (the three-round rule of AGENTS 1.2 is not near) |
| Reviewer | `opus-reviewer`, resumed for the re-check | `opus-reviewer`, resumed for round 2 |
| Implementer | `sonnet-coder`; remediation by `sonnet-coder` | `sonnet-coder`; remediation by a fresh `sonnet-coder` |
| Commit | `a7c0ef06` (14 files, +1060/-37) | `15f01783` (19 files, +6194/-1) |
| Ledger rows | 1089 to 1092 | 1093 to 1096 |

## 2. Files

### 2.1 Stage 1a (14 files)

New: `src-tauri/src/durable_write.rs`; `src/ts/storage/tauriDurableWrite.ts`; `src/ts/storage/tests/tauriDurableWrite.test.ts`.

Edited:
- `src-tauri/src/main.rs` (registers the command and holds the `write_durable` wrapper);
- `src/ts/storage/store/tauriFilesStore.ts` (routing);
- `src/ts/storage/tauriAtomicWrite.ts` (the sweep doc);
- `src/ts/bootstrap.ts` (the boot sweep of `blocks/`);
- test support and tests: `src/ts/bootstrap.remoteBlockCleanup.test.ts`, `src/ts/storage/tests/tauriFsFake.ts`,
  `src/ts/globalApi.saveDbTauriAtomic.svelte.test.ts`, `src/ts/process/tests/coldUnitsTauri.test.ts`,
  `src/ts/drive/tests/internalBackupSnapshotLoad.svelte.test.ts`,
  `src/ts/process/tests/coldStorageDeletionGuards.svelte.test.ts`, `src/ts/storage/tests/manualCleanup.svelte.test.ts`.

No `Cargo.toml` or capability change (implementer's claim; the reviewer read `src-tauri/capabilities/*.json` and `build.rs`
and found fs scope over `$APPDATA/**` and a plain `tauri_build::build()`, so the command adds no write reach beyond what
the window already has through plugin-fs; its registration matches the existing custom commands, with no ACL entry).

Line endings: `main.rs`, `bootstrap.ts` and `coldStorageDeletionGuards.svelte.test.ts` are CRLF and were kept CRLF; the other 1a files are LF. (The Orchestrator re-checked `main.rs` as CR 858 = LF 858.)

### 2.2 Stage 1b

New in `src/ts/storage/` (all LF): `blockKeys.ts`, `blockFrame.ts`, `mainFileFingerprint.ts`, `headSwap.ts`,
`blockStore.ts`. Line counts as the implementer reported them before remediation: 136, 290, 137, 151 and 1425.

New in `src/ts/storage/tests/`: `blockStoreHarness.ts`, `blockKeys.test.ts`, `mainFileFingerprint.test.ts`,
`headSwap.test.ts`, `headSwap.freshProfile.test.ts`, `blockStore.load.test.ts`, `blockStore.commit.test.ts`,
`blockStore.replace.test.ts`, `blockStore.crash.test.ts`, `blockStore.node.test.ts`, `blockStore.compat.test.ts`,
`blockStore.liveState.test.ts`, `blockStore.identity.test.ts`.

Edited: `src/ts/storage/store/indexedDbStore.ts` (the implementer reported imports at the top and appended code only:
`syncBytesOfStoredValue`, then, after remediation, `createIndexedDbHeadSwap`, `openDatabaseForHead` and `HeadOpen`).
The Orchestrator checked that all 1b files and `indexedDbStore.ts` are LF (CR = 0).

Not touched (implementer's claim): `src-tauri/**`, `tauriFilesStore.ts`, `tauriAtomicWrite.ts`, `appStore.ts`,
`contract.ts`, `risuSave.ts`, `package.json`, `globalApi.svelte.ts`, `bootstrap.ts`, `drive/**`.
`@aws-crypto/sha256-js` was already a direct dependency.

## 3. What the stages do

### 3.1 Stage 1a

(Reviewer-run reading of the source, round 1; the implementer's report agrees.)

`write_durable_with` in `durable_write.rs` runs, in order: `create_dir_all`; `create_new` of a temp file; `write_all`;
`sync_all`; rename, with the Windows-only retry; flush of the target directory; best-effort flush of the parent of each
directory this call created (added in remediation, O3).
- Any failure before or at the rename returns an error, removes the temp, and leaves the target's old bytes. One
  exception: an `AlreadyExists` temp is not this call's file and is left alone.
- A failed directory flush is logged with `eprintln!` and the call still returns `Ok`, because the rename has happened.
- The command has no `unwrap` or `panic` on its path.
- The body is decoded before any disk access (`decode_body`): a raw body, or (added in remediation, O1) a JSON array of
  integers 0 to 255, which is what Tauri's postMessage fallback and Android send. Any other shape is rejected before disk.
- The blocking work runs inside `tauri::async_runtime::spawn_blocking` (added in remediation, O2). A `JoinError` becomes
  an `Err(String)`, so the promise rejects and does not hang.

On the TypeScript side `writeFileDurable` awaits `invoke`, which resolves only when the command returns. Routing
(`isDurableKey`) sends `blocks/`, `coldstorage/` and `^database/dbbackup-\d+\.bin$` through it. The main file
`database/database.bin`, assets and the rest of `database/` stay on plugin-fs. The web and Node stores are untouched.
The boot sweep removes only names matching `^risu-write-[0-9a-f]{16}\.tmp$`, recursively under `blocks/`, plus
`coldstorage/`, `database/`, `remotes/` and `assets/` (the last two were already swept before 1a); it does not follow
symlinks or junctions.

### 3.2 Stage 1b

(Implementer's description; the reviewer read the source for the points named in sections 5 and 7.)

- `blockKeys`: `characterKeySegment(chaId)` is the lowercase hex of the UTF-8 bytes when that is at most 80 hex
  characters (40 bytes), else `h` plus SHA-256 hex through `digestSync` (no `crypto.subtle`, for plain-HTTP pages). The
  reviewer verified it is injective, never case-folded, and that the longest key is 111 bytes (under Node's 117). Generation
  ids sort by age.
- `blockFrame`: CRC-32, framing, single-block parse and check, the stubs pack, JSON-object blocks.
- `mainFileFingerprint`: a pure fingerprint of the bytes a conversion read (`b1:` header-only walk for `RISUSAVE` v1,
  `c1:` CRC-32 otherwise) and `decideMainFileRename`. Nothing is renamed by this module.
- `headSwap`: the `HeadSwap` interface (`read`, `swap(expected, next)` giving `won` or `lost`; a rejection means unknown);
  a Node swap (`ifVersion`, 409 is lost) and an in-process mutex swap. `createIndexedDbHeadSwap()` in `indexedDbStore.ts`
  is one read-write transaction on the raw connection. `createHeadSwapForStore` was removed in remediation (N5): the
  caller names the adapter.
- `blockStore`: `BlockStoreOwner` with `load()`, `readCommitted()`, `commitSave`, `replaceWholeState`,
  `seedEmptyProfile`, `findSeedBlockers`, `inventory`, `committedState`; plus free functions `createWebCommitLock`,
  `inspectGenerations`, `retireGeneration`, `assembleLegacyFile`. Input is the encoder's `snapshotLayout()` shape and the
  core never calls `encode()`. Only the flip calls the head swap; `put` refuses the head key.

## 4. Invariants and the evidence for each

"Red" below means what it can mean for new code: a fault injected in memory, or an in-memory revert of a fix, which
makes at least one test fail. There is no pre-change file to run the tests against (all of 1b, and `durable_write.rs`,
are new). Fault harnesses were scratch only: each rewrites one module's source in memory while the tests load, and
nothing under `src/` was edited for a fault.

### 4.1 Stage 1a

| Invariant (Report 57) | Evidence |
|---|---|
| D: when a write resolves, the file and (where the platform allows) its directory entry are flushed; a failure before the rename leaves the target intact | `cargo test --bin risuai durable_write`: 14 new (33 in the whole binary) before remediation; 18 under the `durable_write` filter after (the whole-binary count after remediation was not recorded). **Reviewer-run**, both rounds (14, then 18). Round 1 reports Windows 11, tauri 2.11.5 and plugin-fs 2.5.2 from the local `Cargo.lock`, and that the real Windows directory flush (`FILE_FLAG_BACKUP_SEMANTICS` plus `FlushFileBuffers`) succeeded. The re-check reported only that 18 passed and that the binary, `main.rs` command included, compiled. The TypeScript order test asserts `resolves only after the command resolves`. |
| Routing: only the three durable kinds go through the command | Reviewer-run: seven 1a suites, 492 passed, 1 skipped (re-check); four suites, 123 passed (round 1). |
| Boot sweep covers `blocks/` recursively and touches only temp names | Same suites. |
| Rejected shapes never touch disk | New tests: raw body, valid array including empty, 11 rejected shapes (object, string, number, null, 256, -1, 2.5, `"2"`, null element, nested array, bool); a rejected shape leaves the base directory empty. |
| New directories are flushed into their parents | New test `new_directories_are_flushed_into_their_parents` (1 + 2 flushes). |

Mutants and faults:
- **Implementer's claim, scratch only, not re-run by the reviewer:** Rust `noCreate`, `noCleanup`, `dirFlushFatal`,
  `allowDotDot`; TypeScript `bodyArray`, `noAwait`, `noKeyCheck`, `noRouting`, `noRecursion`, `bootNoRecursion`,
  `bootNoBlocks`: all killed.
- **Reviewer-run (4 TypeScript mutants, all seven suites each, via a scratch Vitest config that swaps module source as it
  loads), all killed:** no-routing (10 failures), no-recursive sweep (3), no-boot-sweep (1, in the bootstrap test),
  enter-symlinks (1).
- **Implementer's claim, remediation:** with the JSON-array arm of `decode_body` disabled in a scratch copy of the crate,
  `a_json_array_of_byte_values_decodes_to_those_bytes` failed (17 passed, 1 failed).
- **Reviewer's finding on two tests.** In round 1 the reviewer showed that the cold-unit "regression reproducer" and the
  backup "fails part-way" test were guards of the TypeScript contract, not reproducers: under the no-routing mutant the
  only failing assertion was that the injected fault fired (setup), because the test double rejects the durable command
  all at once and leaves nothing behind. The cold-unit test was relabelled "guard:" (E1); the backup test was retitled for a rejected backup write (E2), and the "guard" label is only on the cold-units test. The Rust tests own the no-partial
  property.

### 4.2 Stage 1b

The first table is the implementer's own claim about which tests cover which invariant and how many scratch faults each
killed (47 faults in all, every one failing at least one test in the first run). The reviewer did not re-run these 47.
After remediation the implementer re-ran them on the fixed code: 44 killed; one survivor judged equivalent after N2;
two not applicable because the text moved, adapted versions killed by 1 and 18 tests. The coder also re-ran the reviewer's
15 round-1 faults on the fixed code (implementer's claim, from `impl1b-r2/report.md`): 12 were killed; U5 is equivalent; Q2
and L1 were not applied because their text had moved, and the adapted versions were killed (Q2 re-expressed, killed by
`crash.test` scenario 12; L1 covered by the adapted U-loser fault). The reviewer separately ran its own faults (section 6).

| Invariant | Tests (implementer's account) | Faults killed (failing tests) |
|---|---|---|
| H: the head is written only by a compare-and-swap flip | `headSwap.test.ts` (mutex; IndexedDB with 2 connections, 100 trials; Node revision; census that head writes equal won swaps); `blockStore.node.test.ts` 12 converter races on the real server; `crash.test` seeded two-converter races on both store kinds | Node swap skips compare (5), mutex skips compare (3), IDB skips compare (3), owner writes head plainly (1) |
| U: three swap outcomes; nothing deleted on unknown | `replace` and `node` tests: response dropped is Won; unreadable head gives `unconfirmed`, no deletes, owner closed; third generation in head gives lost, no deletes | unchanged treated as lost and deletes (2), landed swap as lost (2), unreadable head keeps going (2), loser deletes without third-generation check (1) |
| Q, P, 2: `load()` writes and deletes nothing; damage installs nothing and is named | `load.test`: zero store mutations with leftover, kept and half-deleted generations and a replace in flight; 18 damage kinds; `node.test` real files and mtimes unchanged | load rewrites root (9), reclaims leftovers (2), installs despite damage (14), damage replace forgets kept marker (1) |
| 12: a generation change mid-load restarts the load | 30 seeded boots against a committing owner | skips race re-read (2) |
| 3, C, R: every listed name resolves at every crash point; old-in-full or new-in-full | `crash.test`: 9 save shapes on both store kinds, loaded fresh after every mutation; failure at each mutation then retry; two interleaved writers, 60 seeds, both kinds | pack without old members (11), own keys deleted before root (11), no read-back (2), previous generation deleted before flip (6), root written first (3) |
| 4: acknowledged only after resolve; no re-read to overwrite | commit (fake Node) and node (real server): A's write lands then throws, B writes, A retries, gets a conflict, B survives | retry re-reads revision (3), ack before write resolves (1) |
| 5, 7: a character-only save writes exactly the character key and the root; no change writes nothing | commit tests; compat tests (`encode()` not called) | root skipped when root owes nothing (2) |
| 8: no create-only write to a key that may have been deleted | orphan `c/X` read first and written on the read revision; `§playground` re-created; 255-byte chaId on the real server | garbage key written create-only (5) |
| 9: size guard per write; replace pre-flight | injected limit | commit guard removed (2), replace pre-flight removed (3) |
| 10: return-to-origin A, B, A | block, root field, stub, thrown write then identical bytes | first bytes as baseline (3), root equality skip (2), pack baseline (4) |
| G: no commit into a non-current generation without stopping | stale Node root gives 409; off Node, retired generation gives `generation-gone`; replace between seq check and root write gives sticky `head-moved`; 60 seeds | head check removed (4), seq check removed (7), pending check not remembered (2), stop not sticky (1) |
| W: lock order | load, seed, replace and inventory never take the commit lock; a page without Web Locks converts; no post-commit deletes without Web Locks off Node | deletes without Web Locks (1), replace takes lock (1), commit does not take lock (4) |
| S, S2: Save mine; seed only on an empty profile | peer deletes a value, Save mine, reload not damaged; seed blocked by head, main file, pre-blocks, numbered pre-blocks or numbered backup | Save mine not rewriting everything (2), pack without stored members (1), seeds over data (5) |
| V: kept and leftover generations | `inventory()` reports both; damage-path replace writes the marker first | retire deletes kept (2), inventory misses kept (2) |
| K: key mapping | about 430 awkward ids: injective, distinct under case folding, creatable under Node, desktop and IndexedDB rules, at most 117 bytes | hash truncated (4), hex too long (1), case folded (3) |
| M: fingerprint and rename decision (pure) | header-only fingerprint; copy, leave, delete-after-copy, numbered variant, nothing without `convertedFrom` | overwrites pre-blocks (1), renames without matching (2), copy not recognised (2), fingerprint ignores length (1) |
| X, 6, 7: bookkeeping stays out of the decoded database; framing equals the encoder's | `compat.test`, labelled guards against the real encoder and decoder: no `__` key in the decoded database; exact bytes; no `encode()` | none (guards only) |

Scenarios 1, 2, 5, 6, 7, 8, 9 and 12 of Report 57 section 8 are covered at core level. Scenarios 3, 4, 10 (the snapshot
part), 11 and 13 need callers or the toggle (13: `inventory` only) and are for 1c (implementer's claim).

**Remediation tests (round 1 `[REJECT]` and the non-blocking items)**, red by in-memory reverts of each fix, not by the
pre-fix file (the pre-fix source was not saved):

| Item | Test | Revert killed (failing tests) |
|---|---|---|
| B1 | new `headSwap.freshProfile.test.ts` (10 tests; the database is dropped before each) | missing DB rejects (5 of 10); failed open as absent (1); thrown open as absent (2) |
| B2 | new `blockStore.liveState.test.ts` (15 tests) | load installs on a live owner (5 of 15) |
| N4 | peer replaced in between: mutating-operation count unchanged, peer head and keys intact; control test won | no head check (1) |
| N2 | landed-but-lost gives won; a re-read naming the previous generation stays lost | own-generation lost stays lost (1) |
| N3 | head re-read and root re-read failures | head re-read error treated as no change (1); root re-read (1) |
| N1 | new `blockStore.identity.test.ts`, with `bytesEqual` wrapped by `vi.mock`: the first unchanged save compares, the second compares 0 and writes 0; change-and-return writes | block not adopted (2), pack member not adopted (2), adopt drops revision (2) |
| N6 | non-binary head test in `headSwap.freshProfile.test.ts` | non-binary head retried (1) |
| N5 | removes a function, so no test | n/a |

## 5. Deviations from Report 57, and their dispositions

### 5.1 Stage 1a (section 6.7)

All six were declared by the implementer; the reviewer judged each against the invariants.

| Deviation | Disposition |
|---|---|
| The command is async (a runtime worker), not a main-thread command | Reviewer: correct, a synchronous command runs on the main thread. The blocking cost was raised as O2 and fixed (`spawn_blocking`). |
| Rust creates the parent directories; the store skips `mkdir` for durable keys | Reviewer: correct; the Windows refuse-before-mkdir case is tested. |
| Rust enforces the key rules only, not the three durable kinds | Reviewer: acceptable; the reach equals the fs scope (`$APPDATA/**`). |
| The key header is `encodeURIComponent(key)`, decoded strictly (`%XX` plus UTF-8) | Reviewer: correct; a decoded `../` and a decoded leading `/` are refused and tested. |
| The rename retry is `cfg!(windows)` only | Reviewer: correct; on Unix errno 5 and 32 are EIO and EPIPE and must not be retried. |
| No ACL entry or capability change | Reviewer: consistent with the existing commands and `build.rs`. The implementer's reasoning on tauri 2.11.5 was source-reasoned, not run; the reviewer read the same files. |

A test-only deviation: the Tauri-store suites need an `invoke` mock that answers `write_durable` (`createDurableInvoke` in
`tauriFsFake.ts`).

**Reviewer's key-rule parity check (round 1):** the TypeScript and Rust key rules match on empty key, backslash and
control characters, leading or trailing `/`, drive prefix, empty or dot-leading segments, temp-named last segment,
`< > : " | ? *`, trailing dot or space, and 255 UTF-8 bytes per segment. Windows reserved device names (`CON`, `NUL`) are
refused by neither side, which matches the existing plugin-fs path.

**A caveat to Report 57 section 6.7's wording.** Report 57 section 6.7 says a JSON argument would serialise multi-MB blocks
as number arrays. That holds for a JSON argument; but on Tauri's postMessage fallback (and always on Android) even a
`Uint8Array` body travels as a number array (reviewer, reading `process-ipc-message-fn.js` and `protocol.rs` of tauri
2.11.5). 1a therefore accepts that shape (O1) while sending raw bodies on the custom protocol.

### 5.2 Stage 1b (implementer's list of 14; the reviewer's disposition where it gave one)

The Gate 2 review says deviations 1, 3, 4, 5, 7, 8 and 9 are acceptable against the invariants. It does not
individually disposition 2, 6 and 10 to 14; they are listed here as the implementer stated them.

1. The core does not import `risuSave.ts` (it would pull the application graph into tests): it has its own CRC-32 and root
   framing, with guard tests against the encoder. The size check is inline against `NODE_BODY_LIMIT_BYTES`, injectable.
   *Reviewer: acceptable.*
2. No `ByteStore` interface change; the head swap is a separate interface, chosen by store kind in 1c. *Not individually
   dispositioned; the choosing factory was then removed (N5) and 1c must pick the adapter explicitly.*
3. The mutex swap is keyed per store object (one per page in production). *Reviewer: acceptable; `getAppStore` is
   memoised per page.*
4. The commit lock is taken on Node too; the sequence read is skipped on Node; Node post-commit deletes are always
   conditional; off Node without Web Locks there are no deletes or pack trims. *Reviewer: acceptable (taking the lock on
   Node is harmless).*
5. `rootOwed`, not in the plan: after a pre-commit write resolved and the root write failed, the next save writes the root
   even if unchanged. *Reviewer: correct and needed; the fault for it is killed.*
6. A failed post-commit head read stays pending and runs at the start of the next commit; the `head-moved` stop is sticky.
   *Not individually dispositioned.*
7. `unconfirmed` closes the owner; a definite `lost` leaves it as it was. *Reviewer: acceptable.*
8. A failed read-back of the new root gives `lost` with reason `generation-damaged` and deletes nothing. *Reviewer:
   accurate, because the head is untouched.*
9. Fresh-generation keys are written unconditionally even on Node; the kept marker is read first and written on the read
   revision. *Reviewer: acceptable.*
10. `load()` records the acknowledged values and returns the loaded blocks; seeding the encoder's committed layout is 1c.
11. The `botPresetsId` clamp and the decoder's tolerance of an absent target are 1c; the core guarantees every listed name
    resolves at every crash point.
12. Per-save work is O(names) pointer maps with no block byte copies; key segments are recomputed per save. A
    per-generation cache is possible in 1c.
13. On Tauri, invariant D belongs to 1a; the Tauri swap here is the mutex over the store, tested in memory.
14. Not tested: WebKit or Android IndexedDB atomicity, a real browser for `createIndexedDbHeadSwap` (fake-indexeddb
    only), a tab closed mid-transaction.

Reviewer on upstream compatibility: the core's framing equals the encoder's (guard tests plus the reviewer's reading of
`encodeRawBlock`), a block set assembles to a file that decodes like the encoder's own, and `__` bookkeeping is dropped.

## 6. Gate rounds

### 6.1 Stage 1a, Gate 2 round 1: `[EDITORIAL]`

`opus-reviewer`; 156,934 tokens, 48 tool uses, about 8.5 min (ledger row 1090). Behaviour accepted; invariant D and
section 6.7 hold (section 3.1 above).

| Finding | Kind | Resolution |
|---|---|---|
| E1 `coldUnitsTauri.test.ts`: the "regression reproducer" is a guard | editorial | Relabelled "guard: …"; header says the Rust tests own part-way atomicity (remediation, verified at the re-check). |
| E2 `globalApi.saveDbTauriAtomic.svelte.test.ts`: "fails part-way leaves no partial backup" cannot be produced by the test | editorial | Retitled for a rejected backup write; Rust tests named as the owner. |
| E3 `main.rs` doc: "never serialised as a JSON number array" is false on the postMessage fallback | editorial | Doc now says raw body on the custom-protocol IPC, JSON byte array accepted from the fallback and from Android. |
| E4 `internalBackupSnapshotLoad.svelte.test.ts` `failPayload` doc | editorial | Now separates plugin writes (partial body) from durable writes (nothing). |
| O1 accept a JSON-array body | optional | **Orchestrator folded in** (`decode_body`). |
| O2 `spawn_blocking` for the blocking work | optional | **Orchestrator folded in.** |
| O3 flush newly created directories | optional | **Orchestrator folded in** (best-effort, after the rename and the first flush). |
| O4 name durable writes in the `sweepAtomicWriteTemps` doc | optional | **Orchestrator folded in.** |
| O5 `eprintln!` is invisible in a Windows GUI release build (stderr is null) | optional | **Orchestrator left it open.** Carried to 1c (section 9). |

### 6.2 Stage 1a, remediation and re-check: `[EDITORIAL]`

Remediation: `sonnet-coder`, 81,350 tokens, 34 tool uses, about 2.7 min (row 1091). Coder checks (its claim):
`cargo test --bin risuai durable_write` 18 passed; five vitest files 231 passed; `pnpm check` 0 errors.

Re-check: the same `opus-reviewer`, resumed; 183,923 tokens cumulative, 11 tool uses this round, about 1.9 min
(row 1092). **Reviewer-run:** `cargo test --bin risuai durable_write` 18 passed; the seven 1a suites 492 passed, 1
skipped; history-word grep over the remediation diff and `durable_write.rs` found nothing. E1 to E4 and O4 closed.
Order and failure semantics of invariant D unchanged; `decode_body` runs before `app_data_dir` and before
`spawn_blocking`; a `JoinError` becomes an error; O3 cannot fail a successful write (errors only go to `eprintln!`).

One required correction remained:
- **R1** `coldUnitsTauri.test.ts`: the test "a successful write goes through the durable command and never opens the unit
  path with the plugin" had no label, though the file header says every test is labelled. **The Orchestrator prefixed it
  "new behaviour:" itself and verified the change by diff.** The Orchestrator verified the edit by diff; in the later commit-message check the reviewer confirmed the title reads "new behaviour: …".

Optional, **O6** (the reviewer's): `decode_body` copies a raw body in full, because `spawn_blocking` needs owned data and the
request only lends the body. Peak memory for one write is twice the body; for a 1 to 2 GB modules block (which exists in
real profiles until Stage 2 splits it) that is a transient extra 1 to 2 GB on the desktop. Not a correctness issue.
**The Orchestrator accepted it as a known residual until Stage 2.** The reviewer named `block_in_place` on the borrowed
slice as the alternative, at the cost of tying up an async worker.

### 6.3 Stage 1b, Gate 2 round 1: `[REJECT]`

`opus-reviewer`; 263,457 tokens, 50 tool uses, about 12.4 min (row 1094). Substantive streak: 1.

| Finding | Severity | Resolution |
|---|---|---|
| **B1** The IndexedDB head swap's `read()` rejects on a profile whose `risuai` database does not exist yet, so `load()` and seeding fail on a fresh web profile (scratch test: `FRESH HEAD READ -> rejected StoreError`, `DATABASES AFTER -> []`). The `headSwap.test.ts` `beforeEach` created the database and masked it. | MAJOR, loud | **Orchestrator confirmed in source** (`withConnection` throws on a null connection). Fixed: a missing database reads as absent; a failed open still rejects; the swap on a missing database rejects as unknown and creates nothing. New fresh-profile tests. |
| **B2** `load()` on an already-live owner re-binds it to whatever the head names and clears a sticky stop, so a stale tab's next `commitSave` overwrites a restore and deletes what it added (reproduced on both store kinds: carol lost, alice overwritten). | MAJOR, silent data loss through the core API | **Orchestrator confirmed in source** (`load()` installed the fresh state unconditionally). Fixed in two parts: `load()` refuses with `BlockOwnerStateError` unless the owner is unloaded (checked before and after the read), and a non-installing `readCommitted()` shares the read path. |
| N1 an unchanged block held as another `Uint8Array` is compared byte for byte on every save (reviewer-run: an unchanged 64 MiB modules block cost 32 to 34 ms per save against 0.0 ms for the same object; best-case hardware) | MINOR, performance | Folded in: on equality the caller's object is adopted, keeping the revision. |
| N2 a definite `lost` whose re-read names this replace's own generation reported "did not happen" | MINOR | Folded in: the re-read naming its own generation is `won`. |
| N3 `changedSince` swallowed read errors and reported damage | MINOR | Folded in: uses the retrying reads and throws `BlockStoreReadError`. |
| N4 a `keepDamaged` replace did not require the head still to name the damaged generation | MINOR, plan-level | Folded in: returns `lost` with reason `head-moved` before any write. |
| N5 `createHeadSwapForStore` gave IndexedDB the in-process mutex | 1c wiring hazard | Folded in: the factory was removed; the caller names the adapter. |
| N6 a non-binary `blocks/head` on IndexedDB made the head read throw at every boot (suspicion) | suspicion | Confirmed by the remediation coder: retried 4 times, then `BlockStoreReadError` every boot. Fixed: `StoreNotBinaryError` is rethrown at once; `load()` reports `bad-head`; seed counts it as a head; `checkHead` treats it as `head-moved`. |
| N7 with a damaged head the backup replace keeps no generation | 1c / plan gap | **Not fixed; recorded for 1c** (section 9). |
| N8 `readPack` copies each stub while `live.keys` also retains the pack | minor memory | **Orchestrator skipped it;** carried (section 9). |
| N9 the `U5` mutant (retry the IndexedDB swap on any error) survived | equivalent mutant | No action: an aborted transaction commits nothing. |
| E1 `blockStore.load.test.ts` title overstated | editorial | Retitled. |
| E2 `blockStore.compat.test.ts` describe claimed allocation was measured | editorial | Retitled: "an ordinary commit writes only the changed blocks and the root and never asks the encoder for a whole file (invariant 7)". |
| E3 `ReplaceResult` `lost` comment and `load()` docs | editorial | Updated with N2 and B2. |

Reviewer-run: 15 scratch faults, 14 killed; `U5` equivalent. The reviewer did not re-run the implementer's 47. The
Orchestrator folded N1 to N6 and E1 to E3 into the remediation brief with B1 and B2.

### 6.4 Stage 1b, remediation

`sonnet-coder` (a fresh one), 182,250 tokens, 80 tool uses, about 14.3 min (row 1095). Implementer's claims: `pnpm check`
0 errors; `pnpm vitest run src/ts/storage` 81 files, 2076 passed; reverts and fault results as in section 4.2. Files:
`blockStore.ts`, `headSwap.ts`, `store/indexedDbStore.ts`, five existing test files adjusted, and the three new test files.
Adjusted tests: the `replace.test` lock-order test now uses `readCommitted` plus a fresh owner `load`; two `headSwap.test`
calls moved to `readCommitted`. Not re-run: the reviewer's scratch `idbFresh` and `reload` tests (a reload now throws on the
second load by design). All new files LF (Orchestrator re-checked CR = 0).

### 6.5 Stage 1b, Gate 2 round 2: `[APPROVE]`

The same `opus-reviewer`, resumed; 321,547 tokens cumulative, 26 tool uses this round, about 4.5 min (row 1096). The
reviewer re-read the source of `blockStore.ts`, `headSwap.ts` and the appended `indexedDbStore.ts` code and did not rely on
the coder's report. **Reviewer-run:** 12 new faults, 11 killed, each run of 236 tests in the block-store and head-swap files
with the unmutated tests all passing.

- B1, B2, N1, N2, N3 and N4 closed. The only assignments to `this.live` and to `state = 'live'` are in `load()` (from
  unloaded only) and in a won `replaceWholeState`; reverting the guard fails 5 tests, making `readCommitted` install
  fails 4.
- N6 closed except for one test: the fault `N6-checkHead-nonbinary-not-moved` **survived** (236 of 236 passed), so
  `checkHead` stopping the owner on a non-binary head has no test (**R2-N1**).
- **R2-N2:** `replaceWholeState` over a non-binary head still throws `StoreNotBinaryError`, so a damage prompt for such a
  head can only offer "stop"; "load newest backup" would throw. Only a forbidden plain `setItem` can produce such a head.
- E1 to E3 closed. The reviewer found no history narration in the new comments; it opened the `beforeEach` comment in
  `headSwap.test.ts` afterwards and found it accurate.

**Gate count for 1b: one substantive `[REJECT]`, then `[APPROVE]`.**

## 7. Orchestrator-run checks

| When | Tree | `pnpm test` | `pnpm check` | `pnpm build` | Other |
|---|---|---|---|---|---|
| 1a pre-gate | 1a plus 1b in progress | 460 files, 8995 passed, 4 skipped | 0 errors, 0 warnings | ok | eol preserved; history-word grep clean |
| 1b pre-gate | 1a accepted plus 1b | 469 files, 9222 passed, 4 skipped | 0/0 | ok | all new files LF, `indexedDbStore.ts` LF; grep: one false positive ("refused too") |
| **Run on the tree that was committed, with both stages** | after 1b remediation | **472 files, 9253 passed, 4 skipped** | **0/0** | **ok** | LF; grep: the same false positive |

Reviewer-run (not the Orchestrator's): `cargo test --bin risuai durable_write`, 18 passed (re-check). Round 1 reported
Windows 11, tauri 2.11.5 and tauri-plugin-fs 2.5.2 as the local `Cargo.lock` resolved them. `Cargo.lock` is gitignored, so a
build elsewhere may resolve other versions.

The last row is the run on the tree that was committed (no source change after it, per the Orchestrator; only scratch
files were edited between that run and the two commits).

## 8. Not verified natively

- No Tauri webview run of `write_durable`: the raw IPC body with a custom header through a real webview, and the postMessage
  fallback, are source-reasoned (the reviewer read `ipc-protocol.js`, `process-ipc-message-fn.js` and `protocol.rs` of tauri
  2.11.5) and mocked in tests.
- The directory flush was tested on Windows only. Unix and macOS directory flush, and the rename over a held handle,
  were not run.
- Power loss is untestable here; Report 57 states it as a residual.
- IndexedDB atomicity was tested only with `fake-indexeddb`, not WebKit, Android or a real browser. (Report 57 section 14
  records a separate real-browser measurement of the compare-and-swap in Chrome, Edge and Firefox, not Safari or Android.)
- A tab closed in the middle of a transaction.
- Every performance figure is best-case hardware (`MC-003`, `MC-010`).

## 9. Carry-forward to Stage 1c

1c must:
- **Pick the head swap explicitly:** `createIndexedDbHeadSwap` for the IndexedDB store (the factory that chose by store
  kind was removed, N5).
- **R2-N1:** add a test that a non-binary head read in `checkHead` stops the owner.
- **R2-N2:** decide what the damage prompt offers over a non-binary head (today only "stop" can work).
- **N7:** a damaged-head backup replace keeps no generation (`previousGeneration` is `null`, so every generation becomes
  "leftover" and manual clean-up could delete the last good one). The reviewer suggests treating the newest generation with a
  root as kept when the head is unreadable. This is a plan gap, not a 1b defect.
- **N8:** `readPack` copies each stub while `live.keys` retains the whole pack; `subarray` would avoid the second copy.
  The Orchestrator skipped it in 1b.
- **1a O5:** the failed-directory-flush log is `eprintln!`, invisible in a Windows GUI release build. Consider the app's
  log facility.
- **1a O6:** `decode_body` copies the raw body, an extra 1 to 2 GB transient for a 1 to 2 GB modules block, until Stage 2
  splits the modules block.
- **Everything in the 1b implementer's "Left for 1c" list:** the boot path (legacy versus block, the damage prompt,
  conversion, seed, `cleanChunks` gating on kept, `opfsCopyBack.classify`); the save loop (`commitSave` under
  `dbWriteLock`, parking, the Save mine UI, iteration bookkeeping, broadcast, `createWebCommitLock(navigator.locks)`); the
  archive pass (stub pack, `checkCommittedBlocks`); both restores and the undo copy; snapshot cadence and the Node
  over-limit notice; finishing the rename; the manual clean-up keep set and the leftover and kept UI; retiring
  `risuSaveCache` and removing the Remote Saving toggle; seeding the encoder's committed layout; the `botPresetsId` clamp;
  the swap choice by store kind; the key-segment cache.
- Scenarios 3, 4, 10 (snapshot part), 11 and 13 of Report 57 section 8 can only be shown with the callers.

## 10. Records

- Commits: 1a `a7c0ef06`; 1b `15f01783`. Both local, not pushed, on top of `80138f0d`. The records commit follows them.
- Ledger rows 1089 to 1098 (the dispatches in sections 6.1 to 6.5, then this batch's `doc-writer` and `doc-verifier` rows).
- Roadmap: the Stage 1 status under the save-layer track. Live-State: commit list and next numbers. Carry-Forward: the
  Stage 1 TODO updated.
- The maintainer's words "start records batch, then commit 1a and 1b" are recorded as `MC-195` item 9; they are the source
  of the quotation in this report.
- **Commit messages were fact-checked before commit** by the gate reviewers (recorded in ledger rows 1092 and 1096). 1a:
  `[EDITORIAL]`; C1, the guard label is only on the cold-units test; C2, the command's reach is a subset of the fs scope, and
  the ACL claim was reasoned from source, not run (200,600 tokens cumulative, 9 tool uses, about 1.7 min). 1b:
  `[EDITORIAL]`; four sentences (the `indexedDbStore` imports, the re-run figures for the 47 faults, compatibility
  overstated as an upstream decode, and the non-binary head "retried forever"); 335,997 tokens cumulative, 5 tool uses,
  about 1.4 min. The Orchestrator applied all required wording and the optional items before committing.
