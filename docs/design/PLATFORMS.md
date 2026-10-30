# Platforms and input — cross-cutting design rule

Recorded 2026-10-25 (DD-017). Applies to every screen in this package.

Maintainer's words: "I think it is worths to mention that while we are focusing on android right now, this app is meant to me multiplatform, which should support both touchscreen, mouse, and keyboard as it currently supports both window, web host, linux(both x86 and ARM), android, and Windows on ARM planned for later. so UI needs to take those into consideration."

## Targets

| Platform | Shell / engine (to confirm per feature) | Typical input | Notes |
|---|---|---|---|
| Windows (x64) | Tauri, WebView2 (Chromium) | mouse + keyboard; touch laptops and tablets | Touch and mouse on the same device |
| Windows on ARM | Tauri, WebView2 | as Windows | Planned |
| Linux x86 | Tauri, WebKitGTK | mouse + keyboard | WebKit, not Chromium: check pointer events, `backdrop-filter` cost, no `navigator.vibrate` |
| Linux ARM | Tauri, WebKitGTK | mouse + keyboard; touch panels | Raspberry Pi 3 is the floor device |
| Android | Tauri, Android System WebView | touch; also mouse, trackpad and hardware keyboard (Tab S9 with a keyboard cover, DeX) | Note 9 / Android 10 is the floor |
| Web host | any modern browser | any | No native bridges (no keep-alive, no haptics guarantee, browser Back) |

## Rules

1. **Behaviour follows the input, layout follows the space.** Width decides layout (docked vs overlay sidebar, sheet vs menu). The input that is actually used decides interaction: `PointerEvent.pointerType` per gesture, `(hover: hover)` / `(any-pointer: coarse)` for affordances, never "phone = touch, desktop = mouse".
2. **Every action has three paths:** touch (gesture or tap), pointer (click, hover, context menu / right-click), keyboard (focus + keys). Gestures are accelerators, never the only way.
3. **Mixed devices are normal.** A touch laptop or a tablet with a keyboard uses several inputs at once; affordances for each stay available (a long-press still works when hover rows exist; a hover row never hides a touch path).
4. **Context menu parity:** long-press (touch) and right-click / Shift+F10 / the Menu key (pointer, keyboard) open the same action menu.
5. **Back is platform-specific:** Android Back / predictive back, Esc and the mouse "back" button on desktop, the browser Back on the web host. The app's Back handler stack serves all of them.
6. **Platform-only features degrade silently:** haptics (Android only), the generation notification (Android), Live Updates (Android 16). No other platform shows a broken or empty control for them.
7. **Engines:** check designs on Chromium (WebView2, Android WebView, Chrome) and WebKit (WebKitGTK; Safari for the web host) where a feature is engine-sensitive (pointer capture, `backdrop-filter`, `:has()`, scroll anchoring).
8. **Floors:** Note 9 (Android 10) and Raspberry Pi 3 (Linux ARM, WebKitGTK) set the performance budget; low-power mode exists for both.

## Checks for every deliverable

In addition to the AGENTS.md checks: mouse-only, keyboard-only and touch-only passes; a mixed pass (touch + keyboard) where the screen has gestures; and a WebKit pass where the design depends on an engine-sensitive feature, or a note that it was not run.
