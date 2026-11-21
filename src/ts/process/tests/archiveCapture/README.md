# Archive capture fixtures

What the one-character archive writer (`archiveCharacterNow`) wrote, captured from the real producer and committed, so the
compatibility guards for archived characters read real bytes after the writer is gone (MC-2987, MC-329).

## What is here

Eleven cases, each with its own `chaId`:

| id | entry | what it is |
|---|---|---|
| `new-alice` | `engine-new` | a new character archived |
| `loaded-edited` | `engine-loaded` | a loaded character edited, trashed and untrashed, then archived |
| `loaded-trashed` | `engine-loaded` | a loaded character with `trashTime`, archived (the unit never holds `trashTime`) |
| `rearchived` | `engine-sequence` | archived, opened as the upstream model opens it, edited, archived again: `unit1` is superseded, `unit2` current |
| `import-v2`, `import-v3`, `import-tavern` | `card-import` | a card imported straight to the archive through the real importer |
| `owner-fields` | `engine-loaded` | the real importer's v3 character with the asset folder document and the retained asset paths |
| `render-when-complete` | `engine-loaded` | as `owner-fields` plus `risutanium_render_when_complete` |
| `group-new` | `engine-new` | a group slot with a member list |
| `pointer-chat` | `engine-new` | a character whose chat is its own unit (`chat` role); the stub's `coldStoragedChats` lists it |

Per case: `<id>.source.json` (the character handed to the writer; for a card import the card's JSON, `sourceKind: card`),
`<id>.stub.json` (the slot the writer left in the list) and the unit bytes `<id>.unit.gz` (`.unit1.gz` and `.unit2.gz` for
`rearchived`, `.chat.unit.gz` beside `pointer-chat.unit.gz`). The units are the exact gzip bytes the real `writeColdStorageUnit`
put in the page's byte store under `coldstorage/<key>` (web layout). `manifest.json` records, per unit, its role, key, store
key, byte length, a hash of the gzip bytes with the MTIME field zeroed (`maskedSha256`) and a hash of the decompressed
payload (`payloadSha256`).

`manifest.content` is everything a re-capture must reproduce. `manifest.capture` is about the one run that wrote the files:
`baseCommit`, `productionDirty` (the production paths that were modified at capture: none), the wall-clock `time`, and per
unit file the sha256 of the committed bytes and the gzip header MTIME value. It is never compared across runs.

## Stand-ins

The capture world replaces: the page byte store (an in-memory map behind the real `coldstorage.svelte`), the platform flags
(`isTauri: false`, `isNodeServer: false`), uuid (a counter set per case), the clock (`Date` faked to `content.systemTime`;
fflate's worker clock is not faked), UI and alerts, and for the card cases the importer's neighbours: `hasher` (identity),
`compressImage`, `getImageType`, `reencodeImage`, `saveAsset`, `saveAssetFromPieces` and the rest of `globalApi.svelte`,
`decodeRPack`, `encodeRPack`, `convertExternalLorebook`, `updateInlayScreen`, `PngChunk`, `translateHTML`,
`interchangeability`, `chatOrigin`, `avatarThumb`, `upstreamAgreement`, `parseMarkdownSafe` and part of
`database.svelte`. The exact list is `manifest.content.standIns`. Consequence: asset paths and image fields inside the
`import-*`, `owner-fields` and `render-when-complete` units are mock-produced opaque strings. The readers treat them as
opaque, so reader compatibility does not depend on them. Real: `archiveCharacterNow`, `writeColdStorageUnit`, fflate
`compress`, `buildColdStub`, `pointerChatKeys`, `coldUnitCharacter`, and for the card cases `importCharacterProcess`,
`importCharacterFile`, `characterFormatUpdate`, `applyCharacterDefaults` and `resetChatStreamingState`.

## Provenance

- Base commit: the `capture.baseCommit` of `manifest.json`. The writer's source is unchanged from there to the stage-1 commit.
- Stage-1 commit: `6a6f43171`, the commit that added these files, so the generator can be read at that commit
  (`git show 6a6f43171:Agents/Tools/save-gen/archiveCapture.svelte.harness.ts`). The id stays valid only if that commit is
  not rewritten (amended, squashed or rebased) before the branch is pushed; the repository merges pull requests with merge
  commits, which keep it reachable.
- Generator (removed with the writer; read it at the stage-1 commit): `Agents/Tools/save-gen/archiveCapture.svelte.harness.ts`,
  run through `Agents/Tools/vitest.archiveCapture.config.ts`.
  The config merges the repository's `vitest.config.ts` (`mergeConfig`), so the capture runs under the same plugin set as
  `pnpm test`: the Svelte proxy patch, the Svelte plugin with the async flag, the async-flag default, the `src` alias,
  happy-dom and `vitest.setup.ts`. Command, from the repository root:

  ```
  npx vitest run --config Agents/Tools/vitest.archiveCapture.config.ts
  ```

  The default run verifies the committed files and writes nothing. `ARCHIVE_CAPTURE_WRITE=1` writes them (to
  `ARCHIVE_CAPTURE_OUT` when set, else here); `ARCHIVE_CAPTURE_VERIFY_AGAINST` verifies against another directory. Never
  point vitest at the whole `save-gen` folder: that rewrites binGoldens.
- Verify rules. V1: the set of `.source.json`, `.stub.json` and `.gz` files is identical and every JSON file is deep-equal
  after parsing. V2: every `.gz` has the same length and the same bytes with bytes 4 to 7 (the gzip MTIME) zeroed on both
  sides, and the decompressed payloads are byte-identical. V3: `manifest.content` is deep-equal. V4: the run prints its
  HEAD, `productionDirty` must be empty, the production diff from `capture.baseCommit` to HEAD must be empty, and
  `capture.baseCommit` must be an ancestor of HEAD. MTIME is masked because fflate's asynchronous `compress` runs in a
  worker thread whose clock is not faked, so that one header field changes with every run.
- The writer was deleted in the stage after the capture, and the generator and its config were removed with it. From then on the guards in `archiveCapture.fixtures.test.ts` check that the committed files
  are intact and consistent; they no longer prove provenance.

## Users

`archiveFixtures.ts` loads a case and places its units under the real store key. `ARCHIVE_FIXTURES_DIR` points the loader at
another directory (a scratch copy, for a mutant run).
