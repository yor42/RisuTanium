# Maybe Later — QOL Backlog

Ideas that are **not** part of the stabilization campaign. Nothing here is approved,
scheduled, or estimated. This file exists so a good idea does not die in a chat log.

**Rules for this file**
- Every entry must say what *already exists* before it says what is missing. Several
  "missing" features in this app turn out to be built but undiscoverable.
- Cite `file:line` for anything asserted about current behaviour, and re-verify before
  acting — citation drift has repeatedly bitten this campaign.
- Entries must respect the compatibility invariant: upstream-compatible characters,
  modules, presets, backups and plugins keep working. Anything additive to a shared
  format needs an explicit fallback for clients that do not understand it.

---

## QOL-01 — Character-bound modules for the RisuRealm asset-module workflow

**Status:** idea. Partially built already.
**Raised by:** yor42, 2026-09-21.

### Context

RisuRealm enforces a 150 MB limit per uploaded bot card. The community routes around
this by shipping assets (per-character emotion sprites, animated images) as separate
**asset modules**, which are frequently far larger than the card itself — tens of MB to
1-2 GB in extreme cases.

The consequence is that a card and the modules it depends on are separate artifacts with
**no declared relationship between them**. A bot that expects three asset modules has no
way to say so, and the user is expected to know and to enable them by hand.

### What already exists

Module resolution is already multi-source. `getModules()` unions five independent lists
(`src/ts/process/modules.ts:399-438`):

| Source | Scope | Field |
|---|---|---|
| `db.enabledModules` | global | `Database.enabledModules` |
| `currentChat.modules` | per-chat | `Chat.modules` (`database.svelte.ts:1840`) |
| `character.modules` | **per-character** | `character.modules` |
| `persona.embeddedModule` | per-persona | — |
| `db.moduleIntergration` | per-preset | comma-separated ids, `database.svelte.ts:2227` (preset field `:1645`) |

So **per-character binding — the thing that would solve the stated problem — is already
implemented.** It is toggled in the chat module menu:

- **Left click** → chat-level, rendered blue (`ModuleChatMenu.svelte:83-97`)
- **Right click / long press** → character-level, rendered violet (`ModuleChatMenu.svelte:102-112`)

It is documented, but only in a single sentence inside the menu (`src/lang/en.ts:1133`):
"You can also enable for this character by right clicking or long pressing the enable
button."

### What is actually missing

**A. Discoverability.** *(Behaviour confirmed by yor42, 2026-09-21: right-click / long-press
does work as documented, and does bind character-wide. The feature is fine. Finding it is
the problem.)*

The binding model has three states, communicated almost entirely through colour:

| State | Colour | How you set it |
|---|---|---|
| Chat-level | blue | left click / tap |
| Character-level | violet | right click / long press |
| Globally enabled | greyed, non-interactive | elsewhere, in module settings |

There is no legend, no tooltip, and no persistent indication of a module's tier once the
menu is closed. The only explanation is one line of small grey text above the search box
(`ModuleChatMenu.svelte:46` rendering `en.ts:1133`), which describes the *gesture* but
never says what the resulting colour means.

As yor42 put it: "if you tap and hold the check icon next to the module, it turns purple,
and it means that module is enabled character wide" is very hard to figure out unless the
user reads the code. A hidden gesture whose only feedback is an unlabelled colour change
is not discoverable, and long-press in particular has no visual affordance at all.

Concrete, low-risk improvements — none of which change behaviour:
- A legend mapping each colour to its scope, rendered in the menu.
- A text badge ("chat" / "character") on the row instead of relying on colour alone.
  This also fixes the accessibility problem: blue vs violet is a poor distinction for
  colour-vision-deficient users, and it is the *only* signal today.
- An explicit control for the character-level toggle, so it is reachable without knowing
  the gesture. The gesture can stay as a shortcut.
- State the colour meaning in `chatModulesInfo`, not just the gesture.

**B. No character-editor view of bound modules.** `character.modules` is written *only*
from the right-click handler in `ModuleChatMenu.svelte`. Nothing in the character editor
lists, displays, or edits it. There is no way to answer "what does this bot need?"
without opening a chat with it and reading button colours.

**C. No declared card→module dependency.** This is the real gap behind the 150 MB
workaround. Importing a card does not, and cannot, bind the asset modules it expects,
because the card has nowhere to name them. The author cannot ship the binding; the user
must reconstruct it manually, per bot, from the card's description text.

### Sketch of a direction (not a plan)

- **Cheap, safe, no format change:** address (A) and (B). A legend in the module menu, and
  a read-only "bound modules" row in the character editor. This alone may resolve the
  reported pain, since the mechanism already works once you know it is there.
- **Additive format change:** let a card declare optional module dependencies by id/name.
  On import, surface "this bot expects modules X, Y — bind them?" rather than binding
  silently. Must be ignorable by upstream clients and must degrade to today's behaviour
  when the modules are absent, per the compatibility invariant.
- **Explicitly out of scope:** anything that auto-downloads modules, or that makes a card
  fail to import when a declared module is missing.

### Related

Compare **persona binding**, which solved the analogous problem at chat scope:
`Chat.bindedPersona` (`database.svelte.ts:1842`), bound from `CustomSidebar.svelte:73-78`
and `SideChatList.svelte:262-275` and `:361-374`, consumed at `DefaultChatScreen.svelte:389-392`. Note
that persona binding got a visible, labelled UI affordance; module binding did not.

---

## QOL-02 — Bulk import for modules and plugins

**Status:** idea. Confirmed gap, narrow and self-contained.
**Raised by:** yor42, 2026-09-21.

### What already exists

Character import is **already multi-file**. `importCharacter()` calls
`selectFileByDom(["*"], 'multiple')` and loops over the result
(`src/ts/characterCards.ts:32-50`), wired to the standard add-character menu in `addCharacter` at
`src/ts/characters.ts:998-999`. Nothing needs doing there.

### What is missing

Both sibling importers pick exactly one file and have no surrounding loop:

| Importer | Picker | Location |
|---|---|---|
| Character | `selectFileByDom([...], 'multiple')` + `for` loop | `characterCards.ts:32-50` |
| Module | `selectSingleFile(['json','lorebook','risum','charx'])` | `modules.ts:258`, called from `ModuleSettings.svelte:173` |
| Plugin | `selectSingleFile(['js','ts'])` | `plugins.svelte.ts:153` |

Importing N modules or N plugins therefore means N passes through the file dialog. This
matters most for the asset-module workflow described in QOL-01, where a single bot can
expect several modules.

### Why it looks cheap

The multi-file precedent already exists in this codebase in both shapes — `selectMultipleFile`
is used for asset add (`ModuleMenu.svelte:254`), and `selectFileByDom(..., 'multiple')` plus a
loop is used for characters. The work is plausibly picker swap plus a loop plus per-item
error isolation, so one bad file in a batch does not abort the rest.

**Unverified:** whether `importModule()` and `importPlugin()` are re-entrant enough to be
called in a loop — both show confirmation dialogs and mutate `DBState` directly. Check before
assuming this is a five-line change.

---

## QOL-03 — Bulk and housekeeping operations for character/module assets

**Status:** idea. Partially built already — do not write "there is no asset UI".
**Raised by:** yor42, 2026-09-21.

### What already exists

A table-based asset manager already ships for **both** characters and modules, with near
identical markup: `src/lib/SideBars/CharConfig.svelte:590-654` and
`src/lib/Setting/Pages/Module/ModuleMenu.svelte:246-301`. A smaller add-only grid exists at
`src/lib/ChatScreens/AssetInput.svelte:34-53`.

It already supports:
- **Multi-file add** — `selectMultipleFile([...])` then a push loop (`ModuleMenu.svelte:254-266`,
  `CharConfig.svelte:596-610`).
- **Inline preview** of image/video/audio per row, behind the `useAdditionalAssetsPreview`
  setting (`CharConfig.svelte:625`, `ModuleMenu.svelte:280`).
- **Rename in place** via a bound `TextInput` (`CharConfig.svelte:635`, `ModuleMenu.svelte:290`).
- **Delete**, one row at a time, `splice(i,1)` (`CharConfig.svelte:638-648`,
  `ModuleMenu.svelte:293-300`).

### What is missing

- No multi-select and no bulk remove — there is no checkbox markup in either table.
- No search or filter, which is what makes the list unusable at the sizes QOL-01 describes
  (asset modules of tens of MB to 1-2 GB, i.e. potentially hundreds of rows).
- No unused-asset detection. A grep for `unused` across `src/ts` and `src/lib` surfaces only
  `coldstorage.svelte.ts:247-256`, which cleans unused *cold-storage keys* — a different
  subsystem, not `additionalAssets`/`assets` dead references.

The community wrote a large plugin covering exactly these gaps (kept locally as evidence; see
the note at the end of this file). That it exists at all is the strongest signal the native UI
stops short of what the workflow needs.

---

## QOL-04 — Import and backup speed

**Status:** idea. Rewritten 2026-10-01 for the current fork; the account-sync premise of the
2026-09-21 text is gone (see "What changed").
**Raised by:** yor42, 2026-09-21. Platform claim refuted by investigation the same day. Local-file
import speed, Lightning Realm Import and the community plugin added by yor42, 2026-10-01.

**2026-10-01:** the maintainer marked this entry stale, because the account sync that its old text
said must not be pushed harder is removed from this fork (`MC-151` addendum).

**2026-10-01, later:** the maintainer asked for a faster local-file character import, built natively,
not by porting the community plugin (`MC-151` 6). The sections "Lightning Realm Import", "The community
fast-import plugin", "The native cost model of a local import", "Safe native equivalents" and "Relation to
QOL-08" below record the investigation behind that (ledger row 532). Nothing in them is approved or
scheduled.

### What changed

The 2026-09-21 text was about a platform boundary: with account sync on, a non-Tauri build served
assets through the upstream hub, so a faster backup or import there could load upstream's
asset-cache servers. That path no longer exists in this fork:
- **RisuAccount, and with it account sync, is removed** (Roadmap CHORE-33, done 2026-09-26; `MC-080`,
  `MC-081`). `MC-080`'s own reasoning names account sync as a blocker for "faster, more aggressive
  local backup creation".
- **Google Drive backup is removed** (Roadmap CHORE-36, done 2026-09-27, `237ebba1`; `MC-092`).
- A search of non-test `src/` on 2026-10-01 finds no `isAccount`, no `AccountStorage`, no `/rs/` and
  no `lightningRealmImport` (writer's Grep). The two backup-save loops (`SaveLocalBackup`,
  `SavePartialLocalBackup`) have no per-asset sleep (`src/ts/drive/backuplocal.ts`).

So the old warning not to make the sync path more aggressive, and the throttle it pointed at, have
nothing left to apply to. The speed work is now a plain local-I/O question.

### What already exists

- **Both backup loops are sequential.**
  - Tauri: `SaveLocalBackup` lists the `assets` directory, then for each entry does one `readFile` and
    one `writer.writeBackup`, each awaited (`src/ts/drive/backuplocal.ts:117-150`).
  - Everywhere else: `forageStorage.keys()`, then one `getItem` and one `writeBackup` per `assets/`
    key, awaited in turn (`:151-178`; other keys are skipped, `:166-169`).
  - Each iteration also posts a progress alert (`:130`, `:164`).
  - `LoadLocalBackup`'s restore loop writes entries one at a time (`backuplocal.ts:607-652`) with
    `await sleep(10)` per entry (`:653`).
- **A partial backup already ships and is already in the UI.** `SavePartialLocalBackup`
  (`backuplocal.ts:232`) asks two confirmations (`:233-245`). It carries only the assets in the map it
  builds (`:262-316`): character profile images, the user icon, persona icons, the custom background,
  folder images and bot preset images. Emotion images are excluded on purpose (`:271`), and the map
  never adds additional assets, VITS files or CC assets. It has its own button, after one more
  confirm, at `src/lib/Setting/Pages/UserSettings.svelte:24-31`. "There is no fast backup option"
  would be false.
- **Parallel asset save already exists for two import formats.**
  - `.charx` import: `CharXImporter` holds a `Semaphore` of `MAX_CONCURRENT_ASSET_SAVES = 10`
    (`src/ts/process/processzip.ts:11`, `:195`, `:383-400`; `Semaphore` is `src/ts/util.ts:954`).
  - `.risum` module import: `readModule` runs up to 10 asset saves at once and retries failures up to
    3 times after a 5 s wait (`src/ts/process/modules.ts:171-173`, `:182-216`, `:238-248`).
- **Several import paths save assets one at a time.**
  - PNG character import awaits `saveAsset` for each `chara-ext-asset_` chunk inside the chunk loop
    (`src/ts/characterCards.ts:170-209`, the save at `:207`).
  - A Character Card V2 card's emotions, additional assets and VITS files, and a V3 card's
    `data:`-URI assets, are saved in awaited loops (`:714-795`, `:807-871`, `:843`). The emotion and
    VITS loops also `await sleep(10)` per item (`:722`, `:771`); the additional-assets loop does so
    every 100th item (`:744-746`).
  - Realm-format imports (`mode === 'hub'`) first fetch each asset with an awaited `getHubResources`
    (`:732`, `:759`, `:782`; `getHubResources` is `:1835-1841`).
- **`saveAsset` names an asset by the hash of its content** (`src/ts/globalApi.svelte.ts:475-486`) and
  then writes it: Tauri `writeFile`, otherwise `forageStorage.setItem` (`:491-500`). The same bytes and the
  same extension therefore get the same key.
- **No hub-side hash check remains.** Upstream/main (`f9728b14`) has `CharXSkippableChecker`, which
  fetches `hubURL + '/rs/assets/' + <double hash>` to skip asset saves for a hub `.charx`
  (`src/ts/process/processzip.ts:445`, read with `git show`; upstream not run). The fork's file has
  no counterpart.

### What remains upstream-facing

Only Realm, and the Node server's proxy for it. Local imports and local backups read and write local
storage only (by reading the loops above); they do not call the hub.
- `server/node/server.cjs:22` sets `hubURL = 'https://sv.risuai.xyz'`, and the routes
  `GET /hub-proxy/*` and `POST /hub-proxy/*` (`:1079`, `:1083`, handler `hubProxyFunc` at `:991`) forward
  to it. Roadmap CHORE-33 and `MC-080` record that the self-hosted server's `/hub-proxy` is kept.
- In the app, `hubURL` is `/hub-proxy` on a Node-server build, otherwise `https://sv.risuai.xyz` or
  the nightly host (`src/ts/characterCards.ts:24-30`). `getHubResources` fetches `${hubURL}/resource/<id>`
  (`:1835-1841`). `downloadRisuHub` first asks for the upstream agreement (`:1770`), then downloads
  from `https://realm.risuai.net/api/v1/download/dynamic/<id>` (`:1779`).

A speed change to a Realm-format import (the per-asset `getHubResources` calls above) would add
requests to those hosts. A change to local backup or local-file import would not.

### The direction this points

**"Bring the slow local paths up to the fast paths that already exist elsewhere in this repo":**
port the semaphore pattern to PNG import and to the other awaited asset loops, and consider the same
for the two backup loops.

**yor42, 2026-09-21: wants to explore speeding up backup on Tauri and local specifically** (`MC-025`).
With account sync gone, that is every backup this fork makes. Whoever picks this up should first
establish where the time goes (the per-asset read, the per-asset archive write, or the progress
alert) rather than assuming concurrency is the answer. The `.charx` semaphore and the `.risum` loop
are precedents, not a diagnosis. For a PNG character import specifically, the investigation below
found a suspect that a semaphore does not touch (a buffer copy that grows with the number of large
assets); see "The native cost model of a local import". `Agents/Tools/README.md` describes a synthetic save-data generator
and a Vitest benchmark harness. It measures the cost of `$state.snapshot()`, not backup I/O, so it is
a pattern to reuse rather than a measurement of this.

Considerations, not findings:
- **Memory.** Overlapping reads hold several assets in memory at once. The maintainer's own local
  backup is about 36 GB (`MC-131` 1), and `MC-130` 4 says that when creating a `.bin` backup would need
  more memory than the device has, a warning is enough for now and streaming is to be looked into.
- **Upstream compatibility.** A backup written faster must still restore in the format this fork
  already restores, and an upstream-readable `.bin` is its own item (`MC-130` 3).

### Lightning Realm Import

**What it was (upstream; read with `git show upstream/main`, not run).** An experimental setting labelled
"Lightning Realm Import" (`src/ts/setting/advancedSettingsData.ts:231-232` on `upstream/main` `f9728b14`,
with `showExperimental: true`), shown only when `db.account.useSync` was on. Upstream added it in
`d12ab8ea` (2024-11-30). On a Realm PNG download, for each `chara-ext-asset_` chunk it:
- hashed the asset with SHA-256 and fetched `https://sv.risuai.xyz/rs/assets/<hash>.png`;
- on a 200 answer, recorded the path `assets/<hash>.png` and did not save the bytes;
- on any other status, called `saveAsset` as usual;
- sent the probes in batches of more than 10
  (`upstream/main:src/ts/characterCards.ts:258-299`, re-read by the writer).

**Packet premise 1, corrected.** The premise was: it hashes each PNG-chunk asset, probes
`/rs/assets/<hash>.png`, 200 means "referenced remotely", gated on `db.account?.useSync`. The
investigation found it partly wrong, in three ways (ledger row 532):
1. **The gate has a second flag.** The test is `db.account?.useSync && f.lightningRealmImport` (`:258`).
   `lightningRealmImport` is set only at the two Realm-download call sites (`:1833`, `:1840`, from
   `db.lightningRealmImport`). A search of `upstream/main` `src` finds the name only there, at the option
   type (`:55`), at the setting and at the database field. The local-file `importCharacter` never sets it,
   so the probe never ran for a local file, even with sync on.
2. **The `.charx` path is a different mechanism, not the same probe.** It is gated on
   `forageStorage.realStorage instanceof AccountStorage` (`:90`), not on the lightning flag. It hashes the
   whole file, hashes that hash again, and fetches `hubURL + '/rs/assets/' + <double hash> + '.png'`
   (`CharXSkippableChecker`, `upstream/main:src/ts/process/processzip.ts:442-447`). The PNG probe is not
   double-hashed; the `.charx` probe is. What the importer then does on success (`skipSaving`) or failure
   (`hashSignal`) is the investigator's reading; the writer read only where `characterCards.ts:131-135`
   sets the two fields.
3. **"Referenced remotely" is true only of the recorded string.** The stored value is an ordinary
   local-form path whose bytes were never saved locally. By the investigator's reading, it resolved only
   through the account-storage fallback. This fork removed that in `87b974e5`, which deletes
   `src/ts/storage/accountStorage.ts` (the writer read the commit's file list and diff; not the
   fallback's read path in full). Without account sync, such a path is a missing asset.

**Is any part meaningful without account sync? No, as written** (investigator). The mechanism is "ask a
server whether it holds these bytes". The only locally meaningful part is the idea underneath: `saveAsset`
names an asset by the hash of its content (`src/ts/globalApi.svelte.ts:475-486`), so "already stored" is
decidable locally. That is a different feature (E4 below).

**Removed here.** `87b974e5` (2026-09-26) deletes the setting, the database field and its type, the two
call-site arguments and the PNG-chunk branch (the writer read the commit's diff). The fork's `processzip.ts`
has no counterpart of `CharXSkippableChecker` (the investigator's diff against upstream; the existing
bullet "No hub-side hash check remains" above says the same).

**What the maintainer and the Orchestrator said (2026-10-01; `MC-151` 6).** The maintainer: upstream
provides a faster Realm import as the experimental "lightning realm import", and it could come back if it
was removed, since it is an official feature. The Orchestrator then told the maintainer that it cannot
return as it was, because it needs account sync, and that its local analogue is a content-hash dedup
against locally stored assets. The maintainer did not dispute that. What form it takes in this fork is not
decided.

### The community fast-import plugin: an idea source only

**Rule.** `MC-133` records that other forks feed ideas and are not code to port. The same rule applies by
analogy to this plugin, and the maintainer said so for it directly (`MC-151` 6): build something similar
natively, do not port the plugin, because it was "more of an experiment" with few reports of data loss or
imperfect lorebook and asset loading.

**Handling.** The plugin is third-party work in the gitignored evidence folder (note at the end of this
file). This entry describes its techniques in the writer's own words and quotes no code at length; it names
three host-API call shapes (`getDatabase(['characters'])`, `setDatabaseLite({characters})`,
`setCharacterToIndex` with `'length'`). The writer did
not open the plugin. Every statement about it below is the investigator's reading of the plugin source
(`fast-character-import-v3_2.0.0.js`), labelled as the investigator labelled it. TRACED means read in
that source; INFERRED means reasoning.

**Techniques, what each replaces, and the risk.** Risk means how plausible the technique is as a cause of
data loss (DL), a missing or partial asset (MA) or an imperfect lorebook (LB).

| # | Plugin technique | Native step it replaces | Risk | Safe native equivalent (non-normative) |
|---|---|---|---|---|
| T1 | Reads the whole PNG into memory once, walks the chunk table by index; no stream, no second pass | The two-pass `readGenerator` stream | Whole file resident; native streams on purpose (`8541258a`). No loss. TRACED | E1 |
| T2 | Decodes base64 straight from the PNG byte range, with no string and no `Buffer.from` | Per-chunk string decode plus `Buffer.from(..., 'base64')` | A lenient decoder skips invalid characters; an empty result becomes a "skipped" asset, and a skipped asset that the card references fails the import loudly. MA, low. TRACED | E1 (decode from bytes) |
| T3 | Up to 128 concurrent `saveAsset` calls, with in-flight and pending byte caps | The sequential PNG save loop; the `.charx` semaphore, which has no byte cap | Failures are retried, then the file aborts. Over-driving a server is possible. DL none; MA only after exhausted retries, and loud. TRACED / INFERRED | E2 (10, not 128) |
| T4 | Retry with backoff and shrinking concurrency | Nothing on the PNG or `.charx` path (the `.risum` import has 3 retries) | A write is safe to repeat because assets are content-addressed. A string error counts as retryable by default. Low. TRACED | E2, optional |
| T5 | Copies each buffer before `saveAsset` | Nothing | The copy is TRACED. Its purpose, avoiding detaching a buffer shared across the iframe bridge, is INFERRED (the bridge collects transferables, `src/ts/plugins/apiV3/factory.ts:116-135`, `:250-266`). One extra copy per asset. None | Not needed natively |
| T6 | Parses `.charx` with its own zip code: merges chunks once, yields every few chunks, has entry-count and size limits | `CharXImporter` | Same as native for correctness. None. TRACED | E5 (backpressure only) |
| T7 | Appends one character through the V3 host API (`setCharacterToIndex` with the index `'length'`), then checks `characterOrder` | `db.characters.push` (already one element) | Depends on a host quirk (below). Fine on the fast path. TRACED | Nothing to port |
| T8 | **Whole-array fallback:** `getDatabase(['characters'])`, then `setDatabaseLite({characters})` | n/a | **DL, the highest.** TRACED mechanism; the race itself is INFERRED | Never |
| T9 | Skips `db.statics.imports += 1`, the per-asset alert and the `sleep(10)` loops; has its own throttled progress | `characterCards.ts:78`, `:130`, `:722`, `:744-746`, `:771`, `:814-816` | None (a statistic only). TRACED | E3 |
| T10 | **Swallows a `module.risum` parse failure** | `readModule` | **LB (and triggers, regex): a real, silent divergence.** No concrete trigger found. TRACED | Keep native's loud failure |
| T11 | A second copy of `convertCharbook` | `convertCharbook` (`characterCards.ts:1006-1111`) | Identical today. A frozen copy can drift if native changes. LB, future. TRACED | One shared implementation |
| T12 | Saves V2 inline assets one at a time, and loses the file extension | The V2 loops (`:714-795`) | MA, low: every asset becomes `.png`, as native already does for PNG-chunk and `.charx` assets. TRACED | n/a |
| T13 | Asks consent before its fallback; refuses encrypted (`rcc\|\|`) PNGs | n/a | A visible refusal; no loss. TRACED | n/a |
| T14 | **Absent:** hash dedup or any lightning-style skip. The investigator's search of the plugin finds no hashing, no network call and no existence check | Nothing exists locally | n/a. This refutes the premise that the plugin does dedup (P2). | E4, with its own invariants |

**The strongest data-loss candidate (T8, TRACED mechanism, INFERRED occurrence).** When its probe of the
list length does not return `undefined` (an empty list), when the call throws, or when the check on
`characterOrder` does not find the new `chaId`, the plugin takes a snapshot of every character and writes
the whole array back with `setDatabaseLite`. Anything written to any character between the read and the
write, such as chat messages or a generation in flight, is overwritten. The plugin warns about this itself
and skips its consent prompt only when the list is empty. Whether the community reports involved the
fallback is unknown (it needs the reports). **Fork-specific, UNTRACED:** the fallback passes whatever
`getDatabase` returns for an archived character (a placeholder) back through `setDatabaseLite`. The
investigator did not trace how this fork's `setDatabaseLite` treats placeholders. It only matters if the
fork ever documents the plugin as supported.

**The host quirk behind T7 (TRACED, re-read by the writer).** `getCharacterFromIndex` and
`setCharacterToIndex` look the key up with `Object.keys(db.characters)[index]`
(`src/ts/plugins/apiV3/v3.svelte.ts:981-1013`). For `index === 'length'` that expression is the array's own
`length`, a number N. For N > 0 it is truthy, so `characters[N] = char` appends. The same idiom is on
`upstream/main` (the investigator's reading), so it is not fork-specific. The fork's `setCharacterToIndex`
also runs `incomingCharacterRefusal`, `fillMissingCharacterInstallIds` and two duplicate-id warnings
(`:1003-1010`). If the V3 API is ever given a bounds check, the plugin would drop silently to the T8
fallback. The idiom must not be copied.

**The swallowed module parse (T10, TRACED).** A native `.charx` export puts triggers, regex and the
override lorebook in `module.risum` (`characterCards.ts:1470`). The plugin's reader returns nothing on any
parse failure, with only a console warning, and the card is then built without those triggers, regexes and
that lorebook. It falls back to the card's own `character_book`, which in a native export may be absent or
stale. Native refuses loudly: `readModule` calls `alertError` on a bad magic number, version or type
(`modules.ts:145-167`), and `characterCards.ts:102-105` would then throw on `md.trigger`. The plugin's
embedded RPack map is byte-identical to `src/ts/rpack/rpack_map.bin` (the investigator compared the 512
entries; 0 differ), so decoding agrees, and the risk is only the swallow. UNCERTAIN whether any real card
hit it: no concrete trigger was found.

**The lorebook conversion matches native (TRACED, by reading both).** The plugin's `convertCharbook` and
native `convertCharbook` (`characterCards.ts:1006-1111`) produce the same 13 output fields, the same
`@@probability`, `@@depth`, `@@role`, `selectiveLogic`, `@@activate_only_after` and `@@match_*` rewrites,
the same `use_regex` reset and the same `loreExt = charbook.extensions`. The differences are tolerance:
the plugin accepts `entries` as an object and tolerates missing `keys` and `content`, and copies
`extensions` where native mutates the card in place. The character object differs from native in four
fields, and none loses data: `ttsMode` is `''` against native `'normal'` (both appear to fall through in
`tts.ts`, INFERRED), `customModuleToggle` is `''` against `{}`, `characterVersion` is `''` against the
string `'undefined'`, and the plugin sets `type: 'character'` where native `importCharacterCardSpec`
(`characterCards.ts:918-986`) sets no `type`. So a lorebook discrepancy is not explained by the conversion itself. Whether the
lorebook reports predate a native `convertCharbook` change is not checked (uncertainty 6 below).

**A "missing asset" report is not explained by a skipped await (TRACED).** The plugin awaits all saves
before it builds the character and throws if any failed, and it appends the character only after that. A
failed save aborts that file, leaving orphan assets, never a partial character. It does import less than
native without failing loudly in some cases: an unreferenced PNG-chunk asset it cannot decode, or over 50
MB, is dropped (a referenced one fails the import loudly), and it reads uncompressed `tEXt` and `iTXt`
chunks where native reads `tEXt` only (`pngChunk.ts:198`).

**Which of these plausibly explain the reports (the investigator's ranking).**
- Lost data: T8 (TRACED mechanism, INFERRED occurrence). Nothing else traced explains loss: no skipped
  await, no swallowed save error, no unmarked write.
- Partial lorebook: T10 only, and only if a `module.risum` failed to parse (UNCERTAIN). T11 is identical
  today.
- Missing assets: the investigator could not trace a silent mechanism. Server limits abort loudly, the
  extension change is not a loss and orphan assets are not missing assets. The reports may describe the
  plugin running against a host version the investigator did not read.

**Do not reproduce:** the `'length'` index idiom, the whole-array fallback, a swallowed module parse
failure, a second copy of `convertCharbook`, or 128-way concurrency.

### The native cost model of a local import

All "where the time goes" statements are INFERRED unless a trace is stated. **Nothing here was timed on
the real app.** The one measurement is a replica, described under F1.

- **F1. PNG: the read stream's `slice()` copies the whole retained buffer on every call (TRACED; replica
  timings only).**
  - `AppendableBuffer.slice` returns `this.buffer.slice(...)` (`src/ts/globalApi.svelte.ts:2593-2595`).
    The `buffer` getter is `this.#buffer.slice(0, this.#byteLength)`, a copy of the whole retained buffer
    (`:2553-2555`). `deappend` copies the remainder (`:2581-2585`).
  - `readGenerator`'s stream branch calls `readableStreamData.slice(start, end)` (`src/ts/pngChunk.ts:166`)
    three times for a `tEXt` chunk: the 4-byte length, the 4-byte type and the body (`:182`, `:184`,
    `:199`). It drops 50000 bytes per call, and only while `start - deapended > 200000` (`:168-170`). At
    most about 150 KB therefore drains per chunk.
  - An asset chunk larger than that grows the retained buffer by its size minus about 150 KB, and every
    later slice copies all of it. A `File` input takes this stream branch (`pngChunk.ts:134-141`). The UI
    path hands `importCharacter` files from `selectFileByDom` (`src/ts/util.ts:227-262`) to
    `importCharacterProcess` as `File`s (`characterCards.ts:40-43`).
  - **Replica, not the real module.** The investigator ran a copy of the `AppendableBuffer` and `slice`
    logic in a scratch script (Node v24.19.0, not Chromium; 64 KB stream chunks the investigator chose; one
    pass; one machine). Bytes copied per file byte rose with the asset count: 160x for 50 x 1 MB, 320x for
    100 x 1 MB and 641x for 200 x 1 MB, taking 1.2 s, 4.7 s and 19.2 s. That is quadratic. 400 x 250 KB
    (100 MB) gave 595x and 8.8 s. 50 x 100 KB (5 MB, below the drain rate) gave 15x and 25 ms, so small
    assets under about 150 KB are not affected. The script is not in the repo.
  - **Consequence (INFERRED):** for a PNG card with assets of a few hundred KB or more, buffer copying can
    exceed the save cost, and neither a semaphore nor dedup touches it. These are best-case desktop
    figures; the hardware floor is a Raspberry Pi 3 and mid-range phones (`MC-003`), and
    `Agents/Tools/README.md` records that campaign measurements ran on an i9-13900K. Needs the measurement
    in uncertainty 1 before anyone quotes a number. Filed as Roadmap CHORE-58.
- **F2. PNG reads the file twice, and the first pass is overhead (TRACED).** A "prereader" runs
  `readGenerator` over the same file, or a `tee()` of the stream, only to count `chara-ext-asset_` chunks
  for the progress percentage (`characterCards.ts:139-163`). It is created without `returnTrimed` (`:151-153`),
  so it never yields the trailing buffer and its `break` (`:156-158`) never fires: it scans to the end,
  decoding every `tEXt` body, asset chunks included, into a string and discarding it (`pngChunk.ts:198-209`),
  and it pays F1 on every chunk. The real pass (`characterCards.ts:166-210`) then repeats the read, decodes
  each asset chunk to a string again and base64-decodes it (`:193`). INFERRED: this is a larger share of
  the time than hashing.
- **F3. PNG saves are strictly sequential; `.charx` saves are not (TRACED).** PNG: `await saveAsset(...)`
  inside the chunk loop (`characterCards.ts:207`), with one progress alert per asset (`:195-203`).
  `.charx`: `Semaphore(10)` (see "What already exists"); completion is awaited at `importer.done()` before
  the spec call (`:111-112`).
- **F4. Per-asset cost inside `saveAsset`, by backend (TRACED).**
  - `hasher()` is `crypto.subtle.digest('SHA-256')` plus hex (`src/ts/parser/parser.svelte.ts:1035`). If it
    throws, `saveAsset` uses `uuidv4()` (`globalApi.svelte.ts:481-485`); a non-secure origin such as a
    plain-HTTP LAN host is the likely cause (INFERRED). Then Tauri `writeFile` (one IPC per asset), or
    `forageStorage.setItem` (`autoStorage.ts:75-78`). There is no existence check and no dedup: identical
    bytes are written again on every import, under the same key.
  - Node server, per `setItem` (`src/ts/storage/nodeStorage.ts:93-132`): a key-pair read, a JWK export and
    an ECDSA signature (`createAuth`, `:34-59`) and a `fetch` POST. Server side (`server/node/server.cjs`,
    `/api/write` at `:1495-1616`): every write goes through one global queue (`withRevisionTransaction`,
    `:96-101`), bumps the key's revision and rewrites `save/__revisions.json` whole through a temp file
    and rename (`saveRevisions`, `:74-83`, called at `:1565`), then writes the asset through a temp file
    and rename (`:1585-1599`).
  - INFERRED: the per-write revisions rewrite grows with the number of stored keys and cannot run in
    parallel, so a large library slows every asset write and caps the gain from concurrency, and a
    re-import of identical bytes pays it again. The server's own comment calls this bookkeeping "comparatively
    cheap" (`:92-95`); nothing measured it. The rate limit is 2000 requests a minute on
    `authenticatedRouteLimiter` (`:170-172`), which also bounds how fast a client can push assets.
  - Consequence: the best native speedup may differ per backend; Tauri and the Node server need separate
    measurement.
- **F5. `.charx` import has no backpressure (TRACED by the investigator; the writer re-read the queue).**
  Each file is accumulated through an `AppendableBuffer` (`append` doubles its backing array, so no
  quadratic copy) and read once with `.buffer` (`processzip.ts:344`, `:355`). The semaphore sits inside
  `#processAssetQueue` (`:383-400`), so it only gates the saves: nothing in the code read waits on it while
  more entries are extracted, so extracted asset buffers can queue in memory while 10 are written
  (INFERRED from that reading). Copying the semaphore to the PNG loop without a bound on pending bytes
  would repeat this.
- **F6. Fixed sleeps in the V2 and V3 import loops (TRACED).** `await sleep(10)` at the start of the PNG
  path (`characterCards.ts:130`), once per emotion (`:722`), once per VITS key (`:771`), and on every
  100th additional asset or V3 asset (`:744-746`, `:814-816`). Each loop also posts an `alertStore` update
  per item. The emotion and VITS sleeps total 10 ms times the item count; a card with 300 emotions of any
  form would sleep for 3 s (INFERRED from the constant). The V2 loops run for any `chara_card_v2` card
  with risuext data (`characterCards.ts:714-715`, `:736`, `:763`). The `sleep(10)` at `:722` and `:771`
  runs before the `__asset:` check (`:723`, `:773`) and the alert posts per item, so `__asset:` references
  still pay the sleep and the alert. Only the inline `saveAsset` and `getHubResources` calls need inline or
  Realm data.
- **F7. The stored shape is the same on every path, and `.png` is the usual extension (TRACED).** The PNG
  chunk path (`characterCards.ts:207`) and the `.charx` path (`processzip.ts:389`) call `saveAsset(data)`
  with no file name, so each asset is stored as `assets/<sha256>.png` whatever its real type. Only V2 inline
  `additionalAssets` pass a file name (`characterCards.ts:759`); the extension is then `fileName.split('.').pop()`
  (`globalApi.svelte.ts:488-490`). Consequence: a dedup key must be the full stored path, not the bare hash.
- **F8. Ordering invariants native already holds (TRACED).** For PNG, all chunk saves finish inside the
  loop before `importCharacterCardSpec` (`:166-210`, then `:292`). For `.charx`, `await importer.done()`
  (`:111`) comes before the spec call (`:112`). The character is pushed only at `db.characters.push(char)`
  (`:1000`). A failed save throws before the push, and the assets already saved stay behind as orphans;
  the startup clean-up (`cleanChunks`, `src/ts/bootstrap.ts:592`) has an asset sweep. The startup sweep
  returns early when the root `db.coldstorage` is set and no manual clean-up was requested (`:628-630`), and
  `sweepAssets` is false for any profile holding a cold-storage stub (`:637`). For those profiles only the
  manual clean-up deletes assets (`MC-149` 2). `:717-726` is the forage branch; Tauri is
  `sweepTauriAssets` (`:645-653`). What the sweep deletes was not re-read for this entry.
- **F9. `returnCharacter` works only on the `.charx` branch (TRACED).** The `.charx` call passes
  `f.returnCharacter` (`:112`); the PNG branch's calls to `importCharacterCardSpec` do not (`:250`, `:267`,
  `:292`), and the option's own comment says so (`:55`).

**Blast radius (counted by the investigator; the writer re-ran the first three counts below).**
- `AppendableBuffer` in non-test `src`: 23 occurrences in 8 files (`characters.ts` 2, `characterCards.ts` 4,
  `globalApi.svelte.ts` 3, `persona.ts` 2, `pngChunk.ts` 4, `process/modules.ts` 2, `process/processzip.ts`
  4, `lib/Playground/PlaygroundSubtitle.svelte` 2). None is under `src/ts/drive`, so a local backup or
  restore does not use it. Of the sites the writer read, only `readGenerator`'s `slice` pattern calls the
  copying `slice`; `processzip.ts`, the `modules.ts` export and `VirtualWriter` call `append` and read
  `.buffer` once.
- `PngChunk.readGenerator(` call sites in non-test `src`: 5 (`characters.ts:144`, `characterCards.ts:151`,
  `:166` and `:1422`, `persona.ts:110`). Only the two in `importCharacterProcess` take the `File` stream
  branch with large assets (the investigator's reading).
- `saveAsset(` call sites in `characterCards.ts`: 8 (`:207`, `:287`, `:640`, `:695`, `:732`, `:759`,
  `:782`, `:843`). Other non-test callers in `src/ts`, named by the investigator: `processzip.ts:389`,
  `modules.ts:47` and `:195`, `transformers.ts:182`. Not callers: `database.svelte.ts` is an import alias
  (`saveAsset as saveImageGlobal`, re-exported as `saveImage`), `plugins.svelte.ts:909` is a definition that
  calls `saveAsset` at `:910`, and `apiV3/v3.svelte.ts:875` is the alias `saveAsset: oldApis.saveAsset`
  (the writer re-read these). The `src/lib` call sites, which the investigator's list did not cover (the
  writer's Grep, 2026-10-01): `Sidebar.svelte:681`, `CharConfig.svelte:607` and `:942` (through the
  `saveImage` alias), `AssetInput.svelte:47`, `OtherBotSettings.svelte:518`, `:598` and `:900`, and
  `ModuleMenu.svelte:263`. A change to `saveAsset`'s semantics reaches all of them; a dedup in the import
  loops reaches only the import paths.
- **Per-asset save-loop marks are not a cost to batch (single-character import; the investigator's finding,
  refuting a premise).** Assets are not database blocks and nothing marks per asset. The only mark is one
  identity-tracker effect on the new character (`src/ts/storage/dbChangeEffects.svelte.ts:410-431`:
  `appendIfAbsent` plus `markChanged`), which also covers `db.characters.push`. It scans all N characters
  per change to the array (O(N), small next to asset I/O) and runs once per file in `importCharacter`'s
  loop (`characterCards.ts:39-45`). There is nothing to batch, so this is not on the idea list.

### Safe native equivalents (non-normative)

These are the investigator's candidates, not a plan. Nothing here is approved or scheduled, and any of them
would go through the plan gate first.

**Invariants every one must keep.**
- I1: every asset is saved before the character is pushed (F8).
- I2: a save failure aborts the import before the push, with a reportable error.
- I3: the stored asset path is unchanged, `assets/<sha256>.<ext>` from `saveAsset`, so upstream-compatible
  `.bin` files and characters keep working.
- I4: the imported `character` object is deep-equal to today's for the same input, lorebook included.
- I5: no change to the save format.

- **E1. Remove the quadratic stream copy and the wasted first pass (PNG).** The highest expected value for
  PNG cards with assets over about 150 KB (F1, F2). Keep streaming, because `8541258a` ("Improve
  performance of PNG card imports", 2025-08-11) introduced the `File.stream()` read path for large files
  on mobile; it is on `upstream/main` too. Invariants:
  - `readGenerator` yields byte-identical `{key, value}` and trimmed-image buffer, including across
    stream-chunk boundaries and for chunks larger than the stream chunk;
  - `readGenerator` is shared by `persona.ts:110`, `characters.ts:144` and the export at
    `characterCards.ts:1422`, so those need the same regression coverage;
  - change `slice` and `buffer` semantics only by adding a non-copying read, not by altering `get buffer()`,
    because of the 23 occurrences above;
  - draining faster fixes F1 but changes peak memory, so it needs a peak-memory check on a large file;
  - a base64 decode from bytes (T2) must be byte-identical to `Buffer.from` on valid input;
  - progress can use bytes read over file size instead of an asset count, which removes the prepass.
  A test that fails on today's code is proposed (a synthetic PNG with 100 x 1 MB `tEXt` chunks); it was
  not run against the real module.
- **E2. A semaphore for the PNG asset loop, with a pending-byte bound** (the `.charx` pattern plus
  backpressure). Take the permit before decoding the next chunk so memory stays bounded; settle every save
  before the spec call; collect errors as `CharXImporter` does (`processzip.ts:383-400`). Keep the limit at
  10, not the plugin's 128. Results are keyed by chunk index, so order does not matter. Invariants I1 and
  I2. A prior attempt had an infinite-wait bug when failures did not count towards completion: `63c365d7`
  (2026-01-08) replaced a 128-line `AssetSaveQueue` with the `Semaphore`, and `b70dd82b` (the same day)
  fixed an infinite `done()` wait when `saveAsset` or `hasher` failed. The counting therefore needs a test
  for the failure path. Honest limit: concurrency pays on Tauri IPC and Node HTTP latency; on a
  single-writer backend such as LocalForage the gain is smaller (INFERRED).
- **E3. Drop the flat 10 ms sleeps and throttle the per-item alerts** (`characterCards.ts:130`, `:722`,
  `:771`; every 100th in the other two loops). The UI must still repaint (yield every N items or by time,
  as the 100-item loops do) and progress must still reach completion. The sleeps incidentally yield to the
  UI, so remove one only where the awaited `saveAsset` already yields, or where a periodic yield replaces it.
- **E4. A local content-hash dedup (skip a write whose key already exists).** This is the local analogue of
  Lightning Realm Import. It is meaningful only locally and only under these constraints:
  1. It needs a real hash. With `crypto.subtle` unavailable, `saveAsset` falls back to `uuidv4()`
     (`globalApi.svelte.ts:481-485`), so there is nothing to compare and no dedup.
  2. The existence test should be one listing per import, not a per-asset read. `AutoStorage` has
     `setItem`, `getItem`, `keys` and `removeItem` (`autoStorage.ts:75-92`) and no existence check; the
     Node server's routes are `read`, `write`, `list` and `remove` (`server.cjs:1210`, `:1495`, `:1478`,
     `:1279`). A listing of tens of thousands of keys can cost more than saving a few small assets, so
     gate it on asset count or size (INFERRED). Tauri would use a directory listing, as the backup loop
     does. LocalForage `getItem` returning the whole blob is the investigator's reading.
  3. Skipping makes an existing corrupt file permanent. A re-import overwrites it today. Tauri `writeFile`
     is not atomic (Roadmap CHORE-55's mechanism), and `assetIntegrity.ts` verifies only the cached copies
     in the browser cache (`caches.open('risuCache')`), not storage. So a skip should compare size, or
     accept that a torn file stays until the next verify.
  4. The key includes the extension (F7): compare the whole path.
  5. Concurrent identical writes are already harmless (content-addressed; the Node server has a per-key
     lock, `server.cjs:103-132`), so a check-then-write race is harmless for the same reason.
  6. Never record a path whose bytes were not stored locally. That is exactly the premise-1 failure after
     sync removal.
  Invariants I1 and I3.
- **E5. Backpressure for the `.charx` importer:** stop feeding the unzip while too many buffers are
  pending. Invariant I1; no change to which entries are saved.
- **E6. Server-side write cost (Node server).** The per-write `__revisions.json` rewrite (F4) is a server
  concern outside `src/`. Changing it touches the storage conflict protocol (`if-match-revision`) and the
  Hono mirror, so it is a separate, higher-risk item, not part of an import fix. Flagged only. Whether
  `server/hono` has the same bookkeeping was not read.

### Relation to QOL-08

A re-import of an updated card re-saves mostly identical assets: each costs a hash and a write, and on the
Node server a revision bump and a `__revisions.json` rewrite (F4). So E4 (and E2) is where QOL-08 benefits
from QOL-04, and an update flow that keeps the old character's assets would make most saves skips. Dedup
matters more to QOL-08 than to a first import, because a first import has no identical stored assets.
Two coupling points the investigator found:
1. QOL-08's update flow built on `importCharacterProcess` could use `returnCharacter` only for `.charx`
   (F9). PNG and JSON would need the same return path first. QOL-08 does not mention this prerequisite.
2. Replacing a character orphans its old assets until a sweep runs (for profiles with archived characters,
   the manual clean-up) (F8).

### Uncertain, and what would settle it

1. **Whether F1 is the dominant PNG cost in the real app.** The replica is Node, 64 KB chunks, one pass.
   Settle it with either:
   - a live-app run on the browser-pane protocol of `Agents/Tools/README.md`: import a synthetic PNG card
     (N assets x L bytes, for example 100 x 1 MB, 400 x 250 KB and 50 x 100 KB), timing the prereader loop,
     the main loop and the cumulative `saveAsset` time separately, on each of Node server, OPFS,
     LocalForage and Tauri; or
   - extracting `AppendableBuffer` so a Vitest `.harness.ts` can run the real `readGenerator`. The existing
     `save-gen` harness measures `$state.snapshot` only and does not fit; the pattern and
     `Agents/Tools/vitest.harness.config.ts` do.
2. **The Node server's per-write cost against the number of stored keys.** Time `/api/write` for a fixed
   100 KB body at 0, 1k, 5k and 20k existing `assets/` keys, and record the size of
   `save/__revisions.json`. Also whether `server/hono` has the same bookkeeping (not read; `AGENTS.md` calls
   it "future").
3. **What the community reports say.** Format (PNG, `.charx` or JSON), platform, which asset types,
   whether the fallback dialog appeared, whether a `module.risum` warning was in the console, the plugin
   version and the host version. Without that, T8 and T10 are candidates, not causes.
4. **Chromium's `File.stream()` chunk size.** It affects the constant in F1, not the quadratic shape. A
   real-browser run settles it.
5. **How this fork's `setDatabaseLite` treats archived-character placeholders on the plugin's fallback
   path.** It only matters if the fork documents the plugin as supported.
6. **Whether the lorebook reports predate a native `convertCharbook` change** (the plugin is a frozen
   copy). `git log -S` on `convertCharbook` in upstream history, against the plugin's date, would settle
   it. Not done.

### Still unverified

- Where backup time goes. Nothing here was measured.
- Whether `LocalWriter.writeBackup` tolerates overlapping calls. It was not opened for this entry.
  `TODO(evidence)`.

---

## QOL-05 — Export an installed plugin

**Status:** idea. Confirmed gap, narrow and self-contained.
**Raised by:** yor42, 2026-10-01.

> "you can export character, prompt preset, modules, etc. but you can't export the plugin."

### What already exists

Export exists for most other things a user builds or configures:

| Item | Export function | Reached from |
|---|---|---|
| Character | `exportChar` (`characterCards.ts:629`) | `CharConfig.svelte:738`, the `language.exportCharacter` button (`:739`) |
| Prompt preset | `downloadPreset(i, 'risupreset')` (`database.svelte.ts:2303`) | `botpreset.svelte:231` |
| Module | `exportModule` (`modules.ts:38`) and `exportModuleLegacy` (`modules.ts:62`) | `ModuleSettings.svelte:99` and `:102` |
| Lorebook | `exportLoreBook` (`lorebook.svelte.ts:811`); a second entry point is the local `exportLoreBook` in `ModuleMenu.svelte` (`:82`) | `LoreBookSetting.svelte:127`; `ModuleMenu.svelte:216` |
| Regex scripts | `exportRegex` (`scripts.ts:32`) | `CharConfig.svelte:704`, `RegexList.svelte:94`, `GlobalRegex.svelte:24`, `ModuleMenu.svelte:238` |
| User persona | `exportUserPersona` (`persona.ts:54`) | `PersonaSettings.svelte:142` |

Several of these save through the shared helper `downloadFile` (`globalApi.svelte.ts:74`).

For plugins, the pieces an export would need are already in place:

- A plugin is a `ProviderPlugin` interface (`plugins.svelte.ts:27-40`), aliased as `RisuPlugin` (`:46`), stored in `db.plugins`. Its source is the
  `script` field (`plugins.svelte.ts:375`). `plugins` is its own save block
  (`risuSave.ts:343-347`; decoded at `:1026`).
- The plugin list has per-row actions for update (shown only when the plugin has an `updateURL`
  and a newer version exists), enable or disable, and remove with a confirm
  (`PluginSettings.svelte:77-133`). Below the list are an import button and a menu with "Import
  plugin with hot reload" and "Download plugin template" (`:245-276`). The template entry is a
  static starter file, not an export of an installed plugin.
- **Suspected bug in that template entry, from reading only (not run).** Its `case 1` builds an
  anchor to `/plugin_start.7z` with `download = 'plugin_starter.7z'` and appends it to the page, but
  never calls `click()` on it (`PluginSettings.svelte:265-270`), so choosing it may download nothing.
  `public/plugin_start.7z` exists. Upstream/main `f9728b14` has the same lines (text search of
  `git show`; upstream not run). This is a note in passing, not a finding of this entry.
- A search over non-test `src/` for `exportPlugin`, "export plugin" and plugin-plus-export or
  plugin-plus-download names finds no plugin export function (writer's Grep, 2026-10-01).

### What is missing

An action that writes an installed plugin back out as a file. Import is a single `.js` or `.ts`
file (`plugins.svelte.ts:153`, see QOL-02), so a user who has lost the original file has no way to
get the installed copy out, or to hand it to someone else.

### Design considerations (considerations, not findings)

- **What to export.** `importPlugin` rebuilds the plugin's name, display name, arguments, links,
  version, update URL and allowed IPC by parsing `//@` header lines in the file
  (`plugins.svelte.ts:167-326`). So exporting `script` verbatim as a `.js` file would go back
  through the existing importer with no new format. For a plugin imported as `.ts`, `script`
  holds the transpiler's output (`plugins.svelte.ts:345-347`, `:375`). Whether the header lines
  survive transpiling was not checked.
- **Plugin arguments and secrets.** The values a user types into a plugin's arguments live in
  `realArg` (`plugins.svelte.ts:263,267`; edited at `PluginSettings.svelte:167-232`). Whether a
  given plugin's arguments hold secrets such as API keys depends on the plugin; nothing in source
  says. An export should not silently include `realArg`. There is a precedent in this app: the
  preset export blanks its key and URL fields before writing (`database.svelte.ts:2308-2313`).
- **Compatibility.** A verbatim script export adds no format. Anything that carries metadata or
  settings beside the script would be a new shared format and would need a fallback for clients
  that do not read it (the rule at the top of this file).

---

## QOL-06 — "Empty all" in the trash

**Status:** idea. Partially built already. **Read the cross-references before designing it:** the
trash's delete path has open data-loss findings.
**Raised by:** yor42, 2026-10-01.

> "\"empty all\" button in trash menu with confirmation prompt"

### What already exists

- The trash is the third tab of the character grid catalog (`GridCatalog.svelte:99-101`, label
  `language.trash`; the list at `:161-189`, described by `language.trashDesc` at `:162`). It lists
  characters that have a `trashTime`, filtered by the search box (`formatChars`,
  `GridCatalog.svelte:36-58`).
- Each row has two actions: restore (`restoreCharacterFromTrash`, `:176-180`) and permanent delete
  (`removeChar(char.charRef, char.name, 'permanent')`, `:181-185`). There is no bulk action, and
  the Roadmap's CHORE-53 records that no bulk empty-trash action exists.
- `removeChar` (`characters.ts:865`) takes `'normal'`, `'permanent'` or `'permanentForce'`:
  - `'normal'` sets `trashTime` (`:908-909`); anything else splices the character out (`:912`).
  - For `'normal'` and `'permanent'` it asks two confirms (`:878` and `:882`), and the first adds
    a warning line when work is running in the character (`:877-878`).
  - `'permanentForce'` skips both confirms (`:867`) and has no non-test caller (writer's Grep).
  - Whatever the type, it stops the work bound to the character it removes (`stopWorkIn`,
    `:905-907`).
- Trash is also purged on its own: `checkNewFormat` in `bootstrap.ts` removes characters trashed
  more than 3 days ago (`bootstrap.ts:577-584`), with no prompt.

### What is missing

One action that permanently deletes everything in the trash, behind one confirmation.

### Cross-references and design considerations (considerations, not findings)

- **CHORE-53 and MC-150 (held-Enter delete data loss).** Community reports describe characters
  outside the trash being permanently lost when deleting from the trash with Enter held down
  (`MC-150` 1-3). One report says "emptied the trash", but no bulk action exists, so which path it
  was is unknown. CHORE-53 is the fix for the stale-target and Enter-clicks-the-control-behind-it
  defects, and it is scheduled right after memory stage 1 step 5 (`MC-150` 4). CHORE-53's fix
  direction (re-resolve each target after the confirm; Enter stops at the confirm) is the base such a
  feature would need. CHORE-53 does not examine a batch delete (it records that no bulk action exists).
  Build it on that fix, not before it.
- **MC-013.** The trash is known to be unstable among the community. A bulk path that deletes
  everything raises the cost of any remaining defect in it.
- **MC-129 (delete during work).** A confirmed delete stops all work bound to the deleted
  character, and the delete warns when work is running there (`MC-129` 1-2). A batch confirm
  would carry that warning itself if any character in the batch is busy. `'permanentForce'`
  skips the warning along with the confirms, and the per-row `'permanent'` path asks two confirms
  per character, so neither fits a single batch confirm unchanged.
- **Search filter.** The trash list is filtered by the search box (`GridCatalog.svelte:58`). Whether
  "empty all" means the whole trash or only the rows currently matching is a product choice, and
  the confirm should state a count.
- **Archived characters.** With cold-storage archiving, a trashed character can be an archive stub.
  `removeChar` itself only splices the entry and touches no cold-storage unit
  (`characters.ts:865-918`). Check how permanent delete treats an archived character's unit before
  building this; what happens to the unit afterwards was not checked.
- **No undo.** Once emptied, only a backup brings a character back.
- **Compatibility.** UI-only; no format change.

---

## QOL-07 — Gesture-driven reroll candidates and sidebar, with following animation

**Status:** idea. Partially built already. The arrow buttons and an animated sidebar exist; the
gestures and the finger-following animation do not.
**Raised by:** yor42, 2026-10-01.

> "more animations: like last messages being scrollable sideways when either swipe reroll is on or
> there is multiple reroll candidates, and side bar that also accepts gesture control, such as
> sliding right from the edge of screen opening sidebar, and tapping the edge of sidebar and
> sliding it to the left closing it with animation following the tap."

Three asks: (a) the last message scrolls sideways through candidates, (b) an edge swipe opens the
sidebar, (c) dragging the sidebar's edge closes it, with the animation following the finger.

### What already exists

- **Reroll arrows.** The `rerolls` snippet in `Chat.svelte` (`:1207-1225`) shows a left arrow
  (previous) and a right arrow (next or new) when `DBState.db.swipe` is on or the `altGreeting`
  prop is set; otherwise a single refresh button. First-message pages show `currentPage/totalPages`
  through the same arrows only when `firstMessage && swipe && showFirstMessagePages` (`:1213-1214`; props
  at `:61-62`). Every message is mounted with
  `rerollIcon: 'dynamic'` (`Chats.svelte:128`), and `.dyna-icon` is `display: none` except inside
  `.chat-message-container:first-of-type` (`styles.css:509-515`), so the controls show on the
  first DOM child, which the Roadmap notes is assumed to be the newest message (`Roadmap.md:281`).
- **The `swipe` setting shows arrow buttons, not a gesture.** It is the row `acc.swipe`
  (`accessibilitySettingsData.ts:27-33`), labelled "Use Swipe for Regeneration" (`en.ts:889`,
  key `SwipeRegenerate`), and defaults to on when unset (`database.svelte.ts:104-106`). A search
  for touch and pointer handlers over non-test `src/` finds none in `Chat.svelte`, `Chats.svelte`
  or `Sidebar.svelte`; the files it does find are `hotkey.ts`, `ResizeBox.svelte`,
  `SliderInput.svelte`, `HypaV3Modal*`, `PlaygroundImageTrans.svelte` and plugin API files
  (writer's Grep). So no swipe gesture exists on a message.
- **`initMobileGesture`** (`hotkey.ts:436-485`) is the only navigation gesture. It listens on
  `document` for `touchstart` (ignoring touches that start on BUTTON, INPUT, SELECT or TEXTAREA)
  and `touchend`. On `touchend`, a horizontal move of more than 50 px that is more horizontal than
  vertical steps `MobileGUIStack` (no character selected) or `MobileSideBar` (a character selected)
  by one. Nothing is drawn while the finger moves; the step happens on release. It is **beta-mobile
  and Lite only**: it is started only when `(db.betaMobileGUI && window.innerWidth <= 800)` or the
  Lite build is on (`bootstrap.ts:306-309`). Every other phone or narrow window uses the desktop
  layout (`App.svelte:220-237`) and gets no gesture at all.
- **Sidebar open and close.** In the desktop layout the sidebar opens from a small arrow tab at the
  left edge (`SideBarArrow.svelte:13-17`) and closes from the same tab, from an empty button at the
  top of the sidebar, and, when the window is 1024 px wide or less (`DynamicGUI`,
  `stores.svelte.ts:16`), from the dark overlay beside it (`Sidebar.svelte:950-960`, `:1000-1015`).
  It is animated by CSS keyframes (`sidebar-transition`, `sidebar-transition-close` and their
  `-non-dynamic` and `sub-sidebar-` variants, `Sidebar.svelte:1023-1134`) with the duration
  `--risu-animation-speed`. That duration is set by the display setting `animationSpeed`, a
  slider from 0 to 1 (`displaySettingsData.svelte.ts:222-230`, `animation.ts:5`), default 0.2 s
  (`styles.css:170`). The close finishes on `onanimationend` (`Sidebar.svelte:943-948`). It is
  time-based, not tied to a touch.
- **Candidate storage.** The reroll history is `rerolls: Message[][]` with `rerollid`, plain
  variables in the composer instance (`DefaultChatScreen.svelte:67-69`), not rendered. Generations
  that return several candidates keep them as strings in a module-level map in `prereroll.ts`.
  Only the current reply is in the chat itself.

### What is missing

- A sideways scroll or drag through candidates on the newest message.
- A touch gesture to open the sidebar from the screen edge (the existing gesture is
  beta-mobile/Lite only and acts on `touchend`).
- A drag on the sidebar that moves it with the finger and closes it on release.

### Cross-references and design considerations (considerations, not findings)

- **Candidate rendering and CHORE-43 / CHORE-54.** A sideways carousel needs the candidates to be
  available to render, and today only the current one is on screen. Who owns the reroll history is
  the first question, and it is the question CHORE-43 and the new CHORE-54 settle. The maintainer
  placed both right after CHORE-53 (`MC-151` 3). Roadmap CHORE-54 recommends fixing them in one change
  because they share the history's ownership (the Orchestrator's recommendation, not the maintainer's).
  CHORE-54 also records that
  moving between candidates currently overwrites an edited reply. Design the carousel after those
  land. The arrow-visibility CSS assumes the newest message is the first DOM child
  (`styles.css:513`; noted in the Roadmap at `:281`).
- **Gesture conflicts.** Under the beta mobile layout the document-level 50 px step would compete
  with a sideways scroll on a message (reading of `hotkey.ts:450-480`; not run). The sidebar
  rework in Phase 2 item 3 (Roadmap `:247`) and `MC-071`, which relays community reports of flaky
  long-tap and drag behaviour in the sidebar, are the nearest existing context.
- **Which layout.** The gesture exists only in the beta mobile layout and the Lite build, and the
  mobile layout's "sidebar" is a different component (`MobileBody.svelte:37-45`). Which layout or
  layouts this is for is a product decision.
- **Low-end cost.** The hardware floor is a Raspberry Pi 3 and mid-range phones (`MC-003`).
  Animation that follows a finger is per-frame work. The existing `animationSpeed` slider can
  reach 0, and a new animation would have to respect it.
- **Compatibility.** UI-only; no format change.

---

## QOL-08 — Update and replace an existing card or module

**Status:** idea. Every step of today's manual path exists; nothing joins them, and nothing matches an
incoming card or module to one already installed.
**Raised by:** yor42, 2026-10-01.

> "also, I think a path to 'update and replace' the existing card/module would be nice to have.
> currently when creators posts update to their bot, users have to manually backup chat, delete the
> old characters and modules, re-import new module/character, then restore their chats."

### What already exists

- **Chat backup and restore.**
  - `exportAllChats` writes every chat of the selected character, with its folders, as one JSON file of
    type `risuAllChats`, version 2 (`src/ts/characters.ts:559-578`; the button is at
    `src/lib/SideBars/SideChatList.svelte:426-428`). `exportChat(page)` exports one chat as JSON, TXT or
    HTML (`characters.ts:245-248`).
  - `importChat` (`:424-557`) reads `risuAllChats` and `risuChat` JSON (versions 1 and 2), JSONL and
    HTML. An imported chat gets a fresh id (`:498`, `:508`, `:526`, `:546`) and goes to the front of the
    selected character's chats (`:500`). A folder whose id already exists on the character gets a new id
    (`:481-489`).
- **Character import never matches an installed character.** `importCharacter` takes several files
  (`src/ts/characterCards.ts:32-50`) and calls `importCharacterProcess` (the call is at `:40-43`; `:52`
  is the definition), whose `.charx`, PNG and
  JSON branches all end in `importCharacterCardSpec` (`:687`). That always builds a new character with
  `chaId: uuidv4()` (`:936`) and one empty chat named "Chat 1" (`:923-929`), and appends it with
  `db.characters.push` (`:1000`). Off-spec cards take the same shape (`convertOffSpecCards`, `:567`,
  `chaId` at `:604`). `importCharacterProcess` and
  `importCharacterCardSpec` were read in full for this entry, and neither compares the incoming card
  with `db.characters`.
- **Realm import records an id that nothing reads.** On the JSON-card path, `downloadRisuHub` sets
  `extensions.risuRealmImportId` to the Realm id (`:1815`), and `importCharacterCardSpec` copies card
  extensions other than `risuai` and `depth_prompt` into the character's `extentions` (`:907-916`,
  `:967`). The PNG and `.charx` download branches return before that line (`:1789-1809`). A search of
  non-test `src/` finds `risuRealmImportId` only at that write. `creatorNotes`, `creator` and
  `characterVersion` are copied from the card (`:941`, `:946`, `:947`); the import code read here does
  not compare them. A character also has a `realmId`, set when the user uploads it to Realm
  (`src/lib/UI/Realm/RealmFrame.svelte:41`).
- **Module import never matches an installed module.** `importModule`
  (`src/ts/process/modules.ts:257-356`) picks one file (`:258`). Every path gives the module a fresh id:
  `.risum` through `readModule` (`:253`), a `risuModule` JSON (`:305`), lorebook and regex conversions
  (`:324`, `:335`, `:346`), and `.charx` through `convertCharacterToModule`
  (`src/ts/interchangeability.ts:68`). Each result is pushed onto `db.modules` (`:276`, `:288`,
  `:313`, `:326`, `:337`, `:348`). `getModuleById` (`:358`) is a lookup, not a duplicate check. A
  re-import is therefore a second module beside the old one.
- **Module bindings are mostly by id.** `getModules` (`:399-438`) joins the global list, the chat's
  list, the character's list, the persona's embedded module and the preset's `moduleIntergration`
  string (the five sources are in QOL-01's table). The global enable button stores the module's `id`
  (`src/lib/Setting/Pages/Module/ModuleSettings.svelte:87`), and the remove button removes the module
  and clears only its global entry (`:128-134`). So an id binding keeps pointing at the old module after a re-import.
  One exception: `getModuleByIds` selects a module whose `id` **or** `namespace` is in the list
  (`modules.ts:375-382`), so a binding that names a namespace would also match a new module with the
  same namespace. `namespace` is an optional creator-set field (`modules.ts:32`;
  `ModuleMenu.svelte:202-203`), and the `.charx` conversions carry it
  (`interchangeability.ts:22`, `:66`). Whether the chat-level and character-level toggles store ids
  or namespaces was not re-opened for this entry.

### What is missing

A way to say "this file is an update of that installed character or module", and to carry the user's
chats, folders and bindings across.

### Design considerations (considerations, not findings)

- **What the manual path changes, to verify before relying on any of it.**
  - Chat ids are new after import, so any reference to an old chat id stops resolving. What holds chat
    ids was not surveyed.
  - The imported chats go in front of the new character's empty "Chat 1", which stays.
  - A chat's own module list travels inside the exported chat, since `exportAllChats` writes whole
    `Chat` objects (`characters.ts:567-572`), and it names the old module ids (INFERRED from QOL-01's
    table; not run).
  - The character gets a new `chaId`. What refers to a `chaId` was not surveyed.
  - Local edits to the old character (bound modules, lorebook edits, settings, assets) are lost with
    it, because the manual path deletes it.
- **What "replace" keeps and what it takes.** Chats, chat folders, the `chaId`, module bindings and the
  user's own edits are the user's. The creator's fields are the update. Which side wins for each field
  is a product choice, and the confirm should show it.
- **Finding the target.**
  - The user picks it: an action on the installed character or module, "replace from file". It needs
    no matching and no new field.
  - Matching by a key: `risuRealmImportId` where it is set (JSON-card Realm path only); name, creator
    and `characterVersion`; for modules, `namespace`, or the `id` inside a `.risum` or module JSON file.
    The importer reads that id and then replaces it (`modules.ts:253`, `:305`), and the `.charx` module
    path carries none (`convertModuleToCharacter` copies no id, `interchangeability.ts:6-53`). Whether
    creators keep a module's id across updates was not checked.
- **Undo.** The old version could go to the trash rather than being removed. The trash purges old
  entries on its own and has open data-loss findings (see QOL-06; CHORE-53; `MC-150`), so this should
  be built on CHORE-53's fix.
- **Archived characters.** An archived character is a stub whose chats live in a cold-storage unit
  (memory stage 1; `MC-149`). How a replace treats a stub was not checked.
- **Work running in the character (`MC-129`).** A confirmed delete stops the work bound to the
  character, and warns when there is some (`MC-129` 1-2, as QOL-06 records). A replace that swaps the
  character under running work needs the same care.
- **Duplicate `chaId`.** The save path has a guard against two characters sharing a `chaId` (CHORE-28,
  Report 26). A replacement that keeps the old `chaId` must leave only one object in `db.characters`.
- **Compatibility.** Matching done locally needs no format change. A new "update key" written into
  cards would be an addition to a shared format and would need a fallback for clients that do not read
  it (the rule at the top of this file).
- **Related.** QOL-01 (a card declaring its module dependencies would let a card update reach its
  modules) and QOL-09 (a one-file character-with-chats export plus an "import as replacement" is one
  shape of this).

---

## QOL-09 — "Archive this character": one file holding the character and its chats

**Status:** idea. A character export and a chat export exist; no single file holds both.
**Raised by:** yor42, 2026-10-01.

> "I think we could also have \"archive this character\" button with dedicated format that exports
> both character and chats in single file."

### What already exists

- **Character export.** `exportChar` (`src/ts/characterCards.ts:629-656`), reached from
  `src/lib/SideBars/CharConfig.svelte:738` (see QOL-05), opens the export dialog (`cardexport`,
  `src/lib/Others/AlertComp.svelte:734-813`). The choices are RisuRealm; Character Card V3 with a format
  of CHARX, CHARX-JPEG, PNG or JSON (`:797-802`); and Character Card V2 as a PNG
  (`characterCards.ts:647-649`). For a group, `exportChar` returns without exporting (`:633-635`).
- **No character export carries chats.** A search of `characterCards.ts` for `chats` finds only the empty
  chat an import creates (`:591`, `:923`), and a search of non-test `src/` for `includeChats` and
  `withChats` finds nothing (writer's Grep).
- **Chats export separately.** `exportAllChats` writes all chats and folders of the selected character as
  one JSON file, and `importChat` reads it back onto the selected character with fresh chat ids (QOL-08
  has the cites).
- **A local `.bin` backup holds everything, but it is the whole database.** `SaveLocalBackup`
  (`src/ts/drive/backuplocal.ts:59-220`) writes every asset and the database entry, and
  `LoadLocalBackup` writes the restored database back as the main save (`:712-717`).

### What is missing

A single-character export that includes the chats, and the matching import.

### Design considerations (considerations, not findings)

- **The word "archive" is already taken.** Memory stage 1 uses it for cold storage. The setting is
  labelled "Archive characters at startup" (`src/lang/en.ts:1767`), bound to `archiveCharacters`
  (`src/ts/setting/advancedSettingsData.ts:164`; the label is `MC-149` 3, step 5a), and an archived
  character is a stub whose data the app restores when needed (for example when one of its chats is
  displayed: `preLoadChat`, `coldstorage.svelte.ts:639`, awaited at `DefaultChatScreen.svelte:826`). A user-facing "archive this character" export would
  use the same word for a different thing: a file the user keeps, against a state the app manages. A
  name such as "export with chats" or "character bundle" would avoid the clash. The name is not decided
  here.
- **Format and upstream compatibility.** A dedicated format is fork-only; upstream cannot read it. Anything
  additive to a format upstream reads needs an explicit fallback (the rule at the top of this file).
  Facts for a `.charx`-based shape:
  - A `.charx` is a ZIP. This fork's reader treats `card.json` and `module.risum` specially, ignores
    other `.json` entries, and saves every other entry as an asset (`src/ts/process/processzip.ts:354-378`).
    Entries over 50 MB are excluded (`:7`, `:333-359`).
  - Upstream/main `f9728b14` has the same routing (`processzip.ts:362-383`, read with `git show`;
    upstream not run).
  - So an extra entry named `*.json` would be ignored by both readers, and an entry with any other name
    would be saved as an asset on import, by reading. How upstream actually behaves on such a file was
    not run, and how large a character's chats get was not measured.
- **Scope.** All chats or the selected one; chat folders (which `exportAllChats` carries); whether the
  character's bound modules, or the modules' own data, go in the file (they are separate artifacts,
  QOL-01); persona binding of chats. A group cannot be exported today (`characterCards.ts:633-635`).
- **Archived characters.** `exportChar` reads `db.characters[charaID]` (`:630-631`). How it treats a
  character whose chats sit in a cold-storage unit was not checked.
- **Relation to QOL-08.** A bundle export plus an "import as replacement" is one shape of
  update-and-replace.
- **Relation to backup.** `MC-130` 3 says upstream compatibility for storage means an option to create a
  `.bin` backup that upstream can restore. A per-character bundle is a different artifact and does not
  meet that.

---

## QOL-10 — Persona embedded modules: a half-built upstream feature

**Status:** idea; half-built upstream; deliberately left inert in this fork. Decision recorded as `MC-207`.
**Raised by:** yor42, 2026-10-03. The maintainer called it "a leftover feature that is left
half-implemented" and asked for it to be parked here to come back to properly. See also CHORE-12 MOD-1
(`Agents/Roadmap.md`, CHORE-12, MOD-1) and `Agents/Reports/99-modules.md:38-45`.

### What already exists

- **A data field and a half-wired read path.** `RisuPersona.embeddedModule?: RisuModule`
  (`src/ts/storage/database.svelte.ts:807`). Upstream commit `0055f0cb` (kwaroran, 2026-06-09, "feat: add
  embbeded modules on persona", empty body) added three things: the persona lookup and
  `ids.concat([persona.embeddedModule?.id])` in `getModules` (`src/ts/process/modules.ts:421-423`), the
  `'$embedded'` branch in `getModuleById` (`modules.ts:366-371`), and `embeddedModule.id = '$embedded'` in
  `convertModuleToPersona` (`src/ts/interchangeability.ts:191`; the file is not under `process/`). The same
  commit protected the module's assets from cleanup. Upstream/main `f9728b14` has the same code (read with
  `git show`; upstream not run).
- **Why it is inert.** `getModules` appends the id, but `getModuleByIds` only filters `db.modules`
  (`modules.ts:375-382`), so the persona's own module object is never returned. Only `getModuleById`
  resolves `'$embedded'`, and its only caller is `applyModule` (`modules.ts:526`).
- **No UI or in-repo code path creates it.** `convertCharacterToPersona` and `convertModuleToPersona`
  (`interchangeability.ts:136`, `:174`) have no non-test callers at HEAD or in `upstream/main`
  (`git grep`). No `src/lib` file mentions `embeddedModule`. Persona PNG export and import
  (`src/ts/persona.ts:54-102`, `:104-141`) carry only `name`, `personaPrompt` and `note`. The data can
  arrive through a `.bin` restore, a plugin's database write (`'personas'` is in `allowedDbKeys`,
  `src/ts/plugins/plugins.svelte.ts:382`, and `src/ts/plugins/apiV3/risuai.d.ts:384` exposes `personas`), or
  hand-edited data; the last two were not traced.
- **Other readers and producers in `src/ts/interchangeability.ts`.** `convertPersonaToCharacter` reads
  `p.embeddedModule` (`:125-126`) and `convertPersonaToModule` reads it (`:154-155`). The two producers are
  `convertCharacterToPersona` (`:142`) and `convertModuleToPersona` (`:179`); the latter also edits the embedded
  module's lorebook and sets its id (`:183-191`).
- **Its assets are kept.** `globalApi.svelte.ts:2138-2153` marks a persona's icon, embedded-module assets
  and embedded-module icon as uncleanable. (`99-modules.md:44` cites this as `:1970-1978`; that range has
  drifted.)

### What is missing

Any way to create, see, edit, remove or activate a persona's embedded module.

### Design considerations (considerations, not findings)

- **What turning it on would activate.** Lorebook, regex, triggers, assets, toggles, `hideIcon` and
  `backgroundEmbedding` (the `getModule*` readers and `moduleUpdate`, `modules.ts:441-593`). Also MCP:
  `getModuleMcps` (`modules.ts:514-518`) feeds `createMCPClient` (`src/ts/process/mcp/mcp.ts:93`), which
  handles `internal:` clients such as `internal:fs` and `internal:risuai` (`:99-108`), `plugin:` (`:137`)
  and `stdio:` (`:144`), which on desktop launches a local process through the shell plugin
  (`:156-164`). Lua triggers are stamped with the module's own `lowLevelAccess` flag
  (`modules.ts:477-480`).
- **Consent.** An ordinary module import asks first: `alertConfirm(language.lowLevelAccessConfirm)`
  (`modules.ts:307-308`; the character-card paths ask at `characterCards.ts:406-407`, `:882-883`). An
  embedded module has no such step and no UI to see or remove it. A consent or review step on restore or
  on bind is one option; whether MCP and `lowLevelAccess` should ever apply to it is a separate question.
- **UI and producer.** A view/edit/remove surface for the embedded module, and a way to convert a module or
  character into a persona.
- **Memo keys collide.** `getModules` memoizes on `ids.join('-')` (`modules.ts:428-431`), and every
  embedded module has id `'$embedded'`, so two personas with embedded modules would share a cache entry.
  Adding the persona id to the key only when the persona has an embedded module avoids it. Keying every
  persona would bump `ReloadGUIPointer` on each persona switch (CHORE-04 territory). `moduleUpdate`'s
  `lastModuleIds` reload key (`modules.ts:560-592`) is built from module ids and has the same issue.
- **Tests do not use the real shape.** The two `embeddedModule` cases in
  `src/ts/process/tests/requestOrigin.svelte.test.ts` (`:657`, `:813`) give the embedded module an id equal
  to a `db.modules` entry, so they do not exercise the `'$embedded'` shape.
- **Compatibility.** `MC-175`: do not change the data shape. Upstream may finish the feature differently,
  so check upstream before building.

---

## Note on the evidence directories

`Agents/Evidences of Investigations/` holds third-party community plugin bundles used as
evidence for QOL-03 and QOL-04. They are **gitignored on purpose** (`.gitignore`, bottom):
they are other people's work, this fork's origin is a public repo, and committing them
republishes them. Read them in the working tree; never commit them.
