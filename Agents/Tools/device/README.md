# Agents/Tools/device - device-check scripts

PowerShell 7 scripts (plus one Node helper) that run one bounded check against a test phone and write a JSON result. They are
campaign tooling, not application code. Purpose (MC-330 item 7): per-check scripts that write JSON results, plus a whole-app-data
snapshot/restore for the test profile, so a device check has a time cap, a data ceiling and a pass/fail exit (MC-330 item 4).

Sources for this page: the scripts and `tests/Test-Runner.ps1` as of 2026-10-22, and the stage verdicts and hand-backs kept in
scratch (`%TEMP%\risu-b715\devscripts\`, not in the repository). Where a statement has no source it says TODO(evidence).

## Scripts

| Script | One line |
|---|---|
| `lib.ps1` | Shared helpers, dot-sourced by every script: tracked child processes, bounded adb, device lock, result JSON, CDP forwards, crash watch, fixture push, import-ring logic. Do not run it. |
| `Run-Check.ps1` | Runs one child command under a hard cap and writes `result.json`. |
| `build-apk.ps1` | Android APK build through Run-Check (debug or release). |
| `sign-install.ps1` | Verifies (and for release re-signs with a throwaway key) and installs an APK on the test phone. |
| `device-prep.ps1` | Keeps the phone awake and exempts the app from battery optimisation; `-Revert` restores the originals. |
| `cold-start.ps1` | N cold starts: `am start -W` time, ready signal over CDP, settled PSS. |
| `cdp.mjs` | `node` helper: evaluates one expression in the first page target of a forwarded WebView devtools port. |
| `snapshot.ps1` | Whole-app-data snapshot of the test profile (debug builds only). |
| `restore-snapshot.ps1` | Restores a snapshot into the app data and verifies it against the manifest (debug builds only). |
| `import-bin.ps1` | Drives the app's own "load local backup" UI for one `.bin` fixture and collects the import phase marks. |
| `fixture-push.ps1` | Pushes (or removes) one fixture file in the phone's shared storage, with a SHA-256 skip. |
| `tests/Test-Runner.ps1` | Self-tests with a fake adb; needs no device. |

Every script takes `-OutDir` (created if missing) and writes `<OutDir>\result.json`; most print one line
`verdict=<v> reason=<text> result=<path>` and exit 0 only for `pass`, else 1.

## Result JSON (all scripts except `cdp.mjs`)

`schema` is `1`. Common fields (from `New-Result`/`Complete-Result` in `lib.ps1`):

```
{ "schema": 1, "checkId": "...", "commit": {...},
  "build":   { "kind": "debug|release|none", "apkSha256": null, "versionName": null },
  "device":  { "serial", "model", "android", "webview", "battery": {level, tempC, charging}, "dataFreeKB" },
  "data":    { "fixture": null, "bytes": null, "ceilingBytes": null },
  "startedAt", "endedAt", "durationSec", "capSec",
  "phases":  [ { "name", "startedAt", "endedAt", "durationSec", "note" } ],
  "verdict": "pass|fail|timeout|crash", "reason": "...",
  "evidence": { "log", "logcat", "screenshots": [], "phasesJson", "consoleTxt" },
  "snapshot": null }
```

While running, `verdict` is `running`. A finished result must have `endedAt`, `durationSec` and `reason`; a result that breaks
the schema is rewritten as `fail` with a `schema: ...` reason. Scripts add their own blocks (`prep`, `cold`, `transfer`, `push`,
`import`, `install`, `warnings`, `steps`).

| Verdict | Meaning |
|---|---|
| `pass` | The check's own success condition held. |
| `fail` | Any other failure; `reason` says which (gate refusals, nonzero child exit, `device-offline`, schema). |
| `timeout` | The `-MaxSeconds` cap was reached. |
| `crash` | The app process was lost, or a fatal log line / renderer loss was seen (not an intended force-stop). |

## Usage

Run from the repository root with `pwsh -NoProfile -File Agents\Tools\device\<script>.ps1 ...`. Defaults below are the script
defaults; `-Serial` defaults to phone 1 and `-AllowedSerials` defaults to that one serial (see Shared defaults).

### Run-Check.ps1

Required: `-CheckId`, `-OutDir`, `-MaxSeconds` (1-1800), `-FilePath`, `-BuildKind` (`debug|release|none`). Optional:
`-ArgumentList`, `-WorkingDirectory`, `-Environment` (hashtable, restored afterwards), `-ArtifactPath`, `-Serial`, `-Package`,
`-RequireApp`, `-PollSeconds 2`, `-RepoRoot`, `-AdbExe`, `-KillLingering`.

First condition wins: child exit (`pass` on 0, `fail` otherwise), cap (`timeout`), and only with `-RequireApp`: app process gone
for 2 consecutive polls (`crash`) or device offline (`fail`, `device-offline`). With `-ArtifactPath` a pass also needs the
artifact to exist (else `fail`); its SHA-256, mtime, `artifactFresh` and `returnLagSec` go to `build.*`. A stale artifact keeps
`pass` with the reason `child exited 0; artifact not rewritten`. On `pass` recorded survivors (for example a Gradle daemon) keep
running and are listed in `lingering`; on any other verdict, or with `-KillLingering`, every recorded descendant is stopped by
PID (`stoppedPids`). Extra result fields: `rootPid`, `realPid`, `exitCode`, `descendantPids`.

```
pwsh -NoProfile -File Agents\Tools\device\Run-Check.ps1 -CheckId demo -OutDir $env:TEMP\risu-b715\demo -MaxSeconds 60 `
  -FilePath pwsh -ArgumentList @('-NoProfile','-Command','exit 0') -BuildKind none
```

### build-apk.ps1

`-OutDir` (required), `-Kind debug|release` (default `debug`), `-MaxSeconds 1500`, `-CleanBuild`, `-Config`, `-Target aarch64`,
`-BuildEnv` (hashtable merged over `JAVA_HOME`, `ANDROID_NDK_HOME`, `CARGO_TARGET_DIR`), `-RepoRoot`, `-ScratchRoot`.
Runs `pnpm tauri android build [--debug] --apk true --target <Target> [--config <Config>]`. Needs the pinned JDK 21 and the
`NDK_HOME` environment variable; a missing prerequisite is a recorded `fail`. A held build lock for that kind refuses the run
instead of waiting. A release build reports whether `keystore.properties` exists (existence only; the content is never read). A preflight (after the
JDK and `NDK_HOME` checks, before any lock or build) fails with a recorded `fail` when `-RepoRoot` lacks the gitignored generated
Android files that Gradle needs: a `TauriActivity.kt` inside a `generated` directory under `src-tauri/gen/android/app/src/main` and
`src-tauri/gen/android/app/proguard-tauri.pro` (patterns `/src/main/**/generated` and `/proguard-tauri.pro` in
`src-tauri/gen/android/app/.gitignore`). A `git archive` tree lacks them, and the build would otherwise fail late with
`Unresolved reference: TauriActivity`. The reason names the missing files and how to provide them; the script copies nothing from
another checkout.

```
pwsh -NoProfile -File Agents\Tools\device\build-apk.ps1 -OutDir $env:TEMP\risu-b715\build-debug -Kind debug
```

### sign-install.ps1

`-OutDir`, `-Kind debug|release` (both required), `-Apk`, `-Serial`, `-AllowedSerials`, `-Package`, `-ResignThrowaway`,
`-AllowClear`, `-MaxSeconds 600`, `-RepoRoot`, `-AdbExe`. A debug APK is verified and installed as built (same stable debug
key, so reinstalls stay signature-compatible). A release APK, or any APK with `-ResignThrowaway`, is zipaligned and signed
with a throwaway keystore generated under `-OutDir` for the run and deleted afterwards. Installs with `adb install -r`, then
checks `pm path` and `run-as ... id`; a debug install that is not debuggable fails. A signature mismatch fails with
`signature-mismatch` and changes nothing; only `-AllowClear` uninstalls (which wipes the app data) and reinstalls. Needs
`ANDROID_HOME` (build-tools) and the pinned JDK 21.

```
pwsh -NoProfile -File Agents\Tools\device\sign-install.ps1 -OutDir $env:TEMP\risu-b715\install -Kind debug
```

### device-prep.ps1

`-OutDir` (required), `-Revert`, `-ScreenOff`, `-Serial`, `-AllowedSerials`, `-Package`, `-StatePath`
(default `<ScratchRoot>\device-prep\<serial>.json`), `-MaxSeconds 120` (1-600), `-RepoRoot`, `-AdbExe`. Changes exactly two
things: the global `stay_on_while_plugged_in` setting (set to `7`) and the app's entry in the device-idle whitelist; both are
read back. The originals are recorded in the state file before the first change and a repeated prep keeps the first recording,
so `-Revert` restores the true originals (`fail` if nothing is recorded or it is already reverted). `-ScreenOff` leaves
stay-awake and the wake key alone, for checks about screen-off behaviour.

```
pwsh -NoProfile -File Agents\Tools\device\device-prep.ps1 -OutDir $env:TEMP\risu-b715\prep
pwsh -NoProfile -File Agents\Tools\device\device-prep.ps1 -OutDir $env:TEMP\risu-b715\prep-revert -Revert
```

### cold-start.ps1

`-OutDir` (required), `-CheckId cold-start`, `-MaxSeconds 900`, `-Runs 3` (1-20), `-SettleSec 25`, `-PauseSec 4`, `-ReadySec 90`,
`-CdpTimeoutMs 5000`, `-CdpStallCalls 3`, `-RelaunchGapSec 30`, `-ReadyText`, `-ReadyExpression`, `-Activity .MainActivity`,
`-Serial`, `-AllowedSerials`, `-Package`, `-BuildKind auto|debug|release` (default `auto`, read from the install),
`-PortMin 6330`, `-PortMax 6399`, `-PollSeconds 2`, `-CdpScript`, `-RepoRoot`, `-AdbExe`.
Per run: force-stop, pause, `am start -W` (TotalTime, WaitTime), ready signal over CDP (page text contains `-ReadyText`, or
`-ReadyExpression` evaluates `true`, or the body has rendered text), a page probe, settle, then settled PSS. The intended
force-stop is declared as a relaunch window, so only an unexpected loss, pid change, fatal log line or renderer loss is a
`crash`. A target whose CDP calls time out `-CdpStallCalls` times in a row fails as `cdp-unresponsive`. `settledPssScope` is
`package-attributed` (the app's own pids plus renderers tagged with its uid) or, when attribution is unavailable,
`inclusive-webview` (every process of the package and of the WebView package); the summary holds medians.

```
pwsh -NoProfile -File Agents\Tools\device\cold-start.ps1 -OutDir $env:TEMP\risu-b715\cold -Runs 3 -PortMin 6270 -PortMax 6289
```

### cdp.mjs

`node Agents\Tools\device\cdp.mjs <port> [--timeout <ms>] (-e "<expression>" | -f <file.js>)`. Prints the JSON value of the
expression (promises are awaited). Always ends within `--timeout` (default 10000 ms). Exit codes: 0 value printed, 2 no page
target, 3 timed out, 4 connection, protocol or evaluation error. The scripts call it themselves; `-CdpScript` overrides the path.

### snapshot.ps1 and restore-snapshot.ps1

`snapshot.ps1`: `-OutDir`, `-Id` (both required), `-Profile test`, `-SnapshotRoot` (default `<ScratchRoot>\device-snapshots`),
`-Pin`, `-ProducedBy manual`, `-WarnBytes 2147483648` (2 GiB), `-RefuseBytes 4294967296` (4 GiB), `-Keep 3` (1-50), `-Serial`,
`-AllowedSerials`, `-Package`, `-MaxSeconds 1500`, `-RepoRoot`, `-AdbExe`.
`restore-snapshot.ps1`: `-OutDir`, `-Id` (required), `-Profile test`, `-SnapshotRoot`, `-Serial`, `-AllowedSerials`, `-Package`,
`-MaxSeconds 1500`, `-RepoRoot`, `-AdbExe`.

A snapshot lives in `<SnapshotRoot>\<Profile>\<Id>\` as `snapshot.tar` plus `snapshot.json` (the manifest, written last). The
app is force-stopped first; the app data dir is archived from inside the app uid (`run-as ... tar`) over `adb exec-out` into a
file, never a pipe. `cache`, `code_cache` and `lib` are not part of it. Ids are never overwritten; the newest `-Keep` unpinned
snapshots of a profile are kept, pinned ones never pruned. Above `-WarnBytes` a warning is recorded and printed; above
`-RefuseBytes` the run is refused, before and during the copy. A release build is refused (`run-as` does not work for it).

Restore checks everything that cannot touch the device first (manifest, tar size and SHA-256, installed build is debuggable
with the same versionCode, signing digest and package, free space), then force-stops the app, pushes the tar with `adb push`
(adb stdin is not binary-safe on Windows), checks the hash on the device, force-stops again, removes the covered top-level
entries as a whole and extracts inside the app uid with `tar --no-same-owner -xf`, so the files take the current app uid (a restore
after an uninstall and reinstall has a new uid, and a tar that keeps the archived owner fails on chown). It then requires the entry list, file count and exact per-entry byte sums
to equal the manifest (`du` block counts are recorded but not compared). `result.deviceTouched` says whether the device data
was changed. A failure after the removal leaves the data in an undefined state; the reason says "restore again".

```
pwsh -NoProfile -File Agents\Tools\device\snapshot.ps1 -OutDir $env:TEMP\risu-b715\snap -Id baseline -Pin
pwsh -NoProfile -File Agents\Tools\device\restore-snapshot.ps1 -OutDir $env:TEMP\risu-b715\restore -Id baseline
```

### fixture-push.ps1 and fixtures

Fixtures are synthetic `.bin` files on the PC (MC-324 tiered data; the scripts do not generate them). `fixture-push.ps1`:
`-OutDir`, `-FixturePath` (required), `-CheckId fixture-push`, `-RemoteName` (default: the file name), `-RemoteDir /sdcard/Download`,
`-CeilingBytes 629145600` (600 MiB), `-AllowLarge`, `-AllowLargeReason`, `-Remove`, `-MaxSeconds 1200`, `-Serial`,
`-AllowedSerials`, `-Package`, `-RepoRoot`, `-AdbExe`.

- The transfer is skipped when the device already holds a file of that name with the same SHA-256 (`push.skipped`). A pushed
  copy is hashed on the device again and removed if it differs.
- The remote name must start with a letter or digit and use only `A-Za-z0-9._-` (128 characters at most); the remote directory
  must be `/sdcard` or below it, with no segment starting with a dot. Fixtures live below `/sdcard` only.
- `-Remove` deletes the named fixture instead of pushing.
- Ceiling gate: a fixture above `-CeilingBytes` is refused before any adb call unless `-AllowLarge` and a non-blank
  `-AllowLargeReason` are both given; then the run proceeds and records a warning with the reason. The ceiling is a caller
  parameter, so a huge `-CeilingBytes` bypasses the reason requirement.

```
pwsh -NoProfile -File Agents\Tools\device\fixture-push.ps1 -OutDir $env:TEMP\risu-b715\fx -FixturePath $env:TEMP\risu-b715\fixtures\c-300m.bin
```

### import-bin.ps1

`-OutDir` (required), `-CheckId import-bin`, `-MaxSeconds 1500`, `-FixturePath`, `-RemoteName`, `-RemoteDir /sdcard/Download`,
`-CeilingBytes 629145600`, `-AllowLarge`, `-AllowLargeReason`, `-SnapshotId`, `-Profile test`, `-SnapshotRoot`, `-NoRestore`,
`-MenuTaps`, `-ConfirmTap`, `-WarnPattern`, `-WizardPattern Airisu`, `-ReadySec 90`, `-LaunchSettleSec 12`, `-SettleSec 8`,
`-BootWaitSec 0`, `-LoadingPattern '^\s*Loading\.\.\.'`, `-PickWaitSec 9`, `-TapPauseSec 2`, `-ConfirmPauseSec 3`,
`-CdpTimeoutMs 4000`, `-RelaunchGapSec 30`, `-RetryGraceSec 120`, `-Activity .MainActivity`, `-Serial`, `-AllowedSerials`,
`-Package`, `-PortMin 6330`, `-PortMax 6399`, `-PollSeconds 2`, `-CdpScript`, `-RepoRoot`, `-AdbExe`.

Needs a debuggable MEASURE build (the import phase ring `__risuImportPhases` is on when the page's localStorage key
`risu-measure-import` is on; the script sets that key after the app booted). Give exactly one of `-SnapshotId` (the import
starts from a restored snapshot) or `-NoRestore`. Order, every step bounded by the cap: gates with no adb call, per-device
lock, fixture push (SHA-256 skip), restore of the snapshot, cold launch, read-only census, UI drive, import watch, settle,
census again. Without `-RemoteName` and with `-FixturePath`, the device name is `<stem>-<8 hex run id><ext>` and is removed at
the end; an explicit `-RemoteName` or a device-side fixture is never removed. Without `-FixturePath` the fixture must already
be on the device. `result.json` adds `steps`, `fixture`, `start`, `atDone`, `end`, `startState`, `runId` and `import`
(`pickedAt`, `doneAt`, `seconds`, `outcome`, `restartBased`, `warnConfirmed`, `bootState`, `noticesDismissed`, ...); each ring mark is one
`phases[]` row and the raw longest snapshot is `<OutDir>\phases.json`. The picker dump is `<OutDir>\picker-ui.xml`.

```
pwsh -NoProfile -File Agents\Tools\device\import-bin.ps1 -OutDir $env:TEMP\risu-b715\imp -FixturePath $env:TEMP\risu-b715\fixtures\c-300m.bin `
  -SnapshotId baseline -BootWaitSec 60 -PortMin 6270 -PortMax 6289
```

## Shared defaults and hazards

- **RISK - port defaults.** `cold-start.ps1` and `import-bin.ps1` default to `-PortMin 6330 -PortMax 6399`. `Agents/Lanes/README.md`
  reserves 6000 to 6399 for lane A ("device ports as in its scripts") and the orchestrator's rules give phone 1 as 6270-6309 and
  phone 2 as 6310-6329, so the default sits inside lane A's reservation and collides with neither phone range. It is still a
  shared default: two runs that both rely on it can pick the same port (the scan skips a port that already has a forward and
  uses `--no-rebind`, but two agents starting together are not coordinated). Pass `-PortMin` and `-PortMax` from the agent's own
  range when more than one device agent works at once. (Before CHORE-204 the default was 9500-9599, outside every
  reservation.)
- **Devices (orchestrator-restated memory rules, not in the scripts).** Phone 1 is serial `29f3cde9193f7ece`, ports 6270-6309;
  phone 2 is `2ac80128013f7ece`, ports 6310-6329. Scripts default to phone 1 (`DefaultSerial` in `lib.ps1`). For phone 2 pass
  both `-Serial` and `-AllowedSerials`; a serial outside the allowed list is refused before any adb call. Only package
  `io.github.yor42.risutanium` is allowed.
- **`-s` on every adb call.** `Invoke-Adb` in `lib.ps1` adds `-s <serial>` when given a serial; call adb by hand the same way.
- **One agent per device.** Only lane A drives the phones (`Agents/Lanes/README.md`); other lanes ask the maintainer to pass the
  request, with a data ceiling, a time limit and a pass/fail exit (MC-330). A per-device lock
  (`<SnapshotRoot>\device-<serial>.lock`) is held by snapshot, restore and import-bin; a stale lock of a dead process is replaced.
  The lock is not continuous in import-bin (see the lock gap below).
- **Process kills.** Scripts stop only PIDs they recorded (the child and its descendants) and remove only the adb forwards they
  made, from their `-PortMin`..`-PortMax`. Never kill by image name; kill only PIDs you started. import-bin stops nothing
  itself: a harness does.
- **Test profile only.** Never hand-edit app state; use snapshot/restore. Fixtures are synthetic only.
- **Build target dir.** `build-apk.ps1` sets its own `CARGO_TARGET_DIR` per kind: `<ScratchRoot>\cargo-target-android-<kind>`
  (warm by default; `-CleanBuild` empties it first, refusing any path not of that form). One build per kind at a time.
- **Scratch root.** `%TEMP%\risu-b715` (`ScratchRoot` in `lib.ps1`): snapshots in `device-snapshots`, prep state in
  `device-prep`, build target dirs.
- **Debug vs release.** Snapshot, restore and import-bin need a debuggable (debug) build because they use `run-as`, which a
  release build refuses; they fail with `release-build`. cold-start works with either and records the kind. Any number from a
  check should name its build kind and device (the plan recommended this; TODO(evidence): the plan's Q3 answer is not in the
  sources). import-bin additionally needs the MEASURE build; how the MEASURE flag is built in is TODO(evidence) (the hand-backs
  name a "MEASURE debug APK" installed with `sign-install.ps1`; `build-apk.ps1` takes `-BuildEnv` and `-Config` but the
  sources do not say which values make a MEASURE build).
- **Where APKs and keys live.** `build-apk.ps1` output:
  `src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk` and
  `...\universal\release\app-universal-release-unsigned.apk`; `sign-install.ps1` writes a re-signed copy to
  `<OutDir>\signed.apk`. A release build signs through `src-tauri\gen\android\keystore.properties` when that file exists;
  `sign-install.ps1` uses a throwaway key generated per run and deleted afterwards. Signing material (`src-tauri\key.txt`,
  keystores, `keystore.properties`) is never read or quoted by the scripts or by this page.
- **Toolchain paths.** `build-apk.ps1` and `sign-install.ps1` hard-code the Gradle-managed JDK 21 at
  `C:\Users\yor42\.gradle\jdks\azul_systems__inc_-21-amd64-windows.2`; `NDK_HOME` and `ANDROID_HOME` must be set.
- **Phone awake.** Run `device-prep.ps1` before a check (except screen-off checks). A cold-start attempt once timed out in
  `am start -W` because the screen was Dozing; waking it with `KEYCODE_WAKEUP` fixed it (Stage 2 hand-back).

## Note 9 tap coordinates and UI notes

Taps are Note 9 coordinates and are parameters (`-MenuTaps`, `-ConfirmTap`); other devices need other values.

- `-MenuTaps` default: `'62 157'`, `'105 125'`, `'105 283'`, `'233 900'`, `'538 610'`, each `x y` (the script refuses a tap not
  matching `^\d+ \d+$`), with `-TapPauseSec` (2 s) after each. What each tap hits in the app UI is TODO(evidence); the scripts
  state only the coordinates.
- `-ConfirmTap` default `'264 1210'`, tapped twice, after `-ConfirmPauseSec` (3 s) before each tap. Then `-PickWaitSec` (9 s), a
  `uiautomator dump` to `/sdcard/risu-import-ui.xml` (removed afterwards, copied to `picker-ui.xml`), and a tap at the centre
  of the bounds of the picker row whose text equals the remote file name. No such row fails with `file-not-in-picker`.
- Notices: the script dismisses informational notices of the app and never a confirm dialog. It clicks the button of an
  `[data-alert-box]` only when that box has exactly one button, the label is `OK` (any case) or the Korean OK label
  (`\uD655\uC778`), the box holds no input control and its text does not match `-WarnPattern`. A Yes/No dialog always has two
  buttons, so the incomplete-items question (whose Yes leaves data out) and the size warning are never clicked by this path.
  It runs (1) after launch, up to 3 notices, before the measurement flag is set; (2) on every ring poll of the import watch while
  the size warning is not showing (the notices of what an import left out show before the reload); (3) at the top of every
  iteration of the boot wait (the archive-characters notice, "To keep memory use low ...", shows after the reload and the boot
  waits for its acknowledgement). `import.noticesDismissed` lists the first 60 characters of each dismissed notice (at most 20).
  The earlier dismissal ran once, at launch only, and matched `OK` case-sensitively, so it missed any notice after the import
  and every notice in the Korean UI (label `\uD655\uC778`).
- Size warning: `-WarnPattern` default matches the start of the store2 time warning ("This backup holds ...", Korean "\uC774 \uBC31\uC5C5\uC5D0\uB294 \uD30C\uC77C\uC774 ...")
  and of the store2 size warning ("The saved data in this backup ...", Korean "\uC774 \uBC31\uC5C5\uC5D0 \uB4E4\uC5B4 \uC788\uB294 \uB370\uC774\uD130\uB294 ..."), plus the older Korean
  database-size opening; Korean text is written as `\uXXXX` escapes. A locale change to those strings needs this default
  updated, or the run waits for a manual tap. While the warning text shows, the script clicks the confirm button inside the
  `[data-alert-box]` element whose text matches it: the button text must be `Yes`, `OK` or the Korean "yes" or "ok" labels
  (`\uC608`, `\uD655\uC778`), matched case-insensitively, so the English UI's `YES` and `OK` and the Korean UI both work. A
  different dialog that replaced the warning is never confirmed. The first click can be swallowed, so the click repeats up to
  6 times, 6 s apart; `import.warnClicks` records the count.
- The wizard probe uses `-WizardPattern` (default `Airisu`) and the loading probe `-LoadingPattern`; `-BootWaitSec` (default 0)
  is how long to wait for the loading screen to go. `import.bootState` is `booted`, `wizard`, `still-loading` or `unknown`.
  The wizard shows after import of a synthetic backup that lacks `didFirstSetup` (Stage 4 source reading); it was not observed
  natively in Stage 4 (Stage 3 observed it natively after importing a synthetic bin).

## import-bin semantics

- **Pass.** The import counts as done at a terminal ring mark `import committed, attempt N`, or when the page restarted after
  the mark `import commit start, attempt N` (the app reloads its page after the commit, which ends the ring; on the Note 9 the
  last mark seen was `import commit start, attempt 1`). A restart-based done, or a boot that is still loading at the end,
  passes only if the start and end `store2Entries` are both readable and the end is higher. A mark-based `import committed`
  with a boot that finished (`booted`, `wizard` or `unknown`) passes without that growth check; with a still-loading boot it
  needs the same growth. Failure statuses (`declined`, `read-failed`, `repair-refused`, `unsavable`, `base-unreadable`,
  `conflict`, `unknown`, `failed`, `abandoned`, `refused`) are terminal.
- **R1 - pass is store growth, not proof the commit finished.** For a restart-based or still-loading run, `pass` means the
  store grew after `import commit start`; it does not prove the commit flip landed. A failed commit that wrote shard units and
  then reloaded the page would pass. No observed case does this (g4s4r2).
- **Retries and R2.** The app retries a `conflict` or `refused` first attempt once (two attempts in all). That attempt-1 mark is
  not the end while the app retries. If no further mark follows within `-RetryGraceSec` (120 s, measured on the page clock
  between marks), the run fails with "no further attempt started within N s", which is also the outcome for a refusal the app
  does not retry. **The grace does not scale with fixture size**: for a much larger bin whose second decode exceeds 120 s on a
  slow phone, a live retry would be called a failure; raise `-RetryGraceSec` for big fixtures (g4s4r2 R2). A re-decode took
  about 4 s on the 353 MB fixture.
- **Ceiling gate.** `-CeilingBytes` (default 600 MiB) is declared by the check. With `-FixturePath` the gate runs before any adb
  call. A fixture already on the device is gated after nine read-only calls (start-server, get-state, model, Android version,
  battery, `df /data`, `dumpsys webviewupdate`, `dumpsys package`, `stat -c %s <fixture>`) and before any write, restore or
  launch. A fixture above the ceiling fails with a `data-ceiling:` reason unless `-AllowLarge` and `-AllowLargeReason` are
  both given (a reason alone does not allow it). `-CeilingBytes` is a caller parameter.
- **`chaIdTokens` is not a character count.** The census counts distinct text runs that start at `chaId` and end at the next
  comma in the store2 shard units, so the same id followed by different text counts more than once, and chat messages carrying
  a `chaId` are counted too. It is not a pass criterion. `store2Entries` (the entry count of `store2`) is the stable marker.
  On the Note 9 the figure read 32, 32 and 64 right after a 485-character import and 96 after a later one, while a PC count of
  the Stage 3 snapshot showed 485 distinct ids. The cause of the low reading was not established (the hand-back guessed that it
  grows as the app boots; the Gate 2 r1 reviewer called that unverified). Use `store2Entries`, not `chaIdTokens`.
- **Same starting state** rests on the snapshot hash and the restore verification recorded in `snapshot` and `startState`.
- **F7 - lock gap.** import-bin holds the device lock from after the no-adb gates to the end, but must release it while the
  restore child runs (the child takes the same lock) and takes it back at once. Mutual exclusion is therefore not continuous
  between the restore child's exit and the take-back. If another process takes the lock in that gap the run fails before
  launch ("took ... while the restore ended"). The damage window is a competing snapshot or restore force-stopping the app after
  the restore verified. Do not start a second device agent in that window (g4s4r2: accepted as documented, low).
- **Verdicts.** `crash` also covers loss of the app or a fatal log line during settle and boot wait; `timeout` is the cap;
  everything else is `fail` with its reason.

## Accepted limits

From the Gate 2 verdicts (scratch records; each was accepted or left as a limit by the reviewer, not necessarily by the
maintainer; TODO(evidence): whether the orchestrator recorded them anywhere else).

- **Stage 1.** An empty lock file left by a crash between creation and PID write counts as held forever. A killed `build-apk`
  leaves its Run-Check tree uncapped. A PID recycled within the 3 s creation-time tolerance of the process tracker could still be
  adopted (judged vanishingly unlikely). The build-apk test covers only the `NDK_HOME` branch of the missing-prerequisite check.
- **Stage 2 N3.** The static guard against `logcat -c` / `--clear` needs the flag on the same line as the word `logcat`; a
  multi-line array, a flag held in a variable or `-cb` passes it. Static guards cannot be complete.
- **Stage 2 N4.** If the test runner is killed between launch and cleanup, the `ping -n (100000+PID)` helper of the
  `tickthrow` test lives about 28 h instead of 5 min.
- **Stage 2 N5.** The PSS attribution reports `package-attributed` whenever the app's own process record exists. If a dump lists
  renderers in another tag form, owned renderers are missing and the figure undercounts under that label. The form was
  verified on the Note 9 (Android 10) only.
- **Snapshot/restore.** A failed extraction after the removal leaves the data wiped or partial, with no rollback (the reason
  says so; the snapshot remains). The temp tar in `/data/local/tmp` leaks if the PC process is killed. The app could be
  relaunched in the milliseconds between the second `pidof` check and `rm -rf`; this is not closed. Release-build refusal was
  tested against a fake adb only. No 0.1 GB or 1 GB state was measured (smallest sized state 0.23 GB; throughput about
  12 MB/s device-to-PC and 32 MB/s PC-to-device on one Note 9 over USB, debug build).
- **import-bin.** R1 and R2 above; the lock gap F7; the native runs used the Korean UI. No failing-restart or retry case was
  run natively (fake adb only), and no over-ceiling run. The Gate 2 r2 test gaps N1 to N4 are closed in s4a (Gate 2 r3
  `[APPROVE]`, 296 PASS): N1 by the `warnfirst` scene (a confirm button outside the warning box), N2 by a test that a restart after only
  pre-commit marks does not pass, N3 by the `lsdrop` test (a final-census app loss returns crash, not pass), N4 by the
  case-insensitive confirm-button match.
- **Stale-lock replace race** (final Gate 2, found by reading, no repro; fixed in CHORE-204). A waiter now takes a stale lock by
  moving it to a tombstone named after the stale holder (`<lock>.stale-<pid>-<start ticks>`); a move onto an existing name
  fails, so a second waiter that judged the same holder stale cannot remove the fresh lock the first created. The lock's
  timestamp is set to now before the move, so the tombstone is fresh from the moment it exists and another waiter's tombstone
  cleanup cannot remove it in between. Limits that remain: a tombstone stays in the lock's folder until the next replacement
  removes tombstones untouched for 10 minutes; a stale holder identity cannot be claimed twice within those 10 minutes (a dead
  process does not come back, so this only matters to a test); a waiter stalled for more than 10 minutes between judging and
  moving is not covered; and a failed timestamp update (read-only or locked file) makes the waiter give up that attempt and
  look again rather than move the lock.
- **Parallel runs.** The older `forward --no-rebind tcp:9770` assert can flake with 3 or more simultaneous test runs.

## Running the tests

`tests/Test-Runner.ps1` tests `lib.ps1`, `Run-Check.ps1` and the device scripts with scripted children and a fake adb (a
stateful node script plus a `.cmd`). It needs no device and no real adb. Plain asserts print `PASS ...` / `FAIL ...`; exit
code 0 only if every assert holds, and the last line is `ALL PASSED` or `FAILED: <n>`.

```
pwsh -NoProfile -File Agents\Tools\device\tests\Test-Runner.ps1
pwsh -NoProfile -File Agents\Tools\device\tests\Test-Runner.ps1 -Fast -ScratchBase $env:TEMP\risu-b715\mine\scratch -RunnerDir C:\path\to\copy
```

- `-RunnerDir`: another copy of the runner directory to test (default: the parent of `tests`). Used to prove that a broken
  variant fails the tests.
- `-ScratchBase`: where per-run scratch is created (default
  `%TEMP%\risu-b715\devscripts\s2r\runner-tests`; each run uses a new GUID subfolder and removes it at the end).
- `-Fast`: skips the sections the stage 4 and lock tests do not depend on; for scratch mutant runs only, not as a pass.
- Host ports: the forward and port-scan tests probe host ports 9770 to 9799 (outside every lane reservation). A listener on
  one of them makes those tests fail spuriously; a live device run on lane A's ports no longer does.
- Current count: 330 PASS, 0 FAIL, ALL PASSED (CHORE-204 remediation: one full run and the round 2 reviewer's run; 327 before the remediation, 296 in s4a). The full
  serial suite took about 20 to 25 minutes. The build-apk generated-files test through `build-apk.ps1` needs the pinned JDK 21
  and prints `SKIP` without it (the unit checks of `Get-AndroidGeneratedMissing` still run).

## Development discipline

The scripts are live (other agents run them), so never edit them in place.

1. Copy the directory to a scratch folder outside the repository (under `%TEMP%`), edit and test there with `-RunnerDir` and a
   private `-ScratchBase`.
2. When finished, write the repository files in one `Copy-Item` pass, then byte-compare each against the scratch copy
   (for example `Get-FileHash` on both) and check the line endings.
3. **LF and ASCII.** Every file here is LF only, no BOM, ASCII only (the stage hand-backs checked CR=0, BOM=False, non-ASCII=0,
   final LF). Non-ASCII text such as the Korean `-WarnPattern` is written as `\uXXXX` escape text.
4. **Escape trap.** The Edit tool turned `\uXXXX` escapes typed in new text into real characters; a byte scan caught it and the
   text was rewritten as ASCII escapes (Stage 4 hand-back). After any edit near an escape, scan for bytes above 127. Prefer
   `Copy-Item` from a checked scratch file over Edit/Write for the repository write.
5. Write PowerShell with single-quoted strings; avoid double-quoted strings and here-strings for code edits (a backtick
   sequence once became a lone CR in another file).
6. Re-run the full suite after changes; show a new guard failing on a mutant copy (red) before relying on it.
