# `.bin` golden fixtures

Small backup files produced by the build before the storage rewrite changed `.bin` import and export, so a later change can show that the same files still import to the same logical content, and that an export decodes back to equal content. They are generated at commit `2de9cdbfa`.

These fixtures record **today's** restore behaviour only. They are not a rule for any later importer: where a file below is described as "kept as stored", a later importer may legitimately do something else with it, and the guard then changes with it.

All ids, times and bytes are fixed. Unit keys are fixed UUIDs (`...-0000000000a1` to `...-0000000000a6`), because a restore places only `coldstorage_<uuid>.json` entries. The asset is `golden-avatar.png` (12 fixed bytes, `assets/golden-avatar.png` after a restore).

| File | Written by | Covers |
|---|---|---|
| `fork-full.bin` | the real `SaveLocalBackup` | an inline character holding a plain chat and a first-message pointer chat; a stub character (`coldstorage` blob entry plus `coldStoragedChats`) whose blob holds a plain chat and a pointer chat; the chat units those pointers name; an object-valued V3 plugin value (`_coldplugin` to a unit; the fork accepts any JSON value); a module with a lorebook entry and a regex; a preset with settings; an asset |
| `upstream-full.bin` | hand-built | the same four pointer kinds in the shapes upstream's `makeColdDataForCharacter` and `makeColdDataForChat` leave behind; an array-valued plugin unit (the value shape upstream's collector writes); a chat holding upstream's unreadable-unit text `[Cold storage data could not be loaded. Key: <k>]` (the unit it names is present as a `coldstorage_<uuid>.json` entry, which upstream's collector would not export because it lists pointer keys only; no assertion depends on that entry); module, preset and asset as in the fork file |
| `fork-missing-unit.bin` | the real `SaveLocalBackup` | an inline character whose pointer chat names a unit that is in no entry |
| `upstream-missing-unit.bin` | hand-built | the same case in upstream shape |
| `upstream-plugin-object-no-entry.bin` | hand-built | an object-valued `_coldplugin` mapping whose unit has no entry (upstream's collector leaves out a unit that is not an array and has no `character` or `message`) |
| `fork-stub-missing-entry.bin` | the real `SaveLocalBackup` | a stub whose blob unit is absent from the store, so no blob entry is written |
| `fork-stub-bad-json.bin`, `fork-stub-wrong-shape.bin` | hand-built | a fork-shaped stub with a blob entry whose body is `not json {`, or JSON `{"a":1}`; the real exporter never writes either, so the entry is placed by hand |
| `upstream-stub-missing-entry.bin`, `upstream-stub-bad-json.bin`, `upstream-stub-wrong-shape.bin` | hand-built | the same three cases for an upstream-shaped stub |

The container is the same in both families (`[nameLength][name][dataLength][data]` entries, units as `coldstorage_<uuid>.json` plain JSON, the database as the last entry, `database.risudat`, encoded by `encodeRisuSaveLegacy` with compression). They differ in the character, chat and stub objects inside the database entry. The upstream-shaped chats carry no chat `id`: upstream's `makeColdDataForChat` changes a chat in place, so a real upstream chat keeps its `id`, `note` and `name`, and the fixture models a chat that has no `id` (an older chat), to which the restore gives one.

## What the restore does today with the unusable-unit cases

- **Pointer to an absent unit** (`*-missing-unit.bin`): the pointer text stays in `chat.message[0].data`, the unit stays absent, and the restore asks the incomplete-restore question naming the character. The fork has no production writer of `formatColdStorageLoadError` text (the builder is used by tests only), but upstream's `preLoadChat` writes `[Cold storage data could not be loaded. Key: <k>]` into a chat, so `upstream-full.bin` carries one such chat; the restore leaves it as it is.
- **Object-valued plugin mapping with no entry** (`upstream-plugin-object-no-entry.bin`): the mapping stays, the unit stays absent, and one question is asked ("1 item(s) could not be linked to a character", 1 unit unavailable).
- **Stub whose blob entry is absent or not JSON** (`*-stub-missing-entry.bin`, `*-stub-bad-json.bin`): the stub is installed exactly as the database holds it (`coldstorage` key, `coldStoragedChats`, its one empty placeholder chat). The blob is not stored (status `missing`), the chat unit named by `coldStoragedChats` is absent, and one question names the character with 2 units unavailable.
- **Stub whose blob entry is JSON of another shape** (`*-stub-wrong-shape.bin`): under the name the exporter writes, any JSON body is stored as a unit (status `ok`), so the stub is installed as above, only the chat unit is unavailable (1 unit), and one question names the character.

## Generating

From the repository root:

```
npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/binGoldens.harness.ts
```

`BIN_GOLDENS_OUT=<dir>` writes to another directory. Two details keep the bytes reproducible. The gzip header of a compressed database entry carries the current seconds, which the harness pins with a fixed clock. msgpackr 1.10.1 passes a length past the buffer's end to `Buffer.prototype.utf8Write` for a longer string, which the Node used here (24.19.0) rejects; the harness clamps that length to the room left, which changes no byte written. Running the generator twice, seconds apart, produced identical files. Regenerate only when the fixture set itself is meant to change, and update the hashes below.

The guard is `src/ts/drive/tests/binGoldens.test.ts` (runs under `pnpm test`). It restores each file through the real `LoadLocalBackup` over an in-memory store; modules and presets are compared as full records. It finds the files from the working directory (the repository root; `import.meta.url` is not a `file:` URL under vitest here), and `BIN_GOLDENS_DIR` points it at another directory of the same file names. It says nothing about the Tauri or Node backends.

## SHA-256

```
0402B17629D0FF7DF0718C03EA7F60A92562E4DDD4457842D03EEFE8EAB9140B  fork-full.bin (1904 bytes)
884268C204A5FC59923306A938EDFB4E88B77C9B85AE9F238ADD8A2CD885B334  fork-missing-unit.bin (625 bytes)
447D6C84B6E8F670930E7F15B58DD8F9559F1054197BB0503A766441BF22644A  fork-stub-bad-json.bin (356 bytes)
7A82BA3D01321A4F990CDE993AC78C75FF1959C7DC42BA1C166A8E79E3CAC47D  fork-stub-missing-entry.bin (330 bytes)
C224075147F79BE37AE01A4BD051DD2D10843703FAC221DD2EC5CA0C3015F516  fork-stub-wrong-shape.bin (353 bytes)
1AFBE225A3B45C2A6CA9EB2145B7DF2A437947E7B60AFFB2F20B8B516E4EA773  upstream-full.bin (2170 bytes)
BCD4F2163D441B09A3AC9BD882F5F3A90E801651B96D1C0CC0BFC04D7A5C5AEF  upstream-missing-unit.bin (601 bytes)
9857A75804FA38B70F81F3C99D378B03BD8A08D38884185CDF30DA1B333C09D2  upstream-plugin-object-no-entry.bin (528 bytes)
3E6F46510227D033B5A95626563090C3C26E54DB18B8C95BD1F7DC2CB84C8DD3  upstream-stub-bad-json.bin (347 bytes)
DFE7C6D7616364984C600EE49CBB360B4C7BD98A4F2002EB6FA703C7465DFBC6  upstream-stub-missing-entry.bin (276 bytes)
A6F59FEBC1214C82CE7212DF1D75E18CA2DF441F2DFB30A1E07C0FF58B8ED0CB  upstream-stub-wrong-shape.bin (344 bytes)
```
