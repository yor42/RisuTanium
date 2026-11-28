# Findings 2026-11-28: PC real-app run (away window), observations only

Rows: #940/#278 (held-asset skip timing), #224 stage 4. Result: **no valid timing was captured**; harness route proven. No acceptance judgement.

## Inputs
- Base for the app build: main `c3c8f08b6` (includes #940, merge `b233e626f`); #940 base build `e6d3cf882`. Both built release with `node node_modules/@tauri-apps/cli/tauri.js build --no-bundle --config '{"build":{"beforeBuildCommand":""}}'` after `node node_modules/vite/bin/vite.js build` (3 min 14 s cold-cache branch, 1 min 20 s base; shared cargo target). Branch exe sha256 prefix `5b3a3fe3e16e97e`.
- Fixtures (synthetic, outside the repo under `%TEMP%\pcaway\fx`): `assets10k.bin` (10,000 assets of 1-64 KiB, 3 of 20/40/60 MiB, 460,478,003 asset bytes, plus a 2-character db entry from `c806-bin-write.mjs --characters 2 --chats 1 --messages 1 --modules 0 --archive off`; 461,269,869 bytes); `small.bin` (`synth-bin-gen.mjs --seed 1337 --scale small`, 334,987,396 bytes).
- Hardware: i9-13900KF, 63.8 GiB RAM, Samsung 990 PRO NVMe, Windows 11 Pro 10.0.26300 (best-case hardware). Build kind: release, Tauri/WebView2.

## Observations
- CDP route works: spawning the exe with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<own port>` (child env only, `shell:false`) attached within 8 s. Previously unverified (Handoff 2026-11-19 laneB note).
- Restore path: Settings > Backup & Files > "Load Backup Locally" > two confirm prompts (English labels `YES`/`NO`, upper case) > native dialog, hosted by WebView2 as a child `#32770` of the Tauri window. File-name Edit and Open expose no Value/Invoke pattern; `WM_SETTEXT` and `BM_CLICK` worked.
- Release build exposes no `__risuImportPhases` ring and no base-content index timing.
- Branch run A#1 (empty profile, `assets10k.bin`): import completed (page reload, restored data shown). Profile `assets` held 10,003 files afterwards (all kept, none collected); store2 file count 92. Progress card reached "339.9 MiB / 439.9 MiB" 15.2 s after Open; the timing poller was killed by its own head-limiting pipe, so **total time is unknown**.
- Re-import B attempt: confirm clicks did not open the dialog (label case); NOT RUN.
- Base exe, further A/B repeats, and Row 2 (`small.bin` twice, store2 file counts): NOT RUN. The run exceeded its ~45 min window.

## Incidents (rule deviations, disclosed)
- One `Start-Process -ArgumentList` launched the runner's own node helper (not the app); killed, replaced by a node-spawned one.
- One UIA lookup by AutomationId matched an unintended file-list item inside the open dialog and read its name once; one top-level window-title listing showed other apps' titles. Neither was recorded.
- The maintainer's running upstream app (PID 39948) was untouched. Sandbox profile dirs were moved aside and renamed back (originals verified present, no `*.pcaway-aside` left); the fresh profile was deleted.

## Rerun notes
Poll to a file, never through a head-limiting pipe; click `YES`; first A (empty profile) then B (same profile) per exe with a fresh profile per pair; use class-based UIA lookups only. Runner scripts and the full runner report are in `%TEMP%\pcaway\drv` and `%TEMP%\pcaway\runner-report.md` (not committed).
