# Observer-free device kit

Reads chat-shell scroll behaviour on a real Android device through the app's WebView DevTools socket, without installing
anything in the page: no listener, no rAF chain, no ResizeObserver, no accessor hook and no wrapped API. Page access is
single `Runtime.evaluate` reads (plus the one `scrollTop` write: the jump, or the fling setup position) and a screencast.
Results are labelled "observer-free device read, diagnostic". The kit makes no behaviour claim by itself.

## Spare device only, never the MVP phone

Run the kit only on a spare device that holds synthetic data and a throwaway key. Never aim it at the MVP phone or at a
phone with real data. The adb serial has no default and no allow-list: the rule is yours to keep, so check the serial first.

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
- adb comes from `-AdbExe` or PATH. `-PortMin`/`-PortMax` (default 9460-9469) bound the local forward port; the free-port
  and identity checks are in `Agents/Tools/device/lib.ps1` (`Update-CdpForward`), which this script dot-sources.
- The first failed step stops the series. The forward the script made is removed and `HARNESS_CDP` is cleared on the way out.

## Files

| File | Purpose |
|---|---|
| `run-obsfree.ps1` | The series: per trial, `Open-ObsFreeFreshChat`, then `obsfree.mjs`, then `analyze.mjs`. |
| `open-fresh.ps1` | `Open-ObsFreeFreshChat -Serial -Fwd`: wake, force-stop, start, forward, two cold taps, close the sidebar. |
| `obsfree.mjs` | One trial. `HARNESS_SERIAL=<serial> HARNESS_CDP=<port> node obsfree.mjs <build> <trial> still <target>` or `... fling <startScrollTop> <y0> <y1> <durMs>`. Bad arguments exit 2 before anything is created. |
| `analyze.mjs` | Frame differencing of a trial's screencast (needs `sharp`, found through the checkout). `selfCheck.estimated` must be 37, the synthetic shift. |
| `coldtap.mjs`, `closeside.mjs` | Single real touch taps through the forwarded port. |
| `lib.mjs` | `devicePort()` and `requireSerial()` (both mandatory), `adbExe()`, `safeName()`, `deviceConnect()`, `loadSharp()`. |

## Device-bound values

These are tied to the Note 9 class screen and the prepared fixture; another device needs them re-measured.

- Taps: (30, 45) and (40, 88) open the chat; (392, 400) closes the sidebar.
- Swipe: x 540, y from 600 to 1500 (the fling specs in `run-obsfree.ps1`).
- Screencast: JPEG quality 70, at most 411 x 1400.
- The sidebar button label in `closeside.mjs` is the Korean UI string; another UI language needs another selector.
- Sleeps in `open-fresh.ps1` (2 s after force-stop, 8 s after start, 1.5 s and 4 s between taps) are from the original series.

## Not covered

- The device path is not exercised by the acceptance test (`tests/device-kit.accept.mjs`): it uses stand-ins for adb and node,
  so it proves argument handling, path rules and the fail-closed order, not the real forward, the taps or the screencast.
- The README rule above is documentation; no code enforces "spare device only".
