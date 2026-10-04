# Report 57 — Save layer Stage 1: the stable-keyed block store (the accepted plan; MC-194 11, MC-195)

**STATUS:** the plan is accepted. Gate 1 (`opus-reviewer`) closed at round 5 with `[EDITORIAL]`, on 2026-10-05, after
rounds 1 to 4 returned `[REJECT]` and a `senior-advisor` escalation after round 3 (ledger rows 1079 to 1086).
**Nothing is implemented.** No Gate 2 has run. The stages are 1a, 1b and 1c (section 10). This report is a dated
snapshot, written at HEAD `71100280` with a clean tree. It restates the accepted plan as the current design;
section 14 says how the plan was reached. It cites source by name, as the plan does.

Every performance figure in it comes from one i9-13900KF-class machine (best-case hardware, `MC-003`, `MC-010`),
mostly in headless browsers on synthetic data (`MC-131`); the Android figures are an x86_64 emulator on the same host.
No phone or Pi figure exists. The Tauri figure is a Node `fs` stand-in, not a Tauri build.

**Sources** (the session scratchpad `stage1/`; not durable, so this report and ledger rows 1073 to 1086 are the
durable record): `plan-r5.md` (the accepted plan, revision 5; revision 1 is `plan.md`), `gate1/round1.md` to
`round5.md`, `boot-read-packet.md`, `write-side-packet.md` (cited as W-), `read-side-packet.md` (cited as R-),
`idbcas/packet.md`, `fp/packet.md`, `advisor-save-layer.md` (the original direction, `MC-194` 11),
`Agents/Carry-Forward.md` ("After Stage A and Stage 0"), `Agents/Maintainer-Context.md` (`MC-194`, `MC-195`).

## 1. What Stage 1 is, in one paragraph

Today the live save is one file (`database/database.bin`), rewritten in full by every committing save. Stage 1 makes
the live save a set of keys in the existing byte store (`ByteStore`, the one storage interface, `MC-167`): a root
that lists the other blocks, one key per fixed block, one key per loaded character, and one value that packs every
archived character's stub. A chat message then writes one character key plus the root, not the whole file. The old
main file is read once to convert an existing profile, then renamed and never written again. Numbered backups stay
whole-file snapshots. One module (the commit owner) is the only writer of the new keys. A whole-state replace (a
restore, an import, a conversion, a seed) builds a new generation and switches to it with a compare-and-swap of a
small head pointer.

## 2. Binding decisions

| Source | Decision |
|---|---|
| `MC-194` 11 | The advisor's shape: stable-keyed block store, root last, one commit owner, `risuSaveCache` retired, per-key `ifVersion` on Node, a size guard per write. Stage 2 is per-module blocks. No SQLite. Remote Saving is not made the default. A partial commit across two Node devices is "Acceptable". Forcing a Tauri directory write to disk: "Yes, in Stage 1". |
| `MC-194` 10 | Tauri and Node first; the web shares the layout (the advisor's Q2). |
| `MC-194` 12 | A startup with nothing to save still guarantees a numbered backup holds the latest data (qualified for Node profiles over the body limit by `MC-195` 5). The fingerprint record never enters a `.bin`. |
| `MC-175`, `MC-011`, `MC-167`, `MC-143`, `MC-159` | The `.bin` round trip works in both directions; upstream profiles must load; one storage interface; plain-HTTP self-hosting (no `crypto.subtle`); the documented two-device Node outcome ("A's next save is refused"). |
| `MC-195` 1 | Archived characters are packed into one `stubs` value; loaded characters get one key each. The maintainer's answer ("start stage 1 plan now") does not name the packing; that it follows from the measurement is the Orchestrator's reading. |
| `MC-195` 3 | A damaged piece at startup: "Backup or stop". Load the newest backup, with the damaged save kept on disk and never deleted; or stop and change nothing. There is no "continue without". |
| `MC-195` 4 | The main file is not written after conversion. After conversion it is renamed ("Rename it"), for example to `database/database.pre-blocks.bin`, so upstream on the same folder sees no save rather than a stale one; the bytes stay on disk. |
| `MC-195` 5 | A Node snapshot over the body limit: "Skip with a notice". Saving continues; the user is told numbered backups are off because the save is too large for the server, and advised to export a `.bin`. Splitting backups is later work. |
| `MC-195` 2, 7 | CHORE-121 was fixed alongside Stage 1 and is done (`71100280`): store requests carry `cache: 'no-store'`, and the storage routes have a 20000-per-minute limit. |
| `MC-195` 6 | A kept damaged save may be deleted from manual clean-up: "Yes, with date + confirm". Leftover partial copies: "Manual only + notice" (never deleted at startup; a startup notice when they exist). The plain-HTTP static IndexedDB page: "Support if it can be safe"; measured safe (section 14.4). |

## 3. Scope

**In:** the block-store layout as the live save on Tauri, Node and IndexedDB; the loader; one commit owner; the save
loop on it; every whole-state writer through it; the archive pass through it; the readers that assumed a live main
file, re-pointed; durable writes on Tauri; `risuSaveCache` writes retired and the cache dropped; new `remotes/` writes
retired and the Remote Saving toggle removed from the UI; the damaged-piece prompt; renaming the converted main file.

**Out:** Stage 2 (per-module blocks); automatic reclaim of unlisted keys inside a live generation; SQLite; the Hono
server (it has no storage routes, R-F15); the OPFS transitional page (section 6.10); unifying cold units with
character blocks; split snapshots; Android (the crate has no mobile entry point, W-Q5).

## 4. Facts the design turns on

Verified or traced in the packets; the packets carry the citations.

1. **Seven whole-state write sites**, not six (W-Q1, R-1.4): bootstrap seeds (Tauri, web/Node), the save loop, the
   internal-backup load, the `.bin` restore, the archive-pass commit, the archive-pass Tauri write-back. All go through
   `appStore.writeMainFile` and its `mainFileOutcome` bracket. `opfsCopyBack` writes IndexedDB directly before boot
   reads.
2. **Restores write only `database/database.bin`** (W-1.5, R-F12). A loader that prefers a block set whenever its root
   key exists would ignore a restore. Key existence alone is not a safe switch.
3. **Only Node is versioned** (`conditionalWrites: true` in `nodeHttpStore.ts` only; verified by the Orchestrator). A
   Node `delete` bumps and keeps a revision and returns none (a tombstone).
4. **`RisuSaveEncoder.set()` re-encodes the root on every call** (a full stringify of all non-block fields) and holds
   framed bytes per block in `this.blocks`. `committedLayout`, `snapshotLayout`, `layoutEqualsCommitted` and
   `markLayoutCommitted` already diff block references (W-Q2). Block puts to `risuSaveCache` happen inside `set()`,
   outside `dbWriteLock` (W-Q3).
5. **A stub is an ordinary type-2 block named by chaId** (R-F7, W-Q2). "Archived" means `cha.coldstorage` is truthy.
   Only the boot pass turns a loaded character into a stub; restore, open and restore-all turn a stub into a loaded
   character (R-F8).
6. **chaIds are not store-safe keys.** `§playground` and `§temp` are real chaIds; they can be up to 255 bytes; fixed
   block names share a namespace with chaIds; Node keys are limited to 117 UTF-8 bytes; Tauri forbids `<>:"|?*`, a
   trailing dot or space, and folds case on Windows and macOS (R-F10, W-1.1).
7. **An omitted character is not benign.** `checkCharOrder` (verified by the Orchestrator) deletes every
   `characterOrder` entry and folder member whose chaId is not loaded; the first save rebuilds the directory from
   memory. An omitted preset block resets `botPresets` and `botPresetsId` (R-F6).
8. **Boot today:** strict decode, else non-strict decode installed without the archive pass and without trying backups;
   backups are tried only if both decodes throw (R-F2). A header-CRC failure in one block aborts the whole decode
   (`CriticalBlockError`, R-F5). `risuSaveCache` heals a payload-CRC-failed block only in default (non-strict) mode
   (R-F4).
9. **The `.bin` export is the legacy msgpack format built from memory** and reads no storage except `assets/` and
   cold-unit payloads (R-F11). Anything placed in `DBState.db` would be exported.
10. **Readers that assume a live main file:** `manualCleanup.keepFromMainFile` (requires main to equal this tab's
    record; its keep set decides which assets and cold units are deleted), `internalBackup.keepCurrentMainFile` (the
    undo copy), `matchesMainFileRecord` and `noteMainFileBytes`, the archive pass's `checkCommittedBlocks`,
    `opfsCopyBack` (R-F13).
11. **Key-space sweeps** (11 `list(` sites, 4 prefixes) do not reach a `blocks/` prefix. Tauri's temp sweep covers only
    `database`, `remotes`, `coldstorage` and `assets`, non-recursively. Node `/api/list` returns every key (R-F9,
    W-Q4).
12. **plugin-fs 2.5.2 has no fsync.** A custom Rust command needs a `generate_handler!` entry and, while no app
    manifest exists, no capability entry (source-traced in tauri 2.11.5, not run; W-Q5). The Gate 1 reviewer confirmed
    the ACL condition in tauri 2.11.5 (`src/webview/mod.rs`), the version in the local `src-tauri/Cargo.lock` (the lock
    file is gitignored, so each build resolves its own versions).
13. **Boot read cost:** packed stubs cost about the same as today's main-file read on every platform measured;
    one key per stub fails on Node and marginally on the emulator (section 14.4). Chrome serialised same-URL reads.
    CHORE-121 (`71100280`) sets `cache: 'no-store'` on every store request, which lifted the serialisation in the
    Chrome 154 measurement; that measurement used a harness equivalent, and it has not been re-run against the
    committed code.
14. **`appStore.writeMainFile` keeps the old `mainFileVersion` when a write throws;** only `readMainFile` moves it. A
    retry after an unknown outcome presents the old revision and gets a 409.
15. **`dbWriteLock` is an in-tab `AsyncMutex`** (not reentrant). Cross-tab exclusion exists only as the storage tab
    locks (`storageTabLocks.ts`: shared per tab, exclusive for restores and migration) over `navigator.locks`, which
    needs a secure context.
16. **`cleanChunks` in `bootstrap.ts` sweeps assets whenever no installed character has `coldstorage`.**
17. **The decoder already drops root keys that start with `__`.**

## 5. Layout

### 5.1 Keys

| Key | Value |
|---|---|
| `blocks/head` | The head pointer (JSON): `current` (the live generation) and, write-once when the head is created by a conversion, `convertedFrom` (the fingerprint of the main file that conversion read; section 6.11). Nothing else. |
| `blocks/<gen>/kept` | A marker, written before the flip by a replace chosen at the damage prompt, inside the damaged generation: that generation is kept. Immutable. |
| `blocks/<gen>/root` | The framed ROOT block, with `__directory`, `__packed` and `__seq`. The commit point of a save. |
| `blocks/<gen>/f/<name>` | `preset`, `modules`, `loadouts`, `plugins`, `pluginStorage`, `config`. |
| `blocks/<gen>/c/<k(chaId)>` | One framed type-2 block per loaded character. |
| `blocks/<gen>/stubs` | The stubs pack: the framed type-2 blocks of every archived character, concatenated (no file magic). |

All Stage 1 keys live under `blocks/`, a prefix no existing sweep, listing or backup enumeration touches (fact 11).
A generation id is fresh and time-ordered, so clean-up can show age.

`k(chaId)` is injective, valid on every adapter including case-folding file systems, within Node's 117-byte budget,
and computable without `crypto.subtle`. Non-normative mechanism: lowercase hex of the UTF-8 when it fits, else a
prefixed SHA-256 hex via the installed `@aws-crypto/sha256-js`. The block's header carries the real chaId, and the
loader checks it. A duplicate chaId (the encoder's frozen keys) always keeps its own key and is never packed.

### 5.2 Root bookkeeping

`__directory` stays as written today: the ordered list of block names, which is the character order after reload
(R-F8, W-Q2). Two fork-only fields are added: `__packed` (the names whose block lives in the stubs pack; a listed
character not in `__packed` lives at its own key) and `__seq` (an integer the commit owner increments on every root it
writes). All three start with `__`, so the decoder drops them (fact 17) and none can reach a `.bin` export. The test
for invariant X is a guard, and is labelled as one.

### 5.3 The head, generations and a whole-state replace

- A **save** commits inside `current`; its commit point is that generation's root.
- A **whole-state replace** (seed, conversion, `.bin` import, internal-backup load, a backup chosen at the damage
  prompt) is the **only writer of the head**:
  1. Read the head (or its absence) and remember exactly what was read.
  2. Pre-flight: encode every value. On Node every value must fit the body limit, or the replace refuses before
     writing anything. (A `.bin` or backup whose modules block exceeds 100 MiB cannot be restored onto Node until
     Stage 2; the refusal says so.)
  3. Write every value of a new generation, root last. If the replace comes from the damage prompt, first write
     `blocks/<damagedgen>/kept`.
  4. Re-read the new generation's root and check that it decodes and matches what was written. This catches a
     generation removed or damaged since step 3, for example by a clean-up on another device.
  5. **Flip, the commit point:** compare-and-swap the head from exactly what step 1 read to `{current: <newgen>}`
     (plus `convertedFrom` when the replace is a conversion). The swap has three outcomes.
     - **Won:** the swap resolved.
     - **Lost:** a definite mismatch: a Node 409, the IndexedDB transaction's compare failing (it aborts), or the Tauri
       adapter's compare failing. Someone else replaced first; this replace has not happened. It reports failure (a
       restore says the restore did not happen, never the success-path reload) and stops as the other-tab path does
       (reload if clean, prompt if dirty). Before deleting its own new generation (best-effort) it re-reads the head
       and deletes only if the head names a third generation, neither its new one nor the one step 1 read; otherwise
       it leaves the generation as garbage (a replayed request whose first copy landed can answer 409 to the
       replace's own write).
     - **Unknown:** any other throw (a lost response, a proxy 502 or 504, a transaction aborted for a reason other
       than its own compare, a Tauri command error). Re-read the head, with the boot read retries. If it names the
       new generation, the outcome is Won. If it names a third generation, it is Lost: the replace did not happen,
       nothing is deleted (the swap might still have landed and been overwritten), and the new generation is left
       as garbage for manual clean-up. If it still names what step 1 read, the outcome is not established (on Node a
       write can land after a proxy's 504): report "could not be confirmed; reload to see which save loaded", delete
       nothing, keep the write lock closed and require a reload. If the head cannot be read, delete nothing, tell the
       user the result could not be confirmed, keep the write lock closed (as a restore does after its write) and
       require a reload, which settles it by reading the head.
  6. After a Won swap, delete the previous generation by listing its prefix, root first (so a half-deleted generation
     never looks whole), unless it carries a `kept` marker. No head write follows.
- **The compare-and-swap, per adapter (invariant H).** It is a new optional `ByteStore` capability for the head key
  only, implemented inside each adapter and never required of callers other than the owner (`MC-167`:
  `conditionalWrites` set the precedent).
  - **Node:** `ifVersion` on the head's revision (an absent head is revision 0 or its tombstone revision; the head
    is never deleted).
  - **IndexedDB:** one `readwrite` transaction on the shared store that reads the head, compares and puts, with
    nothing but IndexedDB requests awaited inside it, over the raw connection the store already opens
    (`openExistingDatabase`). MEASURED cross-tab atomic on a non-secure origin with no Web Locks in Chrome 154, Edge
    154 and Firefox 157, with 2 and 4 tabs: no lost update, and exactly one winner in 500 of 500 flip races
    (section 14.4). **Not measured: Safari (WebKit) and Android Chrome or WebView.** That is a stated residual until
    measured. The raw connection reopens after a `versionchange` close or an `InvalidStateError` (as
    `openExistingDatabase`'s close handler already allows), and the swap stores the head in the same value form the
    adapter's `write` stores and `read` returns.
  - **Tauri:** an in-process mutex in the adapter, since `tauri-plugin-single-instance` allows one process. The head
    goes through the durable command (section 6.7), and that command resolves, logging the error, when only the
    post-rename directory flush fails, because the rename has happened.
  - **No other code path, including LocalForage `setItem`, ever writes `blocks/head`.** The measurement shows a plain
    put breaks the swap.
- **`load()` and boot housekeeping write no `blocks/` key.** (The archive pass, a conversion and a damage-path replace
  do write under `blocks/` during boot; they are commits or replaces, not housekeeping.) `load()` reads the head and
  the current generation and reclaims nothing. Generations that are neither `current` nor marked kept (an interrupted
  build, an interrupted deletion, a losing replace) are garbage, left for manual clean-up. A boot that finds such
  generations shows a notice once per page load ("unused save data found; run clean-up"), with their total size where
  the adapter can tell it cheaply.
- **Seeding an empty profile** is a replace whose swap is against "absent". It runs only when there is no head, no
  main file, no `pre-blocks` file and no numbered backup. `blocks/` keys without a head do not count: with no head
  every one of them is unreferenced garbage (an interrupted first seed or conversion), so the seed proceeds and the
  leftover notice reports them. Anything else found is a boot error naming what was found, offering "load the newest
  backup" when a numbered backup exists. Nothing is seeded over data.

### 5.4 Which state is live

- Head readable: the block store is live (a head always names `current`).
- No head: the legacy path, byte-for-byte as today (strict, then non-strict decode; the backup loop; `risuSaveCache`
  healing; `remotes/` resolution). The first commit after such a boot is the **conversion**, a whole-state replace
  (section 6.4 says which code path performs it). A conversion is never a `commitSave`.
- After a conversion commits, the main file is renamed (section 6.11).

## 6. Behaviour

### 6.1 The commit owner

One module holds, per key of the current generation, the acknowledged bytes and, on Node, the revision, plus the
acknowledged root's `__seq`. It offers `load()`, `commitSave()`, `replaceWholeState()`, and read access to the
committed state. Nothing else writes `blocks/` keys or the main file (invariant 1).

### 6.2 The save protocol

**Lock order.** The commit owner never acquires `dbWriteLock` or the storage tab locks itself; its callers hold what
they need. The save loop holds `dbWriteLock` and then takes the **commit lock**: a new Web Lock name, exclusive,
separate from the storage tab locks (the tab locks' exclusive mode needs every other tab gone, so no multi-tab commit
could be granted). The archive pass and the two restores already hold the exclusive storage hold (which itself holds
`dbWriteLock` and excludes every other tab), so they do not take the commit lock. The order is always `dbWriteLock`,
then the commit lock; nothing takes `dbWriteLock` while holding the commit lock. The commit-lock wait is bounded
(non-normative: 30 s); a timeout leaves the iteration uncommitted and it is retried. A timeout while a live holder
exists (`navigator.locks.query()`, as `idleReloadHost.ts` already uses) is a wait, not a write failure: it does not
count toward the consecutive-failure alert. The commit lock protects only the save loop's `__seq` check and
post-commit deletes; it does not protect the head, which needs no lock (section 5.3).

1. **Who else committed? (off Node)** Inside the commit lock, read the current root's `__seq` and compare it with
   this tab's acknowledged value. If another writer committed, take the other-tab path (stop saving; the existing
   reload-or-stay prompt). On Node this read is skipped: the conditional root write detects a peer commit and parks
   with `node-conflict`. Without `navigator.locks` (a plain-HTTP IndexedDB page) the check is not atomic with the
   writes; such a page therefore makes **no post-commit deletes or pack trims** (they wait for a page with Web Locks,
   or are left as garbage), so a racing peer root can never list a value this page removed.
2. **Pre-commit writes:** every loaded character and fixed block whose bytes differ from the acknowledged record; the
   stubs pack whenever any packed member's bytes changed or a name is being added to `__packed` (written as the union
   of the old and new packed sets). Trashing an archived character, upstream stub enrichment and group stubs all
   change a member's bytes.
3. **Commit:** if step 2 wrote anything, or the root's content changed, write the root with `__seq` incremented. The
   root is never skipped as equal when any block was written: a root write is how every peer learns of a commit. An
   iteration with nothing to write writes nothing (today's skip).
4. **After the commit:** the pack trimmed to the new packed set; deletion of own keys that left the directory or moved
   into `__packed`. On Node these are conditional on the recorded revision, and a 409 is ignored (the key is garbage
   by invariant 2). On IndexedDB and Tauri they run inside the commit lock, so no peer root can be in flight.
5. **Acknowledgement and outcomes:** a value is recorded as acknowledged only after its write resolved, with its new
   revision. A write that throws clears the acknowledged bytes of that key (so the next iteration rewrites it) and
   keeps the old recorded revision. The retry presents the old revision; if the earlier write landed, it gets a 409
   and parks, which is today's residual for the main file, now per key. Nothing re-reads a revision in order to
   overwrite.
6. **Garbage keys:** a key the acknowledged root does not list as this name's own key (an orphan left by an
   interrupted archive, restore or delete, or a re-created `§playground`) has no recorded revision. Before writing it,
   read it and write conditionally on the revision read. Only keys the owner believes listed take the "409 =
   conflict" rule.

**Node conflicts.** Every Node write is conditional. A 409 on a pre-commit write or on the root parks the loop as
`node-conflict`. Because every commit writes the root, a stale device's root write always 409s after a peer commit,
which keeps `MC-159`'s documented outcome. Its pre-commit writes may have landed in keys the peer's root does not
reference, or overwritten an own key the peer's root does reference (the accepted partial commit, `MC-194` 11).

**Save mine.** Node has no Save mine today and gets none. Off Node, after the other-tab prompt, "Save mine" takes the
peer's current `__seq` as its base (so step 1 does not find the same peer commit again), rewrites every key its root
lists, then the root, so its root never lists a value it did not write. The force clears only on that confirmed
commit, as today.

**Committed** means the iteration's pre-commit writes and its root resolved, or the iteration wrote nothing. Everything
the loop derives from "committed" keys off that: `markLayoutCommitted` and the acknowledged record,
`lastIterationCommitted`, `primaryCommitted`, `isSaveClean`, the idle gate, `afterNextSaveCommit`,
`fireNextCommitCallbacks`, the counter resets, `forceMainWrite`'s reset. The same-browser broadcast fires after any
committed iteration that wrote a root (today it fires only after a main-file write).

**Head check.** After a committed root write, the owner reads `blocks/head`. If `current` is no longer its generation,
a whole-state replace happened elsewhere: the tab stops saving and takes the other-tab path. Its last commit went into
a retired generation and is lost with it, as a stale device's save is refused today. (The check is after the write,
not before, because a read before the commit leaves a gap in which another tab flips the head.)

**Size guard.** Every Node write is checked against the body limit (100 MiB, `NODE_BODY_LIMIT_BYTES`) before sending;
a pre-commit value that does not fit parks as `too-large`, naming the block (in practice the modules block: profiles
with asset modules reach 1 to 2 GB; Stage 2 splits it).

**Allocation.** A save allocates O(changed blocks plus root). The root is still re-stringified per call (fact 4).

### 6.3 Loading and the damaged-piece prompt

`load()` reads the head (and writes nothing), the root, every fixed block, the pack if `__packed` is non-empty, and
every loaded character's own key, with bounded concurrency (non-normative: 8). Each value is validated individually
(framing, CRCs, header name equals the directory name); a pack is validated block by block. A failure is confined to
that entity (unlike today's `CriticalBlockError`).

- **Read errors:** on the block-store path, a read that fails (I/O error, network failure, 429, 5xx) is retried a few
  times with a short delay (Tauri os error 32, a busy file, is the expected transient), then stops the boot with an
  error on every platform. Nothing is installed, written, or taken from a backup. The legacy path keeps today's
  behaviour.
- **Racing writer:** before reporting damage, re-read the head and the root; if the generation or the root's `__seq`
  changed, start `load()` again (at most three times, then report what is damaged).
- **Damage:** a listed value that is absent, empty, fails framing or CRC, or names another entity; or an unreadable
  root. Startup stops before installing anything and names the damaged items (from the decoded root and stubs where
  readable; the language setting from the root, where readable, for the wording). Two choices:
  - **Load the newest backup**, showing its date: the numbered-backup loop (newest that decodes), then a whole-state
    replace that first writes the `kept` marker into the damaged generation (section 5.3 step 3), so the flip leaves
    it on disk. The prompt discloses that image clean-up stays off until the damaged save is deleted (section 6.8).
  - **Stop**: change nothing; the app does not open the save (the same screen as a boot read error, with the damaged
    names). The next start asks again.
- The legacy path (no head) keeps today's handling unchanged.
- New English prompt strings go to `sonnet-coder` with their call site; translations go to `translator`.

**Seeding the acknowledged record.** `load()` records every value it read as acknowledged, with its revision and the
root's `__seq`, and seeds the encoder's committed layout from the same bytes. A boot followed by a save with no change
writes nothing.

**Archive pass gate.** A block-store load with no damage is the "clean load" that lets the pass run, with today's
other gates (format version, V2.1 plugins).

### 6.4 Whole-state writers

| Site today | After Stage 1 |
|---|---|
| bootstrap seeds (empty profile, no head, no main file) | `replaceWholeState` of the empty tree. |
| Legacy boot (no head) with the archive pass running | The pass's commit is the conversion: `replaceWholeState` of the post-pass tree. |
| Legacy boot without the pass (its gates fail) | The first committing save is the conversion: `replaceWholeState` of the encoder's full block set. |
| Save loop on a block-store boot | `commitSave`. |
| Archive pass on a block-store boot | `commitSave` (section 6.6). |
| `.bin` restore, internal-backup load | Today's order up to the write; then `replaceWholeState`; the lock stays closed; reload. |
| Archive-pass Tauri write-back of pre-pass bytes | Removed. A pass that fails before its commit leaves the previous root or the legacy main file authoritative. Tests show each failure path leaves a loadable state. |

The `.bin` restore (`backuplocal.ts`) keeps its order (encryption-marker refusal, exclusive hold, stream entries,
non-strict decode, missing-unit check, `repairDatabaseIds`, busy guard). The internal-backup load
(`internalBackup.ts`) makes the undo copy first, then strict decode or salvage-and-confirm as today.

A conversion or seed is a replace whose swap is against "no head". Two tabs or devices converting at once each build a
generation; exactly one swap succeeds (Node `ifVersion`; the IndexedDB transaction, measured cross-tab atomic without
Web Locks; Tauri's single process). A definite loser reports that it did not convert and deletes its own generation
only under section 5.3 step 5's rule; an unknown outcome follows step 5 and deletes nothing. Then a clean tab
reloads, and a dirty tab takes the other-tab prompt rather than reloading silently. The conversion takes no lock
beyond what its caller already holds (the pass: the exclusive storage hold; the save loop: `dbWriteLock`), so it
cannot deadlock on `dbWriteLock` or wait for other tabs to close. This holds on a page without Web Locks too.

### 6.5 Snapshots and the backup record

- Numbered backups stay on today's 5-minute cadence, from the encoder's acknowledged blocks (`encode()`, today's
  self-contained format, stubs as ordinary type-2 blocks), inside `dbWriteLock`, on the write and skip paths alike. A
  snapshot never holds a pointer to a block key.
- On Node, a snapshot over the body limit is not written; saving continues; a notice says numbered backups are off
  because the save is too large for the server and advises a `.bin` export (once per page).
- The fingerprint record keeps its rules over snapshot bytes. At the page's first committing iteration, if no backup
  was written this page, compare the fingerprint of the snapshot the encoder would write with the record; on mismatch
  or no record, write a backup (subject to the size rule above). This costs one F-sized `encode()` and fingerprint per
  page load, as today's first-iteration compare does.
- `mainFileOutcome` and `mainFileRecord` stop being about the main file. The implementation decides whether they are
  renamed or folded into the owner; the nine `globalApi.*` test mocks follow.

### 6.6 The boot archive pass

The pass archives eligible characters as today (cold units first), then commits as a save: the union stubs pack, the
root with the new `__packed`, then deletion of the archived characters' own keys. Its refusal rules (a chaId equal to
a fixed name, `__proto__`, duplicates, over 255 bytes, a UTF-8 round trip) stay. Upstream stubs are enriched as today.
The pass's exclusive hold covers its writes. Two points differ from a plain save:

- On a legacy boot the pass's commit is the conversion (section 6.4).
- `checkCommittedBlocks` keeps checking the encoded values before the first write (as it checks the encoded bytes
  before `deps.writeMainFile` today), so a bad pass result is refused before anything is written. A read-back after
  the commit is optional and is not the guard.

### 6.7 Durable writes on Tauri

A Rust command writes durably: a temp file in the target directory (named to match `ATOMIC_TEMP_NAME_PATTERN`), write,
flush the file (`sync_all`, which is `FlushFileBuffers` on Windows), rename (keeping the Windows retry on os errors 5
and 32), then flush the directory where the platform allows it (Unix: `sync_all` on the directory). On Windows the
rename's directory entry is flushed best-effort (`MOVEFILE_WRITE_THROUGH` does not apply to same-volume renames). The
command resolves keys under the app data directory and repeats the JS key rules and traversal checks; the key travels
in a header and the bytes as a raw IPC body (a JSON argument would serialise multi-MB blocks as number arrays).

It is used for `blocks/` keys, numbered backups and `coldstorage/` units (the pass writes units before its root lists
the stubs that point at them). Assets keep plugin-fs. The boot temp sweep covers `blocks/` recursively.

**Invariant D:** on Tauri desktop, when a root or head write resolves, every value it lists and the record itself have
been flushed to the file system. The directory entry of a rename is flushed when that flush succeeds (Unix); a failed
directory flush is logged and the write still resolves, because the rename has happened; on Windows it is best-effort.
Power loss is a stated residual.

### 6.8 Readers that assumed a live main file

- **Manual clean-up's keep set** comes from the committed state via `load()`. "Main equals this tab's record" becomes
  "the committed root's `__seq` and the acknowledged keys equal this tab's record"; a mismatch stops the clean-up. The
  keep set covers every asset and cold unit the committed set references. This is the highest-severity reader: a
  keep set that misses what the block set references would delete live assets.
- **Leftover generations** (neither `current` nor marked kept) are deleted by manual clean-up, which already runs under
  the exclusive storage hold where Web Locks exist, and lock-less behind a confirm where they do not, with the
  accepted two-device caveat (`MC-138`). A device building a replace while another device (or, on a page without Web
  Locks, another tab) runs clean-up can lose its unflipped generation. The replace's root re-read before the swap
  catches most of it; if clean-up deletes the generation after that check and the swap wins, the replace's step 6 also
  deletes the previous generation, so both are gone and the next boot shows the damage prompt. Everything stays
  recoverable from the replace's source (the `.bin` or numbered backup it restored) and from the numbered backups.
  This is a stated residual of the same class as `MC-138`; clean-up never runs automatically. Clean-up deletes a
  leftover generation's root first.
- **The internal-backup undo copy:** a numbered backup of the committed state before the restore proceeds. If it
  cannot be written (Node over the limit), the restore asks the user to confirm proceeding with no undo copy.
- **`opfsCopyBack.classify`** treats a present `blocks/head` as "IndexedDB is current".
- **Kept generations.** While any `blocks/<gen>/kept` marker exists, the startup asset sweep (`cleanChunks`) does not
  run. A kept generation is damaged by definition, so manual clean-up cannot build its full keep set; instead it
  offers, naming the kept save's date: keep it (clean-up does not run; the message says why), or delete the damaged
  save from that date and clean up (after a confirmation: delete the kept generation root first, then its marker last,
  then run the clean-up). The damage prompt's "load the newest backup" wording discloses this: image clean-up stays
  off until the damaged save is deleted.
- **`cleanUpCopiedBackOpfs`** (deleting old OPFS files at a later start that loaded normally from IndexedDB): on the
  block-store path "loaded normally" means a block-store load with no damage.

### 6.9 Retirements

- **`risuSaveCache`:** no writes. Read only on the legacy path. Dropped at any boot that loaded a block store (so a
  second browser on a Node profile drops its own copy too); the precedent for dropping a database is `dropInstance` in
  `bootstrap.ts`. The block-store loader never runs the decoder's default mode, which reads the cache.
- **New `remotes/` writes stop.** The REMOTE read path, the legacy sweep and existing files stay. The Remote Saving
  toggle and its language keys are removed from the UI; the `enableRemoteSaving` value stays in the data, untouched,
  for the `.bin` round trip.

### 6.10 The OPFS transitional page

A page that fell back to OPFS this time keeps today's main-file path for that session and never creates a head or
reads one. (Making that page read-only is noted as a later simplification.)

### 6.11 Renaming the converted main file

The conversion's head carries `convertedFrom`: the fingerprint of the exact main-file bytes it read, written once with
the head and never changed. Its source is a new pure function over the boot-read bytes, without `crypto.subtle`:

- for a block-format (`RISUSAVE` version 1) file, the length plus the sequence of stored header and payload CRCs from a
  header-only walk (like `listEncodedBlocks`; no pass over the file);
- for every other legacy format, the length plus one CRC32 pass over the file (measured 67 to 68 ms for 43 MiB on the
  i9 with Node 24; phones and the Pi are not measured).

It is not the `mainFileRecord` slice fingerprint (sampled on plain HTTP, superseded by later notes, asynchronous).

The rename finish runs at every block-store boot, needs no head write, is idempotent and is keyed on content:
1. No `database/database.bin`: done.
2. `database/database.pre-blocks.bin` exists and equals `database.bin` (length, then bytes or the same fingerprint):
   delete `database.bin`.
3. `database.bin` matches `convertedFrom`: copy it to `database/database.pre-blocks.bin` (or, if that key holds
   different bytes, to a numbered variant `database/database.pre-blocks-<n>.bin`; all outside `database/dbbackup-` and
   every sweep), then delete `database.bin`.
4. Otherwise (a file written after the conversion, for example by upstream on the same folder starting empty and
   saving): leave it alone and never read it for state.

On Node, a `database.bin` over the body limit cannot be copied through the store: it is left in place and the user is
told once per page load that upstream on the same folder would open an old save. A head created by a seed or by a
restore onto an empty store has no `convertedFrom` and never touches the main file.

## 7. Invariants and the test that would fail if each broke

| # | Invariant | Test |
|---|---|---|
| 1 | Only the commit owner writes `blocks/` keys or the main file (except the OPFS transitional page). | Behavioural: each site's flow ends in the owner (seams); a test that a block-store page never writes `database/database.bin` across save, pass, restore and import. |
| 2 | The root's directory is authoritative; a listed value that is missing, empty, bad or wrong-named is damage, never empty content. | Loader tests per damage kind; the prompt; nothing installed or written before the choice. |
| 3 | Generation tolerance; adds and deletes commit with the root; deletes and trims come after it; cross-block references tolerate an absent target; `botPresetsId` is clamped on load (required). | The crash-point harness; a root/preset skew test. |
| 4 | Acknowledged only after resolve; a throw clears the bytes and keeps the old revision; no revision is ever re-read to overwrite a key the owner believes listed. | Real Node fixture: A's write lands then throws; B writes; A retries and gets a 409 park, B's bytes intact. |
| 5 | Committed means the pre-commit writes and the root resolved, or nothing was written; a root is written whenever any block was. | Save-loop tests; a character-only save writes the root with `__seq` plus 1. |
| 6 | Snapshots are self-contained; the `.bin` export is from memory without bookkeeping; import goes through `replaceWholeState`. | Export after a block-store boot; import then reload wins over the old generation. |
| 7 | Per-save allocation is O(changed blocks plus root). | No `encode()` on an ordinary save. |
| 8 | Node: no create-only write to a key that may have been deleted; garbage keys are written on a freshly read revision. | Fixture: an orphan `c/X`, reload, restore X, and it saves; a `§playground` re-create. |
| 9 | Every Node write is size-checked; a snapshot over the limit is skipped with the notice; a replace pre-flight refuses before writing. | The `nodeSizeGuard*` tests re-expressed; a replace pre-flight test. |
| 10 | Equality skips have return-to-origin scenarios. | The block equal-skip; the root is not equal-skipped when blocks were written. |
| C | Every name a durable root lists resolves at every crash point, for one writer and for two interleaved writers (two tabs on IndexedDB with the commit lock; two Node devices). | The crash-point harness extended to two owners on one store with an interleaving scheduler. |
| G | No tab commits into a generation that is not current without stopping right after. | Two owners; one replaces; the other's next commit is followed by the stop; on Node its root 409s if the head flip came first. |
| K | `k` is injective and valid on every adapter. | A property test. |
| X | Bookkeeping never reaches `DBState.db` (a guard, labelled as one). | Decode a block-store root. |
| D | As section 6.7. | invoke-mock ordering tests; a Rust unit test of the command if `cargo test` can run against a scratch target directory. |
| L | Legacy profiles load byte-for-byte as today until the conversion. | The existing bootstrap tests, unchanged. |
| P | Damage prompt: nothing installed or written before the choice; "backup" keeps the damaged generation; "stop" writes nothing. | Loader and bootstrap tests. |
| S | Save mine: its root lists only values it wrote in that iteration or that the store already holds identically. | A two-tab test with a delete by the other tab, then Save mine, then reload: no damage. |
| R | A whole-state replace either commits completely (its swap succeeded) or leaves the previous state live; its partial generation is garbage left for manual clean-up. A losing replace reports failure, never success. | The crash-point harness on replace; a restore whose swap loses reports "did not happen". |
| H | The head is written only by a replace's flip, only by compare-and-swap against what that replace read, on every adapter; no other path (LocalForage `setItem` included) writes it. | Two converters racing: on the Node fixture; on IndexedDB with two connections (fake-indexeddb, plus the recorded real-browser measurement as the diagnostic); on Tauri with the in-process mutex. Exactly one wins. A census test that the head key is written through one function. |
| S2 | Seeding runs only when there is no head, no main file, no `pre-blocks` and no numbered backup; headless `blocks/` keys are garbage and do not block it. | Each non-empty case: a boot error naming what was found, offering a backup where one exists, nothing written. An interrupted first seed (keys, no head): the next start seeds and shows the leftover notice. |
| U | A head swap has three outcomes; only a definite mismatch is "lost", and nothing is deleted on an unknown outcome. | Node fixture: the head write lands, then the response is dropped; the replace re-reads, finds Won, keeps its generation, deletes the old one. A head read that also fails: nothing deleted, the write lock stays closed, reload loads the new state. A Tauri invoke mock that errors after the rename (the directory flush): resolves as Won. |
| W | Lock order: the owner acquires neither `dbWriteLock` nor the storage tab locks; a save-loop conversion never waits for other tabs. | Two tabs on the fake locks, a legacy profile, a conversion from the save loop while the second tab stays open: it commits; a page without Web Locks also commits. |
| Q | `load()` and boot housekeeping write no `blocks/` key and delete nothing under `blocks/` (the pass, a conversion and a damage-path replace are commits or replaces). | A boot with a leftover generation, a kept generation and a replace in flight on another owner: no store write or delete under `blocks/` during `load()`; the in-flight replace then commits and loads. |
| M | The main file is renamed only when it matches `convertedFrom` or equals `pre-blocks`; anything else is never touched. | After a completed rename, write a new `database/database.bin`; reboot: untouched. A crash after the copy and before the delete: the next boot deletes it. A `pre-blocks` holding different bytes is not overwritten. |
| V | No asset or cold unit referenced only by a `kept` generation is deleted, at startup or by manual clean-up, until the user deletes that kept save after the dated confirmation. | Damage, choose backup, reboot: the newer-only asset survives; clean-up offers keep or delete-with-date; only after delete does clean-up run. |

Tests follow the campaign's rules: a regression reproducer is written against the unfixed code and shown red first;
a compatibility guard is labelled as a guard in the present tense; no test is a source-text guard.

## 8. Acceptance scenarios

1. A chat message on a loaded character writes that character's key and the root; never the main file, never the
   pack, never `encode()`.
2. A boot followed by a save with no change writes nothing (except the once-per-page backup check, if due).
3. An upstream profile boots as today and converts on its first commit (the pass's, if it runs); the old main file is
   renamed.
4. `.bin` both directions (`MC-175`).
5. Restore from a numbered backup and from a `.bin` replaces the whole state at once; a crash anywhere leaves either.
6. Archive into the pack, restore to an own key, trash and untrash an archived character: all survive reload; a crash
   at any write leaves every character loadable.
7. Two Node devices: after B commits anything, A's next save parks with `node-conflict` (`MC-159` holds). After a
   restore on B, A stops after its next commit.
8. Two tabs in one browser on IndexedDB: a tab whose peer committed takes the other-tab path before writing; a delete
   in one tab never makes the other tab's next root list a missing value.
9. A damaged own key, pack, fixed block or root: the prompt names them; "backup" restores and keeps the damaged
   generation; "stop" writes nothing.
10. Node: a modules block over 100 MiB parks `too-large`; a snapshot over the limit is skipped with the notice; a
    replace over the limit is refused before writing.
11. Plain HTTP: everything works except the fingerprint record (as today) and cross-tab atomicity on IndexedDB.
12. A boot during another tab's commit does not report false damage.
13. An interrupted replace and an interrupted deletion leave garbage generations that the next boot neither reads nor
    deletes; it shows the leftover notice, and manual clean-up deletes them, never the current or a kept generation.

## 9. Compatibility and boot cost

### 9.1 Compatibility (`MC-175`, upstream artifacts)

- **Export:** unchanged code path (the legacy format built from memory). Invariant X keeps bookkeeping out. The
  `enableRemoteSaving` value is kept in the data.
- **Import:** decode unchanged; only the final write changes (a whole-state replace instead of the raw main file).
- **Upstream profiles:** the legacy path is untouched until the conversion commit; the conversion encodes from the
  decoded tree with today's encoder.
- **Numbered backups** keep today's self-contained block format.
- **Characters, modules, presets, plugins:** their serialised blocks are byte-identical; only the container changes.
- **Plugins:** no plugin API reads the main file or `risuSaveCache`. The Gate 1 reviewer's grep of non-test
  `src/ts/plugins` for `database.bin`, `risuSaveCache`, `readMainFile`, `MAIN_FILE` and `getAppStore` found nothing;
  plugin storage uses separate localforage instances.
- **Upstream pointed at a converted folder** sees no main file (the maintainer's choice) and would start empty there;
  the `.bin` export is the supported route back.
- **Not kept:** a downgrade to a pre-Stage-1 fork build reading the save folder (`MC-011`: no shipped build).
  Upstream reading the fork's save folder directly is not required (`MC-175`).

### 9.2 Boot cost disclosure

The measured figures (best-case hardware, section 14.4) are for a profile whose characters are mostly archived: about
ten reads. A profile with archiving off or blocked (an enabled V2.1 plugin) reads N plus 8 keys. With `cache: 'no-store'` (the
CHORE-121 change; the measurement used a harness equivalent, not the committed code), Node per-key reads overlap six
at a time (measured at about 0.2 ms per key on loopback and about 2 ms per key at a
simulated 10 ms round trip, on the i9 in Chrome 154), so 500 loaded characters cost about 0.1 s on loopback and about
1 s on such a LAN. Packing loaded characters is out of scope. Two more boot reads are disclosed:

- one listing of `blocks/` per boot, to find leftover and kept generations (on Node `/api/list` returns every key and
  the client filters, so it grows with the asset count);
- while a `database/database.bin` exists that is neither converted nor equal to `pre-blocks` (an upstream file, or a
  Node file over the limit), the rename check reads and fingerprints it at every boot (one CRC32 pass or header walk;
  about 70 ms for 43 MiB on the i9), and the Node over-limit notice repeats once per page load. Caching that verdict per
  device is a later refinement.

## 10. Implementation stages

- **1a. Durable Tauri write.** The Rust command, its registration, the adapter routing, the temp sweep, tests. Stands
  alone.
- **1b. The core, no callers.** The key mapping, the head pointer with its per-adapter compare-and-swap, generations
  and the kept marker, root bookkeeping, `load()` with validation and the race re-read, `commitSave` with the commit
  lock and seq check, `replaceWholeState` with pre-flight, the acknowledged record and the revision rules, and the
  two-writer crash-point harness.
- **1c. Everything wired, in one stage:** boot (both branches, the damage prompt, conversion, rename), the save loop,
  the pass, both restores and the undo copy, manual clean-up, `opfsCopyBack`'s classify, the retirements, the toggle
  removal. It is one stage because a build with the loader but the old restores would ignore restores. No
  intermediate build runs on a real profile.

Each stage gets its own Gate 2. The reviewer for every gate is `opus-reviewer` (persistence and save format). Per
`MC-195` 8, 1a and 1b run in parallel after the records batch.

## 11. Expected files and test churn

`src/ts/storage/risuSave.ts`; a new commit-owner module and its key-mapping helper under `src/ts/storage/`;
`src/ts/storage/store/appStore.ts`; `src/ts/storage/store/tauriFilesStore.ts`; `src/ts/storage/tauriAtomicWrite.ts`
(or a sibling); `src/ts/storage/mainFileOutcome.ts`; `src/ts/storage/mainFileRecord.ts`;
`src/ts/globalApi.svelte.ts`; `src/ts/bootstrap.ts`; `src/ts/storage/bootArchivePass.ts`;
`src/ts/storage/bootArchiveHost.ts`; `src/ts/storage/manualCleanup.ts`; `src/ts/drive/backuplocal.ts`;
`src/ts/drive/internalBackup.ts`; `src/ts/setting/advancedSettingsData.ts` (the toggle's UI; the data field stays);
`src/ts/storage/opfsCopyBack.ts`; `src/ts/storage/storageTabLocks.ts` (if the commit lock lives there);
`src/ts/process/coldstorage.svelte.ts` (durable unit writes routed by the adapter, if not adapter-internal);
`src-tauri/src/main.rs` (and a module); `src-tauri/Cargo.toml` only if a `windows-sys` feature is needed;
`src/lang/*.ts` (prompt strings and the removed setting's keys; see section 6.3 for who edits them); and tests. The
plan lists `src/ts/storage/database.svelte.ts` only for the setting's field, which stays. All are in the Main
Campaign's lanes; `server/**` is not touched by Stage 1.

Test churn (W-Q7, counted by the write-side investigation at `d9adf375`): the real encoder is imported by 66 test files;
16 `globalApi.*` save-loop test files, of which 9 mock `mainFileRecord`; 20 files `vi.mock(...mainFileRecord)`,
including 10 `bootstrap.*`; 12 files name `writeMainFile`; 3 assert on `risuSaveCache` by name; 20 `bootArchive*` files
share one harness that models the Node server on `database/database.bin`. The risk is tests adjusted to pass instead
of to state behaviour (section 12).

## 12. Risks and residuals

**Risks**
1. Manual clean-up deleting live assets if its keep set misses what the block set references (section 6.8). Highest
   severity.
2. Block writes outside the restore lock (fact 4). All `commitSave` writes happen inside `dbWriteLock`;
   `encoder.set()` must stop writing anything to storage.
3. The first iteration rewriting every key if the acknowledged record is not seeded from `load()`.
4. A stale tab after a whole-state replace (invariant G) and a stale device on Node.
5. Test churn is large; Gate 2 checks red against mutants for each invariant.
6. Boot read cost on Node rests on CHORE-121 for concurrent reads.
7. The root is re-stringified per save (fact 4); if it dominates on phones, a later stage addresses it.
8. The commit lock adds a cross-tab wait per commit (bounded by one commit); the head read after each commit is one
   small read; a converted Node profile's first boot over the limit keeps its main file in place.

**Stated residuals**
- The IndexedDB swap is unmeasured on Safari (WebKit) and on Android Chrome or WebView. A tab closed in the middle of
  a transaction was not tested.
- A page without Web Locks makes no post-commit deletes or pack trims, and its cross-tab check is not atomic.
- Two Node devices: a partial commit is accepted (`MC-194` 11); a stale device's root 409s.
- Manual clean-up on one device while another builds a replace can delete the unflipped generation (same class as
  `MC-138`; recoverable from the source and the backups).
- An unknown swap outcome that the re-read cannot settle needs a reload; nothing is deleted.
- Power loss on Tauri is not covered; a failed directory flush after a rename is logged and the write resolves.
- On Node, a snapshot over the body limit is skipped, so such a profile has no numbered backups; a `.bin` or backup
  whose modules block exceeds the limit cannot be restored onto Node until Stage 2.
- Boot reads for a profile that does not archive scale with the loaded count (section 9.2).
- All timings are best-case hardware; the fingerprint pass on phones and the Pi is unmeasured; the Android boot-read
  figures are an emulator.

## 13. Open items

- The cost of the root re-stringify per save on a large profile is not measured (Stage 1 does not depend on it).
- Whether `cargo test` can run against a scratch target directory for the Rust command; otherwise the command is
  verified by a manual Tauri run. The reviewer judged it probably runnable (`cargo` is installed and
  `src-tauri/target` exists) and did not run it, because it writes into the repository's `target/`.
- Not adopted in Stage 1: offering `pre-blocks` at the damage prompt (a new recovery path; `pre-blocks` stays on disk
  and a later change can add it); an aged reclaim of leftover generations (clocks differ; there is nothing to age);
  making the OPFS transitional page read-only; a per-device cache of the rename check's verdict.
- A re-issue of the same head swap after an unknown outcome that re-reads as unchanged (the reviewer's optional
  behaviour in round 5) was not adopted; the plan reports "could not be confirmed" and requires a reload.

## 14. How this plan was reached

### 14.1 Direction and decisions before the plan

`MC-194` 11 adopted the `senior-advisor`'s direction (ledger row 1053): the format is a block store with a directory,
and only the container is one file. The boot-read measurement (row 1073) decided how to store stubs (`MC-195` 1). Two
investigators mapped the code (rows 1074 and 1075), and CHORE-121 was split out and fixed alongside (rows 1076 to
1078). The orchestrator's first revision introduced generations and a head record, because with the main file no
longer written a restore cannot be made all-or-nothing in place; the Gate 1 reviewer judged that design necessary and,
once its gaps were fixed, sufficient.

### 14.2 The five Gate 1 rounds (`opus-reviewer`; rows 1079 to 1081, 1085, 1086)

| Round | Verdict | What it found |
|---|---|---|
| 1 | `[REJECT]` | 14 blocking findings (B1 to B14) and 10 editorial. Concurrency: a Node device's character writes could commit invisibly (B1), a leftover own key became a permanent Node conflict (B2), re-reading a revision before a retry could overwrite another device and the plan's claim about `f04068f1` was false (B3), a stale root from a second tab could list deleted keys (B4), and a boot racing a writer reported false damage (B5). The damage prompt: "continue without" could not keep the damaged piece usable (B6) and loading a backup retired the damaged generation (B7). Others: no commit path for the legacy first boot (B8), a false claim about `checkCommittedBlocks` (B9), packed-stub edits never persisted (B10), stage 1c unsafe alone (B11), read errors (B12), head races (B13), garbage from a failed replace (B14). The maintainer's "Backup or stop", "Rename it" and "Skip with a notice" followed. |
| 2 | `[REJECT]` | Round 1 resolved apart from B7 and B13. New: a conversion inside the exclusive hold deadlocks in the save loop (R2-1), reclaiming a `pending` generation can delete a live one (R2-2), finishing the rename could delete a main file upstream wrote later (R2-3), a kept generation's assets are swept (R2-4). The mechanism question (`AGENTS.md` section 4) was asked after this second rejection; the Orchestrator judged the findings local to the replace edges. |
| 3 | `[REJECT]` | R3-1 only: head read-modify-writes were not all serialised, and without Web Locks a boot could turn a conversion in progress into an empty profile. The reviewer named the mutable multi-field head as the one remaining structural weakness. Third consecutive `[REJECT]`: `senior-advisor` (`AGENTS.md` section 1.2). |
| 4 | `[REJECT]` | On the redesigned head: R4-1 (an unknown swap outcome was treated as lost, so the loser could delete the live generation) and R4-2 (the seed's emptiness test counted leftover keys, so an interrupted first seed could brick a fresh profile). The reviewer agreed the redesign removes the recurring class. |
| 5 | `[EDITORIAL]` | No blocking finding. Required wording corrections E-R5-1 to E-R5-3; optional N-R5-1, adopted. The old wording was confirmed gone from the design sections. |

Rounds 2 to 5 were the same reviewer, resumed. Reviewer claims B3, B6 and R2-1 were checked against source by the
Orchestrator before they were propagated.

### 14.3 The escalation and its root cause (row 1082)

After the third consecutive `[REJECT]`, `senior-advisor` found the root cause: the head conflated a pointer
(`current`) with a work queue (`pending`, `retiring`, `renameMain`) and a liveness list (`kept`), and was rewritten by
six actors, so the plan found one actor per round. The fix removed the actors instead of serialising them: the head is
a pointer, `{current, convertedFrom?}`, written only by a whole-state replace's flip and only by compare-and-swap;
boot writes no `blocks/` key; "kept" is a marker key inside the damaged generation; leftover generations are cleaned
up manually; the rename is keyed on a content fingerprint; seeding happens only on an empty store. The escalation
changed the conclusion: revision 3 kept the multi-field head, and round 3 had asked for one serialisation rule over
its writers; the advisor removed the writers instead. The advisor asked for two investigations (14.4).

### 14.4 The three measurements (all best-case hardware, `MC-003`, `MC-010`)

**Boot read, one key per entity against packed stubs (row 1073).** Data: a synthetic 43,357,028-byte post-pass profile
of 506 blocks (499 stubs of about 1.1 KB, a 33.6 MB modules block, a 7.6 MB plugins block), in the app's own
IndexedDB and Node HTTP store adapters and its own decoder. Decode takes 156 ms on desktop Chrome and 327 ms on the
emulator.

| Platform | One key per entity (total, ms) | Packed stubs (ms) | Verdict |
|---|---|---|---|
| Desktop Chrome, IndexedDB | 55 | 44 to 45 | One key passes; high confidence for this hardware |
| Android emulator (x86_64, Chrome 109), IndexedDB | 398 to 448 cold | 257 to 264 | One key fails marginally (against 327); low to moderate confidence, the margin is inside plausible hardware variance |
| Node, loopback, as the app was | 592 to 634 | 85 to 89 | One key fails (about 4 times the decode); high confidence |
| Node, simulated 2 ms and 10 ms round trips | 1.7 to 1.8 s and 5.7 to 5.9 s | 110 to 149 | One key fails |
| Tauri (a Node `fs` stand-in, not a Tauri build) | 39 to 44 | 11 to 17 | Not established: no Tauri build, no IPC cost |

Chrome serialised same-URL requests through its HTTP cache lock (CHORE-121). With `cache: 'no-store'` Node loopback fell
to 214 to 226 ms and 1.05 to 1.1 s at a simulated 10 ms round trip (the six connections per origin bound it). Caveats:
Chrome 154 desktop and an emulator only; latency was a request delay at a loopback proxy, not a network; Safari and
Firefox were not run; the data is the post-pass shape with stubs only.

**IndexedDB cross-tab compare-and-swap without Web Locks (row 1083).** On `http://192.168.219.187:6021`
(`isSecureContext` false, no `navigator.locks` in every tab), one read-write transaction doing get, compute and put
lost no updates in Chrome 154, Edge 154 and Firefox 157 with 2 and 4 tabs (2000 iterations per tab, three runs each).
The abort-on-mismatch flip had exactly one winner in 500 of 500 trials in every run, and wins were split between tabs,
so the races were contended. A plain `getItem` then `setItem` writer lost updates, which is why nothing else may write
the head. Caveats: one Windows i9, headless tabs; the cause (overlapping read-write transactions serialise across
connections) is inferred from the spec; the transaction must await only IndexedDB requests between get and put (noted,
not tested); Safari and Android Chrome 109 were not run; a tab closed mid-transaction was not tested.

**The conversion fingerprint (row 1084).** The decoder computes both CRCs per block and discards them. A header-only
walk of a `RISUSAVE` version 1 file gives the length plus the stored CRC pairs without a pass over the file; other
legacy formats need one CRC32 pass. On a 43 MiB buffer (i9, Node 24.19): CRC32 67 to 68 ms, the installed JS SHA-256
253 to 255 ms, native SHA-256 17 to 18 ms. Collision tolerance and the effect of a false match on upstream's behaviour
are inferred; whether upstream treats a missing `database.bin` as a first launch or reads backups was not traced
(UNCERTAIN). Phones and the Pi are unmeasured.

## 15. Where each piece was recorded

`MC-195` (the maintainer's choices and the Orchestrator's dispositions); ledger rows 1071 to 1088; the Roadmap's
save-layer track and CHORE-121 entry; `Agents/Carry-Forward.md` for the facts Stage 1 and Stage 2 inherit from
Stage A and Stage 0.
