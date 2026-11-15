# Golden v1 theme packs

`origin-navy.risutheme` and `banana-cocoa.risutheme` are the shipped themes of `docs/design` in the v1 pack layout (a ZIP archive: `manifest.json`, `chat.css`, `studio.css`, `settings.css`, `home.css`). They are frozen bytes: every later build must still accept them (`goldenPacks.test.ts`), and they are never regenerated. `.gitattributes` marks them binary.

| file | size | SHA-256 |
|---|---|---|
| `origin-navy.risutheme` | 7083 bytes | `a3572fc7b4dfea788566a3bf707a806c91b4a26116470ccbc402ad62fb90a06b` |
| `banana-cocoa.risutheme` | 13148 bytes | `d8bda3ae97e300e619d13096eb6a79b56ee3d7fc1ded426080e2e04b6b9327d5` |

The size and hash are also pinned in `goldenPacks.test.ts`; a change to either file must change all three places, which is a deliberate format decision, not a refresh.

## How they were made

`Agents/Tools/save-gen/themePackGoldens.harness.ts` builds both with `src/ts/themePack/fixtures/packBuilder.ts` (fflate `zipSync`, deflate level 9, a DOS time built from local date fields so the bytes are identical in every time zone, entry order `manifest.json`, `chat.css`, `studio.css`, `settings.css`, `home.css`). It writes only when `THEMEPACK_GENERATE=1`, only through `writeGoldenFile` into a directory outside every repository, and prints the size and SHA-256. The files here are a hand copy of that output.

```
$env:THEMEPACK_GENERATE = '1'
node node_modules/vitest/vitest.mjs run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/themePackGoldens.harness.ts
```

Built under `TZ=UTC`, `TZ=Asia/Seoul` and `TZ=America/Los_Angeles`, both packs came out byte-identical.

The sheets are `docs/design/{chat,studio,settings,home}/themes/<theme>.css` with CRLF read as LF. Each manifest has `kind` `risutheme`, `format` 1, `id` `risutanium.origin-navy` or `risutanium.banana-cocoa`, `version` `1.0.0`, `license` `GPL-3.0`, `attribution` `RisuTanium contributors`, `modes` `["dark"]` (Origin Navy) or `["light"]` (Banana Cocoa), and `fonts` empty (the eight sheets name no font and no file).

## Format v1 statements

These sentences are frozen with the goldens. Intake (`intake.ts`) and the validator (`index.ts`) apply them.

1. A pack holds `manifest.json` and at least one of `chat.css` and `studio.css`.
   Build rule, separate from the format: this build refuses a pack without `chat.css`. Only this build rule changes when another area becomes an applied area.
2. Bytes outside every entry are allowed and never read: before the first local header, between the end of one entry's compressed data and the next local header (data descriptors live there and stay allowed), between the last entry and the central directory, and between the central directory and the end record. Bytes inside the central directory after the last record are damage. Bytes inside an entry's compressed extent after the end of its deflate stream are ignored: the reader inflates up to the end of the stream and the declared size and CRC-32 then agree (observed by the T1-40 diagnostic row: an entry with 8 bytes after its final deflate block is accepted).
3. No ZIP64 structure a reader acts on: no ZIP64 locator before the end record, no sentinel in the end record, and no central record with a 0xFFFFFFFF size or offset, a 0xFFFF start disk or a ZIP64 extra block. The central directory governs: of a local header only the signature, the name and the two lengths are read; its method, CRC, sizes and extra blocks (a ZIP64 extra included) are ignored.
4. An entry name is at most 255 bytes.
5. `name` and `version` in the manifest hold no C0 or C1 control character (DEL included), no U+2028 or U+2029, and no bidi embedding, override or isolate character (U+202A-U+202E, U+2066-U+2069); `license` and `attribution` may hold line ends.
6. An empty or comment-only `chat.css` is a valid sheet.
