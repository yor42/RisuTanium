# Settings

To open Settings, click the gear or menu icon in the main frame of the app.

On a wide window (700px or more), the sidebar and the page content sit side by side. On a narrower window, Settings first shows the sidebar menu. When you pick an entry, its page replaces the menu. A back arrow or the close button returns you to the menu. This narrow-layout split is separate from **Mobile GUI** mode. **Mobile GUI** mode forces the same choice between side by side and stacked, at any width.
<!-- src/lib/Setting/Settings.svelte:28,35,193 -->

## Menu, in order

The sidebar shows these entries from top to bottom. Each entry opens a child page:

1. **Chat Bot**: [[Settings Chat Bot]]
2. **Persona**: [[Settings Persona]]
3. **Other Bots**: [[Settings Other Bots]]
4. **Display & Audio**: [[Settings Display]]
5. **Language**: [[Settings Language]]
6. **Accessibility**: [[Settings Accessibility]]
7. **Modules**: see [[Modules]]
8. **Plugin**: [[Settings Plugins]]
9. **Backup & Files**: [[Settings Backup and Files]]
10. **Hotkey**: [[Settings Hotkeys]]. The content of this page renders only when the window is 768px wide or wider.
11. **Advanced Settings**: [[Settings Advanced]]
12. Menu entries that loaded plugins registered.
13. **Easy Panel**: see below. The menu shows it only when **Enable Risuai Pro Tools** is on.

<!-- src/lib/Setting/Settings.svelte:41-184 -->

### Lite mode

Lite is an option that you set when you build the app (`VITE_RISU_LITE`). You cannot turn it on or off in the app. In a Lite build, the menu keeps only **Language**, **Backup & Files**, and **Hotkey**. The build hides everything else, including the entries of plugins and Easy Panel.
<!-- src/lib/Setting/Settings.svelte:41,89,117,136,185; src/ts/lite.ts -->

### (?) help icons, the flask icon, and the warning-triangle icon

Some pages get their controls from data. Advanced Settings is one such page now. The same shared renderer is used on other pages. On these pages, a control can have a **(?)** help icon. The icon opens a popup with more explanation.

A flask icon next to a control marks the control as experimental. The icon is only a label. It does not decide whether the control is visible. A separate condition of the control decides that.

A warning-triangle icon replaces the (?) icon on controls that you are not advised to change. The page groups these controls behind a **Show Unrecommended** toggle. They stay hidden until you turn that toggle on.
<!-- src/ts/setting/utils.ts:17-22,64-67; src/lib/Others/Help.svelte:2 -->

### Use Legacy GUI

**Use Legacy GUI** is on the Display & Audio page. It changes how pages with sub-sections show their sections. By default it is off. Then a page such as Chat Bot or Other Bots shows its sections as a row of tabs, and one tab is open at a time. When it is on, the page shows the same sections as stacked accordion panels. You can collapse each panel on its own, and each panel starts collapsed.
<!-- src/ts/storage/database.svelte.ts:1076; src/lib/Setting/Pages/BotSettings.svelte:113; src/lib/Setting/Pages/OtherBotSettings.svelte:25 -->

---

## Modules

The Modules page lists your installed modules. For more about what a module contains, see [[Modules]]. The list is sorted by name for display only. The sort does not change the order in which the app stores or merges modules. Each row has these controls:

| Control | What it does |
|---|---|
| Globe icon | Turns the module on or off globally. It adds the module to the list of always-enabled modules, or removes it from the list. The icon has a tint if the module already applies through namespace integration without an explicit enable. |
| Export icon | Lets you choose an export in CharX (the current format) or in the legacy RisuM format. It is disabled for MCP modules. |
| Edit (pencil) icon | Opens the module editor for that module. It is disabled for MCP modules. |
| Delete (trash) icon | Asks you to accept, then removes the module. If the module was globally enabled, the app first turns it off. |
| "+" | Creates a new, blank module and opens the editor on it at once. |
| Character-conversion toggle | Replaces the icon set of the row with one "convert to character" button. |
| MCP import icon | Imports a module from an MCP source. |
| Filesystem import icon | Imports a module file from disk. |

<!-- src/lib/Setting/Pages/Module/ModuleSettings.svelte:27-36,56-175 -->

## Easy Panel

Easy Panel is a separate overlay. It is not a page in the content area of the sidebar. It opens on top of Settings when you click its menu entry. The menu shows the entry only when **Enable Risuai Pro Tools** is on.

Easy Panel has requirements: separate parameters on, and matching flags for the model and the preset. If the app does not meet these requirements, Easy Panel shows a banner with one **Run** button in place of the **Models** tab. When you click **Run**, the app sets all five required flags at once. The banner replaces only the **Models** tab. The other tabs show their content whether or not the app meets the requirements. Easy Panel has four tabs:

- **Models**: Pickers for the main model, the submodel, and four separate models (Long-Term Memory, Translator, Emotion Image, and Others).
- **Parameters**: An editor for overrides per model, or an editor per category (Long-Term Memory, Translator, Emotion Image, and Others). The Settings tab decides which editor the page shows.
- **Custom Models**: The same custom-model editor as in the Custom Models section of Advanced Settings.
- **Settings**: One checkbox. It switches the Parameters tab between the per-model mode and the per-category mode.

<!-- src/lib/Others/ProTools/EasyPanel.svelte:21-147 -->

---

## Pages that are not in the menu

The code of the app has a few pages that no menu entry opens. You cannot reach these pages through the sidebar now:

- **Global Lorebook**: An editor for a global list of lorebook entries.
- **Global Regex**: An editor for `db.globalscript`, a list of regex entries. This is not the regex list that the app applies to chats. The list that runs during chat is the **Regex Script** of the preset. You find it at **Chat Bot → Others**. See [[Settings Chat Bot]].

<!-- src/lib/Setting/Settings.svelte:196-234 (no branch reachable from any menu button for these); src/lib/Setting/Pages/GlobalRegex.svelte:11 -->
