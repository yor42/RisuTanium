# Settings: Hotkey

This page belongs to [[Settings]]. To open it, go to **Settings → Hotkey**.

This page needs a window that is at least 768px wide. Below that width, the pane opens but stays blank. The own "screen too small" message of the page never shows, because Settings refuses to mount the Hotkey page below that width.
<!-- src/lib/Setting/Settings.svelte:230; src/lib/Setting/Pages/HotkeySettings.svelte:8-11 -->

## The table

The table has one row for each saved hotkey. A fresh install starts with the defaults below. The list can differ from the defaults if someone added or removed an action after you created your data.

| Column | What it does |
|---|---|
| Ctrl / Shift / Alt toggles | Three buttons for each row. Click a button to flip whether that modifier is required. The app does not check whether a binding collides with another hotkey. |
| Key | Click, then press a key to rebind. The app captures the very next keydown, including keys like Tab, Escape, or Space (shown as "SPACE"). Whatever you press becomes the new binding. |

<!-- src/lib/Setting/Pages/HotkeySettings.svelte -->

## When a hotkey fires and when it does not

- While you type in a text field, a hotkey without a modifier (Ctrl, Alt, or Shift) does not fire. Only hotkeys with a modifier fire.
- A button, dropdown, link, or similar control can hold keyboard focus. Then a bare (unmodified) **Space** or **Enter** press activates that control. It does not run a hotkey that is bound to the same key. This applies only when the focus got there by keyboard, not by a mouse click.
- In all other cases, a match needs exactly the same modifiers. The app has no partial or loose matching.

<!-- src/ts/hotkey.ts:16-320 (handler), 29-37 (unmodified keys in text fields), 53-57 (control yields), 387-404 (hotkeyMatches); src/ts/hotkeyYield.ts:38-66 -->

## Ctrl+1 through Ctrl+9: quick preset switch

This switch is separate from the table above. **Ctrl+1** through **Ctrl+9** switch to your 1st through 9th saved preset, in the order in which the app stores your presets. A toast shows the name of the preset. The toast reads "Changed to Preset: <name>" (fixed English text). Nothing happens in two cases: you do not have that many presets, or another alert or dialog is open. A running reply does not block it. You need to hold only Ctrl. The app does not check Shift and Alt. This binding is fixed to the digits 1 to 9. The page does not list it as a row that you can rebind. It runs only if no hotkey of the table used the key press.
<!-- src/ts/hotkey.ts:234-291,474-483 -->

## Default hotkeys

| Action | Default binding | What it does |
|---|---|---|
| Reroll | Ctrl+Alt+R | Clicks the **first** reroll button on the page. Does nothing if there is none. The app refuses it silently, with no message, while a send, a reroll, or an auto mode runs, and while a prompt waits for an answer. |
| Undo Reroll | Ctrl+Alt+F | Clicks the first undo-reroll button. The app refuses it silently under the same conditions as Reroll. It does nothing when there is no earlier reroll to go back to. |
| Translate | Ctrl+Alt+T | Clicks the translate button on the last message. |
| Remove | Ctrl+Alt+D | Clicks the remove button on the last message. |
| Edit | Ctrl+Alt+E | Clicks the edit button on the last message, then focuses its edit box. |
| Copy | Ctrl+Alt+C | Clicks the copy button on the last message. |
| Send | Ctrl+Alt+Enter | Clicks the send button. While a send runs, the stop button replaces the send button. So this hotkey does nothing and does not stop the send. |
| Settings | Ctrl+S | Opens or closes Settings. |
| Home | Ctrl+H | Returns to the character list. It works while a reply generates. The reply carries on in its own chat. |
| Quick Presets Select | Ctrl+P | Opens or closes the quick preset picker. |
| Quick Persona Select | Ctrl+E | Opens or closes the quick persona picker. |
| Quick Model Select | Ctrl+M | The page lists it and you can rebind it, but the global hotkey does nothing, because this action has no handler. Inside the message box, Ctrl+M is a separate fixed shortcut that rerolls (see below). |
| Toggle CSS | Ctrl+. | Toggles Safe Mode (which disables custom CSS) and refreshes the theme and CSS. |
| Previous Character | Ctrl+[ | Selects the previous character in a list of **all** characters, sorted by name. This is not the order of the sidebar. The list includes groups. It does not include trashed characters or the Playground character. It does nothing when the open character is the first one in that list. From Home or the Playground, it selects the **last** one. While any reply generates, it does nothing, and it gives no message. It restores a character from cold storage if needed. It can show "Cold storage data could not be loaded…" if that fails. |
| Next Character | Ctrl+] | The mirror of Previous Character. It does nothing at the last character of the list sorted by name. From Home or the Playground, it selects the **first** one. It refuses silently while a reply generates, like Previous Character. |
| Quick Menu | Ctrl+` | Opens a menu to jump to Presets, Persona, or Loadout. |
| Quick Settings | Ctrl+Q | Opens or closes the quick-settings overlay. |
| Toggle Voice | Ctrl+V | The page lists it and you can rebind it, but pressing it does nothing now, because this action has no handler. |
| Toggle Log | Ctrl+L | Opens the request log viewer. |
| Preview Request | Ctrl+U | Builds and previews the prompt that the app sends, without a send. It always uses up the key press. The app refuses it in these cases: any reply generates, a send starts, a prompt waits, an alert that is not a toast shows, or you are at Home. |
| Toggle Webcam | Ctrl+W | The page lists it and you can rebind it, but pressing it does nothing now, because this action has no handler. |
| Focus Input | Space (no modifier) | Focuses the chat message box. The step-aside rule for a focused control, described above, applies. |
| Scroll to Active Character | Ctrl+G | Scrolls the character sidebar to the active character. If **Scroll to Active Character** is off in Advanced Settings, the app removes this action from your hotkey list. |
| Popup Editor | Ctrl+X | While you type in certain text areas, it opens a full-size popup editor for the text of that field. It writes your edit back when the editor closes. |
| Loadout | Ctrl+O | Opens or closes the loadout picker. |

<!-- src/ts/defaulthotkeys.ts:10-146; src/ts/hotkey.ts:57-225 (dispatch), 124-173 (prev/next); src/ts/characters.ts:1003-1025; src/ts/process/composerActions.svelte.ts:422-430,501-538; src/ts/process/previewRunner.ts:30-38; src/lib/UI/GUI/TextAreaInput.svelte:70-98; src/ts/storage/database.svelte.ts (scrollToActiveChar filtered when enableScrollToActiveChar is false) -->

The page shows Quick Model Select, Toggle Voice, and Toggle Webcam, and you can rebind them like any other hotkey. But for Toggle Voice and Toggle Webcam, no code anywhere responds to the bound key. Pressing it does nothing now. The global hotkey of Quick Model Select also does nothing. Only the own Ctrl+M of the message box (below) rerolls.

**Scroll to Active Character** appears in the table, and fires, only while **Scroll to Active Character** is on in **Settings → Advanced Settings**. If you turn that option off, the row disappears from your saved hotkey list.

## Message box keys

These keys belong to the message box, not to the table above.

| Key | Main box | Translate box (shown with Auto Translate Input) |
|---|---|---|
| Enter, with **Send with Enter Key** on | Sends. Shift+Enter is a new line. The app ignores it while an input method (IME) composes text. | Sends (without Shift). |
| Enter, with **Send with Enter Key** off | Shift+Enter sends. Enter is a new line. | Nothing sends. Enter and Shift+Enter are both new lines. |
| Ctrl+M | Rerolls. This is fixed, you cannot rebind it, and it does not depend on the Quick Model Select row. Holding Shift or Alt does not change it. | The same. |

Ctrl+M rerolls only while the message box has focus. Elsewhere it does nothing. The app refuses it silently while a send, a reroll, or an auto mode runs. This includes the time when the box is read-only during a send. Unlike the Reroll hotkey, the app does not refuse it while a prompt waits for an answer.

<!-- src/lib/ChatScreens/DefaultChatScreen.svelte:608-622,734-745 -->
