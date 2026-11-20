# Downloadable theme packs

Two `.risutheme` packs for people who install packs from a file. Nothing in `src` imports them or the font: they are not part of the web build or the APK. `src/ts/themePack/downloadPacks.test.ts` and `src/lib/Setting/Pages/Display/themePackDownloads.svelte.test.ts` read them with `node:fs`.

| file | pack id | chat sheet |
|---|---|---|
| `scratch-white.risutheme` | `risutanium.scratch-white` | the built-in Scratch White chat sheet plus `scratch-white.chat-font.css` |
| `office-sheet.risutheme` | `risutanium.office-sheet` | identical to the built-in Office Sheet chat sheet |

Both carry all four area sheets (chat, studio, settings, home) from `docs/design/<area>/themes/`. The install reads the chat sheet today and keeps the other three in the archive. Both are light only.

Scratch White additionally bundles Nanum Pen Script (`fonts/NanumPenScript-Regular.ttf`) and its licence text (`fonts/OFL.txt`). The font block that names it is `scratch-white.chat-font.css`, appended to the chat sheet. The built-in Scratch White names no font, so it keeps the reader's own message font.

The downloadable Scratch White has no paper texture yet: it is the flat off-white paper and the ruled-notebook rules of the built-in, plus the handwriting font. A texture needs a validator change that has not been made.

## Pins

| file | size | SHA-256 |
|---|---|---|
| `scratch-white.risutheme` | 1317116 bytes | `63f96bb1163cb7fe1223c0953aa27f0028901398d6afd54fa30e4b21498c673d` |
| `office-sheet.risutheme` | 6129 bytes | `3f039001c0906949625468baabaf585335553dba2b1a7f171da2589d0fbd591f` |
| `fonts/NanumPenScript-Regular.ttf` (inside Scratch White) | 3201664 bytes | `6f0d1ab29c7894010dc88831fb7a0a51edb79136e450344183de5b1a8b52bd43` |
| `fonts/OFL.txt` (inside Scratch White) | 4534 bytes | `eeacf16032901d0ed0456876ec77b8f0fda6b3fecec7d972f8543eb602e6c30f` |

`downloadPacks.test.ts` pins the same sizes and hashes and fails if this table and the files disagree.

## Licences

- The packs and their stylesheets: GPL-3.0, attribution "RisuTanium contributors".
- Nanum Pen Script: SIL Open Font License 1.1, Copyright (c) 2010, NHN Corporation. Reserved Font Names include Nanum and NanumPen. The font file is the unmodified file published in google/fonts (`ofl/nanumpenscript`): no subsetting, no format conversion. The full licence text is `fonts/OFL.txt` in the archive. The CSS family name `pack-nanumpen` is the alias every pack font needs and does not rename the file.

## Provenance and rebuild

The raw font is not committed on its own; it exists only inside `scratch-white.risutheme`. The generator `Agents/Tools/save-gen/themePackDownloads.harness.ts` reads the two font files from a directory outside every repository and refuses unless their size and SHA-256 equal the pins above. It builds each pack twice with the shared pack builder (deflate level 9, fixed entry time), asserts the bytes are equal, and prints the size and SHA-256. The packs are copied here by hand, then the pins above and in the test are updated.

From the repository root (the output directory must be outside every repository):

```
$env:THEMEPACK_DOWNLOADS_GENERATE = '1'
$env:THEMEPACK_FONT_DIR = '<directory holding NanumPenScript-Regular.ttf and OFL.txt>'
$env:RTB_GOLDENS_OUT = '<output directory>'
node node_modules/vitest/vitest.mjs run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/themePackDownloads.harness.ts
```

Run only that one file: a run of the whole `Agents/Tools/save-gen/` folder rewrites other goldens.
