# Lua Scripting

RisuAI can run a sandboxed Lua VM ([wasmoon](https://github.com/ceifa/wasmoon)) that belongs to a character, a [[Trigger Script]], or a module. Lua is the scripting surface in Risu with the most capability. It can read and rewrite the chat log, the fields of the character, the fields of the persona, and lorebooks. It can also call the LLM itself, under the permission system described below.

This page covers the Lua runtime itself. To learn *when* Lua code runs as part of a trigger, and how Lua compares to the block-based V1 and V2 trigger formats, see [[Trigger Script]]. For the `{{...}}` macro language, see [[Curly Brased Syntaxes]].

> **Fork-specific.** The following runs act on **their own owner character and chat**: a trigger run (the triggers `start`, `input`, `output`, and `manual`, `/trigger`, and the Lua button), and the `editInput` script. In such a run, a Lua binding that reads or writes "the character", "the persona", or "the chat" does not act on the character that is selected in the app. In a group run, it acts on the group itself and the chat of the group, even when the trigger belongs to a member. `editRequest`, `editDisplay`, and `editOutput`, display and request triggers, and any call outside a run still follow the **character that is selected now**. This is the same as upstream everywhere. This matters most for modules, which you can attach to many characters at once. It also matters for group chats, where "the selected character" and "the character that runs the script" are rarely the same. <!-- src/ts/process/scriptings.ts:52-97 -->

## Where Lua code lives

The app stores a Lua script as a single [[Trigger Script]] entry. The first and only effect of the entry has `type: "triggerlua"` and holds the whole script as one string of code. <!-- src/ts/process/triggers.ts:50-53 -->

- **Character scripts**: The app stores them on the character. The "Lua" button in the trigger editor replaces the whole trigger list with one `triggerlua` entry. <!-- src/lib/SideBars/Scripts/TriggerList.svelte:64-83 -->
- **Module scripts**: Modules can ship their own Lua trigger in the same way. It applies to every character that the module is attached to. <!-- src/ts/process/modules.ts:20-28, 470-484 -->
- A group has no triggers of its own on two paths: the `editRequest`, `editDisplay`, `editInput`, and `editOutput` listener path, and the Lua-button path. On these paths, only the Lua scripts and triggers that modules provide run for a group. The `start` and `output` triggers during generation are different. They run against the own member character of the group. So the own Lua and V1/V2 triggers of that member run too (the ones that do not come from a module), not only those of the module. <!-- src/ts/process/scriptings.ts:1568, 1596; src/ts/process/index.svelte.ts:376 -->

## Execution model

- Each *mode* gets its own persistent Lua VM instance. The modes are `start`, `input`, `output`, `manual` or button, `editRequest`, `editDisplay`, `editInput`, `editOutput`, and others. For a given mode, only one call runs at a time. <!-- src/ts/process/scriptings.ts:160, 189, 203 -->
- The app recreates the VM only when the code of the script changes. Otherwise the same globals persist across calls. So state that you keep in your own Lua globals or upvalues survives between invocations of the same mode. <!-- src/ts/process/scriptings.ts:210, 217 -->
- Every call declares all host functions again before it runs your code. Then it invokes the entry point for the current mode. The app catches uncaught Lua errors and logs them to the console. They do not crash the app, but the return value of the trigger stays `undefined`. <!-- src/ts/process/scriptings.ts:1266-1268 -->
- The Lua module `require 'json'` is preloaded. The app exposes it as the global `json` table (`json.encode`, `json.decode`). You can use it directly in your own code. <!-- src/ts/process/scriptings.ts:1386 -->
- The app defines an `async(callback)` helper for you. Wrap a function with it to write code based on coroutines that can `:await()` a host call that returns a promise. Some bindings work only this way, for example `loadLoreBooks`, `LLM`, and `getCharacterImage`. <!-- src/ts/process/scriptings.ts:1413-1435, 1481-1509 -->
- The same module has a companion Python engine. You cannot reach it from the character editor or the module editor today. <!-- src/ts/process/scriptings.ts:153-156, 176, 1618-1656 -->

## Lifecycle and entry points

Your script defines global functions, and the host calls them by name. The `mode` in which the trigger pipeline runs decides which function fires:

| Global function you define | Fired when | Argument(s) | Meaning of the return value |
|---|---|---|---|
| `onStart(id)` | A new chat or generation round starts (trigger mode `start`). | access token | A return of `false` stops the AI from sending or generating. <!-- src/ts/process/scriptings.ts:1263-1264 --> |
| `onInput(id)` | Right before the app adds the message of the user to the chat (trigger mode `input`). | access token | `false` stops sending. |
| `onOutput(id)` | Right after the app produces the reply of the character (trigger mode `output`). | access token | `false` stops sending. |
| `onButtonClick(id, data)` | A click on an HTML element in the chat that has a `risu-btn="..."` attribute, or another script calls the "Lua button" trigger path. | access token, the raw string from `risu-btn` | The value goes back to the caller. |
| any other name, for example `onMyEvent(id)` | Something invokes a **manual** trigger whose name equals the function name. See "Manual triggers call a same-named Lua function" below. | access token | `false` stops sending. |
| `listenEdit(type, func)` (call this at the top level. Risu does not call it as a callback.) | Registers `func` to run for `type` in `{'editRequest','editDisplay','editInput','editOutput'}`. | none | none |

This is the dispatch table for the above: <!-- src/ts/process/scriptings.ts:1215-1262, 1511-1540 -->

- `mode === 'input'` calls the global `onInput(id)`.
- `mode === 'output'` calls the global `onOutput(id)`.
- `mode === 'start'` calls the global `onStart(id)`.
- `mode === 'onButtonClick'` calls the global `onButtonClick(id, data)`.
- `mode` is one of `editRequest`, `editDisplay`, `editInput`, `editOutput`: The app replays every function that you registered with `listenEdit(type, func)` for that type. It threads the value through each function in the order of registration.
- Anything else calls the global function whose **name is exactly the mode string**. See manual triggers below.

### Manual triggers call a same-named Lua function

A Lua-mode trigger entry is exempt from the normal check of whether the `type` of the trigger matches the current mode. A `triggerlua` effect runs on **every** `start`, `input`, `output`, and `manual` pass. Your script tells the modes apart by the global functions that it defines. <!-- src/ts/process/triggers.ts:1318-1328 -->

Something can invoke a **manual** trigger by name. This happens with the chat command `/trigger name`, an HTML attribute `risu-trigger="name"`, or the "Run Trigger" effect of another trigger. Then the app calls the Lua runtime with `mode` set to the *name* of that trigger. It does not use the literal string `manual`. <!-- src/ts/process/triggers.ts:1662 --> So this code:

```lua
-- fires for the manual trigger named "Heal"
function Heal(id)
    setChatVar(id, "hp", "100")
end
```
runs whenever something invokes a manual trigger named `Heal`. It runs from the *same* trigger entry that also defines `onStart`, `onInput`, and so on. All of these can live in one script.

The app filters out the `triggerlua` effects of `editRequest`, `editDisplay`, `editInput`, and `editOutput` from trigger runs in `display` and `request` mode. So a Lua trigger for a whole script never runs during those two modes. <!-- src/ts/process/triggers.ts:1024-1037, 1420-1424 -->

### `listenEdit` (hooks to edit text and prompts)

You do not need a single fixed function. Register as many editors as you like:

```lua
listenEdit('editOutput', function(id, content, meta)
    return content .. "\n(edited by Lua)"
end)
```

| Type | Fires on | Payload shape | Used when |
|---|---|---|---|
| `editInput` | The message that the user typed. | plain string | Before the app pushes the message to the chat. <!-- src/ts/process/scripts.ts:26-27, 99-134 --> |
| `editOutput` | The message that the character generated. | plain string | After generation, once for each path of finalize, regenerate, or continue. <!-- src/ts/process/index.svelte.ts:1722,1781,1807,1875,1879 --> |
| `editDisplay` | The message text right before the chat UI renders it. It does not persist. | plain string | Called from the CBS and Markdown renderer. <!-- src/ts/parser/parser.svelte.ts:784 --> |
| `editRequest` | The **entire formatted prompt** that the app sends to the model. | A JSON array of `{role, content}`. In the wrapper, you get and return a Lua table after `json.decode` and `json.encode`. | Right before the app sends the request to the API. <!-- src/ts/process/index.svelte.ts:1558, 1561 --> |

`editprocess` re-flattens stored history into prompt text. It bypasses Lua entirely. The app returns the content unchanged for that mode, so `listenEdit` cannot see it. <!-- src/ts/process/scriptings.ts:1557-1558 -->

Each call of an edit listener decodes and encodes its payload as JSON. Suppose you return a value of the wrong shape, for example a string from an `editRequest` handler, which expects an array. Then a JSON error occurs. The app swallows the error, and Risu falls back to the original content. <!-- src/ts/process/scriptings.ts:1250-1253, 1511-1540, 1588-1590 -->

## Permission tiers and the `id` token

Every host function receives an `id` string as its first argument. This is the "access key" that the app creates for each invocation. <!-- src/ts/process/scriptings.ts:1201 --> Before a binding does anything, it checks this key against one or more access levels:

| Access level | Granted when | What it unlocks |
|---|---|---|
| Safe | Any mode **other than** `editDisplay`. | Chat mutation (`setChat`, `addChat`, `cutChat`, …), `stopChat`, alerts, `sleep`, `reloadDisplay` and `reloadChat`, the setters for character and persona fields, `getTokens`, and lorebook editing. <!-- src/ts/process/scriptings.ts:1205-1206 --> |
| EditDisplay | The mode is `editDisplay` only. | *Only* `setChatVar` and `setChatVarChanged` (writes of chat variables). Nothing else that the Safe level allows. <!-- src/ts/process/scriptings.ts:1202-1204, 234-247 --> |
| Low-level | The mode is not `editDisplay` **and** the owning trigger, character, or module has low-level access turned on. | `similarity`, `request` (outbound HTTP), `generateImage`, `LLM`, `simpleLLM`, `axLLM`, and `loadLoreBooks`. <!-- src/ts/process/scriptings.ts:1207-1208, 463-561, 656-800, 990-1148 --> |

A few getters that only read have no access check at all. They work in every mode, including `editDisplay`. They are `getChatVar`, `getGlobalVar`, `getChat`, `getChatData`, `getChatRole`, `getFullChat`, `getRecentChats`, `getChatLength`, `getName`, `getCharacterFirstMessage`, `getPersonaName`, `getAuthorsNote`, `getCharacterImage`, `getPersonaImage`, `hash`, `cbs`, `getCharacterLastMessage`, `getUserLastMessage`, and `getLoreBooks`. For the breakdown of each function, see [[Lua API Reference]].

Low-level access comes from the object that owns the trigger. It is the low-level access toggle of a character, or the low-level access toggle of a module. The toggle of a module applies to every trigger that the module ships. When the user imports the module, the app asks the user to accept. <!-- src/ts/process/triggers.ts:1093, 1111-1116; src/ts/process/modules.ts:307-308, 470-484 --> Editing (`editRequest`, `editDisplay`, `editInput`, `editOutput`) always runs without low-level access, even for a character that has low-level access on. <!-- src/ts/process/scriptings.ts:1569, 1576 -->

Each access key can be used one time. The app adds it to the relevant set right before it invokes your entry point, and deletes it right after. So you cannot cache an `id` from a previous call and reuse it. <!-- src/ts/process/scriptings.ts:1201-1210, 1302-1303 -->

## Chat and variable access

- `getChatVar`, `setChatVar`, and `setChatVarChanged` read and write the **same** store of variables for each chat that the `$var` system of [[Trigger Script]] uses. So a Lua script and a V1 or V2 trigger can share state through ordinary variable names. Inside a trigger run or `editInput`, both read and write the own chat of the run. The app resolves that chat again on every call. Outside a run, they read and write the chat of the selected character, as upstream does everywhere. <!-- src/ts/process/scriptings.ts:191-201, 231-250; src/ts/parser/chatVar.svelte.ts:1-59; src/ts/process/triggers.ts:1260-1311 -->
- `getState`, `setState`, and `setStateChanged` are conveniences on the Lua side. They encode structured values as JSON into a separate variable with the prefix `"__"+name`. So they do not collide with plain `$name` trigger variables. <!-- src/ts/process/scriptings.ts:1466-1479 -->
- `getGlobalVar` reads a global variable that does not depend on the chat. It has an optional override that is "locally set" for each chat. There is no matching Lua setter for it. <!-- src/ts/process/scriptings.ts:248-250; src/ts/parser/chatVar.svelte.ts:107-113 -->
- The accessors for chat messages (`getChat`, `getChatData`, `getChatRole`, `getFullChat`, `getRecentChats`, `getChatLength`) operate on the chat that the current invocation of the script received. Inside a trigger run or `editInput`, that is the own chat of the run, and the app resolves it again on every call. It is not necessarily the chat on the screen. Outside a run, it is the own `state.chat` of the caller, fixed for the whole call. <!-- src/ts/process/scriptings.ts:52-57, 288-404 -->

## Limits and sandboxing

- `request(id, url)`: GET only, HTTPS only, and the URL has at most 120 characters. The app always rejects `https://realm.risuai.net`, `https://risuai.net`, and `https://risuai.xyz`. The limit is 5 requests in a rolling window of 60 seconds. **Every script in the process shares this limit.** It is not a limit for each script. <!-- src/ts/process/scriptings.ts:472-539 -->
- `similarity`, `LLM`, `axLLM`, `simpleLLM`, `generateImage`, and `loadLoreBooks` all require low-level access (see the table above). The cost limits and rate limits of the underlying feature (embeddings, image generation, model calls) apply too.
- The app catches errors from the Lua function `error()`, and errors that a binding throws itself, for example `setName` on a non-string or `setDescription` on a group. The app only logs them. By default it shows no message to the user. <!-- src/ts/process/scriptings.ts:809-811, 838-840, 1266-1268 -->
- The VM has no filesystem access. It has no arbitrary network access beyond the vetted `request` function. The host functions listed above mediate everything else.

## Worked examples

**Greet once per chat, with shared trigger variables:**
```lua
function onStart(id)
    if getChatVar(id, "greeted") ~= "true" then
        setChatVar(id, "greeted", "true")
        addChat(id, "char", "*waves hello*")
    end
end
```

**A button that rerolls a stat and shows it:**
```lua
function onButtonClick(id, data)
    if data == "reroll" then
        local roll = math.random(1, 20)
        setChatVar(id, "lastRoll", tostring(roll))
        alertNormal(id, "You rolled " .. roll)
    end
end
```
Trigger it from chat HTML: `<button risu-btn="reroll">Reroll</button>`.

**Rewrite the outgoing prompt (`editRequest`) to inject a note before the last message:**
```lua
listenEdit('editRequest', function(id, messages, meta)
    table.insert(messages, #messages, {role = "system", content = "Stay in character."})
    return messages
end)
```

## See also

- [[Trigger Script]]: The system of conditions and effects that Lua triggers live in, and the V1 and V2 block-scripting alternatives.
- [[Lua API Reference]]: The full list of host functions, arguments, return values, and required access levels.
- [[Curly Brased Syntaxes]]: The `{{...}}` macro language that `cbs(text)` runs.
