# Note 9 device rows, 2026-11-27 (device-runner, observations only)

Role: device-runner. This file records what was observed. It does not judge acceptance; lane A and the owning sessions do that.

## Setup (what ran)

- Device: Samsung SM-N960N (Note 9), Android 10, leased through the controller (request `devrows-p-1127`, build lock `devrows-build-1127`). No other device touched.
- Build: release APK of `7fd5ad67359d0cec3892343710e444eec9f30468` (origin/main at build time, clean checkout in a scratch worktree, never source-copied). unsigned APK sha256 `83934B89CB2EFEA4E8DFC91FB6C26FB1FB545BFFD99FCD6580B5F98789929E7F`. Build evidence: `%TEMP%\risu-dev-2026-11-27\build\result.json`, `wt-status.txt`, `wt-diff-ignore-eol.txt`. Installed with the persistent test key, `-AllowClear` (MC-3874, old signer not recorded; install tool reported a signature mismatch).
- origin/main has since moved to `a755e9a9f` (includes PR #842). Rows whose PR merged after the build are NOT RUN for that reason.
- Data: synthetic fixtures only, generated with `Agents/Tools/save-gen` (`gen-rows.mjs` under the run folder). The `risky.bin` fixture was imported through the welcome wizard's Restore backup path and the system picker (taps by screenshot coordinates).
- Run folder (evidence): `C:\Users\yor42\AppData\Local\Temp\risu-dev-2026-11-27\` (`shots\s1..s27`, `adb-commands.log`, `adbg-state.json`, `fx\`).
- Enabling Studio: Settings > Accessibility > "Studio (preview)" checkbox tapped once through the UI (device-local switch `risuStudio.enabled`=1). No app state was edited by hand.

## Row results

| Row | PR | Result | Evidence / reason |
|---|---|---|---|
| #794 risky flags (Low Level Access, Utility Bot, Escape Output stored as non-boolean) | #795 line | OBSERVED PASS-shaped, see below | s21..s26 |
| #795 malformed Token bias | #795 line | OBSERVED, see below | s27 and DOM text |
| #301 save timing, large character | #837 | NOT RUN | not reached in this session |
| production-build CDP S1 trace and G4 | #837 | NOT RUN | not reached |
| #479 Home tile measurement, 1000 chars | #832 | NOT RUN | not reached (fixture `fx\home1000.bin` generated, unused) |
| #834 archived card on phone | #842 | NOT RUN | PR merged after the build (HEAD `a755e9a9f`); needs a rebuild |
| #681 DV-C1, DV-C2 | #838 | NOT RUN | needs a multi-file picker and a file chooser inside Studio; no maintainer ruling on that route |
| #721 landing time, data equality, base.apk readback | #840 | NOT RUN | not reached (kit adapted partly: `kit721\`) |
| #751 D-1, D-2, D-5..D-7 (fx-probe pack) | #835 | NOT RUN | not reached; pack import route not located |
| #591 home-500 contrast | #805 | NOT RUN | not reached (`fx\home500.bin` generated, unused) |
| #616 D-1 = #811 D-1 SSE native-reply cancel | #811 | NOT RUN | not reached (`fx\mock.bin` generated, unused) |
| #598 redraw survival | #808 | NOT RUN | not reached (same fixture) |
| #221 3000-row asset list | #807 | NOT RUN | not reached (`fx\c221.bin` generated, unused) |
| #768, #688 | n/a | SKIPPED | not runnable with synthetic data in this session |

## #794 / #795 observations (build 7fd5ad673, release, Note 9)

Fixture `risky.bin`: 3 synthetic characters. RiskyFlags has `lowLevelAccess=1`, `utilityBot='yes'`, `escapeOutput=2`. BadBias has `bias='not-a-list'`.

1. Studio opens only after the Studio (preview) switch is on. The character kind shows a "Studio shows this read-only for now" note when the "Studio" root is selected; the tree opens from the title and the Advanced node is editable.
2. RiskyFlags, Advanced, "Risky settings" panel, start values read from the switch `aria-checked`: Low Level Access `true`, Utility Bot `true`, Escape Output `mixed`. Each shows the note "This setting is stored in an unusual form. Pressing the switch replaces it with a real on or off value; undo puts the original back." (3 notes).
3. Pressed Low Level Access once: it became `false` (a real value), its "unusual form" note disappeared (2 notes left), history shows an edit "Low Level Access" and the title shows "Saved".
4. History > Restore point > Restore...: the dialog "Restore the restore point?" lists "Low Level Access". After Restore, a second dialog "Turn on Low-level access?" appeared (Cancel / Turn on), with the text "This character will be able to reach the AI model and your storage directly."
5. Chose Turn on: Low Level Access back to `true`, 3 "unusual form" notes again, history lists "Restored the restore point" above the edit with a "Revert to here" button.
6. BadBias, Advanced: the Token bias block shows "This list holds a value Studio can't edit, so it is read-only here." with a "Repair list" button; Risky switches all `false`. Pressed Repair list: the block became editable ("+" and "No Bias"). History > Restore... > Restore listed "Token bias"; after Restore the read-only message and the Repair list button were back (restore returned the malformed value).
7. Not run: a second visit edit/undo sequence beyond the restore points above, and verification of the stored value in the saved database (read from the UI only).

## Device state at the end

- Fixture `fx-risky.bin` removed from `/sdcard/Download` by exact name; `ls | grep fx-` empty.
- Third-party package census equals the start census (md5 match).
- The installed app is the test-signed 7fd5ad673 release build with the Studio switch on and the `risky.bin` library. The stock APK was not reinstalled. The controller marked the Note 9 `needsReset: true` on release with `--clean census-start.txt`; lane A should run `reset-done` after a device check.
- ADB forward port 6272 removed; `reverse --list` empty.
- Leases `devrows-p-1127` (note9) and `devrows-build-1127` (android-build) released.

## For lane A

- Rows #301, #479, #721, #751, #591, #616/#811, #598, #221, #834, #681 are still owed on the Note 9. #834 needs a build of current main. #681 needs a ruling on how to drive the multi-file picker and the Studio file chooser.
