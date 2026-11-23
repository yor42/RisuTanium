# S3a device run 2 (ticket #689, phone 2, Note 9 serial 2ac80128013f7ece, lease request s3a-689-r3)

STATUS: STOPPED at step 2 (install). No model row ran. Lease released without --clean.

## Summary
- Phone 2 only. Phone 1 (29f3cde9193f7ece), Fold 7 and Tab S9 not touched.
- Wi-Fi off (net-status). Census clean: 27 third-party packages, all standing or stranded-for-this-phone, none removed, no dev.risu.* package.
- The pinned APK install failed with INSTALL_FAILED_UPDATE_INCOMPATIBLE (installed io.github.yor42.risutanium has a different signature). The section 5 MC-3874 uninstall requires the old and new signer SHA-256 recorded before the uninstall. The old signer could not be read with the allowed forms, and apksigner is not on PATH, so the uninstall was NOT run.
- Not run: app launch, screenshot, static server, reverse 6312, CDP forward 6311, memory sampler, meminfo, every model run (mini-smoke, e5-b8, e5-b1, multi-b8, mini-b8), end cleanup, end census.
- The token was not printed or written to any file.

## Lease
- lease-renew --request s3a-689-r3: granted, expiresAt 2026-11-23T09:33:09.443Z (first call). Second renew before install: granted, expiresAt 2026-11-23T09:33:57.296Z. Exit 0 both.
- lease-status: device:2ac80128013f7ece busy true, holder "689-orchestrator", ticket "689", needsReset false. The holder label is not s3a-689-r3 although renew returned granted. Observation only; not resolved here.
- lease-release --request s3a-689-r3 (no --clean): status released, member device:2ac80128013f7ece, needsReset true. Exit 0.

## Rows (exact command, output or exit, observation)

### R0 net-status (start)
- Command: `node C:\Projects\RisuAI\Agents\Tools\device-guard\adbg.mjs net-status --serial 2ac80128013f7ece --log C:\Users\yor42\AppData\Local\Temp\s3a-run1\adb-commands.log`
- Output: `wifi_enabled=off associated=no validated=no`, exit 0.
- Observation: Wi-Fi off; section 1 condition met.

### R1 reverse --list (start)
- Command: `node C:\Projects\RisuAI\Agents\Tools\device-guard\adbg.mjs --serial 2ac80128013f7ece --log C:\Users\yor42\AppData\Local\Temp\s3a-run1\adb-commands.log --own-ports 6310-6329 --own-package io.github.yor42.risutanium -- reverse --list`
- Output: empty, exit 0.
- Observation: no reverse present at start.

### R2 Census (start)
- Command: same guard form with `-- shell pm list packages -3`.
- Output: 27 `package:` lines, exit 0. Raw 27, listed 27, COMPLETE.
- Observation: standing (keep): io.github.yor42.risutanium, io.github.yor42.tbdriver, io.github.yor42.tbprobe, com.sec.android.app.voicenote, com.samsung.android.email.provider, com.google.android.verifier, com.samsung.android.app.watchmanager, com.google.android.contactkeys, com.sec.android.app.sbrowser, com.samsung.android.oneconnect, com.sec.android.app.popupcalculator, org.mozilla.firefox, com.sec.android.app.shealth, com.sec.penup, com.google.android.safetycore, com.google.vr.vrcore. Stranded for this phone (keep and report): com.sec.android.inputmethod.beta, com.samsung.android.app.panel.naver.v, com.samsung.android.widgetapp.daumedge.sports, com.samsung.android.app.panel.naver.tv, com.samsung.android.widgetapp.daumedge.news, com.samsung.android.timezone.autoupdate_O, com.samsung.android.widgetapp.daumedge.kakao, com.sec.android.autodoodle.service, com.samsung.android.app.notes.addons, com.sec.android.easyMover, com.samsung.accessory.fridaymgr. No dev.risu.* package, no keepHelpers package present, no unexpected package. Clean. Detail: C:\Users\yor42\AppData\Local\Temp\s3a-run1\census-start.md

### R3 Pinned APK hash (local)
- Command: `Get-FileHash -Algorithm SHA256 -LiteralPath C:\Users\yor42\AppData\Local\Temp\risu-b715\chore148\app-debug-d2ff459b0.apk`
- Output: BEAB65E184DC50D6514238F1702F6DDF107D81FAA3EFBBCA27B1AD246A6B2B5B (matches the pin).
- Observation: local file matches the pin. apksigner was not on PATH, so the pinned signer was not printed.

### R4 install (step 2)
- Command: `node C:\Projects\RisuAI\Agents\Tools\device-guard\adbg.mjs --serial 2ac80128013f7ece --log C:\Users\yor42\AppData\Local\Temp\s3a-run1\adb-commands.log --own-ports 6310-6329 --own-package io.github.yor42.risutanium -- install -r C:\Users\yor42\AppData\Local\Temp\risu-b715\chore148\app-debug-d2ff459b0.apk`
- Output: `Performing Streamed Install` / `adb.exe: failed to install ... Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package io.github.yor42.risutanium signatures do not match previously installed version; ignoring!]`, exit 1.
- Observation: installed io.github.yor42.risutanium is signed differently from the pinned APK. Section 5 MC-3874 case.

### R5 MC-3874 uninstall (not run)
- Precondition: record old signer and new signer SHA-256 before `uninstall io.github.yor42.risutanium`.
- Old signer: not readable. The allowed forms have no read of the installed base.apk (no pull, no path, no dumpsys package; pm dump is forbidden). The install output prints no signer.
- New signer: not recorded (apksigner not on PATH; not searched further).
- Result: precondition not met, uninstall not sent. No data changed on the phone.

### R6 to R12 (not run)
- Not run: am start, 25 s wait and screenshot, static server on 6312, reverse 6312, pid via ps, CDP forward 6311 and cdp.mjs check, pss-sampler, meminfo-snapshot, run-spike (mini-smoke, e5-b8, e5-b1, multi-b8, mini-b8), battery, end cleanup, end census.
- Reason: STOP at R5 (precondition for the section 5 reset not met), per section 6 "stop at the first unexpected state".

## Notes (interpretation, kept apart from observations)
- The MC-3874 rule needs a signer record before uninstall. With the allowed forms it cannot be produced from the device side. A route needs a decision: an allowed read of the installed signer, or an explicit maintainer decision to uninstall on the signature-mismatch failure alone. The run did not decide this.
- The previous run (s3a-689-r2) reported that the adbg README lists `shell pm path` and `shell sha256sum` for the own package. Not verified in this run and not sent, because section 2 does not list them.
- Brief text had backslashes stripped (for example `C:Usersyor42...`). Real paths used: C:\Users\yor42\AppData\Local\Temp\..., C:\Projects\RisuAI\Agents\Tools\device-guard\adbg.mjs, C:\Projects\RisuAI\.claude\scripts\workflow-control.mjs. serve.mjs and run-spike.mjs exist only in the worktree C:\Projects\RisuAI\.claude\worktrees\689-ltm-embed-spike-0a21d2\Agents\Tools\ltm-embed-spike\.
- Standing list confirmed from .claude/workflow-policy.json (standingPackages 38 entries, keepHelpers dev.risu.dv603 not installed).

## Open items
- Maintainer/PR session: signer-read route for MC-3874 (see Notes).
- Phone 2 holder label 689-orchestrator while lease s3a-689-r3 was granted.
- Phone 2 is needsReset true after release without --clean; the next holder needs a reset (census-start is clean; no reset was performed).

## Evidence files
- This file: C:\Users\yor42\AppData\Local\Temp\s3a-run1\s3a-result.md
- Census start: C:\Users\yor42\AppData\Local\Temp\s3a-run1\census-start.md
- Guard log: C:\Users\yor42\AppData\Local\Temp\s3a-run1\adb-commands.log
