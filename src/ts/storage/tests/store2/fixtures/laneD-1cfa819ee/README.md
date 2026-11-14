# Fixtures produced by the build at commit 1cfa819ee

These files hold what the last build that knew nothing of the retained-paths field wrote: asset lists derived by the
real list derivation, a tree written by the real encoder, and `.risum` bytes written by the real module exporter. The
tests that read them check that the current build reads old data as it always did (a compatibility guard), so they must
not be regenerated from the current code.

All data is synthetic and shaped like a profile (hash-named and plain-named assets, a persona with an embedded module,
loadouts, a legacy file with a cold character and an unreadable file). Nothing here comes from a real profile.

| file | what it is | read by |
|---|---|---|
| `character.json`, `module.json`, `config.json`, `legacy.json` | the owners the lists were derived from | `assetRetained.legacy1cfa.test.ts` |
| `expected-lists.json` | the lists 1cfa819ee derived for those owners | `assetRetained.legacy1cfa.test.ts` |
| `closure-tree.json` | base64 units of two commits (the later one reuses every character unit and carries a legacy keep list), their manifest keys | `assetRetained.legacy1cfa.test.ts` |
| `risum-main-block.json` | a module that holds the retained field and the `.risum` bytes 1cfa819ee wrote for it, with the real RPack permutation | `modules.assetRetained.test.ts` |

## Regenerating

Regeneration means running `generate.mjs` on a clean export of 1cfa819ee (for example `git archive 1cfa819ee`), with
`node_modules` linked into the export:

    node generate.mjs <root of the 1cfa819ee export> <this directory>

The script writes two temporary vitest files into the export, runs them, and removes them. It never reads or writes
anything under `binGoldens`.
