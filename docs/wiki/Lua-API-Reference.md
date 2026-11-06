# Lua API Reference

Every function on this page is available as a global inside a Risu Lua script. For the lifecycle, permissions, and examples, see [[Lua Scripting]]. The **Call it as** column shows the name that you use in Lua. The app wraps some entries automatically. The wrapper decodes JSON, or waits for a promise to resolve, before it returns to your script. <!-- src/ts/process/scriptings.ts:1384-1543 -->

These are the access levels, from the "permission tiers" section of [[Lua Scripting]]:
- **None**: Works in every mode, including `editDisplay`.
- **Safe**: Works in every mode except `editDisplay`.
- **EditDisplay**: Works in `editDisplay` mode only. It is also included wherever the table lists Safe, because those bindings accept either access level.
- **Low-level**: Needs low-level access to be on for the owning character or module. It is unavailable in the edit-listener modes.

## Chat variables and state

| Call it as | Args | Returns | Access |
|---|---|---|---|
| `getChatVar(id, key)` | key: string | The string value (or `"null"`) | None |
| `setChatVar(id, key, value)` | key, value: string | none | Safe + EditDisplay |
| `setChatVarChanged(id, key, value)` | key, value: string | `true` if the value actually changed, otherwise nothing | Safe + EditDisplay |
| `getGlobalVar(id, key)` | key: string | The string value from the store of global variables, which does not depend on the chat | None |
| `getState(id, name)` *(Lua shim)* | name: string | The decoded Lua value from a chat variable named `"__"+name` | None (delegates to `getChatVar`) |
| `setState(id, name, value)` *(Lua shim)* | name: string, value: any | none | Safe + EditDisplay (delegates to `setChatVar`) |
| `setStateChanged(id, name, value)` *(Lua shim)* | name: string, value: any | `true` if changed | Safe + EditDisplay |
<!-- src/ts/process/scriptings.ts:231-250, 1466-1479 -->

## Chat history

| Call it as | Args | Returns | Access |
|---|---|---|---|
| `getChat(id, index)` *(shim)* | index: number (supports negative and `.at()` indexing) | A table `{role, data, time, chatId?}` or `nil`. `chatId` is read-only. It is present only when the message has one. See [Message ids and `setFullChat`](#message-ids-and-setfullchat). | None |
| `getChatData(id, index)` | index: number | The message text, or `''` | None |
| `getChatRole(id, index)` | index: number | `'user'` or `'char'`, or `''` | None |
| `getRecentChats(id, count)` *(shim)* | count: number | A table array of the last `count` messages, each as `{role, data, time, chatId?}`. `chatId` is read-only. It is present only when the message has one. | None |
| `getFullChat(id)` *(shim)* | none | A table array of every message, each as `{role, data, time, chatId?}`. `chatId` is read-only. It is present only when the message has one. | None |
| `setFullChat(id, value)` *(shim)* | value: a table array of `{role, data}`. Each entry can carry the `chatId` that `getFullChat` returned. | Replaces the whole list of chat messages. The app matches messages to the old ones, so unchanged or edited messages keep their stored fields. See [Message ids and `setFullChat`](#message-ids-and-setfullchat). **Fork difference:** An empty list also clears the [[SupaMemory]] data of the chat. <!-- src/ts/process/scriptings.ts:433-502 --> | Safe |
| `getChatLength(id)` | none | The number of messages | None |
| `setChat(id, index, value)` | index: number, value: string | Overwrites the message text at the index | Safe |
| `setChatRole(id, index, value)` | index, value (`'user'`, otherwise treated as `'char'`) | none | Safe |
| `cutChat(id, start, end)` | start, end: number | Slices the message array to `[start, end)`. **Fork difference:** It keeps the [[SupaMemory]] resume point valid. See [[SupaMemory#when-messages-are-removed]]. <!-- src/ts/process/scriptings.ts:343-354 --> | Safe |
| `removeChat(id, index)` | index: number | Removes one message. **Fork difference:** It keeps the [[SupaMemory]] resume point valid. See [[SupaMemory#when-messages-are-removed]]. <!-- src/ts/process/scriptings.ts:355-366 --> | Safe |
| `addChat(id, role, value)` | role (`'user'`, otherwise `'char'`), value: string | Appends a message | Safe |
| `insertChat(id, index, role, value)` | index, role, value | Inserts a message at the index | Safe |
| `getCharacterLastMessage(id)` | none | The text of the most recent `char`-role message in the chat of the call. If there is none, the first message of the owner of that chat. Inside a trigger run or `editInput`, "the chat of the call" is the own chat of the run. The app reads it fresh on every call. It does not hold it from the start of the call. Outside a run, it is the chat of the selected character. | None |
| `getUserLastMessage(id)` | none | The text of the most recent `user`-role message, or `''` | None |
| `getAuthorsNote(id)` | none | The author's note of the chat, or `''` | None |
<!-- src/ts/process/scriptings.ts:52-57, 288-404, 406-416, 433-502, 882-884, 1149-1192, 1483-1497 -->

### Message ids and `setFullChat`

**Fork difference (RisuTanium addition):** `chatId` and the matching rule below do not exist in upstream RisuAI. The commit that added them notes that upstream pull request #1611 proposes the same idea and nobody merged it.

`getChat`, `getRecentChats`, and `getFullChat` return a `chatId` string on a message when the message has one. Some messages have none, for example older messages. So check for `nil`. A script cannot set, change, or create a `chatId`. It is readable in every mode, like the other fields that these getters return.

`setFullChat` replaces the message list with the table that you pass. For each entry, it decides which existing message the entry stands for. It does this in two passes:

1. **By id.** An entry with a `chatId` takes the first existing message that holds that id. The exception is a message that an earlier entry already took.
2. **By position.** Every other entry takes the existing message at the same position. These entries have no id, an unknown id, a duplicate id, or an id that is already taken. The entry takes the message only if that message has the same role and the same text, and no other entry has taken it.

A message that either pass matched keeps every field that it had: generation info, prompt info, speaker, name, the flags for disabled and comment, its `chatId`, and its `time`. Only its role and text are replaced with yours. The alternatives (rerolls) that follow it stay attached. An entry that matches nothing becomes a new message with only a role and text, and no `chatId`. In your table, `chatId` is only a lookup key. An id that you invent, or a `time` that you add, is not stored.

```lua
-- append text to the last message and keep its stored fields
local chat = getFullChat(id)
chat[#chat].data = chat[#chat].data .. ' (edited)'
setFullChat(id, chat)
```

Edge cases:
- A script that never sends ids, for example one written for upstream, is matched by position, role, and text only. An unchanged message keeps its fields. An edited or moved message with no id counts as new and keeps no fields. In the example above, a last message that has no `chatId` loses its fields, because its text changed.
- If the table holds the same `chatId` twice, only the first entry claims the message. The second entry is matched by position, role, and text, like an entry with no id.
- A stale table whose ids are no longer known falls back to position, role, and text. If those happen to match an unrelated message, that message keeps its fields.
- Each existing message is matched at most one time.

## Character and persona

| Call it as | Args | Returns | Access |
|---|---|---|---|
| `getName(id)` | none | The name of the owner of the call. Inside a trigger run or `editInput`, that is the own owner of the run (the group itself, in a group call). The app resolves it again on every call. Outside a run, it is the selected character. | None |
| `setName(id, name)` | name: string | Throws if it is not a string | Safe |
| `getDescription(id)` | none | The description of the owner of the call, with the same origin rule as `getName`. Throws if the owner is a group. | Safe |
| `setDescription(id, desc)` | desc: string | Throws if it is a group. Throws `'Invalid data type'` when `desc` is not a string. | Safe |
| `getCharacterFirstMessage(id)` | none | The first message of the owner of the call, with the same origin rule as `getName` | None |
| `setCharacterFirstMessage(id, data)` | data: string | `true` or `false` | Safe |
| `getPersonaName(id)` | none | The display name of the active persona | None |
| `getPersonaDescription(id)` | none | The persona prompt, parsed as CBS against the owner of the call. With an origin, that is the own owner of the run. Without one, it is the selected character. | None |
| `getBackgroundEmbedding(id)` | none | The background HTML content of the owner of the call, with the same origin rule as `getName` | Safe |
| `setBackgroundEmbedding(id, data)` | data: string | `true` or `false` | Safe |
| `getCharacterImage(id)` *(shim)* | none | The `{{inlayed::id}}` CBS tag for the portrait of the owner of the call (`''` for a group or a missing image), with the same origin rule as `getName` | None |
| `getPersonaImage(id)` *(shim)* | none | The `{{inlayed::id}}` CBS tag for the icon of the active persona, or `''` | None |
<!-- src/ts/process/scriptings.ts:65-72, 563-616, 801-908, 1429-1435 -->

## Lorebook

| Call it as | Args | Returns | Access |
|---|---|---|---|
| `getLoreBooks(id, search)` *(shim)* | search: string, matched against the comment or title of a lore entry | A table array of matching entries (local chat lore, global lore, and module lore), with the content parsed as CBS | None |
| `upsertLocalLoreBook(id, name, content, options)` | name, content: string. `options: {alwaysActive?, insertOrder?, key?, secondKey?, regex?}` | Inserts or replaces a **local (per-chat)** lore entry named `name` on the own chat of the call (the own chat of the group, in a group run). It does nothing in two cases: there is no chat to write to, or the runner is a group and the call is not part of the trigger run of a member. An example of the second case is a module script of a group for `editRequest`, `editDisplay`, or `editOutput`. | Safe |
| `loadLoreBooks(id, reserve)` *(shim, awaits, low-level)* | reserve: the number of tokens to hold back from the max context length of the model | A table array of `{role, data}` for every lore entry that is active now and fits the remaining budget | Low-level |
<!-- src/ts/process/scriptings.ts:911-1037, 1413-1415 -->

## LLM requests

| Call it as | Args | Returns | Access |
|---|---|---|---|
| `LLM(id, prompt, useMultimodal, options)` *(shim)* | `prompt`: an array of `{role, content}` (`system`/`sys`, `user`, `assistant`/`bot`/`char` all normalize). `useMultimodal`: a bool that expands `{{inlay\|inlayed\|inlayeddata::x}}` tags into image attachments. `options: {streaming?}` | `{success, result}`, using the main model | Low-level |
| `axLLM(id, prompt, useMultimodal, options)` *(shim)* | The same as `LLM` | `{success, result}`, using the slot of the auxiliary ("otherAx") model | Low-level |
| `simpleLLM(id, prompt)` | prompt: string | A `{success, result}` object (no JSON round trip is needed), using the main model, with no multimodal support | Low-level |
<!-- src/ts/process/scriptings.ts:656-766, 767-800, 1038-1148, 1417-1427 -->

## Media and other functions

| Call it as | Args | Returns | Access |
|---|---|---|---|
| `generateImage(id, value, negValue)` | value: the prompt, negValue: the negative prompt (default `''`) | The `{{inlay::id}}` CBS tag, or an `'Error: ...'` string | Low-level |
| `similarity(id, source, value)` | source: string, value: string[] | The array `value`, ranked by embedding similarity to `source` | Low-level |
| `request(id, url)` | url: string (for the limits, see [[Lua Scripting]]) | A JSON string `{status, data}` | Low-level |
| `hash(id, value)` | value: string | The hex SHA-256 digest | None |
| `getTokens(id, value)` | value: string | The token count | Safe |
| `sleep(id, time)` | time: milliseconds | Resolves `true` after the delay | Safe |
| `cbs(value)` *(no `id` argument at all)* | value: string | `value`, run through the CBS parser against the owner of the call. With an origin, that is the own owner of the run. Without one, it is the selected character. | None |
| `log(value)` *(Lua shim)* | Any Lua value that can be serialized as JSON | Prints it to the browser console | None |
| `reloadDisplay(id)` | none | Bumps the reload counter of the GUI | Safe |
| `reloadChat(id, index)` | index: number | Bumps the reload counter for one chat message | Safe |
| `stopChat(id)` | none | Marks the current generation to be stopped | Safe |
<!-- src/ts/process/scriptings.ts:251, 385-390, 407-420, 441-460, 463-561, 618-655 -->

## Alerts

| Call it as | Args | Returns | Access |
|---|---|---|---|
| `alertError(id, value)` | string | none | Safe |
| `alertNormal(id, value)` | string | none | Safe |
| `alertInput(id, value)` | A string prompt | The text that the user typed | Safe |
| `alertSelect(id, value)` | `value: string[]` of options | The chosen option | Safe |
| `alertConfirm(id, value)` | A string prompt | `true` or `false` | Safe |
<!-- src/ts/process/scriptings.ts:257-287 -->

## Edit-listener registration (Lua side only)

| Call it as | Args | Notes |
|---|---|---|
| `listenEdit(type, func)` | `type` in `'editRequest' \| 'editDisplay' \| 'editInput' \| 'editOutput'`, `func(id, value, meta)` | Registers `func` in an internal list. Every registered function for the matching type runs in order, and the value passes through each one. It throws for any other `type`. |
<!-- src/ts/process/scriptings.ts:1442-1464 -->

## Not reachable from the current UI

A Python execution backend also exists internally. It mirrors this Lua API. But you cannot select it now as a script language in the character editor or the module editor. <!-- src/ts/process/scriptings.ts:153-156, 176, 1618-1656 -->

## See also

- [[Lua Scripting]]: The lifecycle, the permission model, the sandbox limits, and examples.
- [[Trigger Script]]: Where `triggerlua` fits among the types of trigger effects.
