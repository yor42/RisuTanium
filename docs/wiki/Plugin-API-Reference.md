# Plugin API Reference

This page is the full reference for the V3 plugin API. The global `risuai` object (alias: `Risuai`) exposes it inside the sandboxed iframe of a plugin. For the file format, the sandbox model, and the permission system, see [[Plugin Docs]].

**Every method returns a `Promise` and you must `await` it.** This includes methods that look synchronous, because all calls cross an iframe `postMessage` boundary. <!-- src/ts/plugins/apiV3/factory.ts:374-382 -->

The type definitions for the API are in `risuai.d.ts`. This page documents the actual behavior. Where the behavior differs from the type definitions, the page notes the difference.

## Version info

- **`apiVersion`**: A string constant, `"3.0"`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1301 -->
- **`apiVersionCompatibleWith`**: `["3.0"]`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1302 -->
- **`getRuntimeInfo(): Promise<{apiVersion, platform, saveMethod}>`**: `platform` is `'node'`, `'tauri'`, or `'web'`. `saveMethod` is `'tauri'` or `'local'`, depending on whether the app runs under Tauri. Fork-specific: Upstream also has an `'account'` value for cloud-account storage. This fork does not have it, because the fork removed RisuAccount. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1276-1287 -->

## Logging and alerts

- **`log(message: string)`**: Adds a prefix and logs to the host console as `[RisuAI Plugin: <name>] <message>`. It is deprecated in favor of plain `console.log`, which also works inside the iframe. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1211-1213 -->
- **`alert(msg: string)`**, **`alertConfirm(msg: string)`**, **`alertError(msg: string)`**: Show the styled dialog of the host. They do not use the native `alert` and `confirm` of the browser. `alertConfirm` resolves to a boolean. `risuai.d.ts` does not declare these three methods, but they are live root methods that you can call. See [Other methods](#other-methods-not-in-risuaidts). <!-- src/ts/plugins/apiV3/v3.svelte.ts:1242-1250 -->

## Containers (the own iframe UI of the plugin)

- **`showContainer(mode: 'fullscreen')`**: Makes the iframe of the plugin visible, moves it to `document.body`, and stretches it to cover the viewport (`position: fixed; inset: 0; z-index: 1000`). Any `mode` other than `'fullscreen'` does nothing. <!-- src/ts/plugins/apiV3/v3.svelte.ts:982-1009 -->
- **`hideContainer()`**: Sets `display: none` on the iframe. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1010-1012 -->

## Main-DOM access (`SafeElement` / `SafeDocument`)

- **`getRootDocument(): Promise<SafeDocument|null>`**: Needs the `mainDom` permission. Returns `null` if the user denies it. Returns a wrapper, based on `SafeElement`, around the *real* host `document.documentElement`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1013-1019 -->
- **`createMutationObserver(callback): Promise<SafeMutationObserver>`**: Wraps a real `MutationObserver`. It calls `disconnect()` automatically when the plugin unloads. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1214-1220 -->

`SafeElement` has these methods. All are async, and all operate through the RPC bridge on a specific `HTMLElement` that the app captured:
- `appendChild`, `removeChild`, `replaceChild`, `replaceWith`, `cloneNode(deep?)`, `prepend`, `remove`
- `innerText()`, `textContent()`, `setTextContent(v)`, `setInnerText(v)`
- `getInnerHTML()`, `getOuterHTML()`, `setInnerHTML(v)`, `setOuterHTML(v)`. The setters sanitize with DOMPurify, so script tags and similar content are stripped.
- `setAttribute(name, value)`, `getAttribute(name)`. The name **must** start with `x-`. Otherwise the call throws.
- `setStyle`, `getStyle`, `getStyleAttribute`, `setStyleAttribute`
- `addClass`, `removeClass`, `setClassName`, `getClassName`, `hasClass`
- `focus()`, `getChildren()`, `getParent()`
- `querySelector(sel)`, `querySelectorAll(sel)`, `getElementById(id)`, `getElementsByClassName(cls)`, `matches(sel)`
- `clientHeight()`, `clientWidth()`, `clientTop()`, `clientLeft()`, `getBoundingClientRect()`, `getClientRects()`
- `nodeName()`, `nodeType()`
- `addEventListener(type, fn, opts?)`, `removeEventListener(type, id, opts?)`
- `scrollIntoView(opts?)`

<!-- src/ts/plugins/apiV3/v3.svelte.ts:64-360 -->

- If you construct a `SafeElement` around an element that has a `freezed` attribute, the constructor throws at once.
- `addEventListener` allows only a fixed list of events. Mouse, pointer, and scroll events fire at once. `keydown`, `keyup`, and `keypress` are deliberately delayed by a random 0–99ms (anti-fingerprinting) before the listener runs. Any other event type throws. The listener receives a trimmed plain object with a few common fields. It does not receive a real `Event`.

`SafeDocument` extends `SafeElement` and wraps the real `document`:
- **`createElement(tagName)`**: Tags that are not on the whitelist silently become `<div>`. You can create `<a>`, but you cannot set its `href` with `setAttribute`. Use `createAnchorElement` instead.
- **`createAnchorElement(href)`**: Validates the URL. Anything that is not `http:` or `https:`, or that does not parse, becomes `href="#"`.

`SafeClassArray<T>` is an async array-like. Methods such as `getChildren()` and `querySelectorAll()` return it. It has `at(index)`, `length()`, and `push(item)`. Use the helper `risuai.unwarpSafeArray(safeArray)` to convert it to a plain array.

`SafeMutationObserver` has `observe(element, options)` and `disconnect()`. Mutation records expose `getType()`, `getTarget()`, and `getAddedNodes()`.

## Character and chat data

- **`getCharacter(): Promise<any>`** / **`setCharacter(char)`**: Get and set the character that is selected now. The deprecated aliases are `getChar` and `setChar`. There is no permission gate. <!-- src/ts/plugins/apiV3/v3.svelte.ts:979-980 -->
- **`getCharacterFromIndex(index): Promise<any|null>`**: A snapshot of the character list at that array index, or `null` if the index is out of range. <!-- src/ts/plugins/apiV3/v3.svelte.ts:875-883 -->
- **`setCharacterToIndex(index, character)`**: Writes directly into the character list at that index, in memory. For indices other than the one that is open now, see the [known persistence issue](Plugin-Docs#known-issue-writing-to-a-non-selected-character). <!-- src/ts/plugins/apiV3/v3.svelte.ts:884-891 -->
- **`getChatFromIndex(characterIndex, chatIndex): Promise<any|null>`**: A snapshot of the chat of that character at that index. <!-- src/ts/plugins/apiV3/v3.svelte.ts:892-903 -->
- **`setChatToIndex(characterIndex, chatIndex, chat)`**: Writes directly into that chat slot, but only if the slot already exists. It has the same persistence caveat as `setCharacterToIndex`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:947-957 -->
- **`getCurrentCharacterIndex(): Promise<number>`** / **`getCurrentChatIndex(): Promise<number>`**: The index of the selected character, and its `chatPage` (the active chat slot). <!-- src/ts/plugins/apiV3/v3.svelte.ts:958-965 -->
- **`getCurrentLorebookEntries(): Promise<any[]>`**: The concatenation of the global lorebook of the current character, the local lorebook of the active chat, and the active module lorebooks. The entries are **raw**: the app applies no filter for activation conditions or token budget. <!-- src/ts/plugins/apiV3/v3.svelte.ts:966-977 -->
- **`checkCharOrder(): Promise<void>`**: Validates the list of the order of characters in the database again and repairs it. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1267 -->

### `parseRisuChat`

```ts
parseRisuChat(text: string, options?: {
    messageIndex?: number, role?: string, processRegex?: boolean,
    runVar?: boolean, rmVar?: boolean, tokenizeAccurate?: boolean,
    cbsConditions?: { firstmsg?: boolean, chatRole?: string },
}): Promise<string>
```

This runs the `{{curly brace}}` macro parser of Risu against `text`. It uses the **character that is selected now and its active chat**. It throws if no character is selected or no chat is active. `messageIndex` defaults to `-1`. It must be a valid index into the messages of the active chat, or `-1`. If `processRegex: true`, the parsed text additionally goes through the `editprocess` script pipeline. This can invoke plugin script handlers and Regex and Lua action scripts. It can **change the active chat** as a side effect. <!-- src/ts/plugins/apiV3/v3.svelte.ts:904-946 -->

## Storage

There are three independent storage areas, and all are async:

| API | Backing | Scope | Syncs with the save file? |
|---|---|---|---|
| `pluginStorage` | Cold storage that is part of the save file, keyed for each plugin | Per plugin | Yes |
| `getLocalPluginStorage()` → `SafeLocalPluginStorage` | `localforage` (IndexedDB), with a key prefix | Shared across all plugins, but local to the device | No |
| `safeLocalStorage` | Browser `localStorage`, with the key prefix `safe_plugin_` | Shared across all plugins, local to the device, strings only | No |

- **`pluginStorage.getItem(key)` / `.setItem(key, value)` / `.removeItem(key)` / `.clear()` / `.key(index)` / `.keys()` / `.length()`**: Values can be serialized as JSON, and the app stores them in cold storage. `getItem` resolves `null` for a missing key. Note: `getItem` and `setItem` can reject when the underlying storage fails. They do not only resolve `null` or succeed. Wrap these calls in `try/catch`. <!-- src/ts/plugins/apiV3/pluginColdStorage.ts:16-104 -->
- **`getLocalPluginStorage(): Promise<SafeLocalPluginStorage>`** gives `.getItem<T>(key)`, `.setItem<T>(key, value)`, `.removeItem(key)`, `.keys()`, and `.clear()`. The values are generic and can be serialized as JSON. There is no `key(index)` and no `length()`. <!-- src/ts/plugins/pluginSafeClass.ts:51-77 -->
- **`safeLocalStorage`** gives `.getItem`, `.setItem`, `.removeItem`, `.clear`, `.key(index)`, and `.length()`. Values are strings only. It mirrors the browser `localStorage` API. <!-- src/ts/plugins/pluginSafeClass.ts:9-48 -->

## Arguments

- **`getArgument(key): Promise<string|number|undefined>`** / **`setArgument(key, value)`**: Read and write the own stored value of this plugin for `key`. This is the value bound to an `//@arg` declaration. The names are not namespaced by plugin name, because `getArgument` and `setArgument` already scope to the calling plugin. <!-- src/ts/plugins/apiV3/v3.svelte.ts:859-874 -->
- **`getArg(key)` / `setArg(key, value)`**: The deprecated equivalents from V2. The `key` here must be namespaced as `"<pluginName>::<argName>"`. Prefer `getArgument` and `setArgument`. <!-- src/ts/plugins/plugins.svelte.ts:500-508,576-584 -->

## Database

- **`getDatabase(includeOnly?: string[]|'all'): Promise<DatabaseSubset|null>`**: Needs the `db` permission (with a periodic reconfirmation). Returns `null` if the user denies it. Returns a plain-object snapshot that is restricted to an allow-list of keys: `characters, modules, enabledModules, moduleIntergration, pluginV2, personas, plugins, pluginCustomStorage, temperature, askRemoval, maxContext, maxResponse, frequencyPenalty, PresensePenalty, theme, textTheme, lineHeight, seperateModelsForAxModels, seperateModels, customCSS, guiHTML, colorSchemeName, selectedPersona, characterOrder`. `includeOnly` narrows this further. Note: The `DatabaseSubset` type in `risuai.d.ts` lacks `selectedPersona` and `characterOrder`. Both are in the actual allow-list, and the own JSDoc of `getDatabase` mentions them. <!-- src/ts/plugins/apiV3/v3.svelte.ts:771-785 --> <!-- src/ts/plugins/apiV3/risuai.d.ts:372-422 -->
- **`setDatabaseLite(db: DatabaseSubset)`**: Merges the given keys directly into the live database object, with no validation or migration pass. The keys are restricted to the same allow-list. Anything else lands in the area for custom plugin storage. **There is no permission gate.** <!-- src/ts/plugins/plugins.svelte.ts:752-764 -->
- **`setDatabase(db: DatabaseSubset)`**: Merges keys in the same way as `setDatabaseLite`. But if the merged object includes a `plugins` key, the app first runs that list through the same flow that asks to accept each new plugin. That is the flow of [install-from-plugin](Plugin-Docs#install-enable-and-update-flow). Then the app commits the result through the top-level save routine of the database. That routine also fills in a large set of default and legacy fields before the data becomes live. For example, it fills in default prompts and the default model, and it resets stale `isStreaming` flags. **There is no permission gate.** <!-- src/ts/plugins/plugins.svelte.ts:765-782 --> <!-- src/ts/storage/database.svelte.ts:30-726 -->
  - Note: Despite their names, neither `setDatabaseLite` nor `setDatabase` writes to disk or to the cloud itself. Both only replace the database object in memory. `setDatabase` additionally runs a pass that fills in defaults and migrates data first. The actual persistence happens elsewhere, reactively. For the one persistence caveat that this doc covers for plugin authors, see the [known issue](Plugin-Docs#known-issue-writing-to-a-non-selected-character).
- **Fork difference, empty chats and SupaMemory:** If one of these writers leaves a chat with zero messages, the app clears the [[SupaMemory]] data and the covered marker of that chat. `setChatToIndex` clears that chat. `setCharacterToIndex` and `setCharacter` clear the chats of that character. When the written data has a `characters` list, `setDatabase` and `setDatabaseLite` clear the empty chats of every character, not only the chats that you changed. See [[SupaMemory#when-messages-are-removed]]. <!-- src/ts/plugins/apiV3/v3.svelte.ts:726,1043; src/ts/plugins/plugins.svelte.ts:664-666,770,1029,1046,1077 -->

## Color scheme and text theme

- **`changeColorScheme(name: string)`**: Switches to a built-in preset (`'default'`, `'dark'`, `'light'`, `'cherry'`, `'galaxy'`, `'nature'`, `'realblack'`, `'monokai-light'`, `'monokai-black'`). <!-- src/ts/plugins/apiV3/v3.svelte.ts:790-792 -->
- **`setColorScheme(scheme: ColorScheme)`**: Validates that all required string fields and `type: 'light'|'dark'` are present. It throws otherwise. Sets `colorSchemeName` to `'custom'`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:793-808 -->
- **`getColorScheme(): Promise<{name, scheme}>`**. <!-- src/ts/plugins/apiV3/v3.svelte.ts:809-815 -->
- **`changeTextTheme(name: 'standard'|'highcontrast')`**: Throws on any other value. <!-- src/ts/plugins/apiV3/v3.svelte.ts:818-825 -->
- **`setCustomTextTheme(theme: CustomTextTheme)`**: Validates that all 6 font-color fields are strings. Sets `textTheme` to `'custom'`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:826-844 -->
- **`getTextTheme(): Promise<{name, customTheme}>`**. <!-- src/ts/plugins/apiV3/v3.svelte.ts:845-851 -->

## Network

- **`nativeFetch(url, options?): Promise<Response>`**: A real `fetch` that the host issues. It bypasses the own request pipeline of Risu. It blocks requests whose URL contains `risuai.xyz`, `risuai.net`, or `sionyw.com`, and it throws for them. If `options.headers` includes `x-api-key`, `authorization`, or `proxy-authorization`, the app logs a warning to the console. The app does **not** strip the header. It only flags it. <!-- src/ts/plugins/apiV3/v3.svelte.ts:679-693 -->
- **`saveSecretHeader(key, prefix, value)`**: Not implemented. The call does nothing except log a warning that the feature is pending. Note: `risuai.d.ts` declares a signature with 3 arguments, `(key, prefix, value)`. But the actual function takes only 2 arguments, `(key, value)`. `prefix` does not exist in the implementation. Do not depend on this API yet. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1478-1482 -->
- **`risuFetch(url, arg)`**: A legacy fetch helper from the V2 era. It is still present and you can call it, but `risuai.d.ts` does **not declare** it. It logs a deprecation warning on every call and recommends `nativeFetch`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:662-678 -->

## UI registration

- **`registerSetting(name, callback, icon?, iconType?, id?): Promise<{id}>`**: Adds an entry to the plugin settings menu. If `id` matches an existing entry (from this registration or a previous one), the call replaces that entry in place. Otherwise it appends a new entry. `iconType` must be `'html'`, `'img'`, or `'none'`. The app removes the entry automatically when the plugin unloads. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1020-1056 -->
- **`registerButton(arg, callback): Promise<{id}>`**: `arg.location` is `'action'`, `'chat'`, or `'hamburger'` (default `'action'`). Each has its own list. If you replace an existing `id`, it stays in its original list, regardless of `location`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1084-1157 -->
- **`unregisterUIPart(id)`**: Removes the id from all four lists of menus and buttons and from the list of chat panels (see below), whichever it matches. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1197-1210 -->
- **`setChatPanel(content: string|null, options?: {id?, className?}): Promise<{id}>`**: `risuai.d.ts` does **not declare it**. It renders an HTML panel in the chat UI and sanitizes it with DOMPurify. The call strips all tags and attributes from `className`, so it counts as plain text. If you pass `content` as `null` or `''`, the panel is removed. The default `id` is `"<pluginName>:default"`. The app removes the panel automatically on unload. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1158-1194 -->

## MCP (Model Context Protocol)

- **`registerMCP({identifier, name, version, description}, getToolList, callTool): Promise<void>`**: `identifier` must start with `plugin:`. Otherwise the call throws. It registers a client on which the MCP layer of the app can call `getToolList()` and `callTool(name, args)`. There is no permission gate. <!-- src/ts/process/mcp/pluginmcp.ts:36-54 -->
- **`unregisterMCP(identifier)`**. <!-- src/ts/process/mcp/pluginmcp.ts:56-58 -->

## Providers

- **`addProvider(name, func, options?)`**: Registers a custom AI provider under `name`. It shows up next to the built-in providers. `func` receives `(args: ProviderArguments, abortSignal?)`. It must resolve `{success, content}`. `content` can be a string or a `ReadableStream<string>`. Internally, the app force-overwrites `args.mode` to `'v3'` before your function runs, whatever the caller requested. On registration, the console logs a warning that this API "can potentially be unsafe". <!-- src/ts/plugins/apiV3/v3.svelte.ts:697-724 -->
  - The app triggers the `provider` permission prompt (again) on every invocation of the registered function (`'periodically'` reconfirmation). But the app does not check its result. The provider function runs whether the prompt returns `true` or `false`. Treat `provider` as informational consent only. It is not an enforced gate.

## TTS hooks

Neither hook has a permission prompt. Both unregister automatically when the plugin unloads. Multiple hooks of the same kind run one after another in the order of registration. Each receives the output of the previous hook. If a hook throws, the app discards its result, and the pipeline continues with the next hook. There is no execution timeout. A hook that hangs stalls the TTS playback for that message. <!-- src/ts/plugins/apiV3/v3.svelte.ts:725-736 -->

- **`addTTSPreprocessor(func: (ctx: BeforeTTSContext) => BeforeTTSResult|void)`**: `ctx` is `{text, ttsMode, characterId}`. Return `{text?}` to rewrite the text that the app is about to speak. Return `{skip: true}` to abort the playback entirely for that message.
- **`addTTSPostprocessor(func: (ctx: AfterTTSContext) => AfterTTSResult|void)`**: `ctx` is `{audio: ArrayBuffer, mimeType, ttsMode, characterId}`. This is the raw encoded audio, before decoding. Return `{audio?, mimeType?}` to replace the audio. Return `{skip: true}` to suppress the playback. The app does not invoke it for the `'webspeech'` provider, because no audio buffer exists. It does not invoke it for the `'vits'` provider either, because that provider has a separate playback path.

## Script handlers and replacers

- **`addRisuScriptHandler(mode: 'display'|'output'|'input'|'process', func)`** / **`removeRisuScriptHandler(mode, func)`**: Hooks that transform text. They match the existing pipeline of script modes of Risu. There is no permission gate. <!-- src/ts/plugins/apiV3/v3.svelte.ts:737-738 -->
- **`addRisuReplacer(type: 'beforeRequest'|'afterRequest', func)`** / **`removeRisuReplacer(type, func)`**: `'beforeRequest'` receives and returns `OpenAIChat[]`. `'afterRequest'` receives and returns a `string`. Needs the `replacer` permission (with a periodic reconfirmation). If the user denies it, the call silently does nothing and registers nothing. Note: `risuai.d.ts` does not mention this permission requirement. <!-- src/ts/plugins/apiV3/v3.svelte.ts:739-747 -->

## Chat listeners

- **`addRisuChatListener(mode: 'output', func)`** / **`removeRisuChatListener(mode, func)`**: Fires once for each model output. It fires after streaming completes, after the Lua `output` trigger, and after the host-side post-processing of the output (for example the handling of inlays) already committed to the chat. The app awaits listeners one after another. A slow listener delays the rest of the chat flow. If you do not need to block, start your own async work inside the listener and do not wait for it. It also needs the `replacer` permission, the same gate as `addRisuReplacer`. `risuai.d.ts` does not document this either. The app removes the listener automatically on plugin unload. <!-- src/ts/plugins/apiV3/v3.svelte.ts:748-756 -->
- The callback receives `{char, chat, characterIndex, chatIndex, messageIndex}`. `char` and `chat` are plain snapshots, and a change to them does nothing. Use `characterIndex` and `chatIndex` with `setChatToIndex` to persist changes. If you need to merge with the writes of another listener, read again with `getChatFromIndex` first. `messageIndex` can be `-1` if another trigger or handler already removed the message by the time your listener runs.

## Body interceptors

- **`registerBodyIntercepter(callback: (body, type) => any): Promise<{id}|null>`**: Lets a plugin read and rewrite the outgoing HTTP body of LLM requests. Sensitive fields such as API keys are excluded from what the app hands to `callback`. **It needs the `replacer` permission.** It returns `null` if the user denies it. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1057-1075 -->
- **`unregisterBodyIntercepter(id)`**. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1077-1082 -->

## Assets

- **`readImage(path?): Promise<any>`**: The app sanitizes `path`. It strips an `assets/` prefix and adds it again internally. The remaining path must not contain `/` or `\`. It throws if it does. This effectively restricts reads to flat file names inside the assets folder. <!-- src/ts/plugins/plugins.svelte.ts:799-809 -->
- **`readInlay(id: string): Promise<InlayAssetForPlugin|null>`**: Looks up an inlay asset (image, video, audio, or signature) that is attached to a chat, by UUID. The UUID comes from a `{{inlayed::<uuid>}}` placeholder in the raw message text. Returns `null` if the asset does not exist. Needs the `inlay` permission (with a periodic reconfirmation). It also returns `null` if the user denies it. So a denied permission looks the same as "not found". Note: `risuai.d.ts` documents only the `null` return for the not-found case. <!-- src/ts/plugins/apiV3/v3.svelte.ts:762-768 -->
- **`saveAsset(data): Promise<string>`**: Saves arbitrary asset data and returns its path. <!-- src/ts/plugins/apiV3/v3.svelte.ts:769 -->

## Plugin/runtime management

- **`loadPlugins(): Promise<void>`**: Reloads the entire plugin set (all V2 and V3 plugins). <!-- src/ts/plugins/apiV3/v3.svelte.ts:760 -->
- **`onUnload(func)`**: Registers a cleanup callback. The app runs it when the plugin unloads: when the user disables it, removes it, or reloads it through `loadPlugins`. All registered callbacks run with a combined timeout of 1 second. After that, the app tears down the iframe of the plugin in any case. The app wraps each callback in its own `try/catch`. So one callback that throws does not stop the other callbacks from running, and it does not block the teardown of the iframe. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1221-1223,527-566 -->
- **`getFetchLogs(): Promise<{url, body, status?, response?}[]|null>`**: Needs the `fetchLogs` permission. Returns `null` if the user denies it. Before the app hands the URLs to the plugin, it strips them down to `origin + pathname`. It discards the query string and the hash. The likely reason is to avoid leaks of secrets in the query string. Note: `risuai.d.ts` declares that the resolved objects also have the fields `error?: string` and `timestamp: number`. The implementation never fills in either field. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1224-1240 -->
- **`requestPluginPermission(permission): Promise<boolean>`**: Proactively triggers the consent flow that [[Plugin Docs#permission-system]] describes, for an arbitrary permission string. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1268-1270 -->
- **`unwarpSafeArray(safeArray): Promise<T[]>`**: A helper that drains a `SafeClassArray` into a plain array through repeated `at()` calls. <!-- src/ts/plugins/apiV3/factory.ts:410-418 -->
- **`searchTranslationCache(partialKey): Promise<{key, value}[]>`** / **`getTranslationCache(key): Promise<string|null>`**: Read-only access to the LLM translation cache. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1332-1337 -->

## Plugin-to-plugin IPC

- **`addPluginChannelListener(channelName, callback)`**: Listens on a channel with the scope `<thisPluginName><channelName>`. `risuai.d.ts` marks it as "subject to change". <!-- src/ts/plugins/apiV3/v3.svelte.ts:1443-1448 -->
- **`postPluginChannelMessage(pluginName, channelName, message)`**: Delivers to the channel of another plugin **only if both sides opted in through `//@allowed-ipc`**. The receiver must declare `//@allowed-ipc <sender-name>`, and the sender must declare `//@allowed-ipc <receiver-name>`. If either declaration is missing, the app logs a warning that names the exact directive to add, and it drops the message. It does not queue the message or retry. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1449-1477 -->

## Model and chat control

- **`runLLMModel(options: {messages, staticModel?, mode, allowPlugins?}): Promise<any>`**: Runs a one-off request through the model layer of Risu. `allowPlugins` defaults to `false`. This blocks the request from resolving to another model that a plugin provides (`pluginmodel:::*`). It exists specifically to prevent accidental IPC loops between provider plugins. Pass `true` only if you intentionally want to reach the plugin-supplied model of the user. Then you must avoid loops yourself. There is no permission gate. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1359-1379 -->
- **`sendChat(message: string): Promise<boolean>`**: Pushes `message` as a user chat message and runs the normal send and generate flow. A blank string triggers a send with no new message. Needs the `sendChat` permission. It returns `false` if the user denies it. It throws in three cases: the active chat has not finished loading from cold storage, a chat is already in progress, or the current model comes from a plugin. The last case is blocked to avoid IPC loops. The check of cold storage runs before the permission prompt and before the app pushes `message` into the chat. So the app never tells a plugin "permission granted" for a send that it rejects anyway. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1380-1442 -->

## Other methods (not in `risuai.d.ts`)

These methods exist on the live `risuai` object, and a plugin can call them. But they are not part of the published type surface in `risuai.d.ts`. The header comment of that file says that anything not documented there "is considered internal or subject to change without deprecation, and should not be used by plugin developers." Treat everything below as unstable and subject to change:

- `risuFetch(url, arg)`: See [Network](#network).
- `alert(msg)`, `alertConfirm(msg)`, `alertError(msg)`: See [Logging and alerts](#logging-and-alerts).
- `setChatPanel(content, options?)`: See [UI registration](#ui-registration).
- `installPlugin(plugins: RisuPlugin[])`: A thin wrapper around the same flow that asks to accept each proposed plugin. The `plugins` key handling of `setDatabase` uses that flow internally. The method returns only the subset that the user accepted. It writes nothing into the database itself. <!-- src/ts/plugins/apiV3/v3.svelte.ts:787 --> <!-- src/ts/plugins/plugins.svelte.ts:931-952 -->
