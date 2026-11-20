# Observer-free device kit

Reads chat-shell scroll behaviour on a real Android device through the app's WebView DevTools socket, without installing
anything in the page: no listener, no rAF chain, no ResizeObserver, no accessor hook and no wrapped API. Page access is
single `Runtime.evaluate` reads (plus the one `scrollTop` write: the jump, or the fling setup position) and a screencast.
Results are labelled "observer-free device read, diagnostic". The kit makes no behaviour claim by itself.

## Spare device only, never the MVP phone

Run the kit only on a spare device that holds synthetic data and a throwaway key. Never aim it at the MVP phone or at a
phone with real data. The adb serial has no default. The guard refuses every serial other than the two spare Note 9s, but a
Note 9 that holds real data is still yours to keep out, so check the serial first.

```
pwsh -NoProfile -File run-obsfree.ps1 -Serial <spare serial> -Build smoke -Trials T1,F1 -PlanOnly
pwsh -NoProfile -File run-obsfree.ps1 -Serial <spare serial> -Build smoke -Trials T1,F1
```

Run with `-PlanOnly` first. It checks every argument and path, prints `{Serial,Build,Trials,OutDir,AdbDir,PortMin,PortMax}`
and exits without creating anything or calling adb.

- `-Serial` and `-Build` are mandatory. `-Build` and trial names are letters, digits, `_` and `-` only (1-40).
- `-Trials` is a comma list of `T1 T2 T3 T4 T5 F1 F2 F3` (default: all). An unknown name stops the run before any adb call.
- `-OutDir` defaults to `%TEMP%\chatshell-cdp\out`. It must be outside the checkout and the tool folder; the refusal is
  lexical, so a junction that leads into the checkout is not seen. Results land in `<OutDir>\<build>-<trial>\`
  (`raw.json`, `frames\`, `analysis.json`) and the console lines in `<OutDir>\series-<build>.txt`.
- Every adb call goes through `Agents/Tools/device-guard/adbg.mjs` with `--kit`; there is no `-AdbExe` and no adb environment
  override. The guard refuses any serial other than the two spare Note 9s before it sends anything, so on another serial Phase B
  stops at the adb start (`adb did not start: ...`) with the guard's reason and the refusal in `<OutDir>\adb\adb-commands.log`.
  `-PortMin`/`-PortMax` (default 9460-9469) bound the local forward port and are the own ports the guard allows (at most 128);
  the free-port and identity checks are in `Agents/Tools/device/lib.ps1` (`Update-CdpForward`), which this script dot-sources
  from `Agents/Tools/device/` beside this tool folder. A lone copy of the tool folder stops in Phase B with
  `device/lib.ps1 not found: <path>`; a copy used for device runs keeps `device/` and `device-guard/` beside it.
  `CHATSHELL_REPO_ROOT` and `CHATSHELL_CDP_DIR` only widen the outside-checkout check and choose `node_modules`.
- The first failed step stops the series. The forward the script made is removed and `HARNESS_CDP` is cleared on the way out.

## Files

| File | Purpose |
|---|---|
| `run-obsfree.ps1` | The series: per trial, `Open-ObsFreeFreshChat`, then `obsfree.mjs`, then `analyze.mjs`. |
| `open-fresh.ps1` | `Open-ObsFreeFreshChat -Serial -Fwd`: wake, force-stop, start, forward, two cold taps, close the sidebar. |
| `obsfree.mjs` | One trial. `HARNESS_SERIAL=<serial> HARNESS_CDP=<port> HARNESS_GUARD_LOG=<absolute guard log path> node obsfree.mjs <build> <trial> still <target>` or `... fling <startScrollTop> <y0> <y1> <durMs>`. Bad arguments, or a missing serial, port or guard log, exit 2 before anything is created. The fling swipe is its only adb call: it runs through the guard with `--kit` and concurrently with the observation; `swipeT` is taken before the guard starts, so the swipe reaches adb after node and guard start-up (about 0.1 s on an idle PC, more under load) and fling `tAfterStartMs` includes that delay; and a swipe the guard refuses or that fails ends the run with exit 4 before frames and `raw.json` are written (still mode makes no adb call). Run directly on a serial other than the two spare Note 9s, its adb call is refused by the guard. |
| `analyze.mjs` | Frame differencing of a trial's screencast (needs `sharp`, found through the checkout). `selfCheck.estimated` must be 37, the synthetic shift. |
| `coldtap.mjs`, `closeside.mjs` | Single real touch taps through the forwarded port. |
| `lib.mjs` | `devicePort()`, `requireSerial()` and `guardLog()` (all mandatory), `guardedAdb()` (the one builder of a guard argument list, `--kit` first) and `runGuardedAdb()`, `safeName()`, `deviceConnect()`, `loadSharp()`. |

## Device-bound values

These are tied to the Note 9 class screen and the prepared fixture; another device needs them re-measured.

- Taps: (30, 45) and (40, 88) open the chat; (392, 400) closes the sidebar.
- Swipe: x 540, y from 600 to 1500 (the fling specs in `run-obsfree.ps1`).
- Screencast: JPEG quality 70, at most 411 x 1400.
- The sidebar button label in `closeside.mjs` is the Korean UI string; another UI language needs another selector.
- Sleeps in `open-fresh.ps1` (2 s after force-stop, 8 s after start, 1.5 s and 4 s between taps) are from the original series.

## Not covered

- The device path is not exercised by the acceptance test (`tests/device-kit.accept.mjs`): it uses stand-ins for adb and node
  (the guard itself runs for real against a stand-in adb), so it proves argument handling, path rules, the guard routing and the
  fail-closed order, not the real forward, the taps or the screencast.
- The guard enforces "two spare Note 9s" for this kit's adb calls, not "a device without real data": that part of the rule above is
  documentation. The residuals of the kit's guarantee (a replaced `node` or `adb` on PATH, the guard's fake-adb test variable, a
  modified tree) are listed in `Agents/Tools/device-guard/README.md`.
