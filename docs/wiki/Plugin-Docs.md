# Plugin Docs

RisuAI plugins are JavaScript or TypeScript files that users supply. They extend the app. They can add custom AI providers, chat and lorebook hooks, extra settings screens, buttons, MCP tools, TTS pre-processing and post-processing, and more.

This page covers the format of the plugin file, how the app installs and sandboxes plugins, and the permission system. For the full list of methods in the API, see [[Plugin API Reference]].

## API versions

The plugin API has three generations:

| Version | Status |
|---|---|
| **3.0** | Current. All new plugins must target this version. |
| 2.1 | **Discontinued.** The app cannot newly install it. |
| 2.0 | **Discontinued.** The app cannot newly install it. It no longer executes even if a profile already saved it. |

At import time, the `//@api` header decides whether a new install is allowed <!-- src/ts/plugins/plugins.svelte.ts:343-361 -->:

- `//@api 3.0`: The app accepts the plugin.
- `//@api 2.1`: The importer refuses with *"Your plugin specifies API version 2.1, which is outdated and no longer supported. Please update your plugin to use at least API version 3.0."* The importer installs nothing. <!-- src/ts/plugins/plugins.svelte.ts:345-348 -->
- `//@api 2.0`, or no `//@api` header at all: The importer refuses in the same way, with a message for 2.0. <!-- src/ts/plugins/plugins.svelte.ts:349-353 -->

This gate blocks only **new imports and updates**. A V2 or V2.1 plugin can already be in an existing save. It was imported before the gate existed, or it came from an older profile. Such a plugin still loads. `loadPlugins()` splits the saved plugins by their stored `version` field. It always calls the V2 loader for anything tagged `2` or `'2.1'`. See [Legacy (discontinued)](#legacy-v2--v21-discontinued) below for exactly what that loader does with them. <!-- src/ts/plugins/plugins.svelte.ts:419-430 -->

## Plugin file format

A plugin is one `.js` file, or one `.ts` file that the app transpiles with Sucrase on import. You declare metadata with lines that start with the comment prefix `//@`. The code of the plugin follows.

```js
//@name my_plugin
//@display-name My Plugin
//@api 3.0
//@version 1.0.0
//@arg api_key string Your API key

Risuai.log("Hello from my_plugin!");
```

The importer scans **every line of the file**, not only a "header block". It looks for lines that start with a recognized `//@` prefix <!-- src/ts/plugins/plugins.svelte.ts:184-317 -->. So the importer picks up directives wherever they appear. The one exception is `//@version`. The importer rejects it unless it appears within the first 500 bytes of the file <!-- src/ts/plugins/plugins.svelte.ts:295-304 -->. In practice, put **all** metadata at the top of the file. This is easier to read, and it guarantees that the importer catches `//@version`.

### Metadata headers

| Header | Required | Meaning |
|---|---|---|
| `//@name <name>` | Yes | The internal, stable identifier. The app uses it as the key for stored settings, arguments, and storage. Do not rename it after you publish. <!-- src/ts/plugins/plugins.svelte.ts:185-192 --> |
| `//@api <version>` | Yes (in practice) | The API version. Only `3.0` allows an install. See [API versions](#api-versions). <!-- src/ts/plugins/plugins.svelte.ts:193-205 --> |
| `//@display-name <name>` | No | The friendly name that the plugin list in the UI shows. You can change it freely. <!-- src/ts/plugins/plugins.svelte.ts:206-213 --> |
| `//@arg <name> <string\|int> [description/meta]` | No, repeatable | Declares an argument that the user can configure. See [Argument metadata](#argument-metadata). <!-- src/ts/plugins/plugins.svelte.ts:239-278 --> |
| `//@link <https-url> [hover text]` | No, repeatable | Adds a link icon next to the plugin in the settings list. The URL must start with `https`. <!-- src/ts/plugins/plugins.svelte.ts:215-238 --> |
| `//@update-url <https-url>` | No | The URL that the app checks for updates. It must support CORS and HTTP `Range` requests, because the app fetches only the first 512 bytes for the version probe. It must be `https`. It needs `//@version` to be set too. <!-- src/ts/plugins/plugins.svelte.ts:280-293,324-327 --> |
| `//@version <semver>` | Required only if `//@update-url` is set | The own version of the plugin, for example `1.0.0`. It must be `>= 0.0.1`. It must appear within the first 500 bytes of the file. <!-- src/ts/plugins/plugins.svelte.ts:295-304,329-332 --> |
| `//@allowed-ipc <plugin-name> [more names...]` | No | A whitelist of other plugins that can talk to this plugin, and that this plugin can talk to, over `addPluginChannelListener` and `postPluginChannelMessage`. <!-- src/ts/plugins/plugins.svelte.ts:306-316 --> |

The update check (`checkPluginUpdate`) sends a GET request with `Range: bytes=0-512` to `//@update-url`. It extracts a `//@version` line from the partial response with a regex. It compares that version with the installed `//@version` in dotted-numeric form. The comparison is numeric for each segment. It is not lexicographic. So `1.2.0` > `1.10.0` is false. <!-- src/ts/plugins/plugins.svelte.ts:51-107 -->

### Argument metadata

After the type (`string` or `int`), the text on an `//@arg` line can carry metadata in the tokens `{{key}}` and `{{key::value}}`. Anything that is left over becomes the description of the argument. The settings UI understands these keys: <!-- src/ts/plugins/plugins.svelte.ts:260-277 --> <!-- src/lib/Setting/Pages/PluginSettings.svelte:142-237 -->

- `{{name::Label}}`: Overrides the display name of the field.
- `{{placeholder::...}}`: The placeholder text of the input.
- `{{textarea}}`: Renders a multi-line text area instead of a single-line input (string arguments only).
- `{{checkbox}}` / `{{checkbox::Label}}`: Renders a checkbox (int arguments only). It stores `"1"` or `"0"`.
- `{{radio::Label A|valueA,Label B|valueB}}`: Renders a radio group.
- `{{divider}}` / `{{divider::Section title}}`: Draws a section divider before the field.

```js
//@arg mode string {{name::Mode}}{{radio::Fast|fast,Accurate|accurate}} Choose a processing mode
```

The app parses and stores arguments with names that start with `hidden_` like any other argument. The settings UI does not render them. <!-- src/lib/Setting/Pages/PluginSettings.svelte:142-145 -->

## Install, enable, and update flow

- **Import**: The "+" button on the settings page calls `importPlugin()` with no code. This opens a native file picker for `.js` and `.ts` files. You can also import plugins programmatically by passing the source text directly. The app does this for updates and for hot reload. <!-- src/ts/plugins/plugins.svelte.ts:129-156 -->
- If a plugin with the same `//@name` already exists, the app asks the user to accept the overwrite. <!-- src/ts/plugins/plugins.svelte.ts:388-397 -->
- The app adds newly imported and updated plugins to the plugin list and marks them `enabled: true`. Then `loadPlugins()` runs again for the whole plugin set. <!-- src/ts/plugins/plugins.svelte.ts:363-409 -->
- **Enable/disable**: The power-toggle button in the plugin list flips `plugin.enabled` and calls `loadPlugins()`. The app filters out disabled plugins before it loads. <!-- src/lib/Setting/Pages/PluginSettings.svelte:97-104 --> <!-- src/ts/plugins/plugins.svelte.ts:419-430 -->
- **Remove**: Deletes the entry from the plugin list and reloads. <!-- src/lib/Setting/Pages/PluginSettings.svelte:114-133 -->
- **Update**: If `//@update-url` is set, the UI polls it and offers a one-click reinstall through `updatePlugin()`. That function imports the fetched source again with `isUpdate: true`. The name of the plugin cannot change across an update. <!-- src/ts/plugins/plugins.svelte.ts:109-127,382-385 -->
- **Hot reload (dev mode)**: "Import plugin with hot reload" opens a live file handle through the File System Access API. The app imports the file again automatically whenever it changes on disk, with `isHotReload: true`. Only API 3.0 plugins can use hot reload. <!-- src/ts/plugins/apiV3/developMode.ts --> <!-- src/ts/plugins/plugins.svelte.ts:358-361 -->
- **Install from another plugin**: A plugin can propose the install of other plugins. It writes `plugins` into the object that it passes to `setDatabase`. Each proposed plugin must meet three conditions. It must declare `//@api 3.0`. It must not be installed already under the same name and script. The user must accept a dialog for each plugin before the app adds it. <!-- src/ts/plugins/plugins.svelte.ts:765-782,931-952 -->

## Sandbox model

V3 plugins run **inside a real, sandboxed `<iframe>`**. They do not run in the main page. <!-- src/ts/plugins/apiV3/factory.ts:769-926 -->

- The iframe has `sandbox="allow-scripts allow-modals allow-downloads"`. It has no `allow-same-origin`. So the origin of the iframe is opaque, and the iframe cannot reach the cookies, the storage, or the DOM of the host directly.
- The Content-Security-Policy of the iframe sets these rules:
  - `connect-src 'none'`: no `fetch`, `XHR`, or `WebSocket` from inside the iframe at all.
  - `frame-src 'none'`: no nested iframes.
  - `object-src 'none'`.
  - `script-src 'nonce-...' 'wasm-unsafe-eval'`: only the bootstrap script that the host injects and WASM can run. The policy blocks the injection of arbitrary `<script>`.

  <!-- src/ts/plugins/apiV3/factory.ts:438 -->
- All communication with the host happens over `postMessage` RPC. The injected bootstrap script exposes a `window.risuai` `Proxy`, with the alias `window.Risuai`. **Every property access on it returns an async caller** that makes a round trip to the host. So every call to the plugin API must use `await`, even calls that look synchronous on the host side. <!-- src/ts/plugins/apiV3/factory.ts:374-382 -->
- Network access from a plugin must go through `risuai.nativeFetch` or `risuai.addProvider`. They run on the host side. The iframe itself cannot make network requests because of `connect-src 'none'`.
- Access to the DOM of the *real* app UI is available only through the wrapper objects `SafeElement` and `SafeDocument`. `getRootDocument()` returns them, and the `mainDom` permission controls it. Plugins get an RPC handle to specific elements. They do not get the actual `document`. The creation of elements is limited to a fixed whitelist of tags. Unknown tags silently become `<div>`. `<a>` elements can only get a validated `http(s)` `href` through `createAnchorElement()`. Custom attributes are restricted to an `x-` prefix. Writes to `innerHTML` and `outerHTML` pass through DOMPurify. <!-- src/ts/plugins/apiV3/v3.svelte.ts:64-392 -->
- The own iframe UI of a plugin uses the *real*, unrestricted `document` of the iframe. `showContainer()` and `hideContainer()` show and hide it.

## Legacy V2 / V2.1 (discontinued)

**Do not target V2 or V2.1 for new plugins.** The app can no longer install them. The app explicitly calls V2.1 unsafe. The app shows this warning for any installed V2 or V2.1 plugin: *"Plugin V2 and V2.1 is considered unsafe and will stop working in future versions. Please do not use these versions of plugins."* <!-- src/lang/en.ts:1629 --> <!-- src/lib/Setting/Pages/PluginSettings.svelte:53-59 -->

Today, this happens with plugins that were saved before the gate existed:

- **V2.1** plugins still run. The app passes their source through a static-analysis safety pass. The pass blocklists `eval`, `new Function`, `sessionStorage`, and `cookieStore`. It rewrites `window`, `global`, `globalThis`, `self`, `top`, `parent`, and `frames` to a restricted object. Then the code runs through `new Function(...)` in the **context of the main page**. V2 and V2.1 have no iframe sandbox. <!-- src/ts/plugins/pluginSafety.ts --> <!-- src/ts/plugins/plugins.svelte.ts:890-903 -->
- **V2.0** plugins do not execute at all any more. The loader only logs a warning that the plugin was removed. <!-- src/ts/plugins/plugins.svelte.ts:904-909 -->

The old V2 and V2.1 globals are still wired up for compatibility: `getArg`, `setArg`, `getChar`, `setChar`, `addProvider`, `addRisuScriptHandler`, `addRisuReplacer`, `addRisuChatListener`, `onUnload`, `risuFetch`, `nativeFetch`, `getDatabase`, `setDatabase`, `setDatabaseLite`, `safeLocalStorage`, `safeIdbFactory` (backed by `indexedDB` databases with a prefix), and `safeDocument`. Plugin authors must not build anything new on them. <!-- src/ts/plugins/plugins.svelte.ts:496-815 -->

## Permission system

A number of V3 APIs are behind a consent prompt at runtime. An internal helper, `getPluginPermission(pluginName, kind, reconfirm)`, resolves the prompt: <!-- src/ts/plugins/apiV3/v3.svelte.ts:581-639 -->

| Permission kind | APIs behind it | Prompt |
|---|---|---|
| `db` | `getDatabase()` | *"Plugin {name} is requesting to access the full database, which may expose sensitive information."* |
| `mainDom` | `getRootDocument()` | *"...requesting to access the main Document..."* |
| `fetchLogs` | `getFetchLogs()` | *"...requesting to fetch logs, which may expose sensitive information."* |
| `replacer` | `addRisuReplacer()`, `addRisuChatListener()`, `registerBodyIntercepter()` | *"...requesting permission to replace content in the chat..."* |
| `provider` | The function that `addProvider()` registers. The app checks it on every invocation. | *"...requesting permission to access the provider..."* |
| `sendChat` | `sendChat()` | *"...requesting permission to send chat messages on your behalf..."* |
| `inlay` | `readInlay()` | *"...requesting permission to access the inlay..."* |

<!-- src/lang/en.ts:1622-1629 -->

After the user answers, the app remembers the decision for that plugin for the rest of the session. So the app does not prompt again on every call. Some permissions additionally persist the grant to local storage and ask again automatically after 3 days. These are `db`, `provider`, `replacer` and chat-listener, `fetchLogs`, and anything passed `'periodically'`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:591-639 --> If the user denies a prompt, the gated call returns `null` or `false`. It does not throw. For `addRisuReplacer` and `addRisuChatListener`, the call silently does nothing.

Plugins can also ask in advance with `risuai.requestPluginPermission(kind)`.

**Not every API with a strong effect is behind a permission.** These APIs have no consent prompt at all now: `setDatabase()` and `setDatabaseLite()` (writing), `getCharacter()` and `setCharacter()`, `getCharacterFromIndex()` and `setCharacterToIndex()`, `getChatFromIndex()` and `setChatToIndex()`, and `runLLMModel()`. `getDatabase()` (reading) does have a prompt. Treat those other APIs as always available.

## Known issue: writing to a non-selected character

`setCharacterToIndex(index, character)` and `setChatToIndex(characterIndex, chatIndex, chat)` write directly into the character list in memory, by index. You get the same indices from `characterIndex` and `chatIndex` of `addRisuChatListener`, or from `getCurrentCharacterIndex()`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:884-891,947-957 -->

There is a known issue that nobody fixed yet. A write that targets a character other than the one open in the UI can fail to persist to disk until you open that character at least once. This also applies to a `characters` array that you pass to `setDatabase()` or `setDatabaseLite()`. Until the issue is fixed, a plugin that needs a reliable write must target the selected character (`getCurrentCharacterIndex()`). It must not target an arbitrary index from a background listener.

## Minimal working V3 plugin

```js
//@name hello_world_plugin
//@display-name Hello World
//@api 3.0
//@version 1.0.0
//@arg greeting string {{name::Greeting text}} Text shown when the button is pressed

(async () => {
    await risuai.registerButton({
        name: 'Say Hello',
        icon: '👋',
        iconType: 'html',
        location: 'action',
        id: 'hello-world-button'
    }, async () => {
        const greeting = (await risuai.getArgument('greeting')) || 'Hello!';
        await risuai.alert(greeting);
    });

    await risuai.onUnload(() => {
        console.log('hello_world_plugin unloaded');
    });
})();
```

For the complete list of available methods, see [[Plugin API Reference]].
