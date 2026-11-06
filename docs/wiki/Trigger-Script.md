# Trigger Script

Trigger Scripts are the system of events, conditions, and effects in Risu: "when X happens, if Y is true, do Z." They live on a character or on a module. The triggers of a module apply to every character that the module is attached to. A group has no triggers of its own on two paths: the editing hooks (`editRequest`, `editDisplay`, `editInput`, `editOutput`) and the Lua-button path. On these paths, only the triggers that modules provide run for a group. The `start` and `output` triggers during generation are an exception. They run against the own member character of the group. So the own triggers of that member run too, next to those of the module. <!-- src/ts/process/triggers.ts:21-27; src/ts/process/scriptings.ts:1568, 1596; src/ts/process/index.svelte.ts:376; src/ts/process/modules.ts:20-28, 470-484 -->

You write a trigger script in one of three formats that you can swap: **V1** (legacy, flat list), **V2** (block-based visual scripting), or **Lua** (see [[Lua Scripting]]). You choose the format with a switcher in the editor. When you switch formats, the app replaces the whole trigger list of that character or module after a confirmation prompt. You cannot mix formats within the trigger list of one character. <!-- src/lib/SideBars/Scripts/TriggerList.svelte:23-99 -->

## Trigger object shape

```ts
{
  comment: string        // name, shown in the editor and matched by "manual" invocations
  type: 'start'|'manual'|'output'|'input'|'display'|'request'
  conditions: [...]      // ALL must pass (AND) for the effects to run
  effect: [...]          // V1: a flat list; V2: an indented block starting with a v2Header marker
  lowLevelAccess?: boolean // set by the runner from the owning character/module, not stored on each entry
}
```
<!-- src/ts/process/triggers.ts:21-27, 1093, 1111-1116 -->

### Which character and chat effects act on

**Fork-specific:** Upstream reads the character and chat that are selected now for every effect. In this fork, a `start`, `input`, `output`, or `manual` run works against its own **origin**. The origin is the chat for which someone invoked the run, and the character that owns that chat. The app resolves the origin again on every effect. It never uses a value that it held from before an `await`.

For the trigger of a member of a group, the owner of the origin is the group, and the app resolves its member separately. Some effects read or write "the character". These are `v2GetCharacterDesc`, `v2SetCharacterDesc`, the Lorebook V2 effects, `v2GetReplaceGlobalNote`, `v2SetReplaceGlobalNote`, and the matching V1 fields. They act on that member. If the run has no member, they act on the owner. They do not act on the group, and not on the character that is selected in the app. Lua bindings that such a run calls act on the owner, which is the group. See [[Lua Scripting]].

A `display` or `request` run has no origin. It keeps acting on the own character and chat of its caller, unchanged.

Changes that a running trigger makes are visible at once in the live chat, while the trigger still runs. The app keeps messages that someone sends or edits elsewhere during a wait of a trigger (`sleep`, `runLLM`, or similar). It does not discard them when the trigger resumes. A trigger run stops cleanly, without its remaining effects, if someone deletes or duplicates its own chat while it waits. <!-- src/ts/process/triggers.ts:1097-1166, 1333-1335, 1427-1429; src/ts/process/chatOrigin.ts:78-157 -->

## Timings (`type` / trigger mode)

| Mode | Fires |
|---|---|
| `start` | One time for each new generation round, before the app assembles the prompt |
| `input` | Right before the app adds the message of the user to the chat |
| `output` | Right after the app generates or finalizes the reply of the character |
| `manual` | When something invokes it by name: the chat command `/trigger <name>`, a click on an HTML attribute `risu-trigger="<name>"`, or the Run Trigger effect of another trigger |
| `display` | Runs while the app renders a message for display. It is mostly read-only and runs over a restricted set of effects. It can rewrite the displayed text only. It does not persist. |
| `request` | Runs immediately before the app sends the formatted prompt array to the model. It is mostly read-only and runs over a restricted set of effects. It can rewrite the outgoing messages only. |
<!-- index.svelte.ts:901,1776,1884; DefaultChatScreen.svelte:262; Chat.svelte:348-357; command.ts:225-239; scripts.ts:104-122; request/request.ts:249-260 -->

You can select `display` and `request` as the `type` of a trigger only in the V2 editor. The V1 editor offers only `start`, `output`, `input`, and `manual`. <!-- src/lib/SideBars/Scripts/TriggerV1Data.svelte:64-69; src/lib/SideBars/Scripts/TriggerV2List.svelte:2664-2671 -->

### Execution order

For a given mode, the triggers run in this order. First, every trigger that you defined directly on the character runs, in the order in which they are listed. Then every module trigger runs, in the order of the modules. The app skips a trigger in two cases: its comment does not match (for `manual` triggers), or its type does not match the current mode. The exception is a whole-script Lua trigger. It always runs, whatever its type. See the section "manual triggers call a same-named Lua function" on [[Lua Scripting]]. <!-- src/ts/process/triggers.ts:1114-1116, 1318-1328 -->

Within one trigger, the app combines the `conditions` with AND. The first failure ends the check. Then the `effect` entries run in the order of the array. The `indent` field of V2 creates the block structure (if, else, loop). It does this only at runtime, by a scan forward or backward for matching `v2EndIndent` and `v2Loop` markers. There is no separate parse step. <!-- src/ts/process/triggers.ts:1337-1418 -->

### Recursion

Run Trigger (`runtrigger` and `v2RunTrigger`) can call another trigger, which can call Run Trigger again. The depth of the recursion is capped at 10. The exception is a calling trigger that has low-level access. Then there is no cap on the depth. Note: A low-level trigger that calls itself without a stopping condition can freeze the tab. <!-- src/ts/process/triggers.ts:1501-1502, 1913-1914 -->

### Variable resolution order

`$name` (the `var` and `value` conditions of V1, and the fields of V2 that have the var type) resolves in this order:
1. A V2 local variable declared at or above the current indent in the current scope.
2. The persistent variable store of the chat.
3. The default variables of the character.
4. The default variables of the preset.
5. The literal string `"null"`.

A write goes to whichever of the first two already has the key. Otherwise, the app adds a new entry to the persistent variable store of the chat. This also marks the chat as changed and refreshes the display. <!-- src/ts/process/triggers.ts:1260-1311, 2944-2945 --> This is the *same* store that the Lua functions `getChatVar` and `setChatVar` use. See the section "chat variables & state" on [[Lua Scripting]].

In `display` and `request` mode, variable writes go to a temporary store that does not persist. They do not go to the saved state of the chat. So trigger effects that make sense only live do nothing in those modes. These are alerts, `showAlert`, and `v2GetAlertInput`. <!-- src/ts/process/triggers.ts:1281-1287, 1024-1037, 1420-1424 -->

## Conditions

| Type | Fields | Meaning |
|---|---|---|
| `var` | `var`, `value`, `operator` | Compares the value of the named variable (parsed as CBS) against `value` |
| `value` | `var` *(used as a literal, not a name)*, `value`, `operator` | Compares a literal against `value`. The "always" default condition uses this (`operator: 'true'`). |
| `chatindex` | `value`, `operator` | Compares the current message count against `value` |
| `exists` | `value`, `type2: 'strict'\|'loose'\|'regex'`, `depth` | Searches the joined text of the last `depth` messages for `value` (word match, case-insensitive substring, or regex) |

The operators for `var`, `value`, and `chatindex` are: `= != > < >= <= null true`. `true` passes only if the value is exactly `"true"` or `"1"`. `null` passes only if the value is exactly `"null"`. <!-- src/ts/process/triggers.ts:47-70, 1338-1394 -->

## Legacy: V1 effects

V1 is a flat list of `{comment, type, conditions, effect: [oneEffect]}` entries. The whole trigger list *is* the list of events, and the app evaluates each event on its own. The editor shows a deprecation warning on any V1 script, unless you turn on the option to show deprecated V1 scripts. After a script has moved past V1, the editor hides the "V1" format button entirely. <!-- src/lib/SideBars/Scripts/TriggerList.svelte:18, 24-36, 85-87 -->

| Effect `type` | Parameters | Behavior | Access |
|---|---|---|---|
| `setvar` | `operator: '='\|'+='\|'-='\|'*='\|'/='`, `var`, `value` | Arithmetic or assignment on a variable. A non-numeric current value counts as 0. | any |
| `systemprompt` | `location: 'start'\|'historyend'\|'promptend'`, `value` | Appends text to one of three injection points for the prompt of this round | any |
| `impersonate` | `role: 'user'\|'char'`, `value` | Appends a new chat message | any |
| `command` | `value` | Runs `value` through `processMultiCommand`. This is the same mini-language, separated by pipes (`\|`), as the chat command bar. See [[Chat Commands]]. | any |
| `stop` | none | Stops the AI from sending or generating in this round | any |
| `runtrigger` | `value` (the `comment` of the target trigger) | Recursively runs a `manual` trigger by name (see the recursion note above) | any |
| `cutchat` | `start`, `end` | Slices the array of chat messages. **Fork difference:** Suppose plain [[SupaMemory]] data is saved, and this effect cuts out its resume-point message. Then the resume point moves to the next surviving message. A chat that is left with no messages loses its SupaMemory data. <!-- src/ts/process/triggers.ts:1575-1583; src/ts/process/memory/supaResume.ts:59-141 --> | any |
| `modifychat` | `index`, `value` | Overwrites the text of one message | any |
| `showAlert` | `alertType: 'normal'\|'error'\|'input'\|'select'`, `value`, `inputVar` | Shows a dialog. `input` and `select` write the response into `inputVar`. It does nothing outside low-level access, and it bails out entirely in display mode. | **low-level** |
| `sendAIprompt` | none | Flags that this trigger pass must trigger an AI response | **low-level** |
| `runLLM` | `value` (prompt text in ChatML style, which falls back to a single user message), `inputVar` | Calls the main model synchronously (no streaming). Writes the result or error into `inputVar`. | **low-level** |
| `checkSimilarity` | `source`, `value` (candidates joined by `§`), `inputVar` | Embeds `value` and ranks it against `source`. Writes the ranked list, joined by `§`. | **low-level** |
| `extractRegex` | `value`, `regex`, `flags`, `result` (supports `$1`, `$&`, `$$`), `inputVar` | Extracts with the regex and writes into `inputVar` | any |
| `runImgGen` | `value`, `negValue`, `inputVar` | Generates an image. Writes a `{{inlay::id}}` CBS tag (or an error string) into `inputVar`. | **low-level** |
| `triggerlua` | `code` | Runs `code` as a Lua script. See [[Lua Scripting]]. | Depends on the mode. See the Lua page. |

`runAxLLM` (`value`, `inputVar`) has the same shape as `runLLM`, but it runs against the auxiliary model. You can select it in the V1 editor, but it does nothing at runtime now. Treat it as non-functional and do not rely on it. <!-- src/ts/process/triggers.ts:166; src/lib/SideBars/Scripts/TriggerV1Data.svelte:307-329, 345, 472 -->

`v2StopPromptSending` behaves the same as the `stop` effect of V1, even though it is nominally an effect type for V2 only. <!-- src/ts/process/triggers.ts:1492-1493 -->

## V2 effects

V2 scripts are a `triggerscript[]`. Entry 0 is a `v2Header` marker (`{comment:"", type:"manual", conditions:[], effect:[{type:'v2Header', indent:0}]}`). Every following entry is one named event with its own `comment`, `type`, and `conditions`. Its `effect` array is an indented sequence of block-scripting instructions. You edit them as drag-and-drop blocks. <!-- src/lib/SideBars/Scripts/TriggerList.svelte:37-63 --> Every field that has a matching `xxxType: 'var'|'value'` flag does one of two things. It reads `xxx` as a literal (parsed as CBS), or it looks `xxx` up as a variable name.

All effect categories below match the own grouping of the editor. Apart from the deprecated group at the end of this section, every V2 effect listed here works as documented. This is unlike `runAxLLM` of V1.

### Special (usable only on triggers of the `display` or `request` type)

| Effect | Parameters | Behavior |
|---|---|---|
| `v2GetDisplayState` | `outputVar` | Reads the display text that is in flight (`display` mode only. It returns early otherwise.) |
| `v2SetDisplayState` | `value`/`valueType` | Overwrites the display text that is in flight |
| `v2GetRequestState` | `index`/`indexType`, `outputVar` | Reads the `content` of message `index` from the prompt array that is in flight (`request` mode only) |
| `v2SetRequestState` | `index`/`indexType`, `value`/`valueType` | Overwrites the `content` of that message |
| `v2GetRequestStateRole` / `v2SetRequestStateRole` | As above | Reads or writes the `role` of that message (set accepts only `user`, `assistant`, and `system`) |
| `v2GetRequestStateLength` | `outputVar` | The number of messages in the prompt array that is in flight |

<!-- src/ts/process/triggers.ts:2494-2578 -->

### Control

| Effect | Parameters | Behavior |
|---|---|---|
| `v2SetVar` | `operator: = += -= *= /= %=`, `var`, `value`/`valueType` | Arithmetic or assignment on a variable |
| `v2DeclareLocalVar` | `var`, `value`/`valueType` | Declares a local variable with a scope of the block at the current indent (falls back to `"null"`) |
| `v2Calculate` | `expression`/`expressionType`, `outputVar` | Substitutes `$varName` tokens, then evaluates `+ - * /` with parentheses through a small RPN calculator |
| `v2If` *(deprecated, see below)* / `v2IfAdvanced` | `condition`, `target`/`targetType`, `source`/`sourceType` | Branches. `v2IfAdvanced` adds `≒` (loose or numeric-fuzzy equals), `∋ ∈ ∌ ∉` (membership in a JSON array), and `≡` (boolean-like equals) to the basic set `= != > < >= <=`. |
| `v2Loop` | none | Marks the start of a loop. The matching `v2EndIndent{endOfLoop:true}` drives the looping itself. |
| `v2LoopNTimes` | `value`/`valueType` | The start of a loop with a cap on iterations, which the app tracks for each effect index |
| `v2BreakLoop` | none | Jumps forward to the closing `v2EndIndent` of the loop |
| `v2Command` | `value`/`valueType` | Runs `processMultiCommand` |
| `v2ConsoleLog` | `source`/`sourceType` | Runs `console.log` on the value |
| `v2RunTrigger` | `target` (trigger name) | A recursive call of a manual trigger. See the recursion note above. |
| `v2StopTrigger` | none | Stops the processing of *the rest of the effects of this trigger* only |
| `v2Comment` | `value` | An annotation that does nothing |

The app throttles long-running loops that you build with `v2Loop` automatically. Every 100 iterations, the runtime pauses for 1ms, to avoid a freeze of the tab. <!-- src/ts/process/triggers.ts:1884-1888 -->

### Chat

| Effect | Parameters | Behavior |
|---|---|---|
| `v2CutChat` | `start`/`startType`, `end`/`endType` | Slices the message array (defaults: start 0, end = length). **Fork difference:** The resume point of SupaMemory and the handling of an empty chat are the same as for `cutchat`. <!-- src/ts/process/triggers.ts:2003-2018 --> |
| `v2ModifyChat` | `index`/`indexType`, `value`/`valueType` | Overwrites the text of one message |
| `v2Impersonate` | `role`, `value`/`valueType` | Appends a message |
| `v2GetLastMessage` | `outputVar` | The text of the last message, or `"null"` |
| `v2GetLastUserMessage` / `v2GetLastCharMessage` | `outputVar` | The last message with that role, or `"null"` |
| `v2GetMessageAtIndex` | `index`/`indexType`, `outputVar` | The message text at the index, or `"null"` |
| `v2GetMessageCount` | `outputVar` | The message count |
| `v2GetFirstMessage` | `outputVar` | The greeting of the chat: `char.firstMessage`, or the selected alternate greeting if `chat.fmIndex` points to one |
| `v2QuickSearchChat` | `value`/`valueType`, `condition: strict\|loose\|regex`, `depth`/`depthType`, `outputVar` | The same search as the `exists` condition. Writes `"1"` or `"0"`. |

### Low Level (requires `lowLevelAccess`)

| Effect | Parameters | Behavior |
|---|---|---|
| `v2SendAIprompt` | none | Flags this pass to trigger an AI response |
| `v2ImgGen` | `value`/`valueType`, `negValue`/`negValueType`, `outputVar` | Generates an image. Writes a `{{inlay::id}}` tag or `"null"`. |
| `v2CheckSimilarity` | `source`/`sourceType`, `value`/`valueType` (joined by `§`), `outputVar` | Ranking by embedding similarity, joined by `§` |
| `v2RunLLM` | `value`/`valueType`, `model: 'model'\|'submodel'`, `streaming?`, `outputVar` | Calls the chosen model slot. Supports streaming (it collects the final chunk). |

### Alert

| Effect | Parameters | Behavior |
|---|---|---|
| `v2ShowAlert` | `value`/`valueType` | A normal alert dialog. It bails out entirely in display mode. |
| `v2GetAlertInput` | `display`/`displayType`, `outputVar` | A dialog with text input. Writes the response. |
| `v2GetAlertSelect` | `display`/`displayType`, `value`/`valueType` (options separated by `\|`), `outputVar` | A choice dialog. Writes the selected option. |

### Lorebook V2 (operates on the global lorebook of the own character of the trigger, addressed by index)

| Effect | Parameters | Behavior |
|---|---|---|
| `v2GetAllLorebooks` | `outputVar` | A JSON array of the content of every global lore entry |
| `v2GetLorebookByName` | `name`/`nameType`, `outputVar` | A JSON array of indices whose comment matches `name` as a case-insensitive regex |
| `v2GetLorebookByIndex` | `index`/`indexType`, `outputVar` | The content of that entry, or `"null"` |
| `v2CreateLorebook` | `name`/`nameType`, `key`/`keyType`, `content`/`contentType`, `insertOrder`/`insertOrderType` | Appends a new global lore entry (`mode:'normal'`, not always-active) |
| `v2ModifyLorebookByIndex` | `index`/`indexType`, `name`/`nameType`, `key`/`keyType`, `content`/`contentType`, `insertOrder`/`insertOrderType` | Updates fields on an existing entry. Each new value can contain `{{slot}}` to splice in the current value of the entry. |
| `v2DeleteLorebookByIndex` | `index`/`indexType` | Removes that entry |
| `v2GetLorebookCountNew` | `outputVar` | The entry count |
| `v2SetLorebookAlwaysActive` | `index`/`indexType`, `value: boolean` | Toggles always-active on that entry |

All of these persist at once to the lorebook data of the own character of the trigger. In a group run, that is the member. See "Which character and chat effects act on" above. <!-- src/ts/process/triggers.ts:2669-2801 -->

### String

| Effect | Parameters | Behavior |
|---|---|---|
| `v2RegexTest` | `value`/`valueType`, `regex`/`regexType`, `flags`/`flagsType`, `outputVar` | `"1"` or `"0"` |
| `v2ExtractRegex` | `value`/`valueType`, `regex`/`regexType`, `flags`/`flagsType`, `result`/`resultType` (`$1`, `$&`, `$$`), `outputVar` | Extraction with a regex |
| `v2GetCharAt` / `v2SetCharAt` | `source`/`sourceType`, `index`/`indexType`, (`value`/`valueType` for set), `outputVar` | The character at the index, or the string with one character replaced |
| `v2GetCharCount` | `source`/`sourceType`, `outputVar` | The string length |
| `v2ToLowerCase` / `v2ToUpperCase` | `source`/`sourceType`, `outputVar` | Case conversion |
| `v2SplitString` | `source`/`sourceType`, `delimiter`/`delimiterType` (`var`\|`value`\|`regex`. `regex` accepts a `/pattern/flags` literal) | A JSON array |
| `v2ConcatString` | `source1`/`source1Type`, `source2`/`source2Type`, `outputVar` | String concatenation |
| `v2ReplaceString` | `source`/`sourceType`, `regex`/`regexType`, `flags`/`flagsType`, `result`/`resultType` (a selector for the target group, or a `$n`/`$&`/`$$` template), `replacement`/`replacementType`, `outputVar` | Replacement with a regex, with targeting of a group |

### Data

| Effect | Parameters | Behavior |
|---|---|---|
| `v2GetCharacterDesc` / `v2SetCharacterDesc` | `outputVar` / `value`/`valueType` | The description of the own character of the trigger (see "Which character and chat effects act on" above) |
| `v2GetPersonaDesc` / `v2SetPersonaDesc` | `outputVar` / `value`/`valueType` | The active persona prompt. Get falls back from the setting of the global persona prompt to the prompt of the saved persona. Set writes both. |
| `v2GetReplaceGlobalNote` / `v2SetReplaceGlobalNote` | `outputVar` / `value`/`valueType` | The "replace global note" field of the own character of the trigger |
| `v2GetAuthorNote` / `v2SetAuthorNote` | `outputVar` / `value`/`valueType` | The author's note of the chat. Outside display mode, set persists to the stored chat of the character. |
<!-- src/ts/process/triggers.ts:2246-2286, 2752-2761 -->

### Array (string variables encoded as JSON)

| Effect | Parameters | Behavior |
|---|---|---|
| `v2MakeArrayVar` | `var` | Sets the variable to `"[]"` (it does nothing if the variable already looks like an array literal) |
| `v2GetArrayVarLength` | `var`, `outputVar` | The length, or `"0"` if parsing fails |
| `v2GetArrayVar` / `v2SetArrayVar` | `var`, `index`/`indexType`, (`value`/`valueType` for set), `outputVar` | Read and write by index |
| `v2PushArrayVar` / `v2UnshiftArrayVar` | `var`, `value`/`valueType` | Append and prepend |
| `v2PopArrayVar` / `v2ShiftArrayVar` | `var`, `outputVar` | Remove and return the last or first element |
| `v2SpliceArrayVar` | `var`, `start`/`startType`, `item`/`itemType` | Inserts `item` at `start` |
| `v2SliceArrayVar` | `var`, `start`/`startType`, `end`/`endType`, `outputVar` | A slice of the JSON array |
| `v2GetIndexOfValueInArrayVar` | `var`, `value`/`valueType`, `outputVar` | The index, or `-1` |
| `v2RemoveIndexFromArrayVar` | `var`, `index`/`indexType` | Removes that index |
| `v2JoinArrayVar` | `var`/`varType`, `delimiter`/`delimiterType`, `outputVar` | String join |

If the app cannot parse the JSON in the variable, most array effects reset it to `"[]"`. They do not stop the whole trigger.

### Dictionary (object variables encoded as JSON)

| Effect | Parameters | Behavior |
|---|---|---|
| `v2MakeDictVar` | `var` | Sets it to `"{}"` (it does nothing if the variable already has the shape of an object literal) |
| `v2GetDictVar` / `v2SetDictVar` | `var`/`varType`, `key`/`keyType`, (`value`/`valueType` for set), `outputVar` | Read and write by key (set requires `var` to be a variable, not a literal) |
| `v2DeleteDictKey` | `var`/`varType`, `key`/`keyType` | Removes a key |
| `v2HasDictKey` | `var`/`varType`, `key`/`keyType`, `outputVar` | `"1"` or `"0"` |
| `v2ClearDict` | `var` | Resets it to `"{}"` |
| `v2GetDictSize` | `var`/`varType`, `outputVar` | The key count |
| `v2GetDictKeys` / `v2GetDictValues` | `var`/`varType`, `outputVar` | A JSON array |

### Others

| Effect | Parameters | Behavior |
|---|---|---|
| `v2Random` | `min`/`minType`, `max`/`maxType`, `outputVar` | A random integer, including both ends |
| `v2UpdateGUI` | none | Bumps the pointer for the GUI reload |
| `v2SystemPrompt` | `location: start\|historyend\|promptend`, `value`/`valueType` | Appends to an injection point of the prompt |
| `v2UpdateChatAt` | `index` | Bumps the reload counter for one chat message |
| `v2Wait` | `value`/`valueType` | Sleeps `value` seconds |
| `v2StopPromptSending` | none | Stops the AI from sending or generating (it shares its `case` with `stop` of V1) |
| `v2Tokenize` | `value`/`valueType`, `outputVar` | The token count |

### Legacy V2 effects ("Deprecated" category in the editor)

The app keeps these for old scripts. The "add effect" picker hides them for new scripts. <!-- src/lib/SideBars/Scripts/TriggerV2List.svelte:136-144 -->

The authors believe that these effects do not work today. Two are exceptions: `v2GetLorebookCount` works, and `v2SetLorebookActivation` is now a deliberate no-op. The app stores global lore entries as objects with named fields (`key`, `content`, `alwaysActive`, and so on). But `v2ModifyLorebook`, `v2GetLorebook`, `v2GetLorebookEntry`, and `v2GetLorebookIndexViaName` try to access them as if they were numbered list items. The entries are not structured that way. So lookups by name or index never find a match. A read yields `"null"` or `-1`, and a modify does nothing. This looks like logic that is left over from an older lorebook format. Use the effects that work by index in the Lorebook V2 section above. They are the supported way to do the same things. <!-- src/ts/process/triggers.ts:2179-2230; src/ts/storage/database.svelte.ts:1373-1391 -->

| Effect | Parameters | Behavior |
|---|---|---|
| `v2If` | `condition: = != > < >= <=`, `target`/`targetType`, `source` (always treated as a variable name) | Works as a basic comparison. `v2IfAdvanced` supersedes it. |
| `v2ModifyLorebook` / `v2GetLorebook` | `target`/`targetType` (meant to match the key of a lore entry), `value`/`valueType`, `outputVar` | Meant to modify or read content by a lookup of the key. The lookup never matches (see above). |
| `v2GetLorebookCount` | `outputVar` | The entry count. This one works, because it is just `.length`. |
| `v2GetLorebookEntry` | `index`/`indexType`, `outputVar` | Meant to read content by index. It always yields `"null"` (see above). |
| `v2SetLorebookActivation` | `index`/`indexType`, `value: boolean` | Does nothing. It writes nothing, gives no error, and does not mark the chat as changed (see above). Use `v2SetLorebookAlwaysActive` instead. **Fork difference:** Upstream writes to a non-existent field instead of `alwaysActive`. <!-- src/ts/process/triggers.ts:2215-2218 --> |
| `v2GetLorebookIndexViaName` | `name`/`nameType`, `outputVar` | Meant as an exact-match lookup of the index by name. The lookup never matches (see above). |

## Relation to Lua

A whole-script Lua trigger is a trigger entry that runs Lua code instead of the block-based effects. It is exempt from the rule for mode matching described above. So its Lua entry points (`onStart`, `onInput`, and so on) decide for themselves which mode they respond to. For the full documentation of the runtime, the permissions, and the lifecycle, see [[Lua Scripting]]. Note that passes in `display` and `request` mode never run Lua triggers. <!-- src/ts/process/triggers.ts:1318-1328, 1024-1037, 1420-1424 -->

## See also

- [[Lua Scripting]] / [[Lua API Reference]]
- [[Curly Brased Syntaxes]]: The CBS parser that every `value` and `condition.value` field goes through.
- [[HTML Syntaxes]]: The `risu-trigger` and `risu-btn` attributes that invoke triggers from chat HTML.
