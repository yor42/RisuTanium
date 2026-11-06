# Settings: Plugin

This page belongs to [[Settings]]. To open it, go to **Settings → Plugin**. To learn how to write a plugin, see [[Plugin Docs]].

## Plugin list

The list shows one row for each installed plugin. Click the header of a row to expand or collapse its list of arguments.

| Element | Shown when | What it does |
|---|---|---|
| "Hot" badge | The plugin is hot-reloading now. | Shows a status only. |
| Version-2 warning icon | The plugin declares API version 2 or 2.1. | Opens a warning that explains the version gap. |
| Custom link icon(s) | The plugin declares one or more `customLink` entries with an http(s) URL. | Opens that link in a new tab. |
| Update-available icon | The plugin has an `updateURL`, and a check finds a newer version. | Asks you to accept, then updates the plugin. |
| Enable/disable (power icon) | Always. | Turns the plugin on or off and reloads the plugins. |
| Remove (trash icon) | Always. | Asks you to accept, then removes the plugin. If the plugin was the selected plugin provider, the app also clears that selection. |

<!-- src/lib/Setting/Pages/PluginSettings.svelte:35-130 -->

## Version 1 plugins

For a V1 plugin, the page shows a fixed warning instead of an argument editor. The warning says that the app expects API V3. You cannot edit the arguments of a V1 plugin on this page.
<!-- src/lib/Setting/Pages/PluginSettings.svelte:135-140 -->

## Argument editor (V2/V3 plugins)

For a V2 or V3 plugin, the page shows one control for each declared argument. The control depends on the type of the argument. The page skips arguments whose names start with `hidden_`.

| Argument shape | Control shown |
|---|---|
| An array value | Select dropdown |
| `"string"` type | Text field, textarea, or group of radio buttons |
| `"int"` type | Number field, checkbox, or group of radio buttons |

If the plugin marks an argument, the page shows a divider line before it. The plugin supplies the radio buttons as a list of `label|value` pairs. A comma separates the pairs, and a pipe separates the label from the value in each pair.
<!-- src/lib/Setting/Pages/PluginSettings.svelte:142-240 -->

## Adding plugins

| Control | What it does |
|---|---|
| "+" | Opens the plugin import dialog. |
| Code icon (menu) | Opens a menu with three choices. "Import plugin with hot reload" loads the files of the plugin with hot reload on. This helps while you develop a plugin. "Download plugin template" downloads an archive of a starter plugin project. Cancel closes the menu. |

<!-- src/lib/Setting/Pages/PluginSettings.svelte:246-276 -->
