### MC-4960 — Note 9 run 2026-11-28e: build, install and library, 2026-11-28

- Tag: run record. Date: 2026-11-28. Exact times: UNKNOWN. Related: `#149`, `#909`, `#710`, MC-4940.

Release APK built from current origin/main with the run-d recipe in a scratch worktree, installed on Note 9 phone 1 (`29f3cde9193f7ece`), install verdict pass. Library `rd-rune.bin` pushed and restored through Welcome after one `pm clear` (leftover run-d data). Build SHA is in the raw build output, not in the repository.

### MC-4961 — D-LOCK rows observed, 2026-11-28

- Tag: run record. Date: 2026-11-28. Exact times: UNKNOWN. Related: MC-4960, `#149`.

D-LOCK-1, D-LOCK-4 and D-LOCK-5 observed (kept-current toast, live values on the active preset, switch hit areas). D-LOCK-2 NOT RUN (needs two store2 pages, PC-first). D-LOCK-3: the `.bin` export showed a confirm naming "(sampling, reasoning)" rather than a leave-out sheet listing "Preset field locks" with group names, and the file held no `presetFieldLocks` while the aux and fallback flags travelled. Detail in `Agents/Findings-2026-11-28-note9-run-e.md`.

### MC-4962 — #909 and #710 b/c/d rows observed, 2026-11-28

- Tag: run record. Date: 2026-11-28. Exact times: UNKNOWN. Related: MC-4960, `#909`, `#710`, MC-4910 to MC-4917.

Sheet layout, folder header, Move-to-folder list, the inline swap confirm (Swap and Cancel), Undo toasts (they overlay the bottom of the sheet; Undo worked when tapped in time), select mode (visible checkbox 16x16 css px in a 44x44 hit wrapper), the bundle export through the system save picker (`.risup`, 5828 bytes, keys left out notice) and the import picker (Back cancelled, nothing added) were observed. Not run: single-row Export, completed Import, drag.

### MC-4963 — Disclosures for the run, 2026-11-28

- Tag: disclosure. Date: 2026-11-28. Exact times: UNKNOWN. Related: MC-4960 to MC-4962.

One `pm clear`; `net-status` not allowed, radios read with `settings get global`; Korean IME turned `Work` into `째가` (folder name); a late Undo tap opened the classic settings and a stray tap opened a classic page, both closed; several extra Use-in-chats switches; test-made state left on the phone (folder `째가` with Preset C, hotkey slots, new fallback and aux values, locks ON, "Studio (preview)" ON).

### MC-4964 — Run closed, reset census unchecked, 2026-11-28

- Tag: handoff. Date: 2026-11-28. Exact times: UNKNOWN. Related: MC-4960.

Pushed and app-written files were removed by exact name, the CDP forward was removed, `reverse --list` empty at start and end, Wi-Fi and mobile data read 0 and 0. `workflow-device-reset.mjs end` stopped (exit 3, no start baseline in the run folder it searched); the `note9` lease is released with `needsReset true`, so the census check is open for lane A or the next device session. Later groups (Home group, packs and apply cost, #816, #885, #303) are not started.
