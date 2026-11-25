# Device-subagent brief template

Fill-in brief for one device subagent (the Haiku `device-runner` for scripted guarded rows, a Sonnet role for judgement or UI rows; see [routing](../../../docs/workflow/routing.md)) that runs rows on a leased Note 9 (#647, MC-3773, MC-3774). The PR's own session fills every `<placeholder>`, copies the checklist sections its rows need inline (a pointer is not enough: [live-checks](../../../docs/workflow/live-checks.md#device-and-pc-checklist) requires the text in the brief), lists the row's own guard forms in section 2 and pastes the whole brief into the dispatch. A brief missing the lease request, token, pinned APK hash, row list or stop conditions is returned unrun.

Placeholders:

| Placeholder | Meaning |
|---|---|
| `<serial>` | the leased phone's serial, from the grant (`serial`) |
| `<ports>` | the run's own ports as a comma-separated list (for example `6271,6272`; never a `min-max` range, which `adbg.mjs` drops from `--own-ports` so port calls fail with exit 97), chosen from the grant's `ports.min`..`ports.max` |
| `<run>` | the run folder under `%TEMP%` (absolute) |
| `<request>` | the lease request id |
| `<token>` | the lease token; it is in the brief only |
| `<controller>` | `C:\Projects\RisuAI\.claude\scripts\workflow-control.mjs` |
| `<adbg>` | `C:\Projects\RisuAI\Agents\Tools\device-guard\adbg.mjs` |
| `<apk>` | the pinned APK, absolute path, with its SHA-256 |
| `<result>` | the result file, absolute, under `%TEMP%` |

Copy everything below the line into the brief.

---

## 1. Pre-check: what not to do

Two fresh subagents failed their pre-check by calling `dumpsys wifi`. The guard refuses it on a Note 9 with exit 89 (DZ-11), and `cmd wifi ...` with exit 89 (DZ-8). Exit 89 means stop that line of work; never retry a variant.

Wi-Fi state is read only with the guard's own verb, on the leased serial, at the start and at the end of the run:

```
node <adbg> net-status --serial <serial> --log <run>\adb-commands.log
```

It prints `wifi_enabled=off associated=no validated=no`. Anything else is section 4's Wi-Fi rule.

## 2. Allowed guard forms, exactly

Every adb call has the live-checks form, with `<args>` after `--`:

```
node <adbg> --serial <serial> --log <run>\adb-commands.log --own-ports <ports> --own-package io.github.yor42.risutanium -- <args>
```

`<args>` is one of these, and nothing else:

- `reverse --list`
- `reverse tcp:<p> tcp:<p>` (a port from the lease range only)
- `reverse --remove tcp:<p>`
- `shell pm list packages -3`
- `uninstall <package>` where `<package>` matches `^dev\.risu\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$` (case-sensitive; no `-k`)
- `shell pm clear io.github.yor42.risutanium`
- `install -r <apk>` (the pinned APK only)
- `exec-out screencap -p --out <run>\<name>.png` (the guard writes the PNG to `--out`; on the Note 9 playground serials it runs no own-package pin or picker probe, those apply to restricted serials only, so check the frame yourself before relying on it)
- the row's own forms, which the PR session lists here per row: `<row forms>`

`net-status` (section 1) is the one verb outside the line above; it takes no `--` arguments (exit 2), works on the two Note 9 serials only and exits 4 when a field is unknown. Exit 4: stop and report.

Anything else is not sent: stop and hand back.

## 3. No chained or combined commands

One adb call per action. No `;`, `&&`, `||`, `|`, `&` or backticks inside a shell string. `pm clear` and `uninstall` are separate calls. The guard's DZ-6 exception for the test app is anchored to the whole command, so a chain such as `pm clear io.github.yor42.risutanium && pm uninstall dev.risu.x` or `pm clear io.github.yor42.risutanium; pm list packages -3` is refused with exit 89.

## 4. Checklist

`<the live-checks "Device and PC checklist" sections this row needs, copied here in full by the PR session>`

Always, in addition:

- Synthetic data only.
- Own ports only, from the lease (`<ports>`).
- `reverse --list` at the start; report any reverse the run did not create and never use it.
- At the end: `reverse --remove tcp:<p>` for every own port, then `reverse --list` and `net-status` again.
- If `net-status` shows Wi-Fi on or associated: `svc wifi disable`, stop and report.

## 5. Allowed resets, nothing else

- `shell pm clear io.github.yor42.risutanium`.
- Reinstall of the pinned APK (`install -r <apk>`), then read the device `base.apk` hash back as live-checks "State and data" says.
- `uninstall` of the `dev.risu.*` packages the census (section 8) finds.
- On a Note 9 only (MC-3874): when `install -r <apk>` fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` because the installed `io.github.yor42.risutanium` is signed with a different key than the pinned APK, `uninstall io.github.yor42.risutanium` (no `-k`, one call) and then `install -r <apk>`. This destroys the app's data, so it needs synthetic data only on that phone. Before the uninstall, record the install step's `INSTALL_FAILED_UPDATE_INCOMPATIBLE` output (including any signer detail it reports) and the pinned APK's SHA-256 (plus its certificate SHA-256 from `apksigner verify --print-certs` if available on the host) in the result; section 2's default forms do not include pulling or inspecting the installed `base.apk`, so do not invent an unlisted adb call for it. Stop and report instead on any other serial, on the Fold 7 and the Tab S9, on any other failure, or when the phone holds data that is not synthetic.

Never a factory reset, never another package, never a settings reset beyond restoring the values the run changed.

## 6. Stop at the first unexpected state

Report and hand back; never improvise a workaround.

- Exit 89: danger zone. Stop that line of work and never retry a variant.
- Exit 97: shape refusal. Spell a globbed or misshapen command out once, in a form listed in section 2; otherwise stop. A policy refusal (target, port, verb) is never worked around.
- Exit 95: restricted or wrong serial. Stop.
- Exit 99: usage. Complete the same call once, with no flag, port, target or verb changed.
- Exit 92 or 93, and PICK-LOCK: the live-checks STOP rule. On a Note 9 send no input after a failed locate until a fresh locate or screenshot identifies the target.
- Any other nonzero exit, or an unexpected package, screen or reverse: stop and hand back.

## 7. Lease handling

- The token is `<token>`. Never print it, echo it, or write it to the result file, the run logs or any other file.
- Before every step, and at least every `heartbeatSeconds` (the grant carries it): `node <controller> lease-renew --request <request> --token <token>`. A refusal means the lease has lapsed: stop every adb call and hand back.
- If the grant shows `resetRequired: true`, no row counts yet. Do the allowed resets (section 5) and the census (section 8), then `node <controller> lease-reset-done --request <request> --token <token> --evidence <census file>`.
- Pass `--lease <request> --token <token>` on every `device` claim: `node <controller> device --claim <id> --result pass|inconclusive|fail --required true --evidence <path> --lease <request> --token <token>`. It refuses while the lease is not live or the reset is unacknowledged.
- On every exit path, failure included, release: `node <controller> lease-release --request <request> --token <token> --clean <end census file>` only after a clean end census, otherwise without `--clean` (the phone is then marked as needing a reset for the next holder).
- The PR session releases again after the handback; the call is idempotent.

## 8. Census

Run it at every grant start (before any row) and at the end. The end census's result file is the `--clean` evidence.

1. `shell pm list packages -3` through the guard on `<serial>`. It lists third-party packages only; system and preinstalled packages are outside the census by design.
2. Classify each `package:<name>` line against the grant's lists:
   - in `standingPackages`: keep;
   - in `strandedPackages`: keep and report;
   - in `keepHelpers`: keep and report, even though it matches `helperPattern` (a test app another run still needs; never uninstall it and never mark it stranded), and the end census counts as clean with it present;
   - matches `helperPattern`: remove with `uninstall <name>`, one call each;
   - a vendor or OneUI preinstall (Samsung, Google, Naver/Daum, Microsoft and similar; never `io.github.yor42.*` or `dev.risu.*`; MC-3875): not a maintainer question. Mark it with `lease-reset-done ... --stranded <name>`, list it in the result file and continue; it counts as clean;
   - anything else: STOP.
3. On STOP: no row counts. Release WITHOUT `--clean` and hand back with the package names in the result file. The PR session asks the maintainer whether a later holder marks the package with `lease-reset-done ... --stranded <name>` (a package matching the helper pattern or listed in `standingPackages` cannot be marked stranded).
4. The result file lists every package seen and the action taken.

## 9. Output contract

- The result file is `<result>`, under `%TEMP%`, named `result.md` or `<id>-result.md` (never `REPORT*`, `SUMMARY*`, `FINDINGS*` or `ANALYSIS*`). Per row: the exact command, its output or exit status, and the observation, kept apart from any interpretation. State which rows ran and which did not.
- Hand back exactly three lines: line 1 the absolute path of the result file; line 2 `STATUS:` and the status; line 3 `BLOCKERS/INCIDENTS:` followed by `none` or the list.
