# Settings: Display

This page belongs to [[Settings]]. To open it, go to **Settings → Display & Audio**. The page has three tabs: **Theme**, **Size and Speed**, and **Others**. **Use Legacy GUI** is a checkbox on the Others tab. When it is on, the page stacks the three groups one after another. It shows no tab bar and no accordions.

Note: The app decides which layout you see one time, when the page opens. If you toggle **Use Legacy GUI** while the page is open, the layout does not switch live. Reopen Settings to see the change.

<!-- src/lib/Setting/Pages/DisplaySettings.svelte:1-58; src/lang/en.ts:811,847,1298 -->

---

## Theme tab

| Setting | What it does | Default | Options/range |
|---|---|---|---|
| **Theme** | Chooses the layout of the whole chat UI. | Standard Risu | Standard Risu, Waifulike, Mobile Chat, CardBoard, Custom HTML |
| **Define Custom GUI** (button) | Opens a drag-and-drop builder for the GUI tree. | none | none |
| **Chat HTML** | The raw HTML template for each chat bubble. It supports the special tags `<risutextbox>`, `<risuicon>`, `<risubuttons>`, and `<risugeninfo>`. The help text of the field documents them. | empty | free text |
| **Waifu Chat Width** | The width of the chat panel in Waifulike mode. | 100% | 50–200% |
| **Waifu Character Size** | The size of the character art in Waifulike mode. | 100% | 20–150% |
| **Color Scheme** | Picks a preset color palette (see below) or Custom. | none | See Color scheme presets. |
| **Custom Color Scheme editor** | Nine color pickers and a Light/Dark type selector. The page shows it only when Color Scheme is Custom. | none | none |
| **Text Color** | Chooses the text-color palette for chat. | Classic Risu | Classic Risu, High-Contrast, Custom |
| **Custom Text Theme editor** | Six color pickers (Normal, Italic, Bold, Italic Bold, Single Quote, and Double Quote text). The page shows it only when Text Color is Custom. You can leave the two quote-text colors unset. | none | none |
| **Font** | Chooses the chat font. | Default | Default (Arial), Times New Roman, Custom |
| **Custom Font** (unlabelled text field under Font) | A CSS `font-family` value. The app uses it as it is. The page shows it only when Font is Custom. | empty | free text |

Note: The page shows **Define Custom GUI** only when Theme has a value that this button checks for. The Theme dropdown does not offer that value now. So the button does not appear now.

<!-- src/ts/setting/displaySettingsData.svelte.ts:16-139; src/lang/en.ts:344,825,839,858-865,1273,1337-1338 -->

### Color scheme presets

The Color Scheme picker shows a grid of swatches. It has one swatch for each built-in preset, and a **Custom** tile. The app formats the preset names from their internal names. Hyphens become spaces, and each word gets a capital letter. For example, `monokai-light` shows as "Monokai Light".

The 17 built-in presets are: Default, Dark, Light, Cherry, Galaxy, Nature, Ocean, Aurora, Twilight, Realblack, Monokai Light, Monokai Black, Sky Light, Sage Light, Lavender Light, Slate Light, and Lite.

When you click a swatch, the app applies it at once and updates the colors of the app. When you click **Custom**, the app switches to `db.customColorScheme` and shows the Custom Color Scheme editor above. The editor has Export and Import buttons. They read and write a `colorScheme.json` file. The app rejects an imported file that lacks any of the ten expected fields, with an "Invalid color scheme" error.

Note: On the Lite build of the app, the app always uses the Lite palette for chat colors. The preset that you select here does not matter.

<!-- src/ts/gui/colorscheme.ts:36-333,270-273; src/lib/Setting/Pages/Display/ColorSchemeSelect.svelte; src/lib/Setting/Pages/Display/CustomColorSchemeEditor.svelte -->

---

## Size and Speed tab

| Setting | What it does | Default | Range |
|---|---|---|---|
| **Chat Text Size** | The font size of the chat input box. | 100% | 50–200% |
| **Line Height** | The line spacing. It works together with Chat Text Size. | 1.25 | 0.5–3 |
| **Icon Size** | The size of the avatar boxes of the character and the user in chat. | 100% | 50–200% |
| **Input Area Size** | The height of the chat input box, in named steps from Tiniest to Hugest. | Default | -5 to 5 |
| **Input Area Text Size** | The text size inside the chat input box. | Default | 0–3 |
| **Sidebar Size** | The width of the sidebar. | 0 | 0–3 |
| **Asset Images Max Width** | Sets a limit on the width of additional-asset images that the chat renders. The value -1 means Unlimited (no limit). The value 0 means Hidden (the app does not show images). Other values set the limit in rem. | -1 (Unlimited) | -1 to 40 |
| **Animation Speed** | The speed of the UI transition animations. | 0.4 | 0–1 |
| **Memory Limit Thickness** | The thickness of the line that marks the long-term-memory boundary in chat. The page shows it only when **Show Memory Limit** (Others tab) is on. | 1 | 1–500 |
| **Settings Close Button Size** | The size of the close (X) button in the top-right corner of the Settings window. | 24 | 16–48 |

<!-- src/ts/setting/displaySettingsData.svelte.ts:144-247 -->

---

## Others tab

| Setting | What it does | Default |
|---|---|---|
| **Fullscreen** | Toggles fullscreen mode for the window of the app. | off |
| **Show Memory Limit** | Shows the long-term-memory boundary line in chat. It also shows Memory Limit Thickness above. | off |
| **Show First Message Pages** | Shows a swipe pager next to the alternate greetings of a character. | off |
| **Hide RisuRealm** | Hides the RisuRealm card from the main menu. This includes the placeholder that shows before you accept the terms of upstream ("Realm content comes from a service operated by upstream RisuAI. Agree to its terms to show it." / "Agree and show"). | off |
| **Hide All Images** | Replaces bot avatars, icons, asset images, and RisuRealm cover images with a placeholder. | off |
| **Show Folder Name in Icon** | Overlays the folder name as centered text on its sidebar icon. | off |
| **Custom Background** | A checkbox. When you check it, a file picker (png/webp/gif) opens for a custom background of the app. When you uncheck it, the app clears the background. | off |
| **Play Message Audio** | Plays a short sound when a reply of a character finishes. | off |
| **Play Audio on Translate Completion** | Plays the same sound when an auto-translation finishes. | off |
| **Round Icons** | Rounds the corners of chat avatars and sidebar avatars. | off |
| **Custom Text Screen Color** | A checkbox and a color picker for the background box of the chat text. If you leave it unchecked, the box keeps the built-in default. | off |
| **Text Outlines** | Adds an outline (text-shadow) to chat text. | off |
| **Round Text Screen** | Rounds the corners of the background box of the chat text. | off |
| **Show Saving Icon** | Shows an animated badge while a save is in progress. | off |
| **Show Prompt Comparison** | Shows a control that highlights differences in the list of bot presets. | off |
| **Text Screen Borders** | A checkbox and a color picker for a border on the background box of the chat text. It works like Custom Text Screen Color. | off |
| **Use Chat Message Copy** | Adds a copy-text button to each chat message. | off |
| **Use Additional Assets Preview** | Shows inline media previews in the editor for the additional assets of a character or module. | off |
| **Use Legacy GUI** | Stacks the three Display tabs into one page (see above) instead of tabbing them. | off |
| **Hide API Keys** | Masks API-key fields as password inputs across most provider settings (chat and image providers). See [[Settings Other Bots]] for the key fields on that page that this setting covers and does not cover. | on |
| **Disable Quote Formatting** | See Quote rendering below. | off |
| **Blockquote Styling** | See Quote rendering below. | off |
| **Custom Quotes** | See Quote rendering below. | off |
| **Leading Double Quote** | The character that the app uses as the opening `"` when Custom Quotes is on. | curly opening double quote |
| **Trailing Double Quote** | The character that the app uses as the closing `"` when Custom Quotes is on. | curly closing double quote |
| **Leading Single Quote** | The character that the app uses as the opening `'` when Custom Quotes is on. | curly opening single quote |
| **Trailing Single Quote** | The character that the app uses as the closing `'` when Custom Quotes is on. | curly closing single quote |
| **Beta Mobile GUI** | Uses a beta mobile layout on screens narrower than 800px. You must refresh the page for it to take effect. | off |
| **Menu Side Bar** | Shows a column with a desktop-style icon sidebar. | off |
| **Notification** | When you check it, the app requests the permission for browser notifications. If the OS or browser denies the permission, the app shows an error and unchecks the box. | off |
| **Use Chat Sticker** | Turns on chat stickers. The page shows it only when **Show Unrecommended** is on. See [[Settings Advanced]]. | off |
| **Custom CSS** | See Custom CSS below. | empty |

The page shows the four Leading and Trailing quote fields only when **Custom Quotes** is on.

<!-- src/ts/setting/displaySettingsData.svelte.ts:250-371; src/ts/storage/database.svelte.ts:562; src/lib/UI/MainMenu.svelte:193; src/lang/en.ts -->

### Quote rendering

**Disable Quote Formatting**, **Blockquote Styling**, and **Custom Quotes** interact in this way:

- If **Disable Quote Formatting** is on, the app renders quotes as plain characters with no special styling. **Blockquote Styling** has no effect, even when it is also on.
- Otherwise, if **Blockquote Styling** is on, the app wraps quoted spans in styled markup, so you can pick them out visually. Quoted spans are double-quoted text, and single-quoted text nested inside it.
- If neither setting is on (the default), the quotes keep the built-in inline quote coloring (`risu-mark="quote1"` / `"quote2"`). The app does not add the separate blockquote-style paragraphs of **Blockquote Styling**.

**Custom Quotes** does not depend on the two settings above. It only chooses *which characters* count as quote marks. When it is off, the app uses its built-in pair of curly quotes. When it is on, the four Leading and Trailing quote fields supply the characters instead.

<!-- src/ts/parser/parser.svelte.ts:151-188 -->

### Custom CSS

**Custom CSS** (Others tab) is a free-text CSS block that the app applies to itself. If a stylesheet breaks the UI, press **Ctrl + .** to switch Safe Mode on or off. This is the default **Toggle CSS** hotkey. See [[Settings Hotkeys]]. Safe Mode turns Custom CSS off without a deletion.

Note: While Safe Mode is on, the app does not apply Custom CSS. The saved text does not matter.
<!-- src/ts/defaulthotkeys.ts:78-82; src/ts/hotkey.ts:92-96; src/ts/gui/colorscheme.ts:407-412 -->

<!-- src/ts/gui/colorscheme.ts:407-412; src/lang/en.ts:220 -->

---

## Related

- [[Settings Other Bots]]: The place where most API keys live. It also lists exactly which key fields **Hide API Keys** masks on that page, and which it does not mask.
- [[Settings Advanced]]: The **Show Unrecommended** toggle that controls **Use Chat Sticker** above.
- [[Settings Chat Bot]]: The Chat Formating / Jinja Template block. It is not part of this page.
