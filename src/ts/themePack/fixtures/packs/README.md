# Real-tool theme pack fixtures

Three small packs written by ordinary archive tools on the development PC (Windows 11), so the intake is tested against what those tools actually emit and not only against the builder. Each holds the same content: `manifest.json`, `chat.css`, `fonts/x.woff2` (the `wOF2` magic and padding, not a real font), `fonts/OFL.txt` and `images/x.png` (a real 1x1 PNG). `.gitattributes` marks them binary. They are accepted by `intake.test.ts` (T1-23).

| file | tool | command |
|---|---|---|
| `compress-archive.risutheme` | PowerShell 7.6.9, module Microsoft.PowerShell.Archive 1.2.6 `Compress-Archive` | `Compress-Archive -Path manifest.json,chat.css,fonts,images -DestinationPath compress-archive.zip` |
| `bsdtar.risutheme` | Windows `tar.exe`, bsdtar 3.8.9 (libarchive 3.8.9, zlib 1.2.13.1) | `tar.exe -a -c -f bsdtar.zip manifest.json chat.css fonts images` |
| `7zip.risutheme` | 7-Zip 26.05 (x64) | `7z.exe a -tzip 7zip.zip manifest.json chat.css fonts images` |

Each command ran from the folder holding the content, and the `.zip` result was renamed to `.risutheme`.

What each tool wrote (read with `7z l -slt`):

| tool | separators | directory entries | extra blocks | data descriptors | ZIP64 |
|---|---|---|---|---|---|
| Compress-Archive | `/` | none | none | no | none |
| bsdtar | `/` | `fonts/`, `images/` (stored, size 0) | Unix owner (`ux`) and extended time (`UT`) | yes (flag 0x0008) | none |
| 7-Zip | `/` | `fonts/`, `images/` (stored, size 0) | NTFS times | no | none |

No tool wrote a backslash separator, a ZIP64 sentinel or a ZIP64 extra block.
