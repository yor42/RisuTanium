# Bundled built-in theme packs

The four built-in themes as `.risutheme` archives. `src/ts/themePack/builtins.ts` imports each with `?url`, `bundledArchive.ts` fetches it on every apply, and `apply.ts` checks its size and SHA-256 against the pins in `builtins.ts` before the installed-archive intake judges it. A mismatch is a broken pack (`files`), never an applied one. `.gitattributes` marks the archives binary.

| file | pack id | content |
|---|---|---|
| `origin-navy.risutheme` | `risutanium.origin-navy` | `manifest.json` and the Origin Navy chat sheet |
| `banana-cocoa.risutheme` | `risutanium.banana-cocoa` | `manifest.json` and the Banana Cocoa chat sheet |
| `scratch-white.risutheme` | `risutanium.scratch-white` | `manifest.json` and the Scratch White chat sheet (no font) |
| `office-sheet.risutheme` | `risutanium.office-sheet` | `manifest.json` and the Office Sheet chat sheet |

Each `chat.css` is `preprocessCss` of `docs/design/chat/themes/<slug>.css` (CRLF read as LF). No archive carries a studio, settings or home sheet, a font or an image yet.

## Pins

| file | size | SHA-256 |
|---|---|---|
| `origin-navy.risutheme` | 1619 bytes | `f9b1d61adf8423ae034e875451ef4b9ff932e645458c7bcfc4522d718dc8305c` |
| `banana-cocoa.risutheme` | 3515 bytes | `faed96bba8aa6d34a9bd61fe6ff8ec55485021e4112756cb9fc850966b072cab` |
| `scratch-white.risutheme` | 1920 bytes | `718b7f62d1c396d94399e3cf3730299706d222e85e70f7196ca9b0482008ed36` |
| `office-sheet.risutheme` | 2869 bytes | `1d4076392f31f9d89b2a80e8521f73dbf5725915ae13c881b57b508ef4f27573` |

`builtins.test.ts` pins the same sizes and hashes and fails if this table, `builtins.ts` and the files disagree.

## Licences

The packs and their stylesheets: GPL-3.0, attribution "RisuTanium contributors".

## Provenance and rebuild

The generator `Agents/Tools/save-gen/themePackBundled.harness.ts` builds each archive twice with the shared pack builder (deflate level 9, fixed entry time), asserts the bytes are equal, and prints the size and SHA-256. The archives are copied here by hand, then the pins above, in `builtins.ts` and in the test are updated.

From the repository root (the output directory must be outside every repository):

```
$env:THEMEPACK_BUNDLED_GENERATE = '1'
$env:RTB_GOLDENS_OUT = '<output directory>'
node node_modules/vitest/vitest.mjs run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/themePackBundled.harness.ts
```

Run only that one file: a run of the whole `Agents/Tools/save-gen/` folder rewrites other goldens.
