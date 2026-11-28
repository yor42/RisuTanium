# apply-cost harness (#363, #325)

Scratch measurement apparatus, not application code; nothing in `src/` imports it, and it is not collected by `pnpm test`. It bundles the real `preparePackSheet` path with the app's Vite settings (minified, worker as its own chunk) and drives it in headless Chrome over CDP (no Playwright). Replace `<WORKTREE>` (repo root) and `<SCRATCH>` (an empty directory outside every repository) in the files first, copy `entry.ts`, `vite.config.mjs` and `index.html` (`<!doctype html><script type=module src=./entry.ts></script>`) into `<SCRATCH>`, then:

1. `node node_modules/vite/bin/vite.js build --config <SCRATCH>/vite.config.mjs` from the repo root.
2. `node gen.mjs <SCRATCH>/packs` writes the synthetic packs (random bytes with a font magic, stored zip) and `index.json`.
3. `node drive.mjs <SCRATCH>/dist out.json 15` times built-in applies; `drive3.mjs <dist> <packs> out.json [phases]` times archive applies (env `NOPOLL=1` for timing without RSS sampling, `REPS`, `SLEEP`); `drive4.mjs` samples renderer RSS at stage boundaries.

Chrome is `C:\Program Files\Google\Chrome\Application\chrome.exe` on ports 9731 and 6013.
