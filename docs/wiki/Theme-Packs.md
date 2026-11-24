# Theme packs

A theme pack is a `.risutheme` file that restyles the new screens of RisuTanium: shapes, spacing, fonts and, on the chat screen, colours. A pack changes how the app looks, never how it behaves. You choose and install packs on the **Display** settings page (see [[Settings Display]]).

Note: Theme packs are a RisuTanium feature. Upstream RisuAI has no equivalent.

<!-- src/lang/en.ts themePackRowHelp, themePackInstall; docs/design/THEMING.md "What a pack covers today" -->

---

## Install a pack from a file

1. Open **Settings → Display & Audio**, go to the **Theme** tab and find the **Theme pack** row.
2. Choose **Install from file** and pick a `.risutheme` file in the Android file picker. A pack saved in your Downloads folder works.
3. Read the warning. A theme pack can make the app hard or impossible to use, and while a pack is on, data-loss warnings and save-failure notices may be hidden or hard to read. The warning appears at every install from a file. Confirm to continue.
4. The app checks the pack and shows the result: "Installed", "Installed with warnings" or notes about what it found. If the check refuses the file, the app tells you why and installs nothing.
5. Select the pack under **Theme pack** to turn it on. Choosing **None** turns packs off.

The built-in packs are listed as **Built in** and need no file or warning.

<!-- src/lang/en.ts themePackInstall, themePackRiskConfirm, themePackInstalled, themePackRefusedHeader, themePackBuiltIn, themePackNone; MC-3641, MC-4147 -->

## Which screens a pack styles, and when

| Screen | Shows the pack | Colours |
|---|---|---|
| New chat screen | Only while **New chat screen (preview)** is on, with the standard chat theme | Applied |
| Studio | Only while **Studio (preview)** is on | Shapes only |
| New Settings screen | Only while **New Settings screen (preview)** is on | Shapes only |
| Home | Whenever Home is on screen (no switch) | Shapes only |
| Popups, toasts and dialogs | Over a screen the pack styles | Over the chat screen only |

The classic screens, group chats and the playground keep the built-in look. Custom CSS still applies on top.

A pack may contain colours for the screens that take shapes only. The app keeps them with the pack and says so when you install it; they have no effect yet.

A pack may also set the colours of the chat screen as its own colour scheme, shown as the pack's tile.

Popups never change the escape route (the Theme pack settings and the way back to them) or the protected parts of important prompts, such as data-loss warnings.

<!-- src/lang/en.ts themePackRowHelp, themePackColoursHeld, chatShellPreviewLabel, studioSwitchLabel, settingsShellPreviewLabel; src/ts/themePack/colourReady.ts; src/ts/themePack/surfaceGate.svelte.ts; MC-3009, MC-3121, MC-3420, MC-4162 -->

## Start without a theme pack

If a pack makes the app hard to use:

- **Android launcher:** long-press the app icon and choose **Start without theme pack**. The app starts without the pack for that session and shows the banner "Theme pack is off for this session". Its buttons are **Turn off theme pack** (when offered) and **Dismiss**.
- **Settings:** under **Theme pack**, choose **None**. The Theme pack settings never take a pack's styling, so you can always reach them.
- **If the app is frozen:** close it from recent apps first, or use Force stop in App info, then start it without the pack.

<!-- src/lang/en.ts themePackRiskConfirm, packSafeModeNotice, packEscapeTurnOff, packEscapeDismiss; src-tauri/gen/android/app/src/main/res/xml/shortcuts.xml; src/lib/Others/BootPackEscape.svelte; MC-3420, MC-3641 -->

## What is not supported yet

- Effects. Packs cannot use transitions, transforms, animations, filters, blur or layering. This is planned as ticket #751. Blur-based looks and a reduced-effects fallback do not exist yet.
- Some popups and dialogs have no theme parts yet (for example the memory, bookmark and persona lists). Packs reach them only through shared shapes. This is planned.
- Part of the chat sidebar (the heading, the "New chat" button and menu, the More menu and the row menu buttons) cannot be styled individually yet. This is planned.
- The built-in packs only restyle the chat screen. They are being rebuilt in ticket #654.
- A file named `sidebar.css` (or any other extra `.css` file) in a pack is kept with the pack but never applied. A pack with only `popups.css` is refused.

<!-- MC-4149, MC-4160, MC-4161, MC-3871, MC-3123; src/ts/themePack/intake.ts -->
