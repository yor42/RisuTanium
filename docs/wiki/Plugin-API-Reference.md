# Plugin API Reference

Full reference for the V3 plugin API surface, exposed as the global `risuai` object (alias: `Risuai`) inside a plugin's sandboxed iframe. See [[Plugin Docs]] for the file format, sandbox model and permission system.

**Every method returns a `Promise` and must be `await`-ed**, including ones that look synchronous — all calls cross an iframe `postMessage` boundary. <!-- src/ts/plugins/apiV3/factory.ts:374-382 -->

Type definitions for the API live in `risuai.d.ts`. This page documents actual behavior; where that differs from the type definitions, the difference is noted.

## Version info

- **`apiVersion`**: string constant `"3.0"`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1301 -->
- **`apiVersionCompatibleWith`**: `["3.0"]`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1302 -->
- **`getRuntimeInfo(): Promise<{apiVersion, platform, saveMethod}>`** — `platform` is `'node'|'tauri'|'web'`; `saveMethod` is `'tauri'|'local'`, depending on whether the app is running under Tauri. Fork-specific: upstream also has an `'account'` value for cloud-account storage, which this fork does not, since RisuAccount is removed here. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1276-1287 -->

## Logging & alerts

- **`log(message: string)`** — prefixes and logs to the host console as `[RisuAI Plugin: <name>] <message>`. Deprecated in favor of plain `console.log` (which also works inside the iframe). <!-- src/ts/plugins/apiV3/v3.svelte.ts:1211-1213 -->
- **`alert(msg: string)`**, **`alertConfirm(msg: string)`**, **`alertError(msg: string)`** — show the host's styled dialog (not the browser's native `alert`/`confirm`). `alertConfirm` resolves to a boolean. These three are not declared in `risuai.d.ts`, but are live, callable root methods — see [Other methods](#other-methods-not-in-risuaidts). <!-- src/ts/plugins/apiV3/v3.svelte.ts:1242-1250 -->

## Containers (plugin's own iframe UI)

- **`showContainer(mode: 'fullscreen')`** — makes the plugin's iframe visible, moves it to `document.body`, and stretches it to cover the viewport (`position: fixed; inset: 0; z-index: 1000`). Any `mode` other than `'fullscreen'` is a no-op. <!-- src/ts/plugins/apiV3/v3.svelte.ts:982-1009 -->
- **`hideContainer()`** — sets the iframe's `display: none`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1010-1012 -->

## Main-DOM access (`SafeElement` / `SafeDocument`)

- **`getRootDocument(): Promise<SafeDocument|null>`** — requires the `mainDom` permission; returns `null` if denied. Returns a `SafeElement`-based wrapper around the *real* host `document.documentElement`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1013-1019 -->
- **`createMutationObserver(callback): Promise<SafeMutationObserver>`** — wraps a real `MutationObserver`; auto-`disconnect()`s when the plugin unloads. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1214-1220 -->

`SafeElement` methods (all async, all operate through the RPC bridge on a specific captured `HTMLElement`): `appendChild`, `removeChild`, `replaceChild`, `replaceWith`, `cloneNode(deep?)`, `prepend`, `remove`, `innerText()`, `textContent()`, `setTextContent(v)`, `setInnerText(v)`, `getInnerHTML()`/`getOuterHTML()`, `setInnerHTML(v)`/`setOuterHTML(v)` (sanitized with DOMPurify — script tags etc. are stripped), `setAttribute(name, value)`/`getAttribute(name)` (name **must** start with `x-`, or it throws), `setStyle`/`getStyle`/`getStyleAttribute`/`setStyleAttribute`, `addClass`/`removeClass`/`setClassName`/`getClassName`/`hasClass`, `focus()`, `getChildren()`, `getParent()`, `querySelector(sel)`/`querySelectorAll(sel)`, `getElementById(id)`, `getElementsByClassName(cls)`, `matches(sel)`, `clientHeight()`/`clientWidth()`/`clientTop()`/`clientLeft()`, `getBoundingClientRect()`/`getClientRects()`, `nodeName()`/`nodeType()`, `addEventListener(type, fn, opts?)`/`removeEventListener(type, id, opts?)`, `scrollIntoView(opts?)`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:64-360 -->

- Constructing a `SafeElement` around an element carrying a `freezed` attribute throws immediately.
- `addEventListener` only allows a fixed event list: mouse/pointer/scroll events fire immediately; `keydown`/`keyup`/`keypress` are deliberately delayed by a random 0–99ms (anti-fingerprinting) before the listener runs. Any other event type throws. The listener receives a trimmed plain object (a handful of common fields), not a real `Event`.

`SafeDocument` (extends `SafeElement`, wraps the real `document`):
- **`createElement(tagName)`** — non-whitelisted tags silently become `<div>`. `<a>` can be created but its `href` cannot be set via `setAttribute` (use `createAnchorElement` instead).
- **`createAnchorElement(href)`** — validates the URL; anything that isn't `http:`/`https:`, or fails to parse, becomes `href="#"`.

`SafeClassArray<T>` (returned by e.g. `getChildren()`, `querySelectorAll()`) is an async array-like: `at(index)`, `length()`, `push(item)`. Use the helper `risuai.unwarpSafeArray(safeArray)` to convert it to a plain array.

`SafeMutationObserver`: `observe(element, options)`, `disconnect()`. Mutation records expose `getType()`, `getTarget()`, `getAddedNodes()`.

## Character & chat data

- **`getCharacter(): Promise<any>`** / **`setCharacter(char)`** — get/set the currently selected character (aliases: deprecated `getChar`/`setChar`). No permission gate. <!-- src/ts/plugins/apiV3/v3.svelte.ts:979-980 -->
- **`getCharacterFromIndex(index): Promise<any|null>`** — snapshot of the character list at that array index, or `null` if out of range. <!-- src/ts/plugins/apiV3/v3.svelte.ts:875-883 -->
- **`setCharacterToIndex(index, character)`** — writes directly into the character list at that index, in memory. See the [known persistence issue](Plugin-Docs#known-issue-writing-to-a-non-selected-character) for indices other than the one currently open. <!-- src/ts/plugins/apiV3/v3.svelte.ts:884-891 -->
- **`getChatFromIndex(characterIndex, chatIndex): Promise<any|null>`** — snapshot of that character's chat at that index. <!-- src/ts/plugins/apiV3/v3.svelte.ts:892-903 -->
- **`setChatToIndex(characterIndex, chatIndex, chat)`** — writes directly into that chat slot (only if the slot already exists). Same known persistence caveat as `setCharacterToIndex`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:947-957 -->
- **`getCurrentCharacterIndex(): Promise<number>`** / **`getCurrentChatIndex(): Promise<number>`** — index of the selected character, and its `chatPage` (active chat slot). <!-- src/ts/plugins/apiV3/v3.svelte.ts:958-965 -->
- **`getCurrentLorebookEntries(): Promise<any[]>`** — concatenation of the current character's global lorebook + the active chat's local lorebook + active module lorebooks, **raw** (no activation-condition or token-budget filtering applied). <!-- src/ts/plugins/apiV3/v3.svelte.ts:966-977 -->
- **`checkCharOrder(): Promise<void>`** — re-validates/repairs the character ordering list in the database. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1267 -->

### `parseRisuChat`

```ts
parseRisuChat(text: string, options?: {
    messageIndex?: number, role?: string, processRegex?: boolean,
    runVar?: boolean, rmVar?: boolean, tokenizeAccurate?: boolean,
    cbsConditions?: { firstmsg?: boolean, chatRole?: string },
}): Promise<string>
```

Runs Risu's `{{curly brace}}` macro parser against `text`, using the **currently selected character and its active chat** (throws if none is selected/no chat is active). `messageIndex` defaults to `-1` and must be a valid index into the active chat's messages (or `-1`). If `processRegex: true`, the parsed text is additionally run through the `editprocess` script pipeline (this can invoke plugin script handlers and Regex/Lua action scripts, and **may mutate the active chat** as a side effect). <!-- src/ts/plugins/apiV3/v3.svelte.ts:904-946 -->

## Storage

Three independent storage areas, all async:

| API | Backing | Scope | Syncs with save file? |
|---|---|---|---|
| `pluginStorage` | Cold storage that's part of the save file, keyed per plugin | Per plugin | Yes |
| `getLocalPluginStorage()` → `SafeLocalPluginStorage` | `localforage` (IndexedDB), key-prefixed | Shared across all plugins, but device-local | No |
| `safeLocalStorage` | Browser `localStorage`, key-prefixed `safe_plugin_` | Shared across all plugins, device-local, strings only | No |

- **`pluginStorage.getItem(key)` / `.setItem(key, value)` / `.removeItem(key)` / `.clear()` / `.key(index)` / `.keys()` / `.length()`** — values are JSON-serializable and stored in cold storage; `getItem` resolves `null` for a missing key. Note: `getItem`/`setItem` can reject on an underlying storage failure, not just resolve `null` or succeed — wrap these calls in `try/catch`. <!-- src/ts/plugins/apiV3/pluginColdStorage.ts:16-104 -->
- **`getLocalPluginStorage(): Promise<SafeLocalPluginStorage>`** → `.getItem<T>(key)`, `.setItem<T>(key, value)`, `.removeItem(key)`, `.keys()`, `.clear()`. Generic, JSON-serializable values, no `key(index)`/`length()`. <!-- src/ts/plugins/pluginSafeClass.ts:51-77 -->
- **`safeLocalStorage`** → `.getItem`/`.setItem`/`.removeItem`/`.clear`/`.key(index)`/`.length()` — string values only, mirrors the browser `localStorage` API. <!-- src/ts/plugins/pluginSafeClass.ts:9-48 -->

## Arguments

- **`getArgument(key): Promise<string|number|undefined>`** / **`setArgument(key, value)`** — reads/writes this plugin's own stored value for `key` (the value bound to an `//@arg` declaration). Not namespaced by plugin name — `getArgument`/`setArgument` already scope to the calling plugin. <!-- src/ts/plugins/apiV3/v3.svelte.ts:859-874 -->
- **`getArg(key)` / `setArg(key, value)`** — deprecated V2-style equivalents; `key` here must be namespaced as `"<pluginName>::<argName>"`. Prefer `getArgument`/`setArgument`. <!-- src/ts/plugins/plugins.svelte.ts:500-508,576-584 -->

## Database

- **`getDatabase(includeOnly?: string[]|'all'): Promise<DatabaseSubset|null>`** — requires the `db` permission (periodic re-confirm); returns `null` if denied. Returns a plain-object snapshot restricted to an allow-list of keys: `characters, modules, enabledModules, moduleIntergration, pluginV2, personas, plugins, pluginCustomStorage, temperature, askRemoval, maxContext, maxResponse, frequencyPenalty, PresensePenalty, theme, textTheme, lineHeight, seperateModelsForAxModels, seperateModels, customCSS, guiHTML, colorSchemeName, selectedPersona, characterOrder`. `includeOnly` narrows this further. Note: the `DatabaseSubset` type in `risuai.d.ts` is missing `selectedPersona` and `characterOrder`, even though both are in the actual allow-list and mentioned in `getDatabase`'s own JSDoc. <!-- src/ts/plugins/apiV3/v3.svelte.ts:771-785 --> <!-- src/ts/plugins/apiV3/risuai.d.ts:372-422 -->
- **`setDatabaseLite(db: DatabaseSubset)`** — merges the given keys (restricted to the same allow-list; anything else lands in the plugin custom-storage area) directly into the live database object with no validation/migration pass. **Not permission-gated.** <!-- src/ts/plugins/plugins.svelte.ts:752-764 -->
- **`setDatabase(db: DatabaseSubset)`** — same key-merging as `setDatabaseLite`, but if the merged object includes a `plugins` key, that list is first run through the same "confirm each new plugin" flow used for [install-from-plugin](Plugin-Docs#install-enable-and-update-flow), then the result is committed through the app's top-level database-save routine, which additionally fills in a large set of default/legacy fields (e.g. default prompts, default model, resets stale `isStreaming` flags) before the data becomes live. **Not permission-gated.** <!-- src/ts/plugins/plugins.svelte.ts:765-782 --> <!-- src/ts/storage/database.svelte.ts:30-726 -->
  - Note: despite the names, neither `setDatabaseLite` nor `setDatabase` writes to disk or the cloud itself — both just replace the in-memory database object (`setDatabase` additionally runs a default-filling/migration pass first). Actual persistence happens elsewhere, reactively. See [Known issue](Plugin-Docs#known-issue-writing-to-a-non-selected-character) for the one persistence caveat this doc covers for plugin authors.
- **Fork difference, empty chats and SupaMemory:** a chat left with zero messages by these writers has its [[SupaMemory]] data and covered marker cleared. `setChatToIndex` clears that chat. `setCharacterToIndex` and `setCharacter` clear that character's chats. `setDatabase` and `setDatabaseLite`, when the written data has a `characters` list, clear every character's empty chats, not only the ones you changed. See [[SupaMemory#when-messages-are-removed]]. <!-- src/ts/plugins/apiV3/v3.svelte.ts:726,1043; src/ts/plugins/plugins.svelte.ts:664-666,770,1029,1046,1077 -->

## Color scheme & text theme

- **`changeColorScheme(name: string)`** — switches to a built-in preset (`'default'|'dark'|'light'|'cherry'|'galaxy'|'nature'|'realblack'|'monokai-light'|'monokai-black'`). <!-- src/ts/plugins/apiV3/v3.svelte.ts:790-792 -->
- **`setColorScheme(scheme: ColorScheme)`** — validates all required string fields and `type: 'light'|'dark'` are present (throws otherwise), sets `colorSchemeName` to `'custom'`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:793-808 -->
- **`getColorScheme(): Promise<{name, scheme}>`**. <!-- src/ts/plugins/apiV3/v3.svelte.ts:809-815 -->
- **`changeTextTheme(name: 'standard'|'highcontrast')`** — throws on any other value. <!-- src/ts/plugins/apiV3/v3.svelte.ts:818-825 -->
- **`setCustomTextTheme(theme: CustomTextTheme)`** — validates all 6 font-color fields are strings, sets `textTheme` to `'custom'`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:826-844 -->
- **`getTextTheme(): Promise<{name, customTheme}>`**. <!-- src/ts/plugins/apiV3/v3.svelte.ts:845-851 -->

## Network

- **`nativeFetch(url, options?): Promise<Response>`** — a real `fetch` issued from the host (bypasses Risu's own request pipeline). Blocks requests whose URL contains `risuai.xyz`, `risuai.net`, or `sionyw.com` (throws). If `options.headers` includes `x-api-key`/`authorization`/`proxy-authorization`, a console warning is logged (the header is **not** stripped, just flagged). <!-- src/ts/plugins/apiV3/v3.svelte.ts:679-693 -->
- **`saveSecretHeader(key, prefix, value)`** — not implemented. The call is a no-op that only logs a warning that the feature is pending. Note: `risuai.d.ts` declares a 3-argument signature `(key, prefix, value)`, but the actual function only takes 2 arguments, `(key, value)` — `prefix` doesn't exist in the implementation. Don't depend on this API yet. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1478-1482 -->
- **`risuFetch(url, arg)`** — legacy V2-era fetch helper, still present and callable but **not declared in `risuai.d.ts`**; logs a deprecation warning on every call and recommends `nativeFetch`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:662-678 -->

## UI registration

- **`registerSetting(name, callback, icon?, iconType?, id?): Promise<{id}>`** — adds an entry to the plugin settings menu. If `id` matches an existing entry (from this or a previous registration), it's replaced in place; otherwise a new one is appended. `iconType` must be `'html'|'img'|'none'`. Auto-removed on plugin unload. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1020-1056 -->
- **`registerButton(arg, callback): Promise<{id}>`** — `arg.location` is `'action'|'chat'|'hamburger'` (default `'action'`), each backed by its own list. Replacing an existing `id` keeps it in its original list regardless of `location`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1084-1157 -->
- **`unregisterUIPart(id)`** — removes the id from all four menu/button lists and from the chat-panel list (see below), whichever it matches. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1197-1210 -->
- **`setChatPanel(content: string|null, options?: {id?, className?}): Promise<{id}>`** — **not declared in `risuai.d.ts`.** Renders an HTML panel in the chat UI, sanitized with DOMPurify (`className` is stripped of all tags/attributes, i.e. treated as plain text). Passing `content` as `null` or `''` removes the panel. Default `id` is `"<pluginName>:default"`. Auto-removed on unload. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1158-1194 -->

## MCP (Model Context Protocol)

- **`registerMCP({identifier, name, version, description}, getToolList, callTool): Promise<void>`** — `identifier` must start with `plugin:` (throws otherwise). Registers a client that the app's MCP layer can call `getToolList()`/`callTool(name, args)` on. No permission gate. <!-- src/ts/process/mcp/pluginmcp.ts:36-54 -->
- **`unregisterMCP(identifier)`**. <!-- src/ts/process/mcp/pluginmcp.ts:56-58 -->

## Providers

- **`addProvider(name, func, options?)`** — registers a custom AI provider under `name` (shows up alongside built-in providers). `func` receives `(args: ProviderArguments, abortSignal?)` and must resolve `{success, content}` (`content` may be a string or a `ReadableStream<string>`). Internally, `args.mode` is force-overwritten to `'v3'` before your function runs, regardless of what the caller requested. The console logs a warning on registration that this API "can potentially be unsafe". <!-- src/ts/plugins/apiV3/v3.svelte.ts:697-724 -->
  - The `provider` permission prompt is (re)triggered on every invocation of the registered function (`'periodically'` re-confirm), but its result is not checked — the provider function runs regardless of whether the prompt returns `true` or `false`. Treat `provider` as informational consent only, not an enforced gate.

## TTS hooks

No permission prompt for either hook; both auto-unregister when the plugin unloads. Multiple hooks of the same kind run sequentially in registration order, each receiving the previous hook's output; a throwing hook has its result discarded and the pipeline continues with the next hook. There is no execution timeout — a hung hook stalls TTS playback for that message. <!-- src/ts/plugins/apiV3/v3.svelte.ts:725-736 -->

- **`addTTSPreprocessor(func: (ctx: BeforeTTSContext) => BeforeTTSResult|void)`** — `ctx` = `{text, ttsMode, characterId}`. Return `{text?}` to rewrite the text about to be spoken, or `{skip: true}` to abort playback entirely for that message.
- **`addTTSPostprocessor(func: (ctx: AfterTTSContext) => AfterTTSResult|void)`** — `ctx` = `{audio: ArrayBuffer, mimeType, ttsMode, characterId}` (raw encoded audio, before decoding). Return `{audio?, mimeType?}` to replace the audio, or `{skip: true}` to suppress playback. Not invoked for the `'webspeech'` provider (no audio buffer exists) or the `'vits'` provider (separate playback path).

## Script handlers & replacers

- **`addRisuScriptHandler(mode: 'display'|'output'|'input'|'process', func)`** / **`removeRisuScriptHandler(mode, func)`** — text-transform hooks matching Risu's existing script-mode pipeline. No permission gate. <!-- src/ts/plugins/apiV3/v3.svelte.ts:737-738 -->
- **`addRisuReplacer(type: 'beforeRequest'|'afterRequest', func)`** / **`removeRisuReplacer(type, func)`** — `'beforeRequest'` receives/returns `OpenAIChat[]`; `'afterRequest'` receives/returns a `string`. Requires the `replacer` permission (periodic re-confirm) — if denied, the call silently no-ops instead of registering. Note: this permission requirement isn't mentioned in `risuai.d.ts`. <!-- src/ts/plugins/apiV3/v3.svelte.ts:739-747 -->

## Chat listeners

- **`addRisuChatListener(mode: 'output', func)`** / **`removeRisuChatListener(mode, func)`** — fires once per model output, after streaming completes, after the Lua `output` trigger, and after host-side output post-processing (e.g. inlay handling) has already been committed to the chat. Listeners are awaited sequentially; a slow listener delays the rest of the chat flow — fire-and-forget your own async work inside the listener if you don't need to block on it. Also requires the `replacer` permission, the same gate as `addRisuReplacer` (also not documented in `risuai.d.ts`). Auto-removed on plugin unload. <!-- src/ts/plugins/apiV3/v3.svelte.ts:748-756 -->
- The callback receives `{char, chat, characterIndex, chatIndex, messageIndex}` — `char`/`chat` are plain snapshots (mutating them does nothing); use `characterIndex`/`chatIndex` with `setChatToIndex` to persist changes, and re-read with `getChatFromIndex` first if you need to merge with another listener's writes. `messageIndex` may be `-1` if the message was already removed by another trigger/handler by the time your listener runs.

## Body interceptors

- **`registerBodyIntercepter(callback: (body, type) => any): Promise<{id}|null>`** — lets a plugin read/rewrite the outgoing HTTP body of LLM requests (sensitive fields such as API keys are excluded from what's handed to `callback`). **Requires the `replacer` permission**; returns `null` if denied. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1057-1075 -->
- **`unregisterBodyIntercepter(id)`**. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1077-1082 -->

## Assets

- **`readImage(path?): Promise<any>`** — `path` is sanitized: an `assets/` prefix is stripped and re-added internally, and the remaining path may not contain `/` or `\` (throws if it does) — effectively restricting reads to flat filenames inside the assets folder. <!-- src/ts/plugins/plugins.svelte.ts:799-809 -->
- **`readInlay(id: string): Promise<InlayAssetForPlugin|null>`** — looks up a chat-attached inlay asset (image/video/audio/signature) by UUID (extracted from a `{{inlayed::<uuid>}}` placeholder in raw message text). Returns `null` if the asset doesn't exist. Requires the `inlay` permission (periodic re-confirm) — also returns `null` if denied, so a denied permission looks the same as "not found." Note: `risuai.d.ts` only documents the `null` return for the not-found case. <!-- src/ts/plugins/apiV3/v3.svelte.ts:762-768 -->
- **`saveAsset(data): Promise<string>`** — saves arbitrary asset data, returns its path. <!-- src/ts/plugins/apiV3/v3.svelte.ts:769 -->

## Plugin/runtime management

- **`loadPlugins(): Promise<void>`** — reloads the entire plugin set (all V2 and V3 plugins). <!-- src/ts/plugins/apiV3/v3.svelte.ts:760 -->
- **`onUnload(func)`** — registers a cleanup callback run when the plugin is unloaded (disabled, removed, or reloaded via `loadPlugins`). All registered callbacks run with a combined 1-second timeout before the plugin's iframe is torn down regardless. Each callback is wrapped in its own `try/catch`, so one throwing callback doesn't stop the other callbacks from running or block the iframe from being torn down. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1221-1223,527-566 -->
- **`getFetchLogs(): Promise<{url, body, status?, response?}[]|null>`** — requires the `fetchLogs` permission; returns `null` if denied. URLs are stripped down to `origin + pathname` (query string and hash are discarded) before being handed to the plugin, presumably to avoid leaking query-string secrets. Note: `risuai.d.ts` declares the resolved objects as also having `error?: string` and `timestamp: number` fields, but the implementation never populates either. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1224-1240 -->
- **`requestPluginPermission(permission): Promise<boolean>`** — proactively triggers the same consent flow described in [[Plugin Docs#permission-system]] for an arbitrary permission string. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1268-1270 -->
- **`unwarpSafeArray(safeArray): Promise<T[]>`** — helper that drains a `SafeClassArray` into a plain array via repeated `at()` calls. <!-- src/ts/plugins/apiV3/factory.ts:410-418 -->
- **`searchTranslationCache(partialKey): Promise<{key, value}[]>`** / **`getTranslationCache(key): Promise<string|null>`** — read-only access to the LLM translation cache. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1332-1337 -->

## Plugin-to-plugin IPC

- **`addPluginChannelListener(channelName, callback)`** — listens on a channel scoped to `<thisPluginName><channelName>`. Marked in `risuai.d.ts` as "subject to change". <!-- src/ts/plugins/apiV3/v3.svelte.ts:1443-1448 -->
- **`postPluginChannelMessage(pluginName, channelName, message)`** — delivers to another plugin's channel **only if both sides have opted in via `//@allowed-ipc`**: the receiver must declare `//@allowed-ipc <sender-name>`, and the sender must declare `//@allowed-ipc <receiver-name>`. Missing either declaration logs a warning naming the exact directive to add, and the message is dropped (not queued/retried). <!-- src/ts/plugins/apiV3/v3.svelte.ts:1449-1477 -->

## Model / chat control

- **`runLLMModel(options: {messages, staticModel?, mode, allowPlugins?}): Promise<any>`** — runs a one-off request through Risu's model layer. `allowPlugins` defaults to `false`, which blocks the request from resolving to another plugin-provided model (`pluginmodel:::*`) — this exists specifically to prevent accidental provider-plugin IPC loops; pass `true` only if you intentionally want to reach the user's plugin-supplied model, and take responsibility for avoiding loops yourself. No permission gate. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1359-1379 -->
- **`sendChat(message: string): Promise<boolean>`** — pushes `message` as a user chat message and runs the normal send/generate flow (blank string just triggers a send with no new message). Requires the `sendChat` permission (returns `false` if denied). Throws if: the active chat hasn't finished loading from cold storage yet, a chat is already in progress, or the current model is a plugin-provided model (blocked to avoid IPC loops). The cold-storage check runs before the permission prompt and before `message` is pushed into the chat, so a plugin is never told "permission granted" for a send that would be rejected anyway. <!-- src/ts/plugins/apiV3/v3.svelte.ts:1380-1442 -->

## Other methods (not in `risuai.d.ts`)

These exist on the live `risuai` object and can be called from a plugin, but they aren't part of the published type surface in `risuai.d.ts`. Per that file's own header comment, anything not documented there "is considered internal or subject to change without deprecation, and should not be used by plugin developers." Treat everything below as unstable and subject to change:

- `risuFetch(url, arg)` — see [Network](#network).
- `alert(msg)`, `alertConfirm(msg)`, `alertError(msg)` — see [Logging & alerts](#logging--alerts).
- `setChatPanel(content, options?)` — see [UI registration](#ui-registration).
- `installPlugin(plugins: RisuPlugin[])` — a thin wrapper around the same "confirm each proposed plugin" flow used internally by `setDatabase`'s `plugins` key handling. It only returns the user-confirmed subset and doesn't write anything into the database itself. <!-- src/ts/plugins/apiV3/v3.svelte.ts:787 --> <!-- src/ts/plugins/plugins.svelte.ts:931-952 -->
