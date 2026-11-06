# Settings: Accessibility

This page belongs to [[Settings]]. To open it, go to **Settings → Accessibility**. The page is one flat list of toggles. It has no tabs. **Use Legacy GUI** does not affect it, because that setting changes only the Display page.

<!-- src/ts/setting/accessibilitySettingsData.ts:10-222 -->

| Setting | What it does | Default |
|---|---|---|
| **Ask Removal** | Shows a dialog that asks you to accept before the app removes a chat message. | on |
| **Use Swipe for Regeneration** | Turns on the swipe to regenerate a reply. It also turns on the swipe UI for alternate greetings. | on |
| **Remove subsequent when message remove** | When you remove a message, the app also removes every message after it. | off |
| **Send with Enter Key** | When on, Enter sends the message and Shift+Enter inserts a newline. When off, the two keys swap roles. | on |
| **Fixed chat textarea** | Keeps the chat input box fixed at the bottom of the window instead of inline. The label says that Shift+Enter sends the message when this setting is unchecked. | off |
| **Click Text to Edit** | Lets you click the text of a chat bubble to edit it. This works when the message is not streaming. | off |
| **Enable Block Partial Edit** (Hover to edit individual blocks) | Lets you hover over a part of a message to edit only that block. | off |
| **Long Press to Popup Editor** | When you right-click or long-press the chat input box, the app opens a full popup editor instead of the normal context menu. | off |
| **Enable Drag Partial Edit** (Select text to edit) | Lets you select a part of the text of a message to edit only that selection. | off |
| **Bot Menu when Launch** | Opens the bot settings panel automatically when the app starts. | off |
| **Show Menu Chat List** | Adds a chat-list entry to the side menu. | off |
| **Show Menu Hypa Modal** | Adds a HypaMemory modal entry to the side menu. | off |
| **Go to Character on Realm Import** | After you import a character card, the app jumps to that character automatically. | off |
| **Side Menu Reroll Button** | Adds a reroll button to the chat side menu. | off |
| **Local Activation in Global Lorebook** | In the Lorebook editor, the app treats entries from the global lorebook list of the character as locally activatable. Without this setting, they are always active. | off |
| **Show Request Info Inside Chat** | Shows the generation-info panel inline in the chat. Without this setting, the panel is only behind a button. | off |
| **Inlay Error Response** | When a generation fails, the app inserts the error into the chat transcript. It appends the error to the last assistant message, or it adds a new message. Without this setting, the app shows the error as a popup alert. If the app cannot resolve the character or the chat room, it uses the popup alert. | off |
| **Lorebook Bulk Enabling** | Adds a bulk-enable control to the Lorebook settings sidebar. | off |
| **Show Translation Loading** | Shows a loading indicator while a translation runs. | off |
| **Auto scroll to new message** | Scrolls to a new character message automatically when it arrives. | on |
| **Always scroll to new message** (ignore scroll position) | Scrolls down even if you scrolled away from the bottom. The page shows this setting only when Auto scroll to new message is on. | off |
| **New Message Button Style** | Picks the position of a "jump to new message" button. The page shows this setting only when Auto scroll to new message is on and Always scroll to new message is off. | Bottom Center (Default) |
| **Create Folder on Branch** | When you branch a chat that has no folder yet, the app creates a folder automatically. | on |
| **Move Menu Button to Bottom of Sidebar** | Moves the hamburger menu button from the top of the sidebar to the bottom. | off |
| **Move Instead of Copy on CMP Convert** | A checkbox that has no observed effect in the current build. | off |
| **Apply Additional Parameters to All Models** | Sends the **Additional Parameters** table (Chat Bot → Others) with requests to ordinary models. Without this setting, the app sends the table only to **Reverse Proxy**. Custom models from Advanced Settings use their own parameters field in both cases. | off |
| **Enable Risuai Pro Tools** | Shows an extra "Easy Panel" menu button and feature area. | on if you have at least one plugin installed, otherwise off |
| **Custom Sidebar Config** (button) | Opens a dialog where you configure the icon layout of the sidebar. | none |

<!-- src/ts/setting/accessibilitySettingsData.ts:10-222; src/lib/ChatScreens/Chat.svelte:259-261,820,847-853,904-906,1191,1195,1227; src/lib/ChatScreens/DefaultChatScreen.svelte:641-680,703-731,834-838,1098,1128,1205; src/ts/process/index.svelte.ts:202-253; src/lib/SideBars/Sidebar.svelte:493,862; src/ts/process/request/shared.ts:47-66; src/lib/Setting/Settings.svelte:165-184 -->

**New Message Button Style** has these options: Bottom Center (Default), Bottom Right, Bottom Left, Floating Circle (Bottom Right), Right Center, and Top Bar.

Note: The app sets the option labels of this select one time, when the app loads. If you change the **UI Language** afterward, the labels do not update. You must reload the app to see them in the new language.

<!-- src/ts/setting/accessibilitySettingsData.ts:169-184 -->

Note: The **Long Press to Popup Editor** checkbox has no visible label text next to it in the UI now. It still works as the table describes, but the row shows no name.

<!-- src/ts/setting/accessibilitySettingsData.ts:70-75; src/ts/setting/utils.ts:17-21 -->
