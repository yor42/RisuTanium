# Carry-Forward

This file holds what finished stages leave for later ones: durable facts a later stage relies on,
and hand-offs a later owner must still act on. It is organised by the stage that needs each item,
not by the stage that found it. It is not a history: the chronology of a stage is in its Report's
STATUS block and its ledger rows.

- **Live-State links here.** `Agents/Live-State.md` says what is in flight; this file says what is
  waiting.
- **An item is here only while it is open or relied on.** When a stage closes an item, delete it.
  When a stage finishes, add what it leaves for others. Items that a later stage has already closed
  are not kept.
- **Authority.** Where this file and a Report, `Agents/Roadmap.md` or `Agents/Maintainer-Context.md`
  differ, they win. Sources are cited by name, not by line: the code moves.
- **Checked against** the source, the Roadmap, the Reports' STATUS blocks and `git log` at HEAD
  `7d4bc4b0` (2026-09-30).

## After W2c (the send's prompt)

- **W2c is done:** W2c-a `79c6e35e` (Report 40), W2c-b `9d493c79` (Report 42), W2c-c `d27a1ee4`
  (Report 43). The send's prompt reads its own chat; its index tags describe their message; nothing
  that builds it reads a hidden message.
- **W2c-c's `promptView`** (a parser option, never read from `cbsConditions`) marks every parse that
  builds the prompt; `splitSentMessages` in `src/ts/cbs.ts` is the one definition of "sent", shared
  with `makeMs`. A new prompt parse must carry the marker; the completeness test in
  `sendChatPromptReads.svelte.test.ts` catches a missing one only among parses made from
  `index.svelte.ts`, `exampleMessages`, `parseChatML` and `supaMemory`: its parser spy does not see
  parses inside `scripts.ts`, `lorebook.svelte.ts`, `triggers.ts` or `scriptings.ts` (probably
  the import cycle; not tested), which behaviour tests cover instead.
- **W2c-c leaves, the same as upstream (Report 43 section 8):** messages deleted during the prompt
  build shift where a walk-back tag starts by the number removed before it (hidden messages are
  never taken); a plugin or V3 call that swaps in new message objects mid-send makes the walk-back
  and history tags parsed after it read every message as sent, while the request is unaffected.
  Three stale-view mutants survive because identity-based hidden-ness makes a stale view correct
  for every shift; they matter only when a start trigger removes the reset while keeping the
  messages before it, or inserts one before the reset, and the optional tests that kill them
  (Gate 2 round 2, T5 and T6) were not added.
- **CHORE-45** (Roadmap): the script cache's 1,000-entry capacity. W2c-c decides only which
  prompt-pass results may be cached; the capacity is decided after the memory-footprint stage that
  follows W2e (`MC-119`).
- **The group member names in the prompt read `findCharacterbyIdwithCache`, and no later stage owns
  them.** The prompt's group member names, the preview heading and the `msg.saying` comparison read
  it: a per-send cache over `findCharacterbyId`. It returns a blank "Unknown Character" for a gone
  member, and can return a stale object after a cold restore replaces the member's slot mid-send
  (inferred from Report 35 and the cache's fill point; not traced). Report 35
  leaves this out of scope (its list of what it does not change). Not closed.
- **`GLGlobalVariables` subject branches.** `setGlobalChatVar` in
  `src/ts/parser/chatVar.svelte.ts` falls through to the database-wide global when the subject
  resolves to no chat, even if the origin chat had a local override. `MC-103` lists "a
  `GLGlobalVariables` write whose subject is gone is dropped" as an Orchestrator default that the
  maintainer did not object to. No caller passes a subject to `setGlobalChatVar` at HEAD (only
  `Toggles.svelte` calls it, with none), so that default is unimplemented but unreachable.

## After W2d (the request layer and its tools)

- **W2d is done:** W2d-a `4c34172c` (Report 44; CHORE-27 closed), W2d-b `efd417b9` (Report 45). A
  request with a subject runs its `request` trigger, names its prompt, gets its tools, routes its
  tool calls and parses its JSON schema from its own chat; graph memory, `risuaccess` with no `id`
  and `aiaccess` act on it. Callers with no subject keep the selection.
- **The subject never crosses the plugin bridge.** A client's `callTool` gets it as a third argument
  (`{subject}`); `CustomPluginMCPClient` forwards exactly `(toolName, args)`, and plugin providers
  never see it. A new internal MCP client that reads chat state must take the third argument.
- **The MCP registry** (`src/ts/process/mcp/mcp.ts`): one client per URL, created single-flight;
  swept only when unused by the selection and the current activity, not in flight, and idle for
  `MCP_IDLE_GUARD_MS` (5 minutes, `MC-125`). Every listing, metadata read and name lookup works on its
  own activity's URL list; nothing may walk the whole registry. `internal:risuai` is call-only by a
  per-URL list, not a second map.
- **Left open by W2d-b (Report 45 section 3), none scheduled:**
  - `risuaccess` writes with an explicit `id` hold the object chosen before the confirm prompt; a
    character replaced or removed during the prompt takes a detached write (packet L-9).
  - One unknown `internal:` URL, or a `stdio:` URL outside Tauri, rejects the whole request:
    `getTools()` sits outside `requestChatData`'s retry `try` (packet K1, K2; the same upstream).
  - A tool call over a custom transport whose send fails never settles and pins its client (packet
    H1); a real `stdio:` child was never run.
  - Claude's streaming path does no JSON extraction at all (`MC-124` fixed the non-streaming
    branches only).
  - `extractJSON` with a dotted path returns the parent object; `openAI/requests.ts` also hands it
    already-parsed objects at a few sites.
  - A request with no subject and a `{{char}}` schema still rejects when nothing is selected (the
    translator, IrisModal).
  - The Anthropic tool loop calls a name the request never listed (no `arg.tools` check), so
    `internal:risuai` is name-callable on Claude models; kept as is.
  - A plugin's re-registered MCP keeps its old client for the linger period.
  - A subject-bound tool call whose chat is gone still acts on external servers (`internal:fs`,
    http); `MC-075` 2 covers writes to the origin only. Not decided.
- **Live check method** (ledger row 426): a local OpenAI-compatible probe server (scratchpad
  `w2d/live-b/probe-server.cjs`, 127.0.0.1:6011, CORS open) as the "Custom API" model shows the real
  request, including tools, and can hold a tool call or fail on demand; Echo as the auxiliary model.
  The fallback list is reached in the legacy GUI's prompt-template page.

## After W3 (`/` commands, `/multisend`, Post File)

- **W3 is done** (`e07d32fb`, Report 46). A command line has one chat, fixed when it starts: the
  composer take's (with its hint), a trigger run's, or, for Post File, the chat where it was
  clicked. Every command resolves it by id at the moment it reads or writes, and marks it for save;
  no command calls `setDatabase`. `processMultiCommand(command, ctx)` requires a `CommandContext`;
  there is no caller without a chat.
- **Cancel and the take's text** (`MC-126` 1, `MC-128`): a signal stops a line before its next
  command or segment; the take's record is set at the start of any command outside the non-writing
  set and is not forwarded into nested runs. Ownership of the composer's window and the signal are
  forwarded through `/trigger`, `runtrigger`, `v2RunTrigger` and the input trigger.
- **`/trigger`'s depth** shares the run's `recursiveCount` with `runtrigger`/`v2RunTrigger`
  (the same check, increment and passed value). `NESTED_TRIGGER_LIMIT` in `command.ts` mirrors the
  literal 10 in `triggers.ts`; importing it there breaks tests that mock `./command`.
- **Left open, none scheduled:**
  - A trigger button's command line has no cancel (`MC-126` 1).
  - The busy button cannot be pressed while an `/input` or `/buttons` prompt is open (live check,
    row 442), so such a step can only finish.
  - `/multisend` resolves its chat per segment; no test pins it, because no production path
    replaces the chat object mid-segment (Gate 2 O3).
  - A composer line's `/trigger`s share one count, starting from 0; a fresh count per command is
    not pinned (Gate 2 R7; matters only past ten `/trigger`s in one line).
  - `/addvar` on an existing non-numeric value still writes `NaN`, as upstream.
  - The command parser still makes any `key=value` token a named argument (`MC-127`).
  - Post File was not exercised live (it needs a file dialog; the data-loss path is Tauri-only).

## After W2e (the delete warning and backup loads during work)

- **W2e is done** (`baf238e7`, Report 47). Every unit of work that writes into a chat across an
  await is registered. The send (outer call), the composer take, auto mode, the trigger-button run
  and the Post File job register with their own stop; reroll and `/trigger` register without one and
  are stopped through the send they run or the line's signal. `stopWorkIn` in `chatOrigin.ts` snapshots
  its matches and runs each stop once; `hasWorkIn` matches the owner only; `isWorkInProgress` is any
  registration or the composer window. A new unit of work that writes after an await must register
  with a stop, or be reached by its owner's, or a delete cannot stop it.
- **Deletes** go through `removeChatConfirmed` (the three chat handlers) and `removeChar` in
  `characters.ts`; the stop runs in the same synchronous stretch as the removal.
- **Trigger runs** check their signal before each trigger and effect (`MC-129` amendment); an effect
  in flight, including a model call or a Lua script, finishes.
- **Backup loads** refuse through `refuseBackupLoadWhileBusy` (`src/ts/drive/backupWorkGuard.ts`).
- **Left open, none scheduled:**
  - A registry match is by id: while an id has two holders mid-session, deleting one holder warns
    about, and stops, the other's send (Report 47 section 3).
  - A stopped trigger leaves what its earlier effects did, including a message edit half done
    (Report 47 section 6).
  - The busy button still cannot cancel a trigger-button run (`MC-126` 1); a Lua button run is never
    interrupted; a trigger's own model or image request gets no signal.
  - `storageMaintenance.ts`'s OPFS migration reloads without a work check.
  - `src/ts/process/request/google.ts`'s Vertex token refresh calls `setDatabase(getDatabase())` mid-generation, clearing
    `isStreaming` on every chat (inferred, packet Q4).
  - Two redundant stops are not pinned by a test: auto mode's own stop (the tick abort and the chat
    check already end the loop) and `isWorkInProgress`'s composer-window clause (Gate 2, m12, m19).
  - The eight W2e test files copy about 9,000 lines of harness; a shared harness module would ease
    maintenance.
  - The translator flagged the three new strings in `ko.ts` as literal; the maintainer may reword
    them.

## After Stage A and Stage 0 (the save layer's first steps; for Stage 1 and Stage 2)

Checked against the three commit messages, `MC-194` (items 5, 11, 12, 15, 16 and the Orchestrator
dispositions), the Roadmap's save-layer track and CHORE-83, and the stage scratch records, at HEAD
`82809af2` (2026-10-04). Source was not re-opened for this section. Every performance figure below was
measured on one i9-13900K-class machine, mostly in headless Chrome on synthetic data: best-case
hardware (`MC-003`, `MC-010`, `MC-131`). No phone or Pi figure exists for any of them.

- **Done:** Stage A `b1d2804b` (memory only), Stage 0 (ii) `2aa55398` (Node revision log), Stage 0
  (i)+(iii) `f04068f1` (no-op main-file skip and backup freshness). Stage 1 (the stable-keyed block
  store) has an accepted plan (Report 57, 2026-10-05). Its stages 1a (the durable Tauri write) and 1b
  (the block-store core, no callers) passed Gate 2 on 2026-10-05 (committed as `a7c0ef06` and
  `15f01783`; gate record Report 58). **Stage 1c (everything wired) is next, then Stage 2
  (per-module blocks).** The Stage 1 pre-measurements are in Report 57 section 14.

### What Stage 1a and 1b leave for Stage 1c (full list: Report 58 section 9)

- Choose the head swap by store kind explicitly. The factory that chose it was removed in 1b, and
  `createIndexedDbHeadSwap` is the IndexedDB one.
- A non-binary `blocks/head` on IndexedDB loads as damage (`bad-head`) and stops a live owner in
  `checkHead`, but no test covers the `checkHead` case, and `replaceWholeState` over such a head throws,
  so a damage prompt can offer only "stop" there. 1c adds the test and decides what the prompt offers.
- A damaged-head backup replace keeps no generation (a plan gap): manual clean-up could delete the last
  good one. The reviewer suggests keeping the newest generation that has a root.
- `readPack` copies each stub while the owner also retains the whole pack (a minor memory cost).
- 1a: the failed-directory-flush log goes to `eprintln!`, invisible in a Windows GUI release build; and
  the raw body is copied once in `decode_body`, an extra 1 to 2 GB transient for a modules block of that
  size until Stage 2 splits it.
- `load()` refuses on a live owner (`BlockOwnerStateError`); clean-up and the keep set are to read through
  `readCommitted()` or a second owner (1c). Live state changes only through the owner's own commit or replace.
- Not verified natively: a Tauri webview run of `write_durable`, Unix directory flush, power loss,
  IndexedDB atomicity outside `fake-indexeddb`, a tab closed mid-transaction. Everything else 1c has to
  wire is the 1b implementer's "Left for 1c" list in Report 58 section 9.

### What Stage 1 must state and keep

- **The advisor's ten invariants** (`senior-advisor` dossier, ledger row 1053; scratchpad
  `stage1/advisor-save-layer.md`) go into the Stage 1 plan, each with its test. Short form, in the
  advisor's numbering: (1) one function commits whole state, and the whole-state writers call it;
  (2) the root's directory is authoritative, and a listed block that is missing, empty or fails its
  CRC is an omitted entity, never empty content; (3) the loader tolerates any block version against
  any root version, adds and deletes commit with the root, a delete writes the root first and the
  block delete after, and cross-block references (enabled modules, module order, selected
  character) tolerate an absent target; (4) the encoder records a block only
  after the store acknowledged it; (5) commit means the root write resolved, and everything derived
  from "committed" keys off it; (6) snapshots are self-contained full copies, and the `.bin` import
  goes through the whole-state commit, while the `.bin` export is built from memory and reads no
  storage; (7) per-save allocation is O(changed blocks); (8) on Node a
  deleted key's revision is a tombstone, so stable names are never reused for a different entity
  (check that a module id qualifies); (9) a size guard applies to each store write; (10) every
  equality-based skip comes with its return-to-origin scenario.
- **The advisor counted six whole-state writers and did not re-count them** ("counted by the
  packet, not re-counted"). The Stage 1 plan's grep must confirm the list before its gate. For
  comparison, `f04068f1`'s message lists the main-file writers in the tab as the save loop, the
  bootstrap seeding writes, `bootArchivePass`, the `backuplocal.ts` restore and `internalBackup.ts`
  `loadSelectedBackup`, all through `writeMainFile`. `opfsCopyBack` writes IndexedDB directly,
  before the boot read. The two lists differ (the advisor's six omit the save loop and include a
  Tauri write-back), and at `82809af2` the non-test `writeMainFile` callers are two in
  `bootstrap.ts`, the save loop, `internalBackup.ts`, `backuplocal.ts` and two in
  `bootArchivePass.ts` through its injected dependency; six is not confirmed either way.
- **Keep `mainFileOutcome.ts`'s bracket around every main-file write, or its replacement.**
  `appStore.writeMainFile` reports "begin" synchronously just before `store.write` and "confirm"
  just after it returned. `beginMainFileWrite` runs synchronously immediately before `store.write`,
  so the restores' rule of no await between the busy check and the write still holds. A write that
  throws leaves the outcome unknown (on Node a write can land and then throw) until a confirmed
  write or a recorded read. The skip in the save loop relies on this property and on the committed
  layout moving only after a write returned (the encoder rule of advisor invariant 4); the first
  iteration also needs the `matchesMainFileRecord` comparison. Advisor invariant 4 states the
  acknowledged-bytes rule for the encoder's record; the "lands, then throws" case is the part
  `f04068f1` added, so the single commit owner must carry it explicitly rather than assume
  invariant 4 covers it (inferred: invariant 4 covers per-block records, not a cross-writer
  baseline).
- **A skip is a commit.** `f04068f1` makes a skipped iteration clean the tab, fire the commit
  callbacks once, reset `savetrys` and `conflictAlertShown`, and count as `primaryCommitted` for
  error classification. It makes no broadcast and does not call `noteMainFileBytes`. Advisor
  invariant 5 ("commit means the root write resolved") has to say what a skip is under the block
  store. Save mine (`flush`) forces the next main write, and the force clears only on a confirmed
  loop write.
- **The encoder's committed layout** (block references, or equal block bytes, in the same key order)
  moves only when the loop confirms a write or refreshes on a skip. Stage 1 changes what "written"
  means per block, so this comparison has to be re-expressed against per-key acknowledgements
  (inferred from the two designs; not planned).
- **The nine `globalApi.*.svelte.test.ts` files that mock `mainFileRecord`** gained
  `matchesMainFileRecord`, `getMainFileRecordDigest` and `digestMainFileBytes`, answering
  "different" or null so they keep always-write behaviour: `saveClean`, `saveDbMainFileRecord`,
  `nodeSave`, `nodeSizeGuard`, `nodeSizeGuard413`, `nodeSizeGuardScope`, `nonNodeSizeGuard`,
  `nodeBackups`, `saveDbTauriAtomic`. A change to those exports or to the main-file path touches all
  nine mocks.
- **`risuSaveCache` is retired in Stage 1** (the advisor's recommendation; adopted with the
  direction, `MC-194` 11). The block-cache puts, about 507 entries and 49 MB at every boot on the
  measured profile, were not part of Stage 0 (CHORE-83; the Stage 0 investigation recommended leaving
  them alone). They end when the cache does. Not re-measured since `f04068f1`: TODO(evidence).
- **Maintainer answers that bind Stage 1** (`MC-194` 10, 11): the platforms are Tauri and Node ("data
  in the browser is the one that is least utilized"), SQLite on Node is permitted but not in
  Stage 1; a save that commits partly when two Node devices write is "Acceptable"; forcing a Tauri
  directory write to disk is "Yes, in Stage 1" and needs a Rust command. The direction does not
  make Remote Saving the default. The advisor still recommends the web share the layout (its Q2).
- **The Hono server has no write or revision route** (the advisor, verified by grep at the time).
  It is not a target; do not mirror routes into it.

### The backup fingerprint record (`database/backupfingerprint`)

- **Fork-only, and it must never enter a `.bin` export or import** (`MC-175`, `MC-194` 12). Stage 1
  and Stage 2 export paths must keep it out.
- **What it is:** UTF-8 text `sha256:<length>:<hex>`, where the hex is the SHA-256 of
  `"<length>:<comma-joined per-4 MiB slice SHA-256 hex>"`, built from `mainFileRecord`'s slice
  fingerprint. It is not a whole-file hash.
- **Rules:** written only after a numbered backup's write returned, and only for exactly those
  bytes; never written in a non-secure context or for a sampled fingerprint; read once, at the
  page's first committing save iteration, and only if that iteration skips. A boot that skips takes
  a backup unless the record names the main file.
- **Its key** lies outside `database/dbbackup-`, `assets/`, `remotes/` and `coldstorage/`, and is
  creatable under the Tauri, Node and IndexedDB key rules (the `f04068f1` message). The Stage 0
  Gate 1 review checked these enumerations for it: `getDbBackups`, the `loadInternalBackup` listing, `manualCleanup`,
  `writeLocalBackup`/`writePartialLocalBackup`, the bootstrap remote and asset sweeps,
  `loadTimeListing`, `createStoredRemoteNames`, `AutoStorage.keys` (no production caller) and the
  Node `/api/list` (it returns the key, like any hex-named key; its consumers pass a prefix). Stage 1's per-entity keys need the same
  enumeration check, and must not fall under a prefix a sweep deletes.
- **Under Stage 1 the main file is written only on the backup cadence** (the advisor's shape), so
  what `matchesMainFileRecord` compares against at boot, and what the backup record names, need
  re-deciding. Inferred from the two designs; not examined.

### Residuals `f04068f1` accepted (Stage 1 inherits them unless it changes the mechanism)

- A tab that returns to exactly its own committed bytes after a peer saved skips and leaves the
  peer's file. Save mine is the deliberate overwrite.
- Node: a no-op iteration no longer gets an early 409. A write with an unknown outcome still writes
  and still gets it.
- A skip's backup copies the bytes this tab committed, which after a foreign peer write is not what
  storage holds. It is never worse than the old boot backup.
- Pruning (by timestamp in the name) or clock skew can remove the recorded backup while the record
  still names it, for example after about 19 loads of one snapshot. A boot can then skip with no
  kept backup holding main. The old boot backup was pruned the same way.
- Backups written without a record update can push the recorded backup out of the 20 kept: a
  plain-HTTP session on the same profile writes a backup at boot and every 5 minutes and never a
  record, and a record write can fail. If main later returns to the recorded bytes, a secure boot
  skips with no kept backup holding them. The main file itself stays intact.
- The first boot after the upgrade has no record and takes one backup.
- On plain HTTP (`MC-143`) there is no `crypto.subtle`: the first iteration writes main and a backup
  as before, and no record is written. Steady-state skips work everywhere.
- Not claimed: a whole-file hash; the record being read at every boot; power-loss behaviour of the
  record write (not examined). The cost of the record write on weaker hardware is not measured (one
  SHA-256 pass over each numbered backup, at most every 5 minutes; fingerprinting 43 MiB took 27.3 ms
  in the planning measurement).
- Gate 2 judged four mutant survivors equivalent: a steady baseline ignoring "known", the record path
  ignoring the epoch, a boot check on every skip, and no key-order check. If the design changes, those
  judgements need re-checking.

### The Node revision log (Stage 0 (ii), `2aa55398`)

- **Invariants Stage 1 builds on:** acknowledged revisions never go down; a bump is appended before
  the content write and the response; recovery is the maximum over the snapshot and every valid log
  record; a torn or garbage log line is skipped; compaction (snapshot written to a temp file,
  fsynced, renamed, then the log deleted) at runtime runs only inside `withRevisionTransaction`,
  never alongside a bump; startup compaction (`compactRevisionsSync`) is synchronous and runs
  before the server listens. The compaction threshold is 20000 records (`RISU_REVISION_LOG_COMPACT_AT`
  overrides it for tests).
- **Trap: compaction outside the queue.** One mutant survived Gate 2 round 2: running compaction
  outside the global queue. The reviewer judged a test unnecessary because the only scheduling call
  site is `scheduleRevisionCompaction` through `withRevisionTransaction`, plus the startup
  compaction before listening. A new route or timer that compacts or bumps revisions must go through
  the same queue; nothing tests that.
- **Trap: hidden names.** `__revisions.log` and the snapshot temp files use `__`-prefixed names that
  `isHex` rejects for read, write and remove, and `/api/list` returns only whole, even-length hex
  names. A new server-side bookkeeping file needs the same.
- **Fails closed.** If `__revisions.log` exists at startup and cannot be read, the server logs the
  file and error code and exits with code 1 before listening, leaving the log untouched. A readable
  but torn or garbage log still starts. This was the Orchestrator's choice after Gate 2 round 1
  (`MC-194`, dispositions).
- **Stage 1 raises the key count and the writes per save.** Entries in the revision map are never
  deleted, and a full snapshot is written at each compaction (about 54 MB at 350,350 keys). Stable
  names per entity bound the key count by the entity count (advisor, Q1), which is why they matter
  here. The 15.5 ms p50 per write at 350,350 keys is the cost of the request itself; the revision map
  no longer adds to it.
- **Not claimed:** power loss. The snapshot is fsynced before the rename, but log appends are not
  fsynced and there is no directory fsync; "crash-safe" means a process crash. A second server
  process on the same data directory stays unsupported.
- **Unsupported:** moving a data directory back to a build from before this change (`MC-011`). Such a
  build ignores the log and reads the lower snapshot revisions, so a device holding a revision equal
  to that value could pass the equality check in `/api/write` and overwrite newer content. No such
  fork build shipped, and upstream has no revision check.
- **P9, an unnumbered candidate, not a ticket.** An unparseable or non-object `__revisions.json`
  still starts as if the snapshot were empty (the log is still replayed), and the next compaction
  overwrites it. Possible fixes named in the commit: rename the bad file aside and seed a high
  revision floor so stale devices get 409. Nobody owns it yet.
- **Test fixture:** `nodeServerFixture.ts` gained `halt('graceful' | 'hard')`, `restart(options)`
  (per-field merge of `env` and `nodeArgs`) and `RISU_NODE_SERVER_SCRIPT`, which points the fixture
  at another `server.cjs` and warns when set. Stage 1's Node tests can reuse them.
- **Hand-off already used:** the side session's CHORE-80 server hunks waited for this commit
  (`MC-194` 13).

### Module asset lists (Stage A, `b1d2804b`; for Stage 2 and any code touching `modules`)

- **Invariant: replace the list, never mutate it.** Each module's `assets` is an `AssetList` (an
  Array subclass, `src/ts/storage/assetList.ts`) once the database is installed. Svelte 5.56.8
  proxies only values whose prototype is `Object.prototype` or `Array.prototype`, so the list and its
  tuples sit outside Svelte's reactive graph. An in-place write on an installed `AssetList` (a tuple
  field, `push`, `splice`) re-renders nothing and marks no block dirty, so no save is scheduled. Every
  writer assigns a new list to `module.assets` (`commitAssets` in `ModuleMenu.svelte`). A guard test
  pins the untracked behaviour as the reason. A new writer of a live module's assets, including
  Stage 2's, must replace.
- **The earlier "gap" is closed for in-fork writers.** The moduleHeap measurement patch (install
  only, no replace) left the module editor's in-place edits untracked until another change. Stage A
  moved the editor's rename, add, delete and first-open default to replacing writes, with tests that
  are red against that patch. The implementer's search found no other in-fork writer of a live
  module's `assets` (`exportModuleLegacy` and `readModule` act on a clone or an uninstalled module).
  What can still go untracked is G2-4 below (a suspicion, not reproduced). The V2.1 case and the
  not-wrapped items stay plain arrays: they are tracked and cost memory only.
- **A V2.1 plugin enabled means plain arrays.** V2.1 plugins can edit module lists in place (`MC-132`,
  `MC-146`: they get plain data). While one is enabled the install wraps nothing, `commitAssets`
  assigns a plain array, and `loadPlugins` calls `unwrapModuleAssets` before
  `restoreAllForV21Plugins`. This is a deviation from "always assign a new AssetList", required by
  I6. The unwrap's order against the restore is not test-enforced (the mutant survives; judged
  equivalent because the restore catches its own errors).
- **G2-4, suspicion only, not reproduced.** A resident V2.1 plugin that switches itself off through
  the plugin API's `setDatabase` would let the real `setDatabase` wrap while its code still runs, and
  a later in-place push by it would go untracked. Gate 1 had a similar suspicion for a disabled
  plugin's lingering timer. No such upstream plugin is known.
- **Not wrapped, memory only:** modules added to the live database after the install (import, drop,
  MCP, convert) stay plain until the next install; the plugin API's own `setDatabaseLite` assigns
  `DBState.db` directly; `personas[].embeddedModule.assets` is read-only. The first-boot pass (the
  163 MB decode) is not helped; its peak was not re-measured for this tree.
- **Serialisation is unchanged.** The modules block is byte-identical, and the `.bin` and V3 snapshot
  decode to equal content (`MC-175`). `convertModuleToCharacter` must keep its final
  `safeStructuredClone`, or a character's `additionalAssets` becomes an `AssetList` (two guards fail
  without it). Stage 2's per-module blocks should not need a new rule here, but any code that stores
  or hands off a module's `assets` must give a plain array.
- **What is left in the module tree.** The advisor's finding was that most of the module heap is
  Svelte's wrapping of the asset lists. Out of scope for Stage A and still open: lorebook, regex and
  trigger proxies (about 12.5k proxies left per the plan), asset path strings, the first-boot import
  peak, and the save file's size.
- **Module archiving is shelved, not cancelled** (`MC-194` 5). The maintainer chose "Stage A now,
  decide archiving later". The `MC-193` 5 order (modules first) therefore has no scheduled first step,
  and whether the gated in-session unload (`MC-194` 1) moves up is the maintainer's to place. Stage 2
  (per-module blocks) needs the same two decisions the archiving plan did (the module identity key
  and the order held in the root); the advisor wants Stage 2 decided together with the archiving
  question.
- **Related, closed:** opening the module editor marked the modules block dirty through the `hideIcon`
  checkbox binding. That is CHORE-88 (closed, `54b1a819`). Since `54b1a819` the Stage A editor
  test's helper clears the flag after the tracker registers and before the editor mounts, and a test
  asserts that opening the editor leaves the modules block clean.

## Wiki batch (owned by the Wiki session; W2 is done)

- The composer and send wiki batch is unblocked: on 2026-09-30 the Wiki session was told that W2 and
  W3 are done, with W3's and W2e's user-visible changes. The source-line anchors in
  `RisuAI-Basics.md` (into `composerActions.svelte.ts` and `DefaultChatScreen.svelte`) have shifted
  with every edit to those files since S2.
- W1a's list of stale wiki claims is Report 33 section 13. The lists for W1b and the composer stage
  (`Settings-Hotkeys.md`, `RisuAI-Basics.md`) went to the Wiki session.

## Not scheduled

- **Suspected by the Wiki session while documenting (2026-09-30, wiki `5b366746`); not verified
  by this session.** Each needs an `investigator` check before it becomes a ticket.
  - `prevChar`/`nextChar` in `hotkey.ts` sort all of `db.characters`, trashed ones included.
  - `/multisend clear` empties the chat once per segment, not once overall (upstream the same).
  - `doingChatInputTranslate` in `DefaultChatScreen.svelte` is never assigned, so its clause in the
    busy condition is dead.
  - A suggestion click during a reroll or auto-mode window overwrites the draft, then `send()` is
    refused silently (`Suggestion.svelte` checks only `isComposerLocked()`).
  - The message box's Ctrl+M reroll ignores the hotkey table and fires with Shift or Alt held.
  - The translate box has no send key when Send with Enter is off.
  - The `/?` help text disagrees with the code (`/buttons`, `/len`, `/cut`, `/del`; `/setinput`,
    `/multisend` and `/test_lorebook` are missing).
  - A `/` line's CBS runs before the command is known, so an unknown command's CBS side effects
    fire and its text is then sent as a message.
  - A comment in `index.svelte.ts` says hotkeys change the selection without checking `doingChat`;
    `changeChar` does check it.
  - From earlier batches: the Global Lorebook and Global Regex settings pages are unreachable; Easy
    Panel's menu highlight checks index 16, which nothing sets; the Bug Report export's removal
    list names a removed `account` field; inside a group member's trigger run, Lua `getName()`
    returns the group's name while trigger effects write the member.
  - (The late backup refusal leaving assets and cold-storage items is known and commented in
    `backuplocal.ts`; see "After W2e".)
- **CHORE-43** (Roadmap): the composer's reroll history is per instance and is reset only when the
  selected character's index changes (or after a send appends), so unreroll can write one chat's reply
  into another. The 2026-10-01 amendment confirmed the mechanism (run in a scratch Vitest) and
  corrected the scope: a chat switch remounts the composer only under the opt-in beta mobile layout or
  the Lite build, so the default phone layout reaches it as well as desktop (TRACED, not run in a
  browser). The maintainer placed it right after CHORE-53 (`MC-151` 3). The Orchestrator's
  recommendation (CHORE-54) is to fix it in one change with CHORE-54 (rerolling or going back overwrites
  an edited reply; data loss, save path inferred).
- **W2a's optional items** (Report 35 section 12): skip the image-prompt request when there is no
  reply to append to; align the non-streaming continue whose target is already missing with the
  streaming one.
- **The upstream batch** (`MC-101`; ledger rows 302-303) leaves three items, all the same on
  `upstream/main`:
  - a session-cached plugin permission grant skips the periodic reconfirm for the rest of the
    session;
  - `hasher` (`src/ts/parser/parser.svelte.ts`) needs `crypto.subtle`, so plugin permission checks
    throw on a plain-HTTP LAN origin;
  - a partial `loadoutApplyOptions` object, which only a hand-edited save can hold, hides the missing
    toggles.
- **Escape on alerts stage 2 residuals** (Report 41 section 7):
  - the hosted first-run password prompt, if two ever run at once, would now be asked in turn, and
    the server refuses the second password without telling the client;
  - a follow-up prompt asked after an earlier prompt's answer answers at once, so a double-press can
    answer both;
  - third-party scripts that relied on a foreign answer now wait for their own.
- **A comment citation.** Comments in `src/ts/globalApi.svelte.ts` cite "ledger row 61" for a timing
  claim (a seconds-long `encoder.init` window at 1000 characters) that rows 63 and 79 carry. The
  second comment-sweep pass left it; fix it the next time a stage edits those comments.
- **Disclosed for the maintainer.** In a chat whose id has two holders, the send's own writes land
  (`MC-104` 1) but its trigger runs still write nothing (`MC-078`).

## Reference for any later stage

### The save encoder and duplicate ids (CHORE-28, Report 26)

- **`RisuSaveEncoder` (`src/ts/storage/risuSave.ts`):**
  - each `init`/`set` pass takes one copy of the character list at its start;
  - it counts holders by `String(chaId)` and encodes each key at most once;
  - a key with two or more holders is frozen: its block is kept unchanged, taken out of
    `toSave.character` and never deleted;
  - a never-saved duplicate writes its first holder once;
  - `init({ previous })` reuses the replaced encoder's block only for a key duplicated in its own
    snapshot;
  - `getFrozenKeys()` exposes the frozen set.
- **Marks.** `toSave.character` can hold raw, non-string `chaId` values (`frontUnshiftSelected`,
  `appendIfAbsent`), and the encoder compares marks by `String()`. **Never convert the list to
  strings in place:** `mergeUnsavedChanges` folds it back into the live tracker after a failed
  write, and `prepareSaveIteration`'s no-reload filter compares raw values, so the mark would be
  dropped.
- **`src/ts/globalApi.svelte.ts`:** `reloadSaveEncoder` is the shared reload hand-over;
  `checkFrozenKeysForResolution` is the idle step; `publishFrozenSaveIndicator` feeds
  `frozenSaveKeysStore`, which `SavePopupIcon.svelte` renders. The save loop's calls to the last two
  are covered by review only.
- **Resolving a duplicate.** A normal delete only trashes a character, so the key stays duplicated.
  A permanent delete resolves it. `removeChar` and `restoreCharacterFromTrash` accept the character
  object, and the grid uses that form.
- **Cold storage.** `cleanColdStorage` refuses while any key is frozen.

### Identity and origin (W0, Report 24)

- **`src/ts/process/chatIds.ts`:** pure fill, repair and duplicate warnings; a missing id is always
  fresh. `repairDatabaseIds` runs at boot and on every decoded backup before install, including the
  local `.bin` restore.
- **Two rules for anything that calls `beginWork`:**
  - it takes only objects read back through `DBState`. Row 386's proxied harness passed raw fixtures,
    the hint never matched the proxies, and every resolve became a full scan;
  - resolve once per synchronous batch.
- **`src/ts/process/chatOrigin.ts`:** a target that is gone or held twice is skipped (`MC-075`,
  `MC-078`). W1a, W1b, W2a and W2c-a bind their writes and reads through it (Reports 33, 34, 35,
  40). The send's own writes in a duplicated-id chat are the one exception (`MC-104` 1).

### Multiuser removal (CHORE-34, Report 27)

- **`src/ts/sync/` no longer exists**, and `peerjs` is gone from the dependencies.
- **`saveAsset`'s custom-id parameter** has no production caller that passes a non-empty id (checked
  by grep at `1d6fa16b`: every call passes none or `''`). `verifyAssetCacheEntry` judges a 64-hex
  custom id as a content hash, so a caller must never pass a 64-hex id that is not the hash. A
  `uuidv4()` name, the fallback on non-secure origins, reports 'not-content-addressed'.
- **`checkCharOrder`'s `§temp` exclusion** (in `globalApi.svelte.ts`) is the only production
  reference to `§temp`, and `src/ts/checkCharOrder.tempCharacter.svelte.test.ts` pins it. Upstream
  saves can carry such a character.
- **Upstream facts** (`upstream/main`, 2026-09-23): upstream still ships multiuser; it never writes
  `Message.otherUser`; user messages without `name` already exist upstream.

### The composer as built (after the composer stage's S2, Report 22)

Source is authoritative; this is the shape W2 and W3 work against.
- **`src/ts/process/composerDrafts.svelte.ts`** is the per-chat draft store: a `SvelteMap` of
  `$state` records keyed by `chaId::chatId`.
  - `peek(key)` returns the record, or a frozen empty view, and never creates one.
  - `write(key, updater)` is the one write path. It drops an emptied record, and past 200 it evicts
    the least recently written, never the key set by `setOnScreenKey`.
  - `take` and `putBack`; `resetComposerDraftsForTests`.
- **`src/ts/process/composerActions.svelte.ts`:**
  - `ComposerActionsSource` holds only the instance's reroll history (`rerolls`, `rerollId`,
    `lastCharId`) and `closeMenu`.
  - The take and every put-back go by `workHandle.origin`'s key. A put-back never goes through the
    source.
  - Module state: `locked` (the global lock, `MC-102` 1; open only from a Send's or Continue's take
    until generation starts or the values go back); the `inflight` record; `autoModeRunning`
    (`isAutoModeActive()`); `currentGenerationController`, published at the take and again in
    `sendChatMain`.
  - **The composer's action window is not here.** It lives in `generationOwnership.svelte.ts`
    (`isComposerWindowOpen`, `setComposerWindow`) since W2b-core (`ac8cb3da`), where starters
    outside the composer read it.
  - `abortChat()` takes no source. On every press it stops the unit in progress
    (`abortUnitInProgress`, `generationOwnership.svelte.ts`) and auto mode, then cancels an unsettled
    take, or else aborts `currentGenerationController`. `runAutoMode`'s `finally` ends its work
    handle and clears both the window and the auto-mode flag.
  - `updateInputTransateMessage(key, reverse)` writes only if that record's source text is
    unchanged.
- **`DefaultChatScreen.svelte`** has no composer `$state` of its own. The textareas use function
  bindings to the shown record. Writes go through `resolveDraftKeyForWrite()`, which fills missing
  ids through `beginWork` and ends the handle at once. Late writers (paste, Post File) capture the key
  before their await. A transient `fallbackDraft` is used if the fill is refused, which is not
  expected to be reachable.
- **Tests:** `src/lib/ChatScreens/DefaultChatScreen.composer.svelte.test.ts` (a mount harness of the
  real component in happy-dom, driven through the DOM),
  `src/ts/process/tests/composerDrafts.svelte.test.ts`,
  `src/ts/process/tests/composerActions.svelte.test.ts` and `src/ts/hotkeyCharSwitch.svelte.test.ts`.
