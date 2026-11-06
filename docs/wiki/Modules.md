# Modules

A module is a reusable bundle of content. You can switch it on for every chat, for one character, or for one chat. A module is not a [[plugin|Plugin Docs]]. A plugin is JavaScript that extends the app. A module carries only the same kinds of content that a character card carries.

A module can hold:

- **Lorebook** entries (see [[Lorebook]]). The app adds them after the own lore of the character.
- **Regex scripts** (see [[Regex Script]]).
- **Trigger scripts** (see [[Trigger Script]] and [[Lua Scripting]]).
- **Additional assets** (images, audio, video, fonts, and CSS) that CBS asset tags can use (see [[CBS Assets]]).
- **Background Embedding**: HTML that the app adds to the chat background.
- **Custom Toggles**: Switches that appear in the side toggles of the chat.

<!-- src/ts/process/modules.ts:20-36, 441-518 -->

## Managing modules

Open **Settings → Modules**. The page lists every installed module and has a search box.

Each module row has these buttons:

- **Enable Globally** (globe icon): Turns the module on for every character and chat. The icon is blue when the module is on. It is amber when the module is not enabled globally but is enabled through **Module Integration** (see below).
- **Download** (share icon): Exports the module. You choose **CharX (Recommended)** or **RisuM (Legacy)**.
- **Edit** (pen icon).
- **Remove** (trash icon): Asks you to accept first.

The buttons under the list are, from left to right:

- **+**: Creates an empty module and opens the editor.
- **Person icon**: Switches the list into conversion mode. Then click the person icon of a module to add a copy of the module to your characters.
- **Waypoints icon**: Adds an MCP module (see [MCP modules](#mcp-modules)).
- **Upload icon**: Imports a module file.

<!-- src/lib/Setting/Pages/Module/ModuleSettings.svelte:42-180 -->

### The module editor

The editor has five tabs.

- **Basic Info**: **Name**, **Description**, **Namespace**, **Hide Icon UI**, and **Custom Toggles**.
- **Lore Book**: The lorebook entries and folders of the module, with import and export.
- **Regex Script**: The **Background Embedding** box, then the regex scripts of the module.
- **Trigger Script**: The triggers of the module, and the **Low Level Access** checkbox.
- **Additional Assets**: A table of asset names and files. The accepted files are png, webp, avif, gif, jpeg/jpg, svg, mp4, webm, mp3, ttf, otf, woff, woff2, and css.

<!-- src/lib/Setting/Pages/Module/ModuleMenu.svelte:151-316 -->

## Enabling a module

A module is active in a chat if you enabled it in any of these places:

1. **Globally**: Use the globe button in **Settings → Modules**.
2. **For the current chat**: Open the chat menu next to the input box and choose **Modules**. Click the check button of a module to turn it on for this chat only. The button is blue.
3. **For the current character**: In the same **Modules** window, right-click or long-press the check button of a module. The module is then on in every chat with that character. The button is violet.
4. **Through Module Integration**: **Settings → Chat Bot → Others → Module Integration** is a text box. Enter module namespaces there, separated by commas, for example `module1,module2`. The app saves this setting with the prompt presets, so a switch of presets can switch modules. You can enable only modules that have a **Namespace** this way.

The chat Modules window greys out globally enabled modules, because they are already on.

<!-- src/ts/process/modules.ts:399-438; src/lib/Setting/Pages/Module/ModuleChatMenu.svelte:60-120; src/lib/Setting/Pages/BotSettings.svelte:772-773 -->

### Order

When several modules are active, the app combines their lorebooks, regex scripts, triggers, and toggles. It uses the order in which you created or imported the modules. This is not the order in **Settings → Modules**, which sorts by name. It is also not the order in which you enabled the modules. If you enabled a module in more than one place, the app applies it only one time.

<!-- src/ts/process/modules.ts:375-395; src/lib/Setting/Pages/Module/ModuleSettings.svelte:27-33 -->

## Fields in detail

### Namespace

A namespace is an optional identifier. It stays the same when you import a module again. The internal id of the module changes on every import. **Module Integration** uses the namespace. These CBS functions use it too:

- `{{moduleenabled::namespace}}` (alias `module_enabled`): Returns `1` if a module with that namespace is active, otherwise `0`.
- `{{moduleassetlist::namespace}}` (alias `module_assetlist`): Returns the asset names of that module.

See [[CBS Functions]]. If you do not know what to enter, leave the field blank.

<!-- src/ts/cbs.ts:1592-1622 -->

### Custom Toggles

Each line defines one control in the side toggle panel of the chat:

```
key=Label
key=Label=select=Option A,Option B,Option C
key=Label=text
key=Label=textarea
key=Label=group
key=Label=groupEnd
key=Label=divider
key=Text=caption
```

A line with only `key=Label` is a checkbox. The app stores the value as the global chat variable `toggle_<key>`, so scripts and CBS can read it, for example with `{{getglobalvar::toggle_key}}`. The app shows the toggles of all active modules together with the custom toggles of the prompt preset and of the character.

<!-- src/ts/util.ts:1059-1099; src/ts/process/modules.ts:500-512; src/lib/SideBars/Toggles.svelte:70-130 -->

### Hide Icon UI

If any active module has this option checked, the app hides the chat icon of the character.

### Background Embedding

The app joins the Background Embedding of every active module and adds the result to the chat background. It works the same way as the background embedding of a character.

### Low Level Access

Triggers that come from a module run with the **Low Level Access** setting of the module. The own setting of each trigger does not matter. Low level access unlocks trigger effects that call the AI model or need heavy computing. Examples are running an LLM, image generation, alerts, and similarity checks. When you import a module or a character card that has Low Level Access on, the app asks you to accept first. Enable it only if you need these features.

<!-- src/ts/process/modules.ts:470-484, 307-312; src/ts/process/triggers.ts:1406-1541 -->

## Import and export

**Import** accepts these files:

- `.charx`: A character card. The app converts it into a module.
- `.risum`: The legacy binary module format.
- `.json`: A module exported as JSON, a RisuAI lorebook export, a lorebook in the `entries` format of another app, or a RisuAI regex export.
- `.lorebook`.

Every imported module gets a new internal id. If you import the same file twice, you get two separate modules.

**Export** offers these choices:

- **CharX (Recommended)**: The app saves the module as a `.charx` character card.
- **RisuM (Legacy)**: The binary `.risum` format. The file stores assets separately inside it. The assets get new asset ids when you import the file again.

When you convert a character into a module, the app keeps its description, first message, alternate greetings, and global note replacement as special lorebook entries. If you convert the module back to a character, the app restores them.

<!-- src/ts/process/modules.ts:38-356; src/ts/interchangeability.ts -->

## MCP modules

An MCP module holds only the address of an MCP (Model Context Protocol) server. When the module is active, the app makes the tools of the server available to the model. You cannot edit or export MCP modules, so the Download and Edit buttons are disabled.

<!-- src/ts/process/modules.ts:514-518; src/ts/process/mcp/mcp.ts -->

## Notes

- If an asset of a module has the same name as one of the own assets of the character, the app uses the asset of the character. See [[CBS Assets]].
- Large asset modules make saves and backups larger. While the module exists, the cleanup of unused assets never removes assets inside modules.
- A persona that you make from a character or a module keeps an embedded module inside the persona. The app applies that embedded module to chats only if you also installed the same module in **Settings → Modules**.
- Some edits, for example to the lorebook or the triggers of a module, can fail to show in an open chat until the chat view refreshes. If you switch chats or characters, the view refreshes.
