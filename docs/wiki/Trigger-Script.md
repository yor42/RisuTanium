# Trigger Script

Trigger Scripts are Risu's event/condition/effect system: "when X happens, if Y is true, do Z." They live on a character or on a module, and a module's triggers apply to every character the module is attached to. For the editing hooks (`editRequest`/`editDisplay`/`editInput`/`editOutput`) and the Lua-button path, a group has no triggers of its own — only module-provided triggers run for it. `start`/`output` triggers during generation are an exception: they run against the group's own member character, so that member's own triggers run too, alongside the module's. <!-- src/ts/process/triggers.ts:21-27; src/ts/process/scriptings.ts:1568, 1596; src/ts/process/index.svelte.ts:376; src/ts/process/modules.ts:20-28, 470-484 -->

A trigger script is authored in one of three interchangeable formats — **V1** (legacy, flat list), **V2** (block-based visual scripting), or **Lua** (see [[Lua Scripting]]) — chosen with a switcher in the editor. Switching formats replaces the whole trigger list for that character/module after a confirmation prompt; you cannot mix formats within one character's trigger list. <!-- src/lib/SideBars/Scripts/TriggerList.svelte:23-99 -->

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

**Fork-specific:** upstream reads the currently selected character/chat for every effect. A `start`/`input`/`output`/`manual` run here instead works against its own **origin** — the chat it was invoked for, and the character that owns that chat — re-resolved on every effect, never a value held from before an `await`. For a group's member trigger, the origin's owner is the group and its member is resolved separately; effects that read or write "the character" (`v2GetCharacterDesc`/`v2SetCharacterDesc`, the Lorebook V2 effects, `v2GetReplaceGlobalNote`/`v2SetReplaceGlobalNote`, and the matching V1 fields) act on that member (falling back to the owner when the run has no member), not the group and not the character selected in the app. Lua bindings called from such a run act on the owner, the group — see [[Lua Scripting]]. A `display`/`request` run has no origin and keeps acting on its caller's own character/chat, unchanged. Changes a running trigger makes are visible immediately, in the live chat, while it is still running; messages sent or edited elsewhere during a trigger's `sleep`/`runLLM`/similar wait are kept, not discarded when the trigger resumes; and a trigger's run stops cleanly, without finishing its remaining effects, if its own chat is deleted or duplicated while it is waiting. <!-- src/ts/process/triggers.ts:1097-1166, 1333-1335, 1427-1429; src/ts/process/chatOrigin.ts:78-157 -->

## Timings (`type` / trigger mode)

| Mode | Fires |
|---|---|
| `start` | once per new generation round, before the prompt is assembled |
| `input` | right before the user's message is added to the chat |
| `output` | right after the character's reply is generated/finalized |
| `manual` | invoked by name — the `/trigger <name>` chat command, a `risu-trigger="<name>"` HTML attribute click, or another trigger's Run Trigger effect |
| `display` | runs read-mostly, over a restricted set of effects, while rendering a message for display; can rewrite the displayed text only, does not persist |
| `request` | runs read-mostly, over a restricted set of effects, immediately before the formatted prompt array is sent to the model; can rewrite the outgoing messages only |
<!-- index.svelte.ts:901,1776,1884; DefaultChatScreen.svelte:262; Chat.svelte:348-357; command.ts:225-239; scripts.ts:104-122; request/request.ts:249-260 -->

`display` and `request` are selectable as a trigger's `type` only in the V2 editor; the V1 editor only offers `start`/`output`/`input`/`manual`. <!-- src/lib/SideBars/Scripts/TriggerV1Data.svelte:64-69; src/lib/SideBars/Scripts/TriggerV2List.svelte:2664-2671 -->

### Execution order

For a given mode, every trigger defined directly on the character runs first, in the order they're listed, followed by every module trigger, in module order. A trigger whose comment doesn't match (for `manual` triggers) or whose type doesn't match the current mode is skipped, except a whole-script Lua trigger, which always runs regardless of type — see the "manual triggers call a same-named Lua function" section on [[Lua Scripting]]. <!-- src/ts/process/triggers.ts:1114-1116, 1318-1328 -->

Within one trigger, `conditions` are AND-ed (first failure short-circuits), then `effect` entries run in array order. V2's `indent` field creates block structure (if/else/loop) purely by scanning forward/backward for matching `v2EndIndent`/`v2Loop` markers at runtime — there is no separate parse step. <!-- src/ts/process/triggers.ts:1337-1418 -->

### Recursion

Run Trigger (`runtrigger`/`v2RunTrigger`) can call another trigger, which can call Run Trigger again. Recursion is capped at depth 10, unless the calling trigger has low-level access, in which case there is no depth cap. Note: a low-level trigger that calls itself without a stopping condition can freeze the tab. <!-- src/ts/process/triggers.ts:1501-1502, 1913-1914 -->

### Variable resolution order

`$name` (V1 `var`/`value` conditions, V2 var-typed fields) resolves in this order: a V2 local variable declared at or above the current indent in the current scope, then the chat's persistent variable store, then the character's default variables, then the preset's default variables, then the literal string `"null"`. Writes go to whichever of the first two already has the key. Otherwise, a new entry is added to the chat's persistent variable store, which also marks the chat as changed and refreshes the display. <!-- src/ts/process/triggers.ts:1260-1311, 2944-2945 --> This is the *same* store Lua's `getChatVar`/`setChatVar` use — see the "chat variables & state" section on [[Lua Scripting]].

In `display`/`request` mode, variable writes go to a temporary, non-persistent store instead of the chat's saved state, so trigger effects that only make sense live (alerts, `showAlert`, `v2GetAlertInput`) do nothing in those modes. <!-- src/ts/process/triggers.ts:1281-1287, 1024-1037, 1420-1424 -->

## Conditions

| Type | Fields | Meaning |
|---|---|---|
| `var` | `var`, `value`, `operator` | compares the named variable's (CBS-parsed) value against `value` |
| `value` | `var` *(used as a literal, not a name)*, `value`, `operator` | compares a literal against `value` — this is what the "always" default condition uses (`operator: 'true'`) |
| `chatindex` | `value`, `operator` | compares the current message count against `value` |
| `exists` | `value`, `type2: 'strict'\|'loose'\|'regex'`, `depth` | searches the joined text of the last `depth` messages for `value` (word match / case-insensitive substring / regex) |

Operators for `var`/`value`/`chatindex`: `= != > < >= <= null true`. `true` passes only if the value is exactly `"true"` or `"1"`; `null` passes only if the value is exactly `"null"`. <!-- src/ts/process/triggers.ts:47-70, 1338-1394 -->

## Legacy: V1 effects

V1 is a flat list of `{comment, type, conditions, effect: [oneEffect]}` entries — the whole trigger list *is* the list of independently-evaluated events. The editor shows a deprecation warning on any V1 script unless the option to show deprecated V1 scripts is turned on, and hides the "V1" format button entirely once a script has moved past it. <!-- src/lib/SideBars/Scripts/TriggerList.svelte:18, 24-36, 85-87 -->

| Effect `type` | Parameters | Behavior | Access |
|---|---|---|---|
| `setvar` | `operator: '='\|'+='\|'-='\|'*='\|'/='`, `var`, `value` | arithmetic/assign on a variable (non-numeric current value treated as 0) | any |
| `systemprompt` | `location: 'start'\|'historyend'\|'promptend'`, `value` | appends text to one of three injection points for this round's prompt | any |
| `impersonate` | `role: 'user'\|'char'`, `value` | appends a new chat message | any |
| `command` | `value` | runs `value` through `processMultiCommand` — the same pipe-separated (`\|`) mini-language as the chat command bar (see [[Chat Commands]]) | any |
| `stop` | — | stops the AI from sending/generating this round | any |
| `runtrigger` | `value` (target trigger's `comment`) | recursively runs a `manual` trigger by name (see recursion note above) | any |
| `cutchat` | `start`, `end` | slices the chat message array. **Fork difference:** if plain [[SupaMemory]] data is saved and its resume-point message is cut out, the resume point moves to the next surviving message, and a chat left with no messages loses its SupaMemory data <!-- src/ts/process/triggers.ts:1575-1583; src/ts/process/memory/supaResume.ts:59-141 --> | any |
| `modifychat` | `index`, `value` | overwrites one message's text | any |
| `showAlert` | `alertType: 'normal'\|'error'\|'input'\|'select'`, `value`, `inputVar` | shows a dialog; `input`/`select` write the response into `inputVar`; no-ops outside low-level access, and bails entirely in display mode | **low-level** |
| `sendAIprompt` | — | flags that this trigger pass should trigger an AI response | **low-level** |
| `runLLM` | `value` (ChatML-ish prompt text, falls back to a single user message), `inputVar` | calls the main model synchronously (no streaming) and writes the result/error into `inputVar` | **low-level** |
| `checkSimilarity` | `source`, `value` (`§`-joined candidates), `inputVar` | embeds and ranks `value` against `source`, writes `§`-joined ranked list | **low-level** |
| `extractRegex` | `value`, `regex`, `flags`, `result` (supports `$1`, `$&`, `$$`), `inputVar` | regex-extracts and writes into `inputVar` | any |
| `runImgGen` | `value`, `negValue`, `inputVar` | generates an image, writes a `{{inlay::id}}` CBS tag (or an error string) into `inputVar` | **low-level** |
| `triggerlua` | `code` | runs `code` as a Lua script — see [[Lua Scripting]] | mode-dependent, see Lua page |

`runAxLLM` (`value`, `inputVar` — same shape as `runLLM` but against the auxiliary model) is selectable in the V1 editor, but it currently does nothing at runtime. Treat it as non-functional; don't rely on it. <!-- src/ts/process/triggers.ts:166; src/lib/SideBars/Scripts/TriggerV1Data.svelte:307-329, 345, 472 -->

`v2StopPromptSending` behaves the same as V1's `stop` effect, even though it's nominally a V2-only effect type. <!-- src/ts/process/triggers.ts:1492-1493 -->

## V2 effects

V2 scripts are a `triggerscript[]` where entry 0 is a `v2Header` marker (`{comment:"", type:"manual", conditions:[], effect:[{type:'v2Header', indent:0}]}`) and every following entry is one named event (its own `comment`/`type`/`conditions`) whose `effect` array is an indented sequence of block-scripting instructions, editable as drag-and-drop blocks. <!-- src/lib/SideBars/Scripts/TriggerList.svelte:37-63 --> Every field with a matching `xxxType: 'var'|'value'` flag either reads `xxx` as a literal (CBS-parsed) or looks it up as a variable name.

All effect categories below match the editor's own grouping. Aside from the deprecated group described at the end of this section, every V2 effect listed here works as documented, unlike V1's `runAxLLM`.

### Special (only usable on `display`/`request`-type triggers)

| Effect | Parameters | Behavior |
|---|---|---|
| `v2GetDisplayState` | `outputVar` | reads the in-flight display text (`display`-mode only; returns early otherwise) |
| `v2SetDisplayState` | `value`/`valueType` | overwrites the in-flight display text |
| `v2GetRequestState` | `index`/`indexType`, `outputVar` | reads `content` of message `index` from the in-flight prompt array (`request`-mode only) |
| `v2SetRequestState` | `index`/`indexType`, `value`/`valueType` | overwrites that message's `content` |
| `v2GetRequestStateRole` / `v2SetRequestStateRole` | as above | reads/writes that message's `role` (set only accepts `user`/`assistant`/`system`) |
| `v2GetRequestStateLength` | `outputVar` | number of messages in the in-flight prompt array |

<!-- src/ts/process/triggers.ts:2494-2578 -->

### Control

| Effect | Parameters | Behavior |
|---|---|---|
| `v2SetVar` | `operator: = += -= *= /= %=`, `var`, `value`/`valueType` | arithmetic/assign on a variable |
| `v2DeclareLocalVar` | `var`, `value`/`valueType` | declares a block-scoped local at the current indent (falls back to `"null"`) |
| `v2Calculate` | `expression`/`expressionType`, `outputVar` | substitutes `$varName` tokens, then evaluates `+ - * /` with parentheses via a small RPN calculator |
| `v2If` *(deprecated, see below)* / `v2IfAdvanced` | `condition`, `target`/`targetType`, `source`/`sourceType` | branches; `v2IfAdvanced` adds `≒` (loose/numeric-fuzzy equals), `∋ ∈ ∌ ∉` (JSON-array membership), `≡` (boolean-like equals) to the basic `= != > < >= <=` set |
| `v2Loop` | — | marks a loop start; looping itself is driven by the matching `v2EndIndent{endOfLoop:true}` |
| `v2LoopNTimes` | `value`/`valueType` | loop start with an iteration cap tracked per-effect-index |
| `v2BreakLoop` | — | jumps forward to the loop's closing `v2EndIndent` |
| `v2Command` | `value`/`valueType` | runs `processMultiCommand` |
| `v2ConsoleLog` | `source`/`sourceType` | `console.log`s the value |
| `v2RunTrigger` | `target` (trigger name) | recursive manual trigger call, see recursion note above |
| `v2StopTrigger` | — | stops processing the *rest of this trigger's* effects only |
| `v2Comment` | `value` | no-op annotation |

Long-running loops built with `v2Loop` are throttled automatically: every 100 iterations, the runtime pauses for 1ms to avoid freezing the tab. <!-- src/ts/process/triggers.ts:1884-1888 -->

### Chat

| Effect | Parameters | Behavior |
|---|---|---|
| `v2CutChat` | `start`/`startType`, `end`/`endType` | slices the message array (defaults: start 0, end = length). **Fork difference:** the SupaMemory resume point and empty-chat handling are the same as for `cutchat` <!-- src/ts/process/triggers.ts:2003-2018 --> |
| `v2ModifyChat` | `index`/`indexType`, `value`/`valueType` | overwrites one message's text |
| `v2Impersonate` | `role`, `value`/`valueType` | appends a message |
| `v2GetLastMessage` | `outputVar` | last message's text, or `"null"` |
| `v2GetLastUserMessage` / `v2GetLastCharMessage` | `outputVar` | last message with that role, or `"null"` |
| `v2GetMessageAtIndex` | `index`/`indexType`, `outputVar` | message text at index, or `"null"` |
| `v2GetMessageCount` | `outputVar` | message count |
| `v2GetFirstMessage` | `outputVar` | the chat's greeting — `char.firstMessage`, or the selected alternate greeting if `chat.fmIndex` points to one |
| `v2QuickSearchChat` | `value`/`valueType`, `condition: strict\|loose\|regex`, `depth`/`depthType`, `outputVar` | same search as the `exists` condition, writes `"1"`/`"0"` |

### Low Level (requires `lowLevelAccess`)

| Effect | Parameters | Behavior |
|---|---|---|
| `v2SendAIprompt` | — | flags this pass to trigger an AI response |
| `v2ImgGen` | `value`/`valueType`, `negValue`/`negValueType`, `outputVar` | generates an image, writes a `{{inlay::id}}` tag or `"null"` |
| `v2CheckSimilarity` | `source`/`sourceType`, `value`/`valueType` (`§`-joined), `outputVar` | embedding similarity ranking, `§`-joined |
| `v2RunLLM` | `value`/`valueType`, `model: 'model'\|'submodel'`, `streaming?`, `outputVar` | calls the chosen model slot, supports streaming (collects the final chunk) |

### Alert

| Effect | Parameters | Behavior |
|---|---|---|
| `v2ShowAlert` | `value`/`valueType` | normal alert dialog; bails out entirely in display mode |
| `v2GetAlertInput` | `display`/`displayType`, `outputVar` | text-input dialog, writes the response |
| `v2GetAlertSelect` | `display`/`displayType`, `value`/`valueType` (`\|`-separated options), `outputVar` | choice dialog, writes the selected option |

### Lorebook V2 (operates on the trigger's own character's global lorebook, index-addressed)

| Effect | Parameters | Behavior |
|---|---|---|
| `v2GetAllLorebooks` | `outputVar` | JSON array of every global lore entry's content |
| `v2GetLorebookByName` | `name`/`nameType`, `outputVar` | JSON array of indices whose comment matches `name` as a case-insensitive regex |
| `v2GetLorebookByIndex` | `index`/`indexType`, `outputVar` | that entry's content, or `"null"` |
| `v2CreateLorebook` | `name`/`nameType`, `key`/`keyType`, `content`/`contentType`, `insertOrder`/`insertOrderType` | appends a new global lore entry (`mode:'normal'`, not always-active) |
| `v2ModifyLorebookByIndex` | `index`/`indexType`, `name`/`nameType`, `key`/`keyType`, `content`/`contentType`, `insertOrder`/`insertOrderType` | updates fields on an existing entry; each new value may contain `{{slot}}` to splice in the entry's current value |
| `v2DeleteLorebookByIndex` | `index`/`indexType` | removes that entry |
| `v2GetLorebookCountNew` | `outputVar` | entry count |
| `v2SetLorebookAlwaysActive` | `index`/`indexType`, `value: boolean` | toggles always-active on that entry |

All of these persist immediately to the trigger's own character's lorebook data — the member's, in a group run, per "Which character and chat effects act on" above. <!-- src/ts/process/triggers.ts:2669-2801 -->

### String

| Effect | Parameters | Behavior |
|---|---|---|
| `v2RegexTest` | `value`/`valueType`, `regex`/`regexType`, `flags`/`flagsType`, `outputVar` | `"1"`/`"0"` |
| `v2ExtractRegex` | `value`/`valueType`, `regex`/`regexType`, `flags`/`flagsType`, `result`/`resultType` (`$1`, `$&`, `$$`), `outputVar` | regex extract |
| `v2GetCharAt` / `v2SetCharAt` | `source`/`sourceType`, `index`/`indexType`, (`value`/`valueType` for set), `outputVar` | character at index / string with one character replaced |
| `v2GetCharCount` | `source`/`sourceType`, `outputVar` | string length |
| `v2ToLowerCase` / `v2ToUpperCase` | `source`/`sourceType`, `outputVar` | case conversion |
| `v2SplitString` | `source`/`sourceType`, `delimiter`/`delimiterType` (`var`\|`value`\|`regex`, `regex` accepts a `/pattern/flags` literal) | JSON array |
| `v2ConcatString` | `source1`/`source1Type`, `source2`/`source2Type`, `outputVar` | string concatenation |
| `v2ReplaceString` | `source`/`sourceType`, `regex`/`regexType`, `flags`/`flagsType`, `result`/`resultType` (target group selector or `$n`/`$&`/`$$` template), `replacement`/`replacementType`, `outputVar` | regex replace with group targeting |

### Data

| Effect | Parameters | Behavior |
|---|---|---|
| `v2GetCharacterDesc` / `v2SetCharacterDesc` | `outputVar` / `value`/`valueType` | the trigger's own character's description (see "Which character and chat effects act on" above) |
| `v2GetPersonaDesc` / `v2SetPersonaDesc` | `outputVar` / `value`/`valueType` | active persona prompt (get falls back from the global persona prompt setting to the saved persona's prompt; set writes both) |
| `v2GetReplaceGlobalNote` / `v2SetReplaceGlobalNote` | `outputVar` / `value`/`valueType` | the trigger's own character's "replace global note" field |
| `v2GetAuthorNote` / `v2SetAuthorNote` | `outputVar` / `value`/`valueType` | the chat's author's note (set persists to the character's stored chat outside display mode) |
<!-- src/ts/process/triggers.ts:2246-2286, 2752-2761 -->

### Array (JSON-encoded string variables)

| Effect | Parameters | Behavior |
|---|---|---|
| `v2MakeArrayVar` | `var` | sets the variable to `"[]"` (no-op if it already looks like an array literal) |
| `v2GetArrayVarLength` | `var`, `outputVar` | length, or `"0"` on parse failure |
| `v2GetArrayVar` / `v2SetArrayVar` | `var`, `index`/`indexType`, (`value`/`valueType` for set), `outputVar` | index read/write |
| `v2PushArrayVar` / `v2UnshiftArrayVar` | `var`, `value`/`valueType` | append/prepend |
| `v2PopArrayVar` / `v2ShiftArrayVar` | `var`, `outputVar` | remove & return last/first element |
| `v2SpliceArrayVar` | `var`, `start`/`startType`, `item`/`itemType` | inserts `item` at `start` |
| `v2SliceArrayVar` | `var`, `start`/`startType`, `end`/`endType`, `outputVar` | JSON array slice |
| `v2GetIndexOfValueInArrayVar` | `var`, `value`/`valueType`, `outputVar` | index or `-1` |
| `v2RemoveIndexFromArrayVar` | `var`, `index`/`indexType` | removes that index |
| `v2JoinArrayVar` | `var`/`varType`, `delimiter`/`delimiterType`, `outputVar` | string join |

If the JSON in the variable can't be parsed, most array effects reset it to `"[]"` instead of stopping the whole trigger.

### Dictionary (JSON-encoded object variables)

| Effect | Parameters | Behavior |
|---|---|---|
| `v2MakeDictVar` | `var` | sets to `"{}"` (no-op if already object-literal-shaped) |
| `v2GetDictVar` / `v2SetDictVar` | `var`/`varType`, `key`/`keyType`, (`value`/`valueType` for set), `outputVar` | key read/write (set requires `var` to be a variable, not a literal) |
| `v2DeleteDictKey` | `var`/`varType`, `key`/`keyType` | removes a key |
| `v2HasDictKey` | `var`/`varType`, `key`/`keyType`, `outputVar` | `"1"`/`"0"` |
| `v2ClearDict` | `var` | resets to `"{}"` |
| `v2GetDictSize` | `var`/`varType`, `outputVar` | key count |
| `v2GetDictKeys` / `v2GetDictValues` | `var`/`varType`, `outputVar` | JSON array |

### Others

| Effect | Parameters | Behavior |
|---|---|---|
| `v2Random` | `min`/`minType`, `max`/`maxType`, `outputVar` | inclusive random integer |
| `v2UpdateGUI` | — | bumps the GUI reload pointer |
| `v2SystemPrompt` | `location: start\|historyend\|promptend`, `value`/`valueType` | appends to a prompt injection point |
| `v2UpdateChatAt` | `index` | bumps the reload counter for one chat message |
| `v2Wait` | `value`/`valueType` | sleeps `value` seconds |
| `v2StopPromptSending` | — | stops the AI from sending/generating (shares its `case` with V1's `stop`) |
| `v2Tokenize` | `value`/`valueType`, `outputVar` | token count |

### Legacy V2 effects ("Deprecated" category in the editor)

Kept for old scripts; hidden from the "add effect" picker for new ones. <!-- src/lib/SideBars/Scripts/TriggerV2List.svelte:136-144 -->

These are believed non-functional today, except `v2GetLorebookCount`, and `v2SetLorebookActivation`, which is now a deliberate no-op. Global lore entries are stored as objects with named fields (`key`, `content`, `alwaysActive`, and so on), but `v2ModifyLorebook`, `v2GetLorebook`, `v2GetLorebookEntry` and `v2GetLorebookIndexViaName` try to access them as if they were numbered list items instead. Because the entries aren't structured that way, lookups by name or index never find a match (a read yields `"null"` or `-1`, and a modify does nothing). This looks like logic left over from an older lorebook format. Treat the index-based effects in the Lorebook V2 section above as the supported way to do the same things. <!-- src/ts/process/triggers.ts:2179-2230; src/ts/storage/database.svelte.ts:1373-1391 -->

| Effect | Parameters | Behavior |
|---|---|---|
| `v2If` | `condition: = != > < >= <=`, `target`/`targetType`, `source` (always treated as a variable name) | works as a basic comparison; superseded by `v2IfAdvanced` |
| `v2ModifyLorebook` / `v2GetLorebook` | `target`/`targetType` (intended to match a lore entry's key), `value`/`valueType`, `outputVar` | intended to modify/read content by key lookup; the lookup never matches (see above) |
| `v2GetLorebookCount` | `outputVar` | entry count — this one works, since it's just `.length` |
| `v2GetLorebookEntry` | `index`/`indexType`, `outputVar` | intended to read content by index; always yields `"null"` (see above) |
| `v2SetLorebookActivation` | `index`/`indexType`, `value: boolean` | does nothing: no write, no error, and the chat is not marked changed (see above). Use `v2SetLorebookAlwaysActive` instead. **Fork difference:** upstream writes to a non-existent field instead of `alwaysActive`. <!-- src/ts/process/triggers.ts:2215-2218 --> |
| `v2GetLorebookIndexViaName` | `name`/`nameType`, `outputVar` | intended exact-match index lookup by name; the lookup never matches (see above) |

## Relation to Lua

A whole-script Lua trigger is just a trigger entry that runs Lua code instead of the block-based effects. It's exempt from the mode-matching rule described above, so its Lua entry points (`onStart`, `onInput`, etc.) decide for themselves which mode they respond to. See [[Lua Scripting]] for the full runtime, permission, and lifecycle documentation. Note that `display`/`request` mode passes never run Lua triggers. <!-- src/ts/process/triggers.ts:1318-1328, 1024-1037, 1420-1424 -->

## See also

- [[Lua Scripting]] / [[Lua API Reference]]
- [[Curly Brased Syntaxes]] — the CBS parser every `value`/`condition.value` field is run through.
- [[HTML Syntaxes]] — `risu-trigger`/`risu-btn` attributes that invoke triggers from chat HTML.
