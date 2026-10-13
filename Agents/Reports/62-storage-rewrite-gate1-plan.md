# Report 62 — The A-lite storage rewrite: the consolidated Gate 1 plan (v3 applied) and its gate record

**STATUS (2026-10-13):** **Gate 1 of this plan PASSED** (senior-advisor round 3 `[APPROVE]`; `opus-reviewer` round 3 `[APPROVE]` with four binding carry-forward items, C1 to C4). The maintainer approved the stage list and answered the plugin-storage, lazy-module and quota questions in round G1 (`MC-288`). **Stage 0a was next when this report was written; it is done (2026-10-13, branch `feat/alite`, not merged), see Part C. No later stage has started.** Parts A and B are the plan and its Gate 1 record, not an implementation record; nothing in them is verified by running code. Part C records stage 0a.

**(Updated 2026-10-14, Part D.)** **Gate 1 of stages 1+3 PASSED on 2026-10-14** (`opus-reviewer` `[REJECT]`, `[REJECT]`, `[APPROVE WITH CONDITIONS]`, then three condition checks ending `[APPROVE]`); the maintainer's answers are `MC-290`. Several lines of Parts A and B are superseded by that plan and are marked "(updated 2026-10-14, Part D)" where they stand; the original text is kept. Part D records the stage 1+3 plan.

This report is a dated snapshot written on 2026-10-13 against `main` at `f26e1e457` (pushed). It consolidates plan v2 with every v3 change applied, the binding items of the Gate 1 disposition, and the maintainer's answers of 2026-10-13 (`MC-286` to `MC-288`), so a reader needs no other plan file. It is a documentation draft by `doc-writer`; `doc-verifier` returned `[EDITORIAL]` on it (ledger row 1732: about 120 claims, 116 VERIFIED, 2 WRONG fixed, 2 cosmetic applied). The plan's own claims are not re-verified by running code.

**Evidence labels.** Each label is the source's own and none is upgraded here: VERIFIED, TRACED (read in source), INFERRED (reasoned, not run), PARTIAL, AUTHOR-ONLY (an author's measurement not independently re-run), PLAUSIBLE and TODO(evidence). Figures cited from the S0 spike (`S0-n`) were measured on an i9-13900KF, a standalone Chrome page on one Note 9, or in a scratch model. **They are best-case-hardware or proxy figures (`MC-003`, `MC-010`); no Pi-class box, mid-range phone, real Tauri or Android app path was run.** `file:line` citations are as the reviewers verified them at `f26e1e457`.

**Sources (session scratch, not durable; this report is the durable record).** Folder `...\scratchpad\storage\` under `C:\Users\yor42\AppData\Local\Temp\claude\C--Projects-RisuAI\7373226a-26bd-41e1-bd9d-31e3becc2524\`: `rewrite-gate1-plan-v1.md`, `rewrite-gate1-plan-v2.md`, `rewrite-gate1-plan.md` (v3 plus section 7, the disposition), `S0-report.md`, `maintainer-answers.md`, and `gate1-review\` (`opus-verdict.md`, `opus-verdict-r2.md`, `opus-verdict-r3.md`, `advisor-verdict-r2.md`, `advisor-verdict-r3.md`, `advisor-followups.md`). Advisor round 1 has no file: its findings F1 to F11 are listed in plan v2 section 0.

---

# Part A. The plan

## A0. Decisions this plan follows, and what it removed

Decisions: `MC-283` 3 to 6, `MC-284` 1 to 4, `MC-285`, `MC-282` 2 to 5, `MC-281` 1, 2, 8 and 9, `MC-175` and `MC-223` (`.bin` compatibility), `MC-199` 2 and 3, `MC-132` 1 to 3, `MC-130` 1 to 4, `MC-146` 1 to 3, `MC-268` 1 and 5, `MC-270` 1 and 4, `MC-011` (the fork has never shipped), `MC-091` (complexity reduction is in scope) and `MC-300`. Amended or added by the maintainer on 2026-10-13: `MC-286` (M1: the new automatic clean-up runs on plain-HTTP pages too; amends `MC-282` 4 and `MC-284` 3), `MC-287` (M2: old fork-format data may be deleted) and `MC-288` (round G1).

Following the instruction to prefer removing mechanisms, the plan dropped three between v2 and v3: the owner-claim protocol, the commit-key recovery CAS sequence (replaced by "rebuild through the bulk import path") and resident plugin cold values (they stay lazy).

## A1. Mechanism and premises

### A1.1 Today's store (what is replaced)

- **One mutable generation.** A root, fixed blocks, character blocks and one pack of all stubs (`blockKeys.ts:4-17`, fixed names at `:23`).
- **Commit.** Changed `c/<k>` blocks are rewritten in place, then the pack, then the root with `__seq`+1 (`blockStore.ts:1124-1300`). On Node the root's `ifVersion` is the conflict point (`:1257-1283`); off Node it is a stored `__seq` check (`:1221-1231`).
- **Head CAS** for restores and the legacy main-file conversion (`blockStore.ts:1528`, `saveStep.ts:116-154`).
- **Archived characters** as a second form: a cold unit under a fresh uuid per archive plus a stub, which needs the boot archive pass, put-back fingerprinting and re-archive.
- **Snapshots.** Whole-layout files, written at most every 5 minutes (`globalApi.svelte.ts:771`, `:1815`, written at `:1836`) and skipped on Node over 100 MiB (`:1758`).
- **Chat cold pointers** (`coldstorageData.ts:6`, `preLoadChat` at `coldstorage.svelte.ts:763`).
- **V3 plugin cold storage** written in place at runtime (`pluginColdStorage.ts:134-169`).

### A1.2 A-lite (the target)

**Keys.** One new top prefix. Flat leaves. Lowercase 26-character base32 ids, never reused. At most 117 bytes (S0-4). No key that is also a directory prefix (Tauri). The commit key is one fixed leaf. **(Updated 2026-10-14, Part D, `MC-290` U2:** the prefix is `store2/` (not `alite/`); the commit key is the top-level key `store2-commit`, outside the prefix; the plan adds `store2-sweep` and `store2-fence` at top level. The id alphabet is `0-9a-v` (ordinal order equals numeric order); ordinary keys are 35 bytes and staged keys 43 bytes, not the 26-character base32 ids written here. Stage 0a's `alite` identifiers are renamed in the P0a follow-up on `feat/alite`.)

**Commit key.** Fields: `{fmt, seq, epoch, current:{key,at}, retained:[{key,at}]≤20, pins:[{key,reason}], staging:null|{owner, prefix, startedAt, label}, convertedFrom, convertedAt}`.
- Every commit-key write (commit, restore, marker set and clear, pin change) increases `seq` by 1 **and** writes a new random `epoch`. `epoch` is 16 bytes from `crypto.getRandomValues`; this fixes what the "seq-only compare" mutant removes (opus r3 and advisor r3 editorial).
- Off Node, the CAS compares the **full commit-key bytes** (as `headSwap.ts:172` and `indexedDbStore.ts:523-527` do today), so no recovered or rewritten value can equal one a tab holds as its base.

**Manifest** (write-once):
- `{fmt, seq, createdAt, shardCount, shards[], fixed:{config, presets[], loadouts, plugins[], moduleIndex, modules:[{id,key}], pluginStorage:{k:key}}, order}`, where `order` is the character-order unit. `shardCount` is a manifest field, not fixed in code. `pluginStorage` is present (Q-C settled "inside backups", `MC-288` 2).
- Every ref carries its byte size and CRC32 (the `blockFrame.ts` CRC).
- **Shard entry, one per character:**
  - entity uuid;
  - every `ColdStubFields` field **except `chats`** (`coldCharacter.ts:44-62`: type, name, image, chaId, lastInteraction, trashTime, characters, creatorNotes, coldstorage = entity uuid, coldStoragedChats, chatPage, firstMsgIndex, coldVersion, coldChatCount, tags, creator). `lastInteraction` stays in the entry. The stub's placeholder chat is built at load and never persisted (I9);
  - unit refs: core, lore, scripts;
  - per chat `{id, core, chunks:[{key,count,bytes}], tailKey, messageCount}`;
  - `usesDisplayScripts`: whether the character has Lua editDisplay, a display trigger or index-dependent CBS (for `MC-284` 2's "wait only if used").
  - C4 decided 2026-10-13 (`MC-289`): asset references are recorded per character as a separate list unit, not in the shard entry (A5.4 note).
- The module index carries the same `usesDisplayScripts` flag per module.

**Units:**
- character core, lore and scripts (`MC-283` 4);
- chat core plus id-named chunks of about 128 KiB, byte-capped, with the boundary list in the shard entry;
- one unit per module (`MC-283` 6);
- per-key pluginStorage units (inside snapshots, `MC-288` 2);
- per-preset and per-plugin member maps through the same versioned member map;
- the config root.

Per-send chat fields (`lastMemory`, `scriptstate`) travel with the tail if the stage 3 census shows they change per send. The chat-level `isStreaming`, the character-level `reloadKeys` and the `chatId` stamp are volatile and excluded. `statics` is coalesced into the next root write or an idle commit (decided: it has one writer, `index.svelte.ts:658`, and one reader, the statistics export `SettingsExportButtons.svelte:25`; a crash may lose a few counts).

**Retention admission.** This matches today's numbered-backup cadence, so it needed no maintainer question.
- The previous `current` enters `retained` only when `retained` is empty or its newest entry is at least 5 minutes older. Otherwise it is dropped and becomes garbage.
- Two cases **always** push the previous `current`: save-mine off Node (the peer's state) and a **restore**, so a restore is undoable.
- `current` is always the latest commit. `retained` holds at most 20 entries; overflow drops the oldest unpinned entry. `pins` exempt an entry from rotation.
- The clock serves admission only, never safety.
- Worst case (S0-11, S0-5b): 21 complete distinct indexes pinned by retention; per-module pinned base 34 MiB, worst case 74 MiB; mark at 16 shards and 8 concurrent reads 727 / 868 ms (p50 / p95, IndexedDB on the Note 9). The admission rule only bounds how often entries arrive, so these are unchanged.
- No silent byte budget. Quota handling is Q-B (settled, A5.5 stage 5).

**Commit:**
- **Node, ordinary.** Upload each new unit under a fresh key and keep the revision each response returns. Then CAS the commit key through the guarded route with `ifVersion` = the base and check-only revisions on each new unit.
- **IndexedDB, ordinary (a new primitive).**
  - All unit bytes are encoded and ready **before** the transaction opens.
  - One `readwrite` transaction on the single object store `keyvaluepairs` (`indexedDbStore.ts:36`), durability `strict`: read the commit key, compare its full bytes with the base, put every unit the base does not name (I2b), put the new commit key.
  - **No non-IndexedDB await inside the transaction**, because it would auto-commit and raise `TransactionInactiveError`. A test with an injected await fails the mutant.
- **Tauri, ordinary.** Under the in-process mutex: durable unit writes, then the durable atomic write of the commit key. `isDurableKey` is extended (`tauriDurableWrite.ts:44-46`; its test "exactly the four kinds" at `tauriDurableWrite.test.ts:131` is updated).
  - **A unit write whose directory flush failed** (a new return field of `write_durable`; today the failure is only logged, `tauriDurableWrite.ts:14-17`) is treated as uncertain. It is re-flushed, or re-written under a new key, before any commit key names it.
  - A commit-key write whose flush failed makes GC refuse until a later commit-key write flushes successfully.
- **Bulk** (more than K new units on Node; over a byte threshold on IndexedDB): marker CAS, uploads under the prefix, final CAS. **(Updated 2026-10-14, Part D:** bulk is decided by unit count, more than 59 new units, on Node and IndexedDB alike; a byte threshold returns only if the Note 9 strict-hold measurement at 1, 4 and 16 MiB, still to do, requires it.)
- **Abandon-clear.** A CAS only against a commit key whose `staging` has this owner id and prefix. After an uncertain final CAS, read first: if this owner's manifest is `current`, it is done and nothing is cleared. Waiting for in-flight uploads is best-effort only. A late upload after the clear is garbage (I2).
- **Owner id.** A fresh random id in memory per page load: no claim, no `sessionStorage`. Tauri keeps one id in app data, so its start-up clear works. On the web every reloaded or duplicated tab is foreign, so a crashed tab's marker is cleared only through the Q3 prompt. Safety rests on property (g). The cost is the Q3 prompt after a web crash mid-bulk (see C3).
- **Remedies.** A 404 on a named manifest leads to a re-read of the commit key. A unit mismatch re-uploads the unit **and** the manifest.
- **Merge readiness.** Each device keeps its base manifest and the commit-key version it came from in memory (`MC-282` 2), so a later per-entity three-way merge needs no server-side retention.

**GC:**
- Mark: list, read the commit key at R, read the `current`, `retained` and `pins` manifests and their shards. No body reads.
- **Refuses** if the commit key is unparsable or a Tauri flush flag is set, on every device. **(Updated 2026-10-14, Part D, `MC-290` U7, U10, U12 and U13:** every deleter also refuses when the commit key is absent, too new, or names no `current`; GC treats every key listed in a parsable `store2-fence` as live, and the asset sweep, inlay cleanup and manual cleanup refuse while a fence exists; an unparsable, too-new or unreadable fence stops every deleter. See Part D, D3 and D4.)
- Candidates: the A-lite prefix minus standing staging prefixes. Deletion order is arbitrary. Batches of about 25:
  - **Node:** the guarded remove route with check-only `commit key == R`, plus retire;
  - **IndexedDB:** one strict `readwrite` transaction that re-reads the commit key and requires its bytes to equal what was read at R;
  - **Tauri:** under the in-process mutex.
- Idle only, on every page kind, plain HTTP included (`MC-286`), with pacing against Node's 20,000 requests per minute.

**Why IndexedDB needs no cross-tab lock (`MC-286`, P10; INFERRED).**
- Every transaction uses the single store, so overlapping read-write transactions run one at a time in creation order across all connections and tabs of the origin.
- An ordinary commit and its units are one transaction, so there is no publish-to-CAS window.
- A bulk marker write changes the commit key, so a GC batch built on an earlier read fails its in-transaction check; a GC that read the marker skips the prefix.
- The mark reads outside any transaction, which is safe because each batch re-checks atomically.
- Web Locks are used only to reduce contention.
- `strict` durability is a hint some engines may ignore. Relaxing it needs evidence and goes back to review. Whether the Note 9's Chrome honours it is a device measurement, not settled here.

**Damaged commit key (the simpler design).**
- GC refuses an unparsable commit key, on every device.
- Boot shows a recovery screen listing candidate manifests: keys under the A-lite prefix that parse as a manifest and are **not** under a staging prefix, each with `createdAt`, `seq` and size. **(Updated 2026-10-14, Part D: the recovery candidates are `^store2/m-` plus completed staged manifests `^store2/g-<stg16>-m`, excluding only keys under the standing `staging.prefix` of a parsed commit key; with an unparsable commit key no standing prefix is known, so every staged manifest is a candidate and the read-only tree read validates a pick. No promotion commit exists. Staged manifest keys carry time digits, so candidates order without body reads. The recovery screen also always offers re-conversion (when an upstream main file exists) and `.bin` import, and "start a new empty profile" behind a confirmation while no candidate has passed validation; every exit writes or extends the fence first.)**
- The user picks one. The app **reads** it read-only into a tree (any missing unit fails loudly; the user picks another). It then installs the tree through the ordinary **bulk import path**:
  - the marker CAS at the damaged key's revision (Node) or full bytes (off Node) **fences every in-flight GC batch** that read the old R;
  - every unit is re-written under fresh keys, so the result never relies on old units surviving;
  - the final CAS lands.
- No new protocol mechanism.
- **Disclosed cost:** the recovered profile starts with an empty `retained` list. Older snapshots are not carried over and later become garbage. (Advisor round 2 suggested rebuilding `retained` from the manifests found; v3 kept the simpler design and disclosed the cost, and advisor round 3 approved it.) This is a rare path.
- A listed manifest might never have been committed (a losing device's). It is still a coherent state built on a valid base; the user decides from `createdAt`.
- Binding additions: see A5.1 (C2).

**In memory.** The tree keeps today's stub shape for characters that are not loaded, so the 31 production `.coldstorage` readers keep working (S0-3: stub shape unchanged). Module placeholders come in stage 7. Unloading writes nothing.

### A1.3 Premises

| # | Premise | Evidence | Status | If wrong |
|---|---|---|---|---|
| P1 | Byte-stable re-encoding, so "clean" means equal to the acknowledged bytes | S0-1 | VERIFIED on a small profile and a T3 subset; T4 and the 50-cycle runs are AUTHOR-ONLY | Explicit dirty bit for the named residuals |
| P2 | Protocol safety | S0-5a | PARTIAL; the model lacks lost responses, save-mine, pins, admission and abandon-clear **(updated 2026-10-14, Part D: E1-1 added them and was independently verified; still PARTIAL because the exit bound was `faultCap=1`, not the full A2 bounds; ledger rows 1744 and 1745)** | Stage 1+3 exit E1-1 plus the section A3 replay |
| P3 | The server change is additive, **but an old server silently ignores the headers** (S0-16 results line 13; `server.cjs:1480-1493`, `:1703-1727`). An old server answers the new guarded routes with 404, because `server.cjs` has no catch-all route and `express.static` runs with `index:false` at `:20`. A proxy may answer 200 or 405, so the client needs **a positive marker** | S0-16; opus r2 | VERIFIED | New guarded routes (fail-closed), a marker header plus a numeric `revision` on every guarded response, and `/api/caps` checked by shape (stage 0a) |
| P4 | Retire keeps the table at the live-key count; a retired key reads 0 (`server.cjs:1560`) | S0-13 | Prototype; the parser fix is mandatory | Unbounded growth |
| P5 | Append: 4 keys, under 256 KiB, under 60 ms | S0-2 VERIFIED; S0-8 root-write series AUTHOR-ONLY **(updated 2026-10-14, Part D: independently re-measured, CONFIRMED with conditions, MEASURED on an i9 and a Note 9 Chrome page; ledger row 1743)** | Re-verify before the freeze | In-place tail is a maintainer question (`MC-282` 5) |
| P6 | 16 shards keep the mark under 1 s | S0-5b re-run | AUTHOR-ONLY and marginal **(updated 2026-10-14, Part D: independently re-measured, PARTIAL: under 1 s only with 8-concurrent or batched reads; ledger row 1743)** | Device gate in stage 5 |
| P7 | uuid in the stub and in the entry name | S0-3 | In-repo only | Refuse an unmappable id loudly; an upstream sample is owed |
| P8 | Await gates make plugins, Lua and triggers safe | S0-14 | Stand-ins only | Guards backed by mutants |
| P9 | Direct `getModules(` callers sit in 3 non-test files (`modules.ts`, `cbs.ts`, `DevTool.svelte`). The `getModule*` family is used in 15 files and returns a cached result (`modules.ts:716-755`) | grep (opus r1 finding 14) | TRACED | — |
| P10 | Overlapping read-write transactions on one database run one at a time across connections. Basis: spec reasoning, and fake-indexeddb 6.2.5 `Database.processTransactions` keeps one queue per database. Durability, crashes and separate processes are not modelled | Spec reasoning plus the fake | INFERRED **(updated 2026-10-14, Part D: the plain-HTTP probe ran, CONFIRMED on plain HTTP, MEASURED: desktop Chrome 155 86,180 transactions and Note 9 Chrome 154 22,691 transactions, zero interleaving, zero duplicate winners; a hidden Android tab stopped completing callbacks after about a minute; ledger row 1743. The stage 2 real-adapter repeat is still owed.)** | A **scratch two-tab plain-HTTP probe** runs before stage 1 Gate 2, on the S0 N9-IDB page harness in desktop Chrome and Note 9 Chrome; the stage 2 device check repeats it with the real adapter. If it fails, only the adapter changes (Web Locks on secure pages; no GC on plain-HTTP IndexedDB), so the format freeze does not wait for it, and the maintainer is informed (`MC-286` would then hold only for Node and Tauri) |
| P11 | The `.bin` restore writes assets itself: Tauri desktop streams (`backuplocal.ts:134-172`, `:1060-1093`); everything else writes whole values (`:1095-1165`). Inlays have their own path and a 200 MiB cap (`inlayStore.ts:72-91`). `saveAssetFromPieces` (`globalApi.svelte.ts:691`) serves card and module import only | Source | TRACED | — |
| P12 | Design K of about 60 on Node's default header limit; proxies are tighter | S0-16 | Node only | Conservative K; a 431 or a reset switches to the bulk path |

### A1.4 Invariants

- **I1.** After every step, the current, retained and pinned manifests and every unit they name exist. A restore never installs a manifest that names a missing unit.
- **I2.** A unit key is written at most once by intent. An uncertain write is re-uploaded under a new key.
- **I2b.** Off Node, every unit the base does not name is written inside the commit's critical section (the IndexedDB transaction, or the Tauri mutex hold). No "already uploaded" reuse.
- **I3.** A CAS always uses the base version (save-mine is the modelled exception, see E1-1). Only these remove a marker: the owner's final CAS, the owner's start-up clear (Tauri's app-data id), the owner's abandon-clear (same id and prefix), or a confirmed foreign clear.
- **I4.** GC and retire touch only the A-lite prefix. The server refuses retire outside it. The cutover's one-time deletion of old data (A2.4a) is separate, with its own rules.
- **I5.** No partial chat or module reaches a plugin, Lua, a trigger, the prompt, memory, the encoder or an export. While a V2.1 plugin is enabled, everything stays resident.
- **I6.** `.bin`: upstream to the fork always works, Node restores included. The `MC-223` named warning on fork-to-upstream export is absent at this base (S0-ceilings). That gap is pre-existing and tracked as CHORE-129, not something this plan delivers.
- **I7.** Automatic GC runs on every page kind, and its safety never depends on Web Locks.
- **I8.** Before a character unloads or is evicted from the keep-set, all its units are re-encoded and byte-compared with the acknowledged bytes, whatever the tracker says. If any differs, it commits first and unloads only after acknowledgement.
- **I9.** A stub is never encoded into units.

### A1.5 Acceptance scenarios

- **A1.** A switch between unedited characters writes **no unit bytes**: only shard, manifest and commit key, within the S0-8 constant part (34 to 66 KiB at 16 shards). It is still a reproducer against today's 1.17 MB. (Redefined from "writes 0 bytes": every production `changeChar` sets `lastInteraction = Date.now()`, `characters.ts:741-742`, `:1416`, `:1474-1476`, VERIFIED by advisor r2, so a switch changes the shard entry. A technical restatement, disclosed with its reproducer, not a product change.)
- **A2.** One append writes exactly the planned 4 keys (tail, shard, manifest, commit key), under 256 KiB and under 60 ms on the Note 9.
- **A3.** A Node profile over 100 MiB keeps its snapshots at today's cadence, and a restore brings chats back exactly.
- **A4.** An upstream `.bin` with all four pointer kinds imports, re-exports, and imports into upstream with nothing lost. A Node restore of a 101 MiB asset skips nothing.
- **A5.** GC racing two devices, a restorer and lost responses never breaks I1.
- **A6.** A plugin's `getCharacter` gets every chat of the selected character, complete.
- **A7.** A Lua-display character waits for its full chat; others get the fast first display.
- **A8.** A chat waits for its modules before sending and before first display.
- **A9.** An unmarked edit to a resident character that is not selected survives its unload (a guard, not a reproducer: today's put-back fingerprint also passes).
- **A10.** An upstream profile with numbered backups, and cold keys reachable only from a backup, keeps all of them through conversion.

---

## A2. Stages

Dependencies: 0a → (1+3) → 2 → 4a+4b → 5 → (6+7) → 8. Stage 0b sits off the critical path, any time after 0a. The merge spike follows stage 5. The fork backup format follows stage 8. The whole format is frozen at stage 1+3 and written at cutover; the GC library and the replay come before wiring; GC is switched on separately; old code is unwired at cutover and deleted at the end.

### Stage 0a: guarded Node routes, retire, capabilities, client support

- **Server** (`server.cjs`):
  - New routes `/api/write-checked` and `/api/remove-checked` carry the S0-16 logic: check-only keys joined into the sorted `withFileWriteLocks` set (`:311-320`) and checked inside `withRevisionTransaction`. An old server answers these with 404 (fail-closed). The existing routes are unchanged.
  - `retire` is accepted only on `/api/remove-checked`, only for the A-lite prefix.
  - The map deletion **and** the `{k,d:1}` append happen inside `withRevisionTransaction`. The parser and start-up replay honour delete records in log order.
  - **Every guarded response carries the header `risu-storage-guarded: 1` and a JSON numeric `revision`.**
  - `GET /api/caps` returns `{checkOnly, retire, pieces}` and must return the expected shape.
  - The revision-invariant comment at `:51-60` is amended.
- **Client** (`nodeHttpStore.ts`):
  - The guarded routes. **Anything other than the marker plus a numeric revision (a 404, a 405, a 200 without the marker, HTML) counts as capability missing** and maps to a typed `ServerLacksCapability` error.
  - A 431 or a fetch reset maps to "list too long", never retried as is.
  - A GC-only retire entry point that asserts the prefix.
- **Node behaviour without the capability:** A-lite commits and GC refuse. The page parks with a named message ("the server must be updated or restarted"; a new string, translated). The client checks at boot and at the start of every GC pass. Fail-closed routes make each call safe even if the server is swapped between checks.
- **Tests:**
  - *New-behaviour tests* (red on the unpatched server via `RISU_NODE_SERVER_SCRIPT`, green after): the 26 S0-16 check-only cases on the new routes; retire then restart; retire then forced compaction (`RISU_REVISION_LOG_COMPACT_AT=1`) then restart; retire whose `fs.rm` fails; retire outside the prefix refused.
  - *Reproducer:* the new client against the unpatched server. Commit and GC must refuse. A mutant that falls back to the old routes is caught.
  - *Stub proxy:* one returning a 200 HTML fallback and one returning a 405; the client must treat both as capability missing.
  - *Guards:* the 13 S0-16 cases that pass on both versions; the unchanged routes stay byte-identical; conformance passes; a check-only on an absent key compares as 0 and fails for r≥1 (route test plus conformance).
  - *Mutant:* the S0-13 version-1 parser, which must fail retire-then-restart.
- **Gates:** `opus-reviewer`. **Device checks:** none. **Exit:** all of the above pass. **Rollback:** revert.

### Stage 0b: chunked Node upload (`MC-284` 4; off the critical path)

- **Server:** a piece session (begin, append pieces of at most 64 MiB, finish to the final key under the per-key lock with a revision bump). Temp names fail the `/api/list` filter (`server.cjs:1686`) and are distinct from `<hex>.tmp-*`. Abandoned sessions are swept at `begin` and by idle age while the server runs, not only at start-up.
- **Client:** `nodeHttpStore.openWriter` implementing `PieceWriter` (`contract.ts:79-98`).
- **Restore:** a Node streaming branch in the `backuplocal.ts` entry loop that reads file slices like the desktop `createChunkedWriter` branch (`:134-172`), replacing the whole-value write (`:1095-1165`) for assets over a threshold. The pre-confirm and `tooLarge` skips (`:808`, `:908`, `:1052`) are removed when the store has `openWriter`.
- **Inlays:** `restoreCollectedInlays` uses the piece path. On Node, `inlayWriteLimit` rises to the 200 MiB cap.
- **Scope of "never skips":** the Node 100 MiB limit only. The 200 MiB inlay cap applies on every platform.
- **Secondary:** drop the `isTauri` gate at `globalApi.svelte.ts:691` for Node (card and module import).
- **Out of scope:** pieces are not used for A-lite units; a unit over the limit is refused with a message.
- **Tests:** *reproducer:* a 101 MiB asset restored onto the Node fixture is skipped today and stored byte-identical after. *New behaviour:* a 150 MiB inlay is stored on Node. *Guards:* the Tauri streaming branch is unchanged; abandoned sessions are swept; temp files never appear in `/api/list`.
- **Gates:** `opus-reviewer`. **Device check:** a real restore over 100 MiB onto a Windows Node server.
- **Ticket:** `MC-284` 4 names no ticket. An older entry, CHORE-105 ("A Node chunked upload endpoint (optional)"), exists in the Roadmap; whether it carries this stage is not decided: TODO(evidence).

### Stages 1+3: protocol library and unit codec (unwired). One Gate 1 with one senior-advisor challenge (the format freeze); two Gate 2s; separate worktrees

**Stage 1 (protocol)** delivers everything in A1.2 as a library:
- keys, frame (format version plus type), commit key with `epoch`, manifest with `shardCount`, shards;
- ordinary and bulk commit, fresh owner id, Tauri start-up clear, abandon-clear, foreign-clear hook, restore CAS (always pushing `current`), save-mine off Node, pins, admission;
- the per-backend adapters: Node guarded routes, the IndexedDB single-transaction commit (strict), Tauri durable plus mutex, with the re-flush or re-write rule for a failed flush;
- `isDurableKey` extended (`tauriDurableWrite.ts:44-46`; test at `tauriDurableWrite.test.ts:131` updated);
- the flush-status flag, a Rust change in `write_durable` (src-tauri scope);
- recovery through the bulk path and GC's refusal of an unparsable commit key.

**Stage 3 (codec):**
- `Database` ↔ units: field split, chat core and chunks, module index with flags, per-key pluginStorage, `ColdStubFields` (without `chats`) in shard entries, residual normalisation. **The codec refuses a stub (I9).**
- tree ↔ units functions shared by import, export and boot;
- the census extended to Lua and hypa activity, which decides the tail field list.

**Freeze preconditions:**
- independent re-verification or re-measure of the S0-8 root-write series and the S0-5b 16-shard re-run **(done 2026-10-13, ledger row 1743; updated 2026-10-14, Part D)**;
- **Q-D** answered 2026-10-13 (the size script on real data; result in A6 "Settled"; ledger row 1741);
- **C4** decided 2026-10-13 (`MC-289`: a recorded per-character list, as its own unit; A5.4 note);
- Q-C is settled (inside backups, `MC-288` 2), so `pluginStorage` is in the manifest.
- **(Updated 2026-10-14, Part D.)** The format is now a build candidate at step 1a and is declared frozen at the stage 3 gate, after the maintainer-run counts-only census and the model variants V1 to V4 (Part D, D8).

**Exit E1-1 (scratch, before the freeze).** `model.mjs` gains:
- (a) one lost response per actor per run, on any write kind;
- (b) save-mine (rebuilds from a fresh read; keeps `staging`, `pins` and `convertedFrom`; pushes the peer's `current`);
- (c) pins, admission (time as a nondeterministic "admit or not"), and a restore that always pushes;
- (d) abandon-clear with the A1.2 conditions;
- (f) the IndexedDB single-transaction commit and in-transaction GC check as the off-Node variant;
- (g) recovery through the bulk path racing GC, with damage injected into the commit key, **including the case in which a device holding the pre-damage base heals the key and the recovery marker CAS then conflicts (C2)**.

There is no item (e): the owner-claim protocol it modelled was removed.

**Bounds:** device A 1 ordinary + 1 bulk; device B 1 ordinary; 1 GC pass; 1 restorer; retained 2; K 2; retry bound 2; at most 1 crash and 1 lost response per actor per run. **Wall-clock cap:** 4 hours on the i9 (64 GB). **Not finishing within the cap is a finding to the Orchestrator and blocks the freeze**, not a slip. The run is independently verified before the freeze. **(Updated 2026-10-14, Part D: E1-1 ran and was independently verified, but the exit bound used was `faultCap=1` (at most one crash-or-lost-response in total), a scope bound that does not exhaust the bounds written here; the plan lists the regions it cannot reach in Part D, D6, and schedules the variants V1 to V4 before the freeze declaration; round 1 asked whether the bound is enough to freeze, finding 17.)**

**Mutants that must fail:**
- the five original controls (S0-5a);
- abandon-clear without the id-and-prefix check;
- abandon-clear without the read after an uncertain final CAS;
- a restore CAS that drops `staging`;
- a restore that does not push `current`;
- a save-mine that drops `staging` or `pins`;
- a mark ignoring `pins`;
- a GC not skipping a staging prefix;
- off-Node reuse of earlier-uploaded units;
- an IndexedDB commit split across two transactions;
- an IndexedDB GC check outside its transaction;
- a Tauri commit-key write before durable units;
- a Tauri commit naming a unit whose flush failed;
- recovery that installs the chosen manifest's existing units directly, without the marker fence (see C2: if this one is not caught it is a mutant-validity finding, not a protocol weakness);
- a seq-only compare off Node;
- retire outside the prefix;
- the S0-13 version-1 replay parser (stage 0a server tests).

**Tests:**
- Stage 1, guards plus partial replay: properties (g), (h), control (v), bulk, a two-tab schedule, recovery.
- Stage 3, guards: codec byte stability over T3, T4, T5 and the legacy shapes; a property that normalised residuals stay stable; **the codec refuses a stub, with a mutant**. The saveLoopWorld "first open writes nothing" reproducer lives in stage 4a.

**Gates:** one Gate 1 with one `senior-advisor` challenge; Gate 2 for each of stages 1 and 3 by `opus-reviewer`.

**Device checks:** IndexedDB strict commit cost on Note 9 Chrome; the Tauri Android durable commit hold; the P10 two-tab plain-HTTP probe before stage 1 Gate 2.

**Exit:** E1-1 passes; the partial replay is green and its mutants are red; the device costs fit A2.

### Stage 2: GC library and the full replay (unwired)

- **Gate 1:** this plan's section A3, accepted as part of this Gate 1.
- **Scope:** GC as in A1.2, with pacing against Node's 20,000 requests per minute.
- **Gate 2:** `opus-reviewer`. Budget for many rounds (Report 08 estimated about nine).
- **Device check:** two real tabs over plain HTTP (no Web Locks) and over HTTPS with the real adapter, desktop Chrome and Note 9 Chrome, running concurrent commits, bulk and GC on IndexedDB (P10); strict GC batch hold on the Note 9.
- **Exit:** section A3 met; the replay record is filed as a required input to the stage 4a+4b Gate 1.
- **Stop:** a violation in the unmodified protocol goes to `senior-advisor`.

### Stage 4a: cutover, part 1 (merged to `main` together with 4b, so `.bin` never breaks)

**Boot table:**

| Store state | Action |
|---|---|
| `opfs-transitional` page (`appStore.ts:64`, `:122-125`) | Read-only as today: no conversion, no deletion, no GC. A-lite boots after the copy-back into IndexedDB (`:162-182`); the copied-back upstream main file takes the conversion row |
| Commit key parses | Normal boot. **Resumes an unfinished deletion (C1)** |
| Commit key unparsable | Recovery screen (A1.2) |
| No commit key; upstream `database/database.bin`; no `blocks/` key | Convert through the bulk path with `convertedFrom`. **Delete nothing.** Main file, numbered backups and `coldstorage/` untouched |
| No commit key; `blocks/` present; no `database.bin` | Seed an empty profile; one notice; fork-only deletion (A2.4a) |
| No commit key; both present | Convert `database.bin`; mixed deletion (A2.4a) |

**Save path:** table T3. **Entry points:** table T2.

**Open and unload:** eager chunks. **Disclosure:** long-chat open is slower than today until stage 6; it is excluded from the 4a device exit and recorded as transitional. The keep-set of `MC-268` 1 is kept. V2.1 keeps everything resident.

**Snapshots and restore:** read retained and pinned manifests (`getDbBackups` at `:2429`, `internalBackup.ts:178`). A restore pushes `current`. BroadcastChannel carries `seq`; a peer commit makes this page park. Streaming saves are throttled (a parameter). The manual clean-up button is hidden until stage 5; a dev-only "run GC now" action, compiled out of normal builds like the `MC-300` measurement code, exists for soak testing.

**Tests:**
- *Reproducers on today's code via `saveLoopWorld.ts`:* A1 (unit bytes above 0 today); the Node snapshot skip over 100 MiB; the pluginStorage whole-block rewrite; 35.7 MB per module edit; first open of an archived character writes.
- *Guards plus mutants:* A2's exact key set; A9; `MC-146` 2 and 3 on the new loader; **A10**; the T2 asset-sweep guard; the deletion guards (A2.4a).
- *Re-runs:* the replay and the live-server test against the wired save step, with 429 injection.

**Gates:** a joint 4a+4b Gate 1 with `senior-advisor` and `opus-reviewer`, with the stage 2 replay record as a required input; Gate 2: `opus-reviewer`. Translator for strings.

**Device checks (on the integrated 4a+4b build, because an empty seeded profile measures nothing):** Note 9 Tauri cold start against the current baseline, PSS, A1, A2; Windows Tauri; Node plus web over plain HTTP; the T3 idle-sweep check with a V2.1 plugin enabled (everything resident); the boot asset sweep's cost.

### A2.4a Deletion, T1, T2, T3

**Deletion (M2 = `MC-287`).** Runs once, after the seed or conversion commit has landed, **only when any `blocks/` key exists**. Idempotent and resumable.

- **Fork-only** (no `database.bin`): delete `blocks/`, `database/dbbackup-<n>.bin`, `database/database.pre-blocks*` and every `coldstorage/` key. All of it is synthetic per M2. In a fork-only profile, deleting `database.pre-blocks*` is covered by M2: such profiles exist only in the unreleased fork, and the file is the upstream main file the fork moved aside, not upstream user data.
- **Both present:**
  - delete `blocks/` and `database.pre-blocks*`;
  - **keep** `database.bin` and **every** numbered backup;
  - for `coldstorage/`, compute the exclusion as a **key-only** variant of `collectColdStorageBackupPayloads`' walk (`coldstorage.svelte.ts:561`; the same chain-following, nothing held in memory but keys) over the decoded trees of `database.bin` and **every** numbered backup, `_coldplugin` included. Exclusion = `settledKeys` (found, missing, invalid) ∪ every root key;
  - delete only `coldstorage/` keys outside the exclusion;
  - **any read, decode or walk error means no `coldstorage/` key is deleted.** `blocks/` and `pre-blocks` deletion still proceed, since no upstream file can reference them.
- **Never deleted:** `assets/`, inlays, `remotes/`, the A-lite prefix.
- **Guard (A10) and mutants:** deletion without the fork marker; a walk that ignores numbered backups; a walk that continues after an error.
- **Binding (C1, to the 4a+4b Gate 1; a silent-loss path, not optional):** the deletion deletes only from a **key list snapshot taken and persisted before the seed or conversion commit** (for example a unit named in the commit key, or a field in it); it never deletes a key outside that list; `blocks/`, the trigger, is deleted **last**; the "commit key parses" boot row resumes an unfinished deletion; mutant: a resumed run that re-lists `coldstorage/` instead of using the snapshot. Reason: V3 plugin storage writes `coldstorage/<id>` at runtime today (`v3.svelte.ts:1432-1434`), so a deletion that resumes or runs while a plugin writes would delete live plugin data. With Q-C settled "inside backups" that writer moves to units, and the snapshot rule remains the safe default.

**T1: pointer kinds**

| Kind | Import (`.bin` or upstream main file) | In memory | Units | Export |
|---|---|---|---|---|
| Character stub `coldstorage` plus `coldstorage_<uuid>.json` entry | Read the entry; build the full character; entity id = that uuid when valid, otherwise a new uuid with the references rewritten | Not loaded: a stub built from the shard entry with `coldstorage` = entity uuid. Loaded: the full character | Core, lore, scripts, chat entries | As today: characters **not loaded at export time** export as stub plus `coldstorage_<uuid>.json` (uuid in both places; an unmappable id refused loudly). Loaded characters are inline. Whether upstream restores fork stubs is unknown (S0-3); A4's hand check decides. If it fails, export goes all-inline with the `MC-130` 4 memory warning |
| `coldStoragedChats[]` | Used to find units, then discarded | Stub carries `[]` | — | `[]`; chats inline inside the entry |
| Chat first-message pointer (`coldStorageHeader`) | Resolved into chunks. **If its unit is missing or unreadable at import, the chat is kept with today's load-error message as its content, never dropped** (fixture added) | Never present (lazy chunks replace it) | Chat core plus chunks | Inline messages; no pointers |
| V3 plugin `_coldplugin` → `coldstorage/<id>` | Read each value into a per-key pluginStorage unit, **inside snapshots** (`MC-288` 2) | Values are **not resident**: read lazily through the existing async API (`v3.svelte.ts:1429-1458`), which keeps today's memory profile. V2.1's synchronous `pluginCustomStorage` view sees the same mapping as today | Per-key units named by the manifest | As today's form, mapping plus entries, with the `MC-176` warning |

**T2: entry points.** The `cold*` facades keep their signatures and failure vocabulary (`ColdRestoreFailure`, `coldCharacterRestore.ts:41`); only the internals change, so stage 8 deletes internals, not facades.

| Entry | Callers | Redirect |
|---|---|---|
| `readColdCharacterCopy` (`coldCharacterRestore.ts:138`) | `exportAsDataset.ts:33`, `storageMaintenance.ts:32` | A-lite read of the units as a copy |
| `restoreColdCharacter` (`:264`) | `characters.ts:1382`, `:1428` (open) | Load the entity and make it resident |
| `readArchivedCharacter` (`coldCharacterAccess.ts:74`) | v3 `readArchivedCopyOrThrow` (`v3.svelte.ts:712`, used at `:994`, `:1029`); MCP `utils.ts:35` | A-lite copy. `MC-146` 1: one alert and the call fails |
| `restoreArchivedForWrite` (`:109`) | v3 `:722`; `playgroundChat.ts:27` (`MC-146` 3); `group.ts:30`; MCP `utils.ts:75` | Load and make resident |
| `restoreColdCharacterByChaId` (`coldMemberRestore.ts:27`) | `process/index.svelte.ts:636` (`MC-146` 2) | Load; on failure the member stays a stub, is named in an alert and skipped |
| `restoreAllColdCharacters` (`coldRestoreAll.ts:34`) | `plugins.svelte.ts:431` (V2.1) | Load every entity |
| `preLoadChat` (`coldstorage.svelte.ts:763`) | `DefaultChatScreen.svelte:818` | Await chat completion (eager in 4a, lazy in 6) |
| `read`/`setColdStorageItem` | `pluginColdStorage.ts`, `inlayCleanup.ts:530`, backup and restore | Per-key units; the inlay clean-up reads chunks |
| `buildAssetKeepSet` → `resolveUncleanableChars` → `getColdStorageItem(cha.coldstorage)` (`globalApi.svelte.ts:2859-2914`) | Boot asset sweep (`bootstrap.ts:1191-1300`) | Read unloaded characters' units (key-only refs from core, lore, scripts and chat units, yielding). **The sweep's keep-set source changes.** Guard: an asset referenced only inside an unloaded character survives. Mutants: a stub-only scan; a sweep that silently stops (`complete=false`). See C4 (decided 2026-10-13, `MC-289`; A5.4 note corrects the premise) |
| `retryLegacyColdChatLoad` (`DefaultChatScreen.svelte:228`) | Chat screen | Await chunk completion (no legacy pointers after import) |
| `manualCleanup.ts:139`, `:224` | Manual clean-up | Reworked in stage 5 |
| `bootstrap.ts:649` | Old boot | Replaced by the 4a boot table |
| `backuplocal.ts:1234` | Restore | Tree → units in 4b |

The "unavailable" failure (plain HTTP with no cold store) disappears.

**T3: save-path dependencies** (rework of `saveDb`, `globalApi.svelte.ts:1531-2422`; units re-encoded and byte-compared against the acknowledged bytes before every write)

| Mark path | Units re-encoded and compared |
|---|---|
| Boot window, first save | All resident non-stub units |
| `markCharacterForSave`, V2 marks | That character's core, lore, scripts and resident chat units (core excludes `reloadKeys`; chat core excludes `isStreaming`) |
| 6b partitions (selected character) | Core, lore, scripts; for a chat change, the chat core plus the chunks covering the changed indices |
| Identity tracker (fires on load and unload, `dbChangeEffects.svelte.ts:410-431`) | `order` plus the affected characters. **For a stub, only `order` and shard-entry fields may change; the codec refuses to encode a stub (I9).** A load or unload that changes nothing compares equal (part of A1) |
| Presets, loadouts, plugins, pluginCustomStorage | Changed members |
| Module children | That module plus the module index |
| 6a generic top-level effect | Config root without `statics` |
| `requiresFullEncoderReload` triggers (`characters.ts:999`, `:1072`; `globalApi.svelte.ts:1466`, `:2028`; `backuplocal.ts:1335`) | All resident non-stub units |
| Unload or eviction | All of that character's units (I8) |
| Idle safety net (replaces the full encoder reload) | Byte-compare of resident units: **idle only, yields per unit, skips units unchanged since the last mark.** Note 9 check at T3 with a V2.1 plugin enabled (everything resident) |

### Stage 4b: `.bin` import and export

- **Import:** tree → units through the bulk path, per T1, replacing `restoreReplace.ts` `replaceWithRestoredSet`; the `backuplocal.ts:1234` redirect.
- **Export:** tree from units, then today's encoder and the T1 export column.
- **Tests (guards):** golden fixtures generated by the **pre-rewrite** build, covering all four pointer kinds with upstream-shaped chat pointers and `_coldplugin`; import, export, then the legacy decoder gives equal logical content; the T1 missing-unit fixture; the upstream sample once supplied.
- **Device checks:** a hand round trip with an upstream build on Windows (A4); a T3-shaped import on the Note 9.
- **Exit:** the guards are green and the maintainer has imported their test data.

### Stage 5: GC switched on, manual clean-up reworked

- **Scope:** idle GC on every page kind. **Quota path (Q-B settled, `MC-288` 4):** on `QuotaExceededError`, run GC and retry; if still refused, drop the **oldest** retained manifest one at a time and retry, with a one-time notice naming how many were dropped. Never silent; no hidden size budget. Manual clean-up becomes "run GC now" plus today's asset-orphan sweep, reading units (rows `manualCleanup.ts:139` and `:224` redirected to unit reads). Assets are never in the GC allowlist.
- **Binding (C3, with Q3):** also offer the foreign-marker clear when the marker is older than a threshold, **from the quota path and from manual clean-up**, not only when a later bulk needs it. Wording stays with the maintainer (Q3).
- **Q9:** the `MC-268` 2 orphan counter: recommended, point it at assets only (still open).
- **Tests:** *reproducer:* orphan units are not collected on the stage 4 snapshot (the named pre-fix base) and are collected after. *Guards:* the replay and live-server test against the wired GC; quota trimming and its notice.
- **Gates:** `opus-reviewer`.
- **Device checks:** mark on the Note 9 Tauri file store under 1 s (P6); commit stall during delete batches; plain-HTTP IndexedDB GC on Note 9 Chrome.

### Stages 6+7: lazy chats and lazy modules. One Gate 1; two Gate 2s

**Stage 6 (lazy chats):**
- The tail chunk shows first; the rest loads in the background.
- Completion gates on: send and v3 `sendChat`; `runScripted` (`scriptings.ts:164`) and `runTrigger` (`triggers.ts:1106`), manual buttons included; v3 reads (`v3.svelte.ts:879-893`, `:983-999`, `:1020-1034`, `:1078-1089`); MCP.
- Plugin "complete" means every chat of the selected character (`MC-284` 1). `getDatabase('all')` loads every chat of resident characters.
- **Trace first** the editDisplay / display-trigger / CBS path (TODO(evidence); the S0 report marks it PLAUSIBLE), then use the shard flag for "wait only if used" (`MC-284` 2).
- A partial write-back is refused.
- *Guards plus mutants:* S0-14 P1-P5 and L1-L5; each mutant removes a gate.

**Stage 7 (lazy modules):**
- Placeholders are rendered from the module index.
- `lastModuleData` cache invalidated on every module load.
- Gate before send, prompt and first display.
- The translator, the Toggles sidebar, MCP module tools, CBS outside a send and DevTool get either a gate or placeholder-safe behaviour.
- Export, encode and restore await every module and never encode a placeholder.
- Module edit and export load first.
- **Settled (Q5, `MC-288` 3):** V2.1 keeps every module resident while a V2.1 plugin is enabled, and a v3 `getDatabase` that includes modules awaits them all.
- **Disclosure:** first display waits for the chat's modules, because `getModules` is synchronous.
- *Guards plus mutants.*

**Device checks:** stage 6: a 50k-message chat shows first in ≤300 ms and completes within today + 20 % (product line about 2 s); open time for a Lua-display character. Stage 7: Note 9 boot to list and first chat open with 7.8 MB and 32 MB modules.

### Stage 8: removal and re-measure

- Delete the unwired internals: `blockStore`, `blockKeys`, `headSwap` (except what the adapters reuse), `saveStep`, `bootBlockLoad`, `bootArchive*`, `bootPassSeams`, `treeToBlockSet`, `pageBlockOwner`, `mainFile*`, `blockProfileValidate`, `packedNames`, `coldRetained`, `supersededUnits`, put-back, re-archive, archive internals, `restoreReplace`, the old `manualCleanup` parts. About 8.6k lines (opus r1: the named files sum to 8,673 lines). The `cold*` facades stay.
- Delete the 66 test files that import them, after checking each.
- Remove unused locale keys.
- Re-measure memory and Android boot (`MC-281` 8).

---

## A3. Gate 1 replay requirement

**Reading.** Real code does not exist at plan time. This section is stage 2's Gate 1. Its execution is the acceptance of stage 2's Gate 2, and its record is a required input to the stage 4a+4b Gate 1.

1. **Driver.** Real library code against an in-memory store with Node semantics (revision, tombstone, check-only, retire, atomic batch remove), plus an IndexedDB variant with single-store transaction scheduling and a Tauri mutex variant. A deterministic scheduler makes each store call one step.
   - Actors as in S0-5a, plus faults: crash after any own write (marker write included), **lost response on every write kind** (one per actor per run in E1-1; unbounded in the PCT sampling), **commit-key damage**, **Tauri flush failure**, restart with a Tauri start-up clear, save-mine, pins, admission.
   - Properties (a), (b), (d), (g), (h)-as-amended and (i) checked after every step.
2. **Schedule sources:**
   - (i) every control counterexample trace from `logs/bfs_*` and `f_ctl_*`, step for step;
   - (ii) model-exported schedules for every 409/404 remedy category and for surprises 1 to 3 and 6;
   - (iii) the unexhausted regions (reload remedy with any-order GC and both devices committing; crash A with any-order GC; the A+B+G crash union; foreign clear with any-order GC or with a crash of A), plus the E1-1 additions, under seeded PCT scheduling with adversarial deletion order. **Minimum per region: 20,000 seeds, each run until every actor terminates, at least 1 hour on the i9.** Seeds, steps and distinct state fingerprints are reported. This is **sampling evidence, not exhaustion**; exhaustion is E1-1's job at reduced bounds;
   - (iv) **two tabs, two distinct fresh ids** (the IndexedDB variant);
   - (v) **commit-key damage, then recovery racing GC.**
3. **Mutants** (in scratch, through module substitution): controls (i) to (v), the E1-1 mutant list above, off Node without serialisation, and unsorted locks. Each must be caught.
4. **IndexedDB and Tauri variants** with `fake-indexeddb` 6.2.5 and the Tauri fakes. The fake keeps one transaction queue per database across connections and runs overlapping read-write transactions in creation order, which is adequate for scheduling. It models neither durability nor crashes, so the P10 probe and the stage 2 real-browser check remain required.
5. **Live-server test** (`nodeServerFixture.ts`, a real `server.cjs` with stage 0a): 2 to 4 client devices, a GC loop and a restorer for a fixed duration.
   - An observer checks I1 after every operation.
   - Injected server restarts, induced 431s and lost responses (the proxy drops replies after the server applied the request); 429 injection from stage 4.
   - **Against the unpatched server, the new client must refuse to commit or collect.**
   - Plus the stub proxy (200 HTML, 405) under which the client must refuse.

---

## A4. Risks, rollback, measurements

### A4.1 Risks

| Risk | Stage | Response |
|---|---|---|
| E1-1, the replay or the live test finds a violation | 1+3, 2, 4, 5 | Stop; `senior-advisor` with the trace |
| E1-1 does not finish within its cap | 1+3 | A finding; the freeze waits for the Orchestrator's decision |
| IndexedDB scheduling across tabs does not hold on a real browser (P10) | Before stage 1 Gate 2; stage 2 | Adapter-only fallback; the maintainer is informed (`MC-286` then holds only for Node and Tauri) |
| Strict durability breaks A2 on the Note 9 | 1+3 | Relaxing needs evidence and goes back to review |
| Re-verified P5 or P6 fails | 1+3, 5 | Revisit the amendments before the freeze |
| Real sizes: a unit nears 100 MiB on Node | 1+3 | Split further before the freeze (Q-D). **Not triggered (2026-10-13): the largest unit is 4.48 MiB, see A6 "Settled".** |
| Upstream cannot restore fork stubs | 4b | Switch export to all-inline with the `MC-130` 4 warning |
| A scan of unloaded characters makes the boot asset sweep slow | 4a | Yields; Note 9 check; C4 (decided 2026-10-13, `MC-289`) |
| The Lua-display trace contradicts the PLAUSIBLE reading | 6 | Back to the maintainer |
| Lazy modules make first open worse than eager boot | 7 | Measure and report; `MC-283` 6 stands until the maintainer revisits it |
| Garbage while GC is off (stage 4 to 5) | 4-5 | The dev-only GC action bounds it |
| Review budget | All | `senior-advisor` after three substantive REJECTs in a row |

### A4.2 Rollback

- Stages 0 to 3: revert.
- 4a+4b: the cutover **deletes fork-format data only, and only when a fork marker exists** (`MC-287`); that data is synthetic. Upstream data is never deleted. Rolling back means reverting the code; the old build then starts with an empty or upstream profile. Data moves back by a `.bin` exported from the A-lite build, which the old build can import.
- Stages 5 to 7: revert. Data stays readable because the format is unchanged.
- Stage 8: revert.

### A4.3 Device measurements owed

The test platforms are the Note 9 and a Windows desktop (`MC-270` 4). **The 4a device checks run on the integrated 4a+4b build.**
- Stage 1+3: commit cost; the P10 probe before stage 1 Gate 2.
- Stage 2: two tabs over plain HTTP and HTTPS.
- Stage 4: cold start, PSS, A1, A2, the upstream round trip, the T3 idle-sweep check with a V2.1 plugin.
- Stage 5: mark and stalls.
- Stage 6: first display and complete.
- Stage 7: module boot.
- Stage 8: re-measure.

Unmeasured: a phone-to-Node LAN run, a reverse proxy, a Pi-class box, a mid-range phone.

---

## A5. Binding carry-forward (Gate 1 disposition, 2026-10-13)

These are binding inputs to the Gate 1 named for each. They are not optional notes.

- **A5.1 C2 (stage 1+3 Gate 1).** Recovery:
  - on a 409 at the recovery marker CAS, re-read the commit key and abandon recovery if it now parses (a device holding the pre-damage base healed it); model in E1-1(g);
  - manifests recognisable by key form or by a fixed frame-header read, without body reads; disclose the listing cost (opus r3 states that listing candidates otherwise reads every key under the prefix);
  - candidate list newest first with a visible cap (advisor r3 note 2);
  - disclose that recovery holds the chosen state in memory and rewrites the whole library like a `.bin` import, so the `MC-130` 4 memory warning applies on phones (advisor r3 note 1);
  - if the "direct install without the marker fence" mutant is not caught, treat it as a mutant-validity finding, not a protocol weakness, and do not reopen the design (advisor r3 note 3).
- **A5.2 C1 (stage 4a+4b Gate 1).** The deletion snapshot rule in A2.4a.
- **A5.3 C3 (stage 4 Gate 1, with Q3).** The stale-marker clear in stage 5's scope.
- **A5.4 C4 (stage 1+3 freeze input; format-shaping).** Consider recording asset references per character in the shard entry at encode time, so the boot asset sweep does not read every unloaded character's units on each boot (`MC-130` and `MC-283` boot goals; today's `resolveUncleanableChars` reads every archived unit, `globalApi.svelte.ts:2859-2893`). Decide before the freeze. If not adopted, the boot-sweep risk row and the Note 9 check stand. (Decided and its premise corrected 2026-10-13; see the note below.)
  - **Note, 2026-10-13 (C4 decided; `MC-289`; ledger row 1742).** The premise above is corrected: today's boot asset sweep never reads archived units; `bootstrap.ts` lines 1185 to 1187 switch the asset sweep off whenever any character is cold-stored, a sweep hold is set or an older main-file copy exists (orchestrator-verified; the C4 packet's other findings are TRACED, not independently verified). The maintainer decided that the startup asset clean-up runs after the rewrite, using a recorded per-character list of asset files ("Run it, using a list", `MC-289`). Measured on the real library (ledger row 1742): the largest character list is about 783 KB as base64url stems (1.21 MB as full keys) against the 256 KiB per-append budget (A2), so the list cannot sit inside the shard entry (INFERRED, the orchestrator's): it must be a separate per-character unit, and likewise per module, written only when that owner's asset fields change and named from the shard entry. The final design is the stage 1+3 plan's. **Binding stage 1+3 input:** a keep-set from the current manifest alone would delete assets that only an older retained or pinned manifest still needs, so the sweep must also keep those (`MC-289`).
  - **(Updated 2026-10-14, Part D; `MC-290` U1, U8, U9, U11, U12, U13.)** The sweep gate is now specified: the keep-set is the union over `{current} ∪ retained ∪ pins` of the per-character, per-module and config asset lists plus the legacy unit (the assets the old upstream files use, U1); the sweep refuses unless the commit key parses with a non-null `current`, `staging` is null, no `store2-fence` exists, every closure node is readable and no legacy file is `unreadable`; it runs per batch with a commit-key and fence re-check; an age record (`store2-sweep`, 24 hours proposed) means a candidate is deleted only on a later pass; and it runs automatically only below `SWEEP_AUTO_LIMIT` files (a 50,000 placeholder, not a measurement), otherwise from a Settings button (U9, which amends `MC-289`). The asset lists are separate units as the note above says; sizes unchanged (ledger row 1742).
- **Editorial.** `epoch` is 16 bytes from `crypto.getRandomValues`. The fork-only `database.pre-blocks*` deletion is covered by M2 (A2.4a).
- **Records before stage 0a.** M1 and M2 recorded as MC entries: done as `MC-286` and `MC-287`.

## A6. Questions

### Settled

- Plain-HTTP clean-up: `MC-286` (M1). Old fork-format data: `MC-287` (M2).
- Q-C: V3 plugin cold storage moves **inside snapshots** (`MC-288` 2).
- Q5: V2.1 keeps every module resident; a v3 `getDatabase` with modules awaits them (`MC-288` 3).
- Q-B: on quota, drop the oldest snapshots one at a time with a one-time notice (`MC-288` 4).
- Stage list approved; stage 0a may start (`MC-288` 1).
- **C4, decided 2026-10-13 (`MC-289`):** the startup asset clean-up runs, using a recorded per-character list of asset files (option "Run it, using a list"). Placement and the retained-manifest keep rule: A5.4 note; sizes: ledger row 1742. **(Updated 2026-10-14, Part D: `MC-290` U9 amends "runs" for libraries above a file-count limit, where it runs only from a Settings button.)**
- **(Added 2026-10-14, Part D.)** `MC-290` records U1, U2, U3, U7 to U13: old files' assets kept; names `store2/` and `store2-commit`; a prefix-only server list route; recovery "ask again"; shared live folder unsupported; limit-gated automatic sweep; newer format read-only with a notice; old inlays kept; fresh start behind a confirmation; damaged data kept on every recovery exit.
- **Q-D, answered 2026-10-13 (the real-size census; ledger row 1741).** The maintainer ran `Agents/Tools/save-gen/real-size-report.harness.ts` on 2026-10-13 against a local copy of their real upstream `.bin`; the output is `Agents/Tools/output/real-size-report.json` (gitignored; sizes, counts and ordinals only). The measure is the UTF-8 bytes of each piece's JSON serialisation, so it is an upper-side measure of the stored units, which are compressed or encoded. Units: lore is `globalLore`; scripts are `customscript`, `triggerscript` and `virtualscript`; core is the character minus chats, lore and scripts; chat chunks are a greedy 128 KiB packing of whole messages. Numbers (VERIFIED: the maintainer's run output, scalars checked by the orchestrator against the JSON):
  - Container 32.24 GiB, 383,743 entries. The database entry is the legacy format, 62 MiB (65,143,738 bytes), decoded in 1,075 ms; peak RSS 944 MiB (the whole decode added about 570 MB). A first attempt from a NAS was seek-bound; the harness reads sequentially in 32 MiB chunks, and the rerun from local disk ran at about 2.5 GB/s overall (34.6 GB in 13.8 s, per the JSON's `elapsedMs`).
  - 485 characters, no stubs, no cold-storage units. Largest whole character 4.48 MiB (core max 2.12 MiB, lore max 3.92 MiB, scripts max 1.0 MiB); character p95 1.12 MiB; all characters together 132 MiB (138,319,559 bytes).
  - 814 chats; largest whole chat 773 KiB; most messages in one chat 62; most chunks in one chat 7.
  - 180 modules; largest 3.30 MiB; the whole array 35.6 MiB (37,349,021 bytes).
  - Config root 619 KiB; plugins 8.5 MiB; `pluginCustomStorage` 0.9 MiB; `botPresets` 1.7 MiB.
  - Assets: 383,742, 32.2 GiB, largest 20.5 MiB, 3 over 16 MiB, none over 100 MiB.
  - Nothing at or over 50 MiB; nothing at or over 100 MiB.

  Interpretation (the orchestrator's; INFERRED): the largest A-lite unit has about 22x headroom under Node's 100 MiB body limit, so the A4.1 "unit nears 100 MiB" risk does not trigger and no further split is needed before the freeze. A design that stores all characters as one value (132 MiB) would exceed the limit. The whole module array as one value is 35.6 MiB today, about a third of the limit; other users have far larger module sets (1 to 2 GB asset modules, recorded in campaign memory), so modules stay per-unit. The library is character-heavy and chat-light; chat chunking is still required for long-chat users. Limit: one library, one maintainer; it is not representative of the extreme 1000+ character users.
- `statics` coalesced; retention admission matches today's cadence; manual clean-up hidden during stage 4 to 5; owner id fresh per load; A1 redefined; the existing delete paths (post-commit clean-up, generation retire and numbered-backup rotation go away with the block store; `cleanChunks` stays, its keep-set source changes, see T2).

### Open

- **Q3 (stage 4, with C3).** Foreign-marker prompt. With fresh owner ids, every crash mid-bulk on the web leads to this prompt. Recommended (not decided): show `startedAt` and a platform label; offer Wait (default) / Clear and continue; prompt rather than wait silently.
- **Q9 (stage 5).** Point the orphan counter at assets only. Recommended (not decided).

### Inputs owed

An upstream-exported `.bin` sample (stage 4b).

## A7. Size estimate in review rounds

Anchors: the spike plan took five Gate 1 rounds; Report 08 estimated about nine for GC. Token costs are not estimated.

| Item | Gate 1 rounds | Gate 2 rounds |
|---|---|---|
| This plan | passed (3 rounds) | — |
| 0a | 1 | 1-3 |
| 0b (off the critical path) | 1 | 2-3 |
| 1+3 | 2-3 joint, plus advisor; E1-1 verification 1-2 | 1: 3-5; 3: 2-4 |
| 2 | Folded into this plan | 4-9 |
| 4a+4b | 2-4 joint, plus advisor | 4a: 4-7; 4b: 2-4 |
| 5 | 1-2 | 2-4 |
| 6+7 | 2-3 joint | 6: 3-5; 7: 2-4 |
| 8 | 1 | 1-2 |

Total: about 35 to 70 review rounds, plus Note 9 sessions in stages 1, 2 and 4 to 8 (the plan's own estimate; not measured).

### Critical files for implementation

- `C:\Projects\RisuAI\server\node\server.cjs`
- `C:\Projects\RisuAI\src\ts\storage\store\indexedDbStore.ts`
- `C:\Projects\RisuAI\src\ts\globalApi.svelte.ts`
- `C:\Projects\RisuAI\src\ts\process\coldCharacterRestore.ts`
- `C:\Projects\RisuAI\src\ts\process\coldstorage.svelte.ts`
- `C:\Projects\RisuAI\src\ts\drive\backuplocal.ts`

---

# Part B. Gate record

## B1. Reviewed snapshot

- **What was reviewed:** the plan only (v1, v2, v3, as written in session scratch). **No code existed or was reviewed.**
- **Base:** `main` at `f26e1e457`. Opus round 1 records `git diff --stat 2e065403a f26e1e457 -- server src` as empty, `git status --short -- src server` as empty and `server/node/server.cjs` as blob `e4107bf` at both commits; opus rounds 2 and 3 record `src/` and `server/` unchanged.
- **Method and execution.** Reviewers read source and ran `git` and `grep`. Opus rounds 1, 2 and 3 each state that they ran no tests; the advisor rounds' execution is not stated beyond "reopened" source, TODO(evidence) for any run. The "headers ignored" fact (P3) is S0-16's own executed result, re-read against source but not re-run. `node_modules/fake-indexeddb` is 6.2.5 (opus r2).
- **Citation checks:** opus round 1 spot-checked 31 citations; all held at `f26e1e457` except P11's premise and P9's wording (both corrected in v2). Opus round 3 re-verified the `requiresFullEncoderReload` call sites and the `_coldplugin` read path.
- **Maintainer inputs applied:** M1, M2 (before v2); round G1 (after v3). See `MC-286` to `MC-288`.

## B2. Rounds and verdicts

| Round | senior-advisor | opus-reviewer | Scope |
|---|---|---|---|
| 1 (plan v1) | `[REJECT]`, F1 to F11, questions Q-A to Q-D (relayed; no file) | `[REJECT]`, O1 to O18 (`opus-verdict.md`) | v1; the code-searcher packet (ledger row 1724) fed v2 |
| 2 (plan v2) | `[EDITORIAL]`: F1 to F3 closed; two required corrections (A1 versus the shard entry; Q-C timing) plus editorial items (`advisor-verdict-r2.md`) | `[REJECT]`, R2-1 to R2-12; two blocking: R2-1 (deletion removes upstream data) and R2-2 (recovery can break I1) (`opus-verdict-r2.md`) | v2 |
| 3 (plan v3) | `[APPROVE]` (`advisor-verdict-r3.md`) | `[APPROVE]` with binding items C1 to C4 (`opus-verdict-r3.md`) | v3 as a delta over v2 |

- Reject streak: at most two consecutive `[REJECT]` on the opus track (rounds 1 and 2), so the three-round rule of AGENTS was not reached and no advisor escalation was made. The advisor's `[EDITORIAL]` neither counts nor breaks a streak.
- The Orchestrator's disposition (plan v3 section 7, 2026-10-13) records both round-3 verdicts and makes C1 to C4 binding inputs to the named Gate 1.

## B3. Finding disposition

- **Advisor r1 F1 to F11 and Q-D → plan v2** (section 0 of v2): retention admission (F1), re-encode and compare before unload (F2, I8), no silent byte budget (F3), `shardCount` field (F5), fixed replay minimums (F6), absent check-only key behaviour (F7), Tauri durability (F8), honest rollback (F9), old-format data (F10), disclosures (F11), size script (Q-D). F4 is not listed in v2's table; TODO(evidence).
- **Opus r1 O1 to O18 → plan v2.** Opus r2 closure table: O1, O3 to O9, O11 to O15 and O18 closed (some with a named residual: O1 needs R2-5, O3 needs R2-8, O6 needs R2-6, O8 needs R2-4); O2 and O10 partly closed; O16 closed except the recovery seq (R2-2); O17 moot (settled by M1).
- **Advisor r2 items → plan v3:** A1 redefined (item 1, AR2-1); Q-C moved before the freeze (item 2, AR2-2); deletion only on the fork branch (item 3, with opus R2-1); E1-1 bounds stated (item 4, AR2-4); owner-claim protocol dropped (item 5, AR2-5, adopted; opus R2-7 rebutted on the same basis); OPFS-transitional row (item 6, AR2-6); P10 probe timing (item 7, AR2-7); M1 and M2 recorded (item 8, AR2-8); idle-sweep bounds; 4.3 device checks on the integrated build. Advisor r2's editorial suggestion to rebuild `retained` during recovery was answered by the disclosed cost, which advisor r3 accepted.
- **Opus r2 R2-1 to R2-12 → plan v3:** R2-1 (fork marker, both-present rules, key-only walk, guard A10 and three mutants); R2-2 (recovery through the bulk import path; epoch plus full-bytes compare); R2-3 (T2 rows added; the boot asset sweep's keep-set source changes); R2-4 (stub rule, I9); R2-5 (positive marker, stub proxy); R2-6 (Tauri re-flush or re-write); R2-7 (**rebutted**; opus r3 accepted); R2-8 (restore pushes `current`); R2-9 (key-only walk); R2-10 (IndexedDB transaction rule, OPFS row); R2-11 (missing-unit message; plugin values lazy); R2-12 (editorial).
- **Round 3 → binding carry-forward C1 to C4 and editorial** (A5).

## B4. Accepted limitations

These were accepted at Gate 1 and are not closed; each keeps its source label.

- **P2, protocol safety: PARTIAL.** Safety rests on E1-1, the section A3 replay and the live-server test, all owed. The replay is sampling evidence for the unexhausted regions, not exhaustion; E1-1 runs at reduced stated bounds.
- **P5, append cost: S0-2 VERIFIED; S0-8 root-write series AUTHOR-ONLY.** Re-verify or re-measure before the freeze. **(Updated 2026-10-14, Part D: re-measured independently, CONFIRMED with conditions, MEASURED on best-case hardware; ledger row 1743.)** The S0 report's complete-load figure is also over the +20 % gate on IndexedDB at 128 and 192 KiB (`MC-283` note).
- **P6, mark under 1 s with 16 shards: AUTHOR-ONLY and marginal.** Re-run before the freeze; device gate in stage 5. **(Updated 2026-10-14, Part D: re-measured, PARTIAL, under 1 s only with 8-concurrent or batched reads; ledger row 1743.)**
- **P10, IndexedDB cross-tab serialisation: INFERRED.** Spec reasoning plus a fake that does not model durability or crashes. A two-tab plain-HTTP probe is owed before stage 1 Gate 2, and the stage 2 real-browser check repeats it. A failure changes the adapter only and goes to the maintainer. **(Updated 2026-10-14, Part D: the plain-HTTP probe ran, CONFIRMED on plain HTTP, MEASURED on desktop Chrome 155 and Note 9 Chrome 154, zero interleaving; the stage 2 real-adapter repeat and the hidden-tab stall remain owed; ledger row 1743.)**
- **Other disclosed costs:** the recovered profile starts with an empty `retained`; a web crash mid-bulk leaves a marker until a Q3 prompt (C3); long-chat open is slower than today until stage 6; first display waits for modules after stage 7.
- **Hardware:** all S0 figures are best-case or proxy figures (see the header).

## B5. Remaining uncertainty

- Whether upstream restores fork stubs (S0-3; the A4 hand check decides); an upstream-exported `.bin` sample is owed.
- Whether `durability: 'strict'` is honoured by the Note 9's Chrome build.
- Upstream's numbered-backup naming was not checked against upstream source (advisor r2 finding 3 and its UNCERTAINTY note; opus r2 R2-1 treats the files as upstream's backups without flagging this); the deletion rule is safe under either naming.
- The editDisplay / display-trigger / CBS behaviour behind stage 6's "wait only if used" is PLAUSIBLE and untraced.
- Real sizes (Q-D) answered 2026-10-13 (A6); C4 decided 2026-10-13 (`MC-289`, A5.4 and A6); still open: Q3 and Q9.
- Whether CHORE-105 carries stage 0b: TODO(evidence).
- The order in which the code-searcher packet and the round-1 verdicts arrived is not recorded.
- The report's documentation claims were checked by `doc-verifier` (`[EDITORIAL]`, ledger row 1732); the plan's design claims remain as labelled above.

## B6. Citation and consistency notes

- Opus r3 assigns C4 to "stage 4a Gate 1"; the Orchestrator's disposition (plan v3 section 7) makes it a **stage 1+3 freeze input** because it shapes the format. This report follows the disposition and flags the difference.
- Plan v3's header says the stage list "awaits maintainer approval"; round G1 approved it (`MC-288` 1).
- Plan v1 cited Q1 and Q2 as questions; M1 and M2 settled them before v2.

## B7. Next steps and owners

1. Stage 0a (guarded Node routes, retire, capabilities): done 2026-10-13 on `feat/alite`, see Part C (a stage-level plan was written and passed its own Gate 1, rounds 1 and 2, before implementation). Gates: `opus-reviewer`.
2. Stages 1+3: Gate 1 with a `senior-advisor` challenge; C2 and C4 bind it; Q-D answered 2026-10-13 (A6); preparation started (C9). **(Updated 2026-10-14, Part D: Gate 1 passed 2026-10-14; next steps are in D9.)**
3. The independent `doc-verifier` pass of this report and of the records of this pass is done (ledger row 1732, `[EDITORIAL]`, fixes applied).

---

# Part C. Stage 0a outcome (2026-10-13)

Appended after the sections above; those sections are not rewritten. Where they say stage 0a is next or not started (the STATUS line, A7, B7 item 1), this part supersedes them for stage 0a. The stage 1+3 and later text is unchanged. Provenance: the stage's plan, verdict and handback files are session scratch (`S` below = `C:\Users\yor42\AppData\Local\Temp\claude\C--Projects-RisuAI\7373226a-26bd-41e1-bd9d-31e3becc2524\scratchpad\storage\stage0a`), outside the repository. Statements below are labelled by who checked them: the orchestrator checked the Gate 1 round 2 conditions against the plan text, the Gate 2 fixes by diff, the commit, and the locale diff (one inserted line per file); everything else is the named agent's own claim (the implementer's handback, a reviewer's verdict) and has not been independently re-run by this record.

## C1. Commit, branch and gates

- **Commit:** `ebe3c77a9` ("Stage 0a: guarded Node storage routes for the A-lite rewrite") on branch `feat/alite`, worktree `C:\Projects\RisuAI\.claude\worktrees\alite`, on top of `e7bbb5a2d`. `git show --stat` (read by this record): 23 files changed, 2,685 insertions, 23 deletions. **Not merged to `main`; `main` is unchanged at `e7bbb5a2d`.**
- **Gate 1, round 1:** `opus-reviewer`, `[REJECT]` (`S\gate1-verdict.md`): one blocking finding (B1) and seven should-fix findings (S1 to S7) against plan v1 of the stage (kept as `S\plan-v1.md`; the orchestrator's brief to round 2 named it as the reviewed plan). The reviewer's own scope note: B1 is the only blocking item, S1 to S7 are plan amendments, and a targeted remediation review is enough. B1 is the "headers lost in transit" case: with both check-only headers treated as an empty list, a proxy that drops them gets a 200 with the marker and a numeric revision for a request that was never check-only guarded.
- **Gate 1, round 2:** `opus-reviewer`, `[APPROVE WITH CONDITIONS]` (`S\gate1-verdict-r2.md`), a targeted re-review of plan v2 (kept as `S\plan-v2.md`): B1 and S1 to S7 resolved; new findings N1 to N3 and recommendation C3; three conditions (N1 applied; N2 and N3 test wording corrected; C3 adopted or recorded as an accepted limitation). The orchestrator adopted C3 and checked the conditions against the plan text; the plan became v3 (`S\plan.md`). The reviewer stated its execution as one scratch probe plus source reading.
- **Gate 2:** `opus-reviewer`, `[EDITORIAL]` (`S\gate2-verdict.md`): server and client match plan v3; the handler extraction is pure; no false-success path and no silent-data-loss path found. Three editorial findings, E1 to E3 (below), applied and checked by the orchestrator by diff. The reviewer's own runs: nine node-route test files 246/246 passed on the edited server; against the pinned old server `nodeRoutesUnchanged` 4/4 passed and `nodeRetire` 15/15 failed; a partial-append mutant killed 3/3; `pnpm check` 0 errors.
- **Reject streak:** one `[REJECT]` on this stage's Gate 1, then an approve with conditions; the three-round rule was not approached.

## C2. What was built (the implementer's handback, `S\impl\handback.md`; the commit stat is the orchestrator's)

- **Server** (`server/node/server.cjs`, new `server/node/aliteKeys.cjs`): `/api/write-checked`, `/api/remove-checked` and `/api/caps`; the original `/api/write` and `/api/remove` become `handleWrite` and `handleRemove` with `guarded=false`. Guarded routes require the `check-only-count` and `retire-count` headers (a lost or altered list is a 400 with `code:'guarded-count'` before any lock or file work), compare check-only keys inside the global revision transaction, carry the `risu-storage-guarded: 1` marker and `Cache-Control: no-store`, and echo the enforced `checkOnly` (and `retired`) counts. `retire` is accepted only on `/api/remove-checked`, only for keys under the prefix `alite/` (plan decision D3), runs inside the file write locks after the removal and appends a `{k,d:1}` delete record; the revision-log parser is normalising and start-up replay honours delete records in log order. A failed retire append answers 500 with the revisions.
- **Client** (`src/ts/storage/store/nodeHttpStore.ts`, `contract.ts`, `errors.ts`, `keyRules.ts`): an optional `guarded` surface on the Node byte store (`probe`, `writeChecked`, `removeChecked`, `retireChecked`), which never falls back to the unguarded routes and never follows redirects; new errors `ServerLacksCapabilityError`, `StoreCheckListTooLongError` and `StoreOutcomeUnknownError`; pre-flight limits of 60 check-only keys and 8000 header bytes.
- **UI string:** `errors.storageServerNeedsUpdate` in all seven locales. The translator drafted the six non-English strings and the coder applied them verbatim, because the write guard limits translators to the main checkout. The orchestrator checked the locale diff: one inserted line per file.
- **Tests:** five new test files and edits to four existing ones (list in the commit; handback line counts for the new files: `nodeGuardedRoutes` 491, `nodeRetire` 361 at hand-in and 378 after the Gate 2 test, `nodeRoutesUnchanged` 201, `nodeHttpStoreGuarded` 423, `nodeAliteKeyRule` 63, plus the `nodeGuardedProxy.ts` helper).
- **Not built, by plan:** no consumer. The boot and per-GC-pass `probe` call sites belong to stage 1+3 (plan section 11, deviation 3), and no UI path parks on the new string yet.

## C3. Design decisions taken at Gate 1

1. **C3 count headers (the reviewer's recommendation C3, adopted by the orchestrator).** `check-only-count` and `retire-count` are mandatory on the guarded routes (`0` allowed), so a proxy that strips custom headers gets a 400 and nothing is applied. This prevents B1 instead of detecting it afterwards. Residual stated in plan risk 3b: the old routes share the same exposure for `if-match-revision` (see C8).
2. **Echo kept as defence in depth.** The success body still echoes `checkOnly` and `retired`, and the client requires them to equal what it sent, so a rewriting intermediary is caught too. The echo alone detects only after the server applied the request; the count header is what prevents it.
3. **`ServerLacksCapabilityError.mayHaveApplied` (reviewer's N1, adopted).** A boolean saying whether the request may have been applied: true for a refused 2xx, false for a 404, 405, 3xx, refused count list, or caps refusal. A `true` is handled like `StoreOutcomeUnknownError` (re-read the commit key; GC abandons the pass). The park string no longer says "Nothing was changed.".
4. **`StoreOutcomeUnknownError`.** New error thrown only after the request was sent, for a connection reset after send. The reviewer accepted the name in round 2 (S6): `errors.ts` had no uncertain-outcome class, and the name matches the existing `'unknown'` vocabulary. A reset is never typed as list-too-long (mutant M-AL).
5. **Retire placement (S2) and failure plumbing (S3).** Retire runs inside the `withFileWriteLocks` callback, after the removal loop; a retire-append error carries `committedRevisions` so the existing handler answers 500 with `revisions`; a fault marker that fires only on an append containing `"d":1` exercises it.

## C4. Deviations from the plan (handback deviations 1 to 7, plus 8) and from the earlier report text

The handback numbers eight items; items 1 to 7 are deviations from plan v3, item 8 records that no change was needed.

1. Replay tests (c) and (d) were labelled green on the old server in the plan; with the snapshot values used they are red on old (the old parser reads the snapshot value 5 where 0 or 3 is expected), so they are new-behaviour tests. Test (d) also kills mutant M-AK.
2. `mayHaveApplied` is always false for caps refusals, and false for a 2xx `text/html` answer without the marker (an HTML page is a front end's answer). Any other unmarked 2xx, and every refused marked 2xx, is true. The plan's flat "any refused 2xx is true" conflicted with its own html-200 expectation. Gate 2 accepted this, and named one residual outside the repository: an intermediary that forwards the request and then replaces the answer with a page (for example an `error_page` mapping a 502 or 504 to a 200 page) would be reported `mayHaveApplied: false` after the server applied it; bounded by the commit key's compare-and-swap, out of the threat model, same class as risk 3b. The Gate 2 fix E2 documents this.
3. The scratch S0-16 `compare.js` SHA-256 pair was not re-run. The literal table of original-route answers captured from the pinned old server (`S\impl\g1-capture.json`, 25 requests plus the revision log) is asserted on the old and the new server instead. The original write temp-file failure path cannot be injected and stays review-only (Gate 2 read it).
4. One test not in the plan: a 409 whose marker was lost is refused ("marker-lost conflict"), because no planned test killed mutant M-AD.
5. `parseRetire` validates the `retire` header value before the count checks (a value other than `1` is a plain 400, not a count refusal).
6. A guarded remove with no `file-path` is a 400; the original route answers 200 with `revisions:{}`. Only the guarded route changed. Gate 2 note: maps to `NodeHttpError(400)`; the client refuses an empty list before sending.
7. The normalised record parser drops unknown extra fields of bump records (`{k,r,x}` becomes `{k,r}`); no such record is ever written.
8. `nodeServerFixture.ts` needed no change.

Plan section 11 (the earlier deviations from this report's stage 0a text, labelled E1 in the plan) lists seven items plus one added in v3; they stand as listed there: (1) the client "reproducer" is relabelled guards plus mutants (no pre-fix client exists); (2) the "26 red / 13 pass on both" split does not carry over to the new-route design, measured counts replace it (C5 below); (3) the boot and per-GC-pass `probe` call sites move to stage 1+3; (4) "numeric revision on every guarded response" applies to 2xx only (non-2xx guarded responses carry the marker, and `currentRevision` on a 409); (5) success bodies gain `checkOnly` and `retired`, and guarded responses and `/api/caps` carry `Cache-Control: no-store`; (6) a failing retire append answers 500 with `revisions`; (7) `GUARDED_HEADER_BYTES` is 8000; (8, v3) the C3 headers, `mayHaveApplied`, and the string text without "Nothing was changed.".

## C5. Measured counts (the implementer's runs against a pinned copy of the old server at `e7bbb5a2d`, `sha256 AC785277...81B2` per the handback; Gate 2 re-ran two of them)

This report asked that the records carry measured counts. Environment: Windows 11, Node, vitest 4.1.11, localhost on an i9-class machine; nothing ran on a phone or Pi.

| Test file | On the old server | On the new server | Note |
|---|---|---|---|
| `nodeGuardedRoutes.test.ts` (51 tests) | 50 failed, 1 passed | all pass | failures are `expected 404 to be 200/400/409` and body mismatches, not import errors; the 1 pass is the both-servers controls test |
| `nodeRetire.test.ts` (15 tests at that run) | 15 failed, 0 passed (Gate 2 re-ran: 15/15 red) | all pass | replay cases (a) to (d) fail for the real reason (old parser value), not a 404 |
| `nodeRoutesUnchanged.test.ts` (4 tests) | 4 passed | 4 passed | guard, not a reproducer; also 4/4 on the unmodified worktree before the edit (Gate 2 re-ran it on the old server: 4/4) |
| Client and conformance, six files, 164 tests | 12 failed, 152 passed | all pass | 4 conformance S14, 7 in `nodeHttpStoreGuarded`, 1 `nodeServerRoutes` bucket test; the proxy-mode refusal tests pass on old (a correct client refuses; guards) |

- The new client against the real old server refuses with `ServerLacksCapabilityError` (observed 404) and never reaches `/api/write` or `/api/remove` (handback, from failure messages).
- "Numeric revision on every guarded response" was measured as stated in plan section 11 item 4: it is asserted on 2xx responses only; non-2xx guarded responses are asserted to carry the marker.
- A 400-key request with the pre-flight limits lifted: Node answered 431, which the client typed as `StoreCheckListTooLongError`, with exactly one request (printed diagnostic in the implementer's run; a reset would be `StoreOutcomeUnknownError`, which the plan requires the test to distinguish).

## C6. Mutant results (handback; Gate 2 re-ran only the partial-append mutant and the old-server runs above)

Server mutants (scratch copies; runs over `nodeGuardedRoutes`, `nodeRetire`, `nodeRoutesUnchanged`, `nodeHttpStoreGuarded`, 92 tests): M-S (version-1 parser) killed, 5 failed; M-T (map entry deleted, no `d:1`) killed, 4; M-U (`d:1` appended, entry kept) killed, 8; M-V (retire outside prefix accepted) killed, 1; M-W (retire before removal) killed, 2; M-X (retire without check-only) killed, 1; M-AE (unsorted locks) killed, 1 (the 120-concurrent test, by timeout; the plan did not assume it); M-AG (absent check-only skipped instead of 0) killed, 2; M-AK (raw object returned, `{k,d:1,r:5}` deletes) killed, 1; M-AM (retire append error without `committedRevisions`) killed, 1; M-AN (server ignores the count headers) killed, 22.

Client mutants (applied to the repository file with a backup and sha256-verified restore; `nodeHttpStoreGuarded` plus `nodeHttpStore`, 122 tests, baseline 122 passed): M-Y (falls back to old routes) killed, 9; M-Z (trusts a bare 200 without the marker) killed, 6; M-AA (marker without numeric revision) killed, 1; M-AB (retire without prefix assertion) killed, 2; M-AC1 (resend after 431) killed, 2; M-AC2 (resend after reset) killed, 1 (the first run of the mutant script had a syntax error and ran no tests; fixed and rerun); M-AD (409 without marker read as a conflict) killed, 1 (test added during implementation, deviation 4); M-AH (ignores the echo) killed, 2; M-AJ (follows redirects) killed, 2; M-AL (reset or unsent failure typed as list-too-long) killed, 2; M-AO (client omits count headers) killed, 11; M-AP (refused 2xx reported as `mayHaveApplied` false) killed, 2.

Gate 2 follow-up: M-AQ (only the first key's delete record appended) was killed, 2 failed of 94 (the new two-key test and the racing-batches test). Gate 2 found it killed only by the racing-batches test (3 of 3 runs) before that test was added, and recommended the deterministic two-key test, which was added.

**Review-only (no deterministic black-box interleave):** M-AF (check-only keys not joined into the lock set) and M-AI (retire after the locks are released). Gate 2 confirmed both placements by reading. Gate 2 also named an equivalent mutant (echo computed from the count header instead of the parsed list; the server enforces count equals parsed length).

## C7. Gate 2 editorial fixes, test results, hygiene

- **Fixes (checked by the orchestrator by diff):** E1 adds a `NodeHttpError` bullet to the `GuardedOperations` failure list in `contract.ts` and the same sentence to the `StoreOutcomeUnknownError` doc in `errors.ts` (a 5xx or an intermediary's status after send may have applied; handle like `StoreOutcomeUnknownError`; 400, 401, 403 and 429 applied nothing); E2 rewords the HTML-page comment in `guardedRequest` and the `ServerLacksCapabilityError` doc (see C4 item 2); E3 narrows the downgrade note in `server.cjs` to "may bring retired keys back (while the log still holds their bump records)". Plus the optional deterministic test (retire two keys, restart, both read 0 and neither is in the snapshot).
- **Full `pnpm test` on the final snapshot** (`S\impl\full-test.txt`, exit 1): 712 files, 710 passed, 2 failed; 14,163 tests, 14,155 passed, 2 failed, 6 skipped. Both failures were 5 s timeouts under full-suite load: `assetFacade.test.ts` (a Tauri `saveAsset` reproducer) and `assetPieceSave.test.ts` (a `saveAsset` without `crypto.subtle` reproducer). The implementer's claim: both files pass alone (75/75 each, run twice), and neither imports a module this stage changed (grep: no `nodeHttpStore`, `nodeServerFixture`, `keyRules` or guarded); the `assetPieceSave` timeout matches the known flakiness item (CHORE-152 in the ledger and Roadmap). **Not re-run on `main`**; the evidence that they are load-sensitive rather than caused by 0a is the isolated passes and the absence of a shared import, not a before-and-after comparison.
- **`pnpm check`:** 0 errors, 0 warnings on the final snapshot (implementer's run; Gate 2 also ran it).
- **Hygiene:** per the handback and Gate 2, touched files are CRLF with equal CR and LF counts and no BOM; `node --check server/node/server.cjs` exit 0; no `any`.
- **Known leftover:** the worktree shows `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap` as modified, line endings only (vitest rewrote it; `git status --short` in the worktree read by this record). Left untouched and not part of the commit.

## C8. Carried to stage 1+3 and later (binding inputs from plan section 12 and the Gate 2 notes)

- **Risk 3b, restated (Gate 2 N1; the stage 1+3 plan must restate it):** a proxy that strips `if-match-revision` turns the own-key condition into an unconditional one. The count headers and the echo do not cover it. Pre-existing on the old routes; out of scope for 0a.
- **Every commit-key write goes through `writeChecked`** (plan section 12, stage 1), including the recovery marker CAS and the abandon-clear, never the plain `write`; otherwise a marker could land on an old server before the guarded final CAS is refused.
- **The commit key lives outside `alite/`** (plan section 12, S7, binding for the stage 1+3 freeze), or the server's retire check is extended to refuse it by name. Retirable means never rewritten.
- **Probe call sites:** stage 1+3 names the boot and per-GC-pass `probe` call sites; GC handles `StoreOutcomeUnknownError` by abandoning the pass, and `StoreCheckListTooLongError` by switching to the bulk path where one exists. A `ServerLacksCapabilityError` with `mayHaveApplied: true` is handled like `StoreOutcomeUnknownError`.
- **Prefix name:** `alite/` is the plan's pick (D3). If the maintainer prefers a neutral name, it must be decided before the stage 1+3 freeze. **(Updated 2026-10-14, Part D: decided, `MC-290` U2; the names are `store2/` and `store2-commit`, and the stage 0a identifiers are renamed in the P0a follow-up. The commit key is outside the prefix, as the previous bullet requires.)**

## C9. Open items

- **Merge:** `feat/alite` (`ebe3c77a9`) is not merged to `main`. When it merges is the maintainer's call; the timing is not stated in the sources given to this record (the orchestrator relays that the branch decision says at the latest after 4a+4b): TODO(evidence).
- **Express ETag note (implementer's):** the literal table's ETag values are Express weak ETags of the JSON bodies; a different Express major could change them.
- **Not exercised:** the old write temp-file failure path (review-only); M-AF and M-AI (review-only); nothing ran on a phone, a Pi or against a reverse proxy; the proxy modes are stubs.
- **Stage 1+3 Gate 1 preparation:** Q-D, the real-size run, is done (2026-10-13; A6 "Settled", ledger row 1741). The rest started 2026-10-13: the P10 two-tab plain-HTTP probe, the S0-8 and S0-5b re-measure, the E1-1 model extension and the C4 sizing (done: C4 decided 2026-10-13, `MC-289`, A5.4, ledger row 1742); apart from C4, none of these has a recorded result yet (see B4, B5, A6). **(Updated 2026-10-14, Part D: all four now have recorded results, ledger rows 1743 to 1745; the P5, P6 and P10 status lines in A1.3 and B4 are updated; E1-1 ran at `faultCap=1`.)**
- **Records:** this part was verified by `doc-verifier` `a76804465aa082c3d`: `[EDITORIAL]`, about 95 claims in 11 groups, 9 groups confirmed; two fixes applied (ledger row 1739 cell split, the C3 cross-reference to C8); 95k tokens (ledger row 1740).

---

# Part D. Stage 1+3 Gate 1 (2026-10-13 to 2026-10-14)

Written 2026-10-14 by `doc-writer` from the orchestrator's brief and the scratch sources it names, now copied to `Agents/Tools/storage-model/` (README there). **This is a summary of the approved plan, not the plan.** The full plan, with every section number cited below, is `Agents/Tools/storage-model/plan-v3.4.md`; do not read this part as a substitute. Nothing here ran as code except what the cited scratch results ran; no repository code was changed by the Gate 1. `doc-verifier` had not run on this part when it was written. The labels (MEASURED, EXECUTED, REASONED, INFERRED, REVIEWER-READ, AUTHOR-ONLY, TODO(evidence)) are the plan's own and none is upgraded here. **Every timing below is from an i9-13900KF (best-case hardware) or a Note 9 Chrome page; no Pi-class box, mid-range phone or real Tauri/Android app path was run.**

Maintainer answers: `MC-290` (U1, U2, U3, U7 to U13). Ledger rows 1743 to 1750.

## D1. Status and Gate history

**Gate 1 for stages 1+3 PASSED on 2026-10-14.** Plan versions and verdicts:

| Plan | Review | Verdict | Notes |
|---|---|---|---|
| v1 | internal draft | none | feeds v2 |
| v2 | `opus-reviewer` round 1 (`reviews/r1-review.md`), plus the `senior-advisor` challenge | **`[REJECT]`**, 17 findings | maintainer answers U8 to U11 follow; the advisor's own verdict label is not in the supplied sources: TODO(evidence) (its text is quoted in plan v3's change table) |
| v3 | `opus-reviewer` round 2 (`reviews/r2-review.md`) | **`[REJECT]`**, narrow, 10 findings | second rejection: the mechanism was reconsidered (plan v3.1 E1) and kept, with two simplifications S1 and S2 (D3); U12 follows |
| v3.1 | `opus-reviewer` round 3 (`reviews/r3-review.md`) | **`[APPROVE WITH CONDITIONS]`**, 17 findings, conditions C1 to C13 | U13 follows |
| v3.2 | conditions check (`reviews/r3-conditions-check.md`) | `[APPROVE WITH CONDITIONS]` | C11 and C13 partial; N1 to N5; R-a |
| v3.3 | conditions check 2 (`reviews/r3-conditions-check-2.md`) | `[APPROVE WITH CONDITIONS]` | D1 (N1 partial), E1 |
| v3.4 | conditions check 3 (`reviews/r3-conditions-check-3.md`) | **`[APPROVE]`** | the orchestrator applied v3.4's two edits, J1 and J2 |

**Escalation accounting (accurate to the review files).** AGENTS.md requires `senior-advisor` escalation before a fourth revision after three consecutive substantive `[REJECT]` rounds, and a reconsideration of the mechanism at the second rejection. The `opus-reviewer` rounds were `[REJECT]`, `[REJECT]`, `[APPROVE WITH CONDITIONS]`. Round 3 was conditional, so no third consecutive `[REJECT]` occurred on the review files and no advisor escalation was needed. The mechanism was reconsidered at the second rejection (plan v3.1 E1, S1/S2). The brief for this records pass described the rounds as three consecutive `[REJECT]`s; see D10 (citation mismatch).

All reviewers were `opus-reviewer` instances (ids in ledger rows 1747 to 1749). Review files record the reviewers' reads; the plan labels many facts REVIEWER-READ, meaning cited from a review file and not reopened by the plan's author.

## D2. Format decisions (plan sections 3.1 to 3.10; build candidate)

- **Names (U2):** prefix `store2/`; top-level keys `store2-commit`, `store2-sweep`, `store2-fence`; library directory `src/ts/storage/store2/`. Stage 0a identifiers are renamed in P0a.
- **Three evolution tiers (3.1a):** Tier 1 harmless additive (readers ignore unknown fields; writers copy unknown fields of every non-derived object at every level); Tier 2 load-bearing additive (a `req` token on the manifest and the commit key; an older build sees an unknown token as too-new); Tier 3 format change (`fmt` bump, Gate 1 reopen after the declaration). A bump of a derived list's version is Tier 1 with refusal.
- **Keys (3.2):** alphabet `0-9a-v`; ordinary `store2/<kind>-<id>` 35 bytes; staged `store2/g-<stg16>-<k><r16>` and, for manifests, `store2/g-<stg16>-m<t7><r9>` 43 bytes, so staged manifests order without body reads; a test asserts every generated key is at most 48 bytes.
- **Frame (3.3):** magic `RSAL`, `fmt` 1, type, codec 0 (UTF-8 JSON), reserved 0, payload length, header CRC32, payload, payload CRC32. A valid-header frame with `fmt` above 1 or an unknown codec, reserved or type byte is **too-new**, never damaged. Unit types 1 to 23 (23 is the fence record). A single `refsOf(type, body)` schema table names every Ref position; mutants are generated one per table row.
- **Commit key (3.4):** `{fmt, req, seq, epoch, current, retained, pins, staging, convertedFrom, convertedAt}`; `current: null` is valid (recovery, conversion and seed markers). No `fence` field (the fence moved out, D3). First life: the create uses the revision returned with the absence read, not a hard-coded 0.
- **Manifest, shards, chats, chunks (3.5, 3.6):** write-once manifest with 16 shards; shard chosen by `crc32(utf8(u)) mod shardCount`, `u` minted by the converter, never derived from `chaId`; chunk tuple `[tail, bytes, crc, count]`; `chunks` is required (no `cx` reservation, S2); an empty chat has one chunk with `msgs: []`; chunks seal at 131,072 bytes.
- **Lists (3.8):** per-owner asset lists (type 15), config-level `fixed.configAl`, inlay lists (type 21) with an overflow flag and no silent cap, and one legacy unit (type 20) holding the union over the old upstream files, including their inlays (an orchestrator reading of U1, `MC-290`). Sizes of the asset lists are MEASURED (ledger row 1742).
- **What a commit writes (3.10):** an append writes 4 keys (5 when it adds an inlay id), under 256 KiB, at a 128 KiB chunk cap mean 106 KiB and maximum 169 KiB (MEASURED, ledger row 1743).

## D3. Protocol rules

- **Boot table (3.4b), 11 rows, summarised.** 1 commit key absent and no `store2/` key: convert / seed / fresh (the zero is confirmed by a re-filtered list; if the list fails, conversion and seeding are blocked). 2 commit key absent, any `store2/` key exists: recovery screen, never conversion or seeding. 3 too-new (higher `fmt`, unknown codec, reserved, type or `req` token, in the commit key, a manifest or unit read, or the fence): read-only with a notice (U10); where the build cannot parse, the notice is all it can show. 4 damaged: recovery screen. 5 parses, `current` non-null, tree loads: normal boot. 6 parses but a needed unit is missing or fails CRC: recovery screen. 7 to 11 parses with `current` null: by `staging` label (`recovery`, `seed`, `convert`, `import`, `restore`, `bulk`), recovery screen or re-run of the operation (`seed` always re-runs; `convert` re-runs only while the old upstream file exists). Every deleter refuses unless the row says normal.
- **Recovery (3.4b, 4.6; S1).** Candidates are `^store2/m-` plus completed staged manifests, excluding any key under a *standing* `staging.prefix`; the read-only tree read validates a pick; no promotion commit exists (S1, which reverses the author's earlier ruling that staged manifests are not candidates). The marker CAS writes `current: null`; units are rewritten under fresh keys; the final CAS names the new manifest. The screen always offers re-conversion (when an upstream main file exists) and `.bin` import, and "start a new empty profile" (U12) behind a confirmation while no candidate has passed validation; never when the state is too-new. S1 evidence is REASONED, not a model result (D6).
- **The fence `store2-fence` (3.4c; U12, U13).** A top-level key, outside `store2/`, never retired, never collected, never written by recovery or restore. Every recovery-screen exit (pick, re-conversion, `.bin` import, fresh start) creates or extends it by CAS **before** its marker CAS; it lists the tails of every `store2/` key that existed at any exit and keeps the prior commit key's bytes verbatim (`priorCommits`) and, over an unparsable fence, the damaged bytes (`priorFences`). Readers: absent means unfenced; parsable means GC treats every listed key as live and the asset sweep, inlay cleanup, manual cleanup and the Settings sweep button refuse; **unparsable, too-new or unreadable means every deleter, GC included, deletes nothing.** Every deleter's batch carries the fence version in the same atomic step as its commit-key check (Node check-only entry with the revision from the pass-start fence read, absent included; IndexedDB in-transaction read; Tauri under the mutex). Discard is an explicit Settings action: a CAS delete at the revision or bytes just read. On Tauri the exit waits for the fence write to report `flushed` before its marker CAS. Cost disclosed: while a fence exists the sweep, inlay cleanup and manual cleanup are off and the pre-exit keys stay (plan X16). Fence golden vectors F1 to F6 are part of step 1a.
- **Recovery after interruption (U7).** GC refuses while the commit key names no `current`; boot treats "parses but no current" like an unparsable key.
- **Protocol per backend (4.3 to 4.5).** Node: a prefix-only list route `GET /api/list-prefix?prefix=` and a `count=1` mode (U3; the client re-filters every response and falls back to `/api/list` on non-success), the commit key and fence created at the revision returned with the absence read. IndexedDB: own raw connection, ordinary commit one strict `readwrite` transaction, bulk by unit count (more than 59 new units), range-scan `list`/`has` (live-path change L2). Tauri: mutex, `isDurableKey` extended, flush status on all three Rust paths (live-path change L1), re-flush on every page load of the commit key and the fence.
- **Prerequisites (P0).** P0a (rename the prefix rule; widen the capability check to `checkOnly`, `retire` and `pieces` present and boolean, unknown keys ignored; corrected 2026-10-14 from "required flags true", which the plan and the code do not say) and P0b (an own-condition header on guarded write and remove routes for risk 3b), both on `feat/alite` before step 1a. The P0b option of a `&revisions=1` list mode is **not approved** (D8). **(Updated 2026-10-14: P0a and P0b are DONE on `feat/alite`, not pushed and not merged to `main`. P0a is commit `cafca63a4` (11 files, +129/-101; Gate 2 `opus-reviewer` `[REJECT]` on tests, then `[APPROVE]`); P0b is commit `e561fc614` (7 files, +269/-9; Gate 2 `opus-reviewer` `[EDITORIAL]`). Checks: `vitest src/ts/storage` 135 files, 3,561 passed, 2 skipped after P0a and 3,578 passed, 2 skipped after P0b; `pnpm check` 0/0; full `pnpm test` and the build were not run. P0b accepted residuals: an intermediary that strips `if-match-revision` and rewrites the count to match is outside the threat model (the echo catches it only after the write applied), and risk 3b is closed on the guarded routes only. Ledger rows 1751 and 1752.)**

## D4. Deleter rules

- **Sweep fences (3.8c):** a sweep needs a parsable commit key with a non-null `current`, `staging` null, no `store2-fence`, every closure node readable, no `unreadable` legacy file, and on Tauri a clear flush flag; each batch re-checks the commit key and the fence atomically. A list or unit whose `v` or `iv` is above this build's known version is unreadable: the pass reports incomplete and deletes nothing.
- **Node removals go per asset with drop-and-retry:** a 409 naming `store2-commit` rebuilds the keep-set; a 409 naming an asset drops that asset. **Node never deletes an item whose `rev` is null:** at most 500 candidates (the HEAD cap) enter the record per pass and each has a non-null `rev`; the cost is slow convergence on very large orphan sets.
- **Age record `store2-sweep` (type 22):** a young record is never rewritten; an old record deletes only the intersection with the fresh candidates under a fresh keep-set; a record dated more than 10 minutes ahead is treated as absent; `SWEEP_MIN_AGE` 24 hours is a proposal (basis INFERRED). IndexedDB and Tauri keep the content-addressed re-save residual (R22), disclosed.
- **U9:** automatic below `SWEEP_AUTO_LIMIT`, Settings button above it; placeholder 50,000 on every backend, an orchestrator placeholder, not a measurement.
- **Inlays (3.8d; U11):** type 21 body `{v, u, h, o, x?}`; no silent cap; an owner with unknown ids (`x`) blocks inlay deletion; an other-shaped candidate is deleted only when every owner is resident; candidates are lower-cased before the `u` lookup.
- **Legacy deleters (3.8e; binding stage 4a item):** on every profile opened by an A-lite build, deleters outside `store2/`, `assets/` and `inlays/` are disabled (the `remotes/` cleanup in both loops, the numbered-backup rotation inside `getDbBackups()`, `mainFileRename`, `deleteColdStorageUnits`, `supersededUnits`, manual clean-up's cold-unit and older-file deletes, OPFS copy-back leftovers once `store2-commit` exists), with a guard test and one mutant per disabled site; the A2.4a cutover deletion is exempt. The census behind the table is **PARTIAL** (Rust and unusually named receivers not enumerated): TODO(evidence), completed at the 4a Gate 1.
- **Sharing one live folder with upstream after conversion is unsupported (U8);** the conversion dialog says so.

## D5. Tests and mutants (plan section 7)

- **Stage 1:** golden vectors for every unit type and for the commit key (vectors 1 to 12) and fence (F1 to F6); classification of too-new versus damaged at boot, in a mark, in recovery listing and in a load; ordinal key order across a digit boundary; boot table rows 1 to 11; Node first-life create at "absent, revision 1"; the recovery screen's exits; the fence (every exit extends it before its marker CAS; a second exit writes a superset; unparsable fence stops every deleter); the V1-shaped integration (fresh start, then commit-key damage, then recovery: no pre-fence key deleted); `refsOf` with one generated mutant per row; backend conformance on three backends; L1 and L2 as a **reproducer** against today's IndexedDB `list`, then a guard.
- **Stage 3:** codec byte stability over T3, T4, T5 and legacy shapes; the codec refuses a stub; asset-list purity and `assetRefKey`; keep-set rules; sweep record rules; Node drop-and-retry; sweep races; marker-before-asset; inlay type 21 cases; legacy-deleter guard; U9 count methods; unknown fields round-trip at each level.
- **Mutants that must fail:** the Report 62 list plus the plan's additions (plan 7.3): any deleter running on absent, unparsable, null-current, too-new, fenced or unreadable-fence state; unknown codec treated as damaged; absent key seeds; zero count trusted; writer drops unknown fields or lowers `req`; newer list `v` read as complete; sweep without the per-batch fence; far-future record trusted; capped `il`; legacy deleters running (rows 2 to 10, 15); recovery or restore writing, deleting or shrinking the fence; an exit writing its marker before its fence; hard-coded create revision on Node; guarded remove retried as a whole after an asset conflict; plus the v3.3 additions (7.4): a `rev = null` item deleted on Node, a fence checked only at pass start, an absent fence checked at revision 0 (v3.4 J1), an exit over an unparsable fence keeping fewer keys than the listing, a marker CAS after an unflushed fence write on Tauri, a case-sensitive `u` lookup.
- Labels in the plan: **reproducer** (fails on the relevant pre-fix base), **new behaviour**, **guard**, **diagnostic**.

## D6. E1-1 and its bound (plan section 6; ledger rows 1744, 1745)

- **What ran (EXECUTED, scratch; the independent verifier takes precedence).** The protocol model, with lost responses, save-mine, pins, admission, abandon-clear, the IndexedDB and Tauri variants, and damage plus recovery. Exhaustive at `faultCap=1`, 0 violations: Node 94,119,831 states; "refuse" 83,978,143; IndexedDB without damage 57,079,650 (AUTHOR-ONLY); Tauri with every fault 34,371,907 (AUTHOR-ONLY). Re-run with identical counts by the verifier: Node `f1`, "refuse", "rec", "cur", IDB refuse with the check outside the transaction and the spot-checked mutants. `p_rec0` (9,973,029) was never re-run.
- **Finding F1** (a crash during recovery plus GC while `current` is null empties the profile) is CONFIRMED and, per the verifier, broader than the author reported: it needs no start-up clear, and a foreign clear loses the profile with no crash at all. The maintainer chose the "refuse" fix (U7).
- **The exit bound is `faultCap=1`: at most one crash-or-lost-response in total. It is a scope bound, not a sound reduction. The full Report 62 A2 bounds (1 crash and 1 lost response per actor) were NOT exhausted.**
- **Regions `faultCap=1` cannot reach:** an uncertain bulk final CAS followed by a crash of the owner before its read; a lost response on a recovery marker CAS followed by that actor's crash; any two-fault combination.
- **Inconclusive at the 1,800 s cap:** `W_refuse_fclear_L2` (about 30 % of seeds), `W_refuse_rec2_L2` (18 %), `W_ri_refuse_wide` (6 %), `W_refuse_f2_L2` (stopped at 420 s). **Unfinished:** `q_bulk`, `N_rec_f1`, `I_nosm_f1`, `N_reload0`.
- **Not covered by any run:** concurrent recoveries; the two-level tree; Tauri bulk and recovery; a proxy stripping the CAS condition (P0b closes it at the edge on the guarded `/api/write` and `/api/remove` routes only; plain write and remove are unchanged; qualified 2026-10-14); a real device's start-up clear of a recovery marker; the fence.
- **S1 evidence is REASONED, not a model result.** The model's candidate set is a superset with no standing-prefix exclusion, and no finished "refuse" run had a staged candidate; the argument that S1 is sound (recovery holds the chosen tree in memory before its marker CAS and rewrites every unit under fresh keys) is the reviewer's and the author's.
- Divergences that matter: D1 Tauri GC as a whole pass under one hold; D3 flat manifest; D4 foreign clear and web owner ids only in verifier runs; D5/D6 one recovery actor; D7 staged manifests as candidates; D8 save-mine rewrites every unit; D9 no assets; D13 Tauri preset has no bulk or recovery.

## D7. Measurements and corrected premises (ledger rows 1743, 1746)

All MEASURED on best-case hardware (i9; Note 9 Chrome page for P5 and P10). **P5** CONFIRMED with conditions: base cell p50 13.4 ms, p95 31.2 ms, maximum 46.7 ms; across all strict cells 6 of 2,000 samples over 60 ms and a maximum of 93.2 ms (192 KiB, 5 keys); "4 keys" holds only with the per-send fields outside the root. **P6** PARTIAL: under 1 s only with 8-concurrent or batched reads. **P10** CONFIRMED on plain HTTP: 86,180 and 22,691 transactions, zero interleaving; a hidden Android tab stopped completing callbacks after about a minute. IndexedDB whole-store `list` at 386,850 keys took 56,365 ms against 55 to 62 ms ranged. Node `/api/list` at 387,504 keys: p50 1.2 to 2.2 s, p95 3.2 to 3.6 s, 30,022,602 bytes, parse 127 to 206 ms, server RSS 70 to 72 MB idle and 312 to 315 MB after one list; `readdir` floor p50 610 ms; the scratch prefix route returned `store2/` in 148,528 bytes. The plan's section 0 table (R1 to R26) lists each premise it corrected and the consequence.

## D8. Freeze point and open items (plan sections 1, 10)

- **Freeze point.** Step 1a makes `fmt = 1` a **build candidate**. It is declared **frozen at the stage 3 gate** after (i) the maintainer-run, counts-only real-data census (plan 8.3, including the inlay collector's scope and per-owner counts and chunks per chat) and (ii) the model variants **V1 to V4** (V1 with fresh start, damage, recovery and fence and the fence-write-to-marker window; V2 the deleter fence under a newer `req` token; V3 the sweep fence; V4 the "refuse" fix with a bulk, one silent damage and one recovery, with staged manifests as candidates). Amendment before the declaration: through `feat/alite`, updated golden vectors, one `opus-reviewer` round; no Gate 1 reopen unless a safety property is removed. Removing a safety property (refuse list, `req`, `store2-fence`, key location outside the prefix) before the declaration needs a Gate 1 reopen; after the declaration a Tier 3 change does.
- **Before stage 2 Gate 2:** N2 (Tauri flag lost with the re-flush), `q_bulk`, `N_rec_f1`, `I_nosm_f1`, `N_reload0`, `faultCap=2` on a reduced set.
- **Numbers still to be set by measurement:** `SWEEP_AUTO_LIMIT` (placeholder 50,000; the maintainer's library is above it); IndexedDB strict-hold at 1, 4 and 16 MiB (before 1b Gate 2) and whether a byte threshold is needed; `SWEEP_MIN_AGE` (24 h proposal); the Node HEAD cap of 500; the 8 MiB unit-size parameter that sets `x`. **Unmeasured:** the A2 cost on Tauri Android; `count(range)` on IndexedDB at 386k keys; Node prefix, count and HEAD-per-candidate cost on a Pi and over LAN; the per-batch fence check on IndexedDB when a large fence exists; legacy derivation time and memory; power loss after exit.
- **Later traces (4a unless noted):** whether legacy derivation resolves `remotes/` pointers; completion of the call-site census; whether anything reads `convertedFrom` / `convertedAt`; which chat fields are per-send in real use; the `usesDisplayScripts` trace (stage 6); the save debounce value; `Chat.id` for `cid`; upstream stub restore (4b); the manual clean-up age rule (stage 5).
- **Open product question, not decided:** the P0b `&revisions=1` list mode (`MC-290` does not cover it); without it large Node orphan sets converge slowly.
- **Carried reviewer acceptances:** (a) a higher `fmt` or unknown codec shows only a notice, accepted with the `MC-290` disclosure; (b) the sweep age cannot protect a tab stalled beyond it, accepted as a stall residual; (c) recovery offering only `m-` is moot under S1. Q3 and Q9 stay open (A6).

## D9. Next steps

1. P0a and P0b follow-ups on `feat/alite` (each its own Gate 2, `opus-reviewer`); both merge into `feat/alite` before step 1a. **(Updated 2026-10-14: DONE. P0a `cafca63a4` and P0b `e561fc614` are committed on `feat/alite`, each with its Gate 2; ledger rows 1751 and 1752. Not pushed, not merged to `main`. Next is step 1a on `feat/alite-fmt`, which waits for the maintainer's go-ahead.)**
2. Step 1a (`format/`, golden vectors incl. F1 to F6), then stage 1b (library, adapters, L1, L2, `/api/list-prefix`, `fence.ts`) and stage 3 from merged 1a, in separate worktrees; one application-code writer each; no merge to `main` before the maintainer says.
3. The maintainer-run counts-only census (plan 8.3) and variants V1 to V4, before the freeze declaration at the stage 3 gate.
4. Device checks owed to stage 1b Gate 2: strict hold at 1, 4 and 16 MiB; L1 on an Android build and Windows; L2 on a Note 9 build; Node `/api/list-prefix` and count from a Note 9 over LAN and a Pi-class host (sets `SWEEP_AUTO_LIMIT`).
5. Translator strings for the new UI (conversion dialog, too-new notice, Settings sweep button and its first-press note, unreadable-legacy notice, flush-failure notice, recovery-screen options and the fresh-start confirmation, "discard old data").

## D10. Citation and consistency notes

- The brief for this records pass called the review rounds three consecutive `[REJECT]`s. The review files show two `[REJECT]` rounds (r1, r2) and an `[APPROVE WITH CONDITIONS]` round (r3). Part D follows the review files; whether the `senior-advisor` challenge after round 1 counts as a third rejection is not in the supplied sources: TODO(evidence).
- Plan v3.4's section 10 A.1 says U2 covers `store2-sweep` and `store2-fence` as well as `store2/` and `store2-commit`; the maintainer's question named only the folder and the commit file. `MC-290` records the other two names as following the pick by analogy.
- Nodelist's own verdict was "needed: NO (conditional on host)", leaning yes for a boot listing; the U3 outcome ruling is the orchestrator's, and `MC-290` quotes both.
- Plan v3.4 is stored with CRLF line endings (592 of 593 lines) while the other Tools files are LF; it was copied byte for byte.
- The plan's own line citations (`W:` worktree and `M:` main at `cd426f6ac`) were not reopened by this records pass.
