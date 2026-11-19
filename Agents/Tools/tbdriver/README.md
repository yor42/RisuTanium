# tbdriver: unattended TalkBack checks on the Note 9 test phones

`tbdriver` is a test-only Android companion app and a few host scripts. With them, an agent can drive a screen reader the way a user does, while it stays on. It does not touch the RisuTanium app code.

What it can do:
- swipe to the next or previous item, double-tap to activate, scroll with two fingers, and explore by touch;
- read the accessibility-focused node and the accessibility event stream;
- capture every utterance the screen reader sends to text-to-speech.

It was built and verified on 2026-11-19 on a Note 9 (SM-N960N, Android 10, Samsung Voice Assistant 11.5.02.1, a TalkBack fork). The investigation report lives outside the repository: `%TEMP%\risu-b715\talkback-automation\report.md`.

## Why a companion app, and not `adb shell input`

- **`input` skips TalkBack.** `input tap` and `input swipe` events never pass through the accessibility input filter. With TalkBack on, an `input tap` activates whatever is under it, as if TalkBack were off. It produces no touch-interaction events, and `input swipe` is not a TalkBack gesture. `input keyevent` cannot send modifier combinations on Android 10, so TalkBack's keyboard shortcuts are out of reach too.
- **`dispatchGesture` reaches it.** An AccessibilityService's `dispatchGesture()` strokes enter the input filter ahead of the touch explorer: in Android 10's `AccessibilityInputFilter.enableFeatures`, the `MotionEventInjector` is the first handler. So TalkBack receives them as finger input. The framework emits `TYPE_GESTURE_DETECTION_START/END` for a swipe and `TYPE_TOUCH_EXPLORATION_GESTURE_START/END` for exploration.
- **Prior art.** The Latte/Axer research framework drives stock TalkBack the same way.

The three kinds of interaction stay distinct:

| Kind | How | Counts as a TalkBack check? |
|---|---|---|
| Genuine gesture simulation | `tb.mjs next/prev/activate/scroll*/firstlast/explore` (dispatchGesture) | yes |
| Keyboard navigation | not available here (see above) | - |
| Direct accessibility action | `tb.mjs raw "/act?a=click"`, `raw "/global?a=back"` | **no**: a bypass, for setup only |

## Harness rules (every TalkBack device brief)

- **Drive TalkBack through tbdriver, never `adb shell input`.** `input` bypasses TalkBack and activates whatever is under the finger.
- **No `uiautomator dump` and no adbg `pick` in a process before a TalkBack check of that process.** Each UiAutomation connection made without `FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES` does three things:
  - it unbinds every accessibility service for about 1.1-1.4 s ("Voice Assistant 꺼짐", then "켜짐");
  - it turns touch exploration off for that time, so a touch is a raw tap;
  - it resets TalkBack's focus to the top of the window.

  The same holds for instrumentation tests that use `getUiAutomation()` without that flag. Read the tree with `tb.mjs tree` and `tb.mjs focus` instead. If a dump is unavoidable, take it after the check and restart the process before the next one.
- **Inspection that is safe while TalkBack is on:** `tb.mjs tree/focus/events/speech`, adbg `dumpsys accessibility` and `dumpsys window`, `exec-out screencap`, `logcat -d`.
- **The L-shaped gestures are uncalibrated** (`lupleft`, `lupright`, `rightleft`). On Samsung VA they are detected as gestures but read single characters, and they seem to change the reading control. Never use them as back or home. Use the drawer's own close control, or `raw "/global?a=back"` as a declared bypass.
- **Explore by touch with a moving finger.** WebView content only answers hover moves, so a stationary injected tap explores native views but never WebView content. `tb.mjs explore x y` drags 80 px slowly through the point.
- **Teardown always reads back.** `session.ps1 -Action off` resets `enabled_accessibility_services` to null (any other service enabled before is not restored), `accessibility_enabled` to 0 and deletes `tts_default_synth`. It removes the forward, then reads each value back and fails if any is not clean.
- **Device rules are unchanged:**
  - every adb call goes through `Agents/Tools/device-guard/adbg.mjs` (the scripts here only call it);
  - only the playground Note 9 serials;
  - synthetic data only, network off;
  - kill only your own processes;
  - never read signing secrets.

## Build (local run slot A only)

1. Take slot A (`%TEMP%\risu-b715\fullrun-slot`, owner.txt), as for any APK build.
2. Create `android/local.properties` with one line, `sdk.dir=<your Android SDK path>`. It is git-ignored.
3. Use JDK 17 for Gradle 8.14.3 (JDK 25 is rejected). Set it process-local: `$env:JAVA_HOME = '<path to a JDK 17>'`.
4. From `android/`, run `.\gradlew.bat --offline assembleRelease`. If the AGP 8.11.0 artifacts are not cached yet, the first build needs to go online once.
5. The APK lands in `android/app/build/outputs/apk/release/app-release.apk`. Release it with `.\gradlew.bat --stop`, then release the slot.

**Signing.** The release build is signed with the standard Android **debug** keystore (`~/.android/debug.keystore`, password `android`, alias `androiddebugkey`). The Android Gradle Plugin creates it on the first build if it is missing. It is never committed. If you need one by hand, run:

```
keytool -genkeypair -v -keystore %USERPROFILE%\.android\debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
```

Never sign it with the app's release key. The package (`io.github.yor42.tbdriver`) is separate from RisuTanium.

## Workflow

The parameters are environment variables, so nothing is tied to one phone or folder:

```
$env:TB_SERIAL = '<playground serial>'     # required
$env:TB_RUN    = '<run folder>'            # required: holds adb-commands.log and adbg-state.json
$env:TB_OWN_PORTS = '9561,9562'            # must include TB_HOST_PORT
$env:TB_HOST_PORT = '9562'                 # host side of the forward; the device side is always 9562
$env:TB_SCREEN = '1080x2220'               # gesture placement; Note 9 portrait by default
```

1. **Install, once per phone:** `pwsh -File scripts/tbg.ps1 install <apk>`.
2. **Start the session:** `pwsh -File scripts/session.ps1 -Action on`. This sets the capture TTS as default (skip with `-NoSpeech`), enables TalkBack plus tbdriver, forwards the port, and reads everything back. If the TTS default is changed while TalkBack is already running, cycle the services: the screen reader only picks up the engine at startup.
3. **Check it:** `node scripts/tb.mjs ping` must report `"service": true`.
4. **Bring the subject to the front:** `$env:TB_PKG = '<package>'; pwsh -File scripts/tbg.ps1 shell "am start -n <package>/<activity>"`. `TB_PKG` becomes adbg's `--own-package`; which `am` commands adbg accepts depends on the device profile (see `device-guard/README.md`). For tbdriver's own test screen, use `io.github.yor42.tbdriver/.TestActivity`.
5. **Drive and assert.**
   - `node scripts/tb.mjs next`: each verb prints the gesture events, the new focus (class, text, desc, bounds) and the speech.
   - `node scripts/tb.mjs explore 101 150`.
   - `node scripts/tb.mjs activate`: activates the focused item. Only activate what the brief allows.
   - Take a screencap for the visible ring: `$env:TB_OUT = '<png>'; pwsh -File scripts/tbg.ps1 exec-out screencap -p; $env:TB_OUT = $null`.
6. **Probes:**
   - `node scripts/probe.mjs <risu|probe> <out.json>` is the reachability probe: 12 linear steps plus 3 explore drags.
   - `pwsh -File scripts/dumptest.ps1 -Label <name>` measures what one `uiautomator dump` does to a running session.
7. **Teardown:** `pwsh -File scripts/session.ps1 -Action off`. It fails unless the read-back is clean.

## Files

- `android/`: the companion app (Java, no androidx, minSdk and targetSdk 29).
  - `DriverService`: accessibility service with `canPerformGestures` and `canRetrieveWindowContent`; its loopback HTTP API listens on device port 9562.
  - `CaptureTts`: a TTS engine that records each utterance and returns silence.
  - `TestActivity`: a synthetic native screen.
  - Endpoints: `/ping`, `/events?since=&kind=`, `/focus`, `/tree?max=`, `/find?text=`, `/tap`, `/taps?n=&gap=`, `/swipe`, `/path?pts=x,y_x,y`, `/fingers?n=&dx=&dy=`, `/global?a=` (bypass), `/act?a=` (bypass).
- `scripts/tbg.ps1`: the adbg wrapper; parameters come from the environment.
- `scripts/session.ps1`: on, off and status, with read-backs.
- `scripts/tb.mjs`: host client and gesture verbs.
- `scripts/probe.mjs`: reachability probe.
- `scripts/dumptest.ps1`: UiAutomation interference measurement.

## Known limits

- **The loopback API is unauthenticated.** While a session is on, any app on the phone, or a web page in its browser, can send gestures and global actions to `127.0.0.1:9562` and read the event and speech log (on-screen text from every app). Run sessions only on the synthetic playground phones, only for the length of a check, with no app holding real data open, and tear down straight after.
- **probe.mjs is Note 9 and Korean specific.** Fixed 1080x2220 coordinates, and the RisuTanium targets are found by their Korean labels (메뉴, 페르소나, 버전). It prints PASS or FAIL but always exits 0.
- **Speed.** Each gesture plus settling takes about 1-2 s.
- **No multi-finger TalkBack gestures.** Taps and swipes with three or more fingers are Android 11+.
- **The companion changes the environment slightly.** A second enabled accessibility service is present, with event mask `typeAllMask`. Findings that could depend on it deserve one unassisted control.
- **Untested elsewhere.** The gesture timings were tuned only on the Note 9: 150 ms swipes over 600 px, a 40 ms/90 ms double tap, and 800 ms explore drags. Other screens or TalkBack builds may need different values.
