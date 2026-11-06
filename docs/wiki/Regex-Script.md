# Regex Script

A Regex Script rewrites text at a specific point in the message pipeline. It matches a JavaScript regular expression against a string. It replaces the match with an OUT template. The template can contain [[Curly Brased Syntaxes]] and special `@@` directives.
<!-- src/ts/process/scripts.ts:99 -->

## Where scripts live, and processing order

You can define scripts in three scopes. The app combines all three and runs them together, in this order, for every mode except `edittrans`:

1. **Preset scripts**: You edit them under Settings, on the "Preset" page, in the **Regex Script** accordion. The app saves and loads them as part of the active connection **Preset**. It exports and imports them with it. So they apply to every character while that preset is loaded. They do not apply to a single character.
   <!-- src/ts/process/scripts.ts:134; src/lib/Setting/Pages/BotSettings.svelte:787-789; src/ts/storage/database.svelte.ts:2108,2233 -->
2. **Character scripts**: You edit them in the own config panel of the character.
   <!-- src/lib/SideBars/CharConfig.svelte:689 -->
3. **Module scripts**: They belong to every [[module|Modules]] that is enabled now. The app joins them in the order of the modules.
   <!-- src/ts/process/modules.ts:486-498 -->

For `edittrans` scripts only, the order is preset, then module, then character.
<!-- src/ts/translator/translator.ts:649 -->

> Note: Settings also has a separate **"Global Regex"** page. Despite the name, the app does not apply that list to any message. It is only a save slot for the Import and Export buttons of that page. To run a script everywhere, put it in the Regex Script list of the Preset. Do not put it in "Global Regex".
> <!-- src/lib/Setting/Pages/GlobalRegex.svelte:7-28 -->

Within one scope, scripts run in list order from top to bottom. The exception is a reorder with `<order N>` (see below).

## Modification types

You set the type for each script with the "Modification Type" dropdown. Each type is a distinct point in the pipeline:
<!-- src/lib/SideBars/Scripts/RegexData.svelte:119-124 -->

| Type (saved value) | UI label | Runs on | When |
|---|---|---|---|
| `editinput` | Modify Input | The text that you type, before the app stores it as a chat message | When you send a message |
| `editoutput` | Modify Output | The reply of the AI, streamed or generated, before the app stores it as a chat message | After generation |
| `editprocess` | Modify Request Data | The text of each message as the app assembles it into the outgoing request, and the first message or greeting of the character that the app uses for token counting | While the app builds the prompt |
| `editdisplay` | Modify Display | The stored message text, only when the app renders it on screen. The app never writes it back to chat data. | When the app displays the message |
| `edittrans` | Edit Translation Display | The text after auto-translation, before the app shows it | After translation, through a separate, lighter engine (see below) |
| `disabled` | Disabled | Never. It matches no mode, so it turns the script off without a deletion. | none |

<!-- editinput: src/lib/ChatScreens/DefaultChatScreen.svelte:269; editoutput: src/ts/process/index.svelte.ts:1670; editprocess: src/ts/process/index.svelte.ts:886-917; editdisplay: src/ts/parser/parser.svelte.ts:783; edittrans: src/ts/translator/translator.ts:639-760 -->

For `editinput`, `editoutput`, and `editdisplay`, the [[Lua edit triggers|Lua Scripting]] (the callbacks `editInput`, `editOutput`, and `editDisplay`) run before the regex list. `editprocess` skips this step.
<!-- src/ts/process/scriptings.ts:1409-1422; src/ts/process/scripts.ts:102 -->

Before the regex list itself runs, `editdisplay` runs three more steps. First, it runs a "display" [[Trigger Script]] hook, for non-group characters only. Then it runs any plugin hook that is registered for that mode. Last, it runs a CBS (`{{...}}`) parsing pass.
<!-- src/ts/process/scripts.ts:104-133 -->

### `edittrans` uses a separate, lighter engine

`edittrans` scripts run through a separate, lighter engine instead of the main script pipeline. The engine supports the same flag and action syntax (`<order N>`, `<cbs>`, `<move_top>`, `<move_bottom>`). It does not support `@@emo`, `@@inject`, or `@@repeat_back`.
<!-- src/ts/translator/translator.ts:632-760 -->

## Flags

The Flag field is a normal JS regex flag string. It allows only `d g i m s u v y`. The app silently strips unsupported characters and collapses duplicates.
<!-- src/ts/process/scripts.ts:166-174 -->

- If **Custom Flag** is off, the effective flags are always `g`.
- If it is on, but the flag field is empty after the app removes all directive tokens, the flags fall back to `u`, not `g`.
  <!-- src/ts/process/scripts.ts:172-174 -->

The Flags editor also has toggle buttons for `g i m u s`, and custom bracket directives (below).
<!-- src/lib/SideBars/Scripts/RegexData.svelte:65-79 -->

### `<...>` bracket directives (Flag field)

The app parses out any `<...>` token in the Flag field before it uses the string as regex flags. It turns the token into an ordering rule or an action:
<!-- src/ts/process/scripts.ts:296-330 -->

- `<order N>`: Sets the order of execution. When any script in the whole combined list uses `<order>`, the app sorts all scripts again by order, highest first, before it runs any of them. Scripts without `<order>` have the default order `0`.
  <!-- src/ts/process/scripts.ts:298-334 -->
- `<cbs>`: Evaluates the IN pattern itself through the CBS parser (`{{...}}` macros) before it compiles the regex. So the pattern can depend on character data and chat data. Without it, the app uses IN as a literal regex source.
  <!-- src/ts/process/scripts.ts:176-179 -->
- `<no_end_nl>`: Suppresses the automatic trailing newline described below.
- `<move_top>`, `<move_bottom>`, `<repeat_back>`: An alternate way to trigger the `@@` directives with the same names (see the next section). You do not need the `@@...` prefix in OUT.
- `<inject>`: The UI does not document it, but the app recognizes it exactly like `@@inject` in OUT.
  <!-- src/ts/process/scripts.ts:207 -->
- Any other bracket text: The app still strips it from the flags, but it has no built-in effect. It is a harmless custom marker.

You can combine multiple directives in one flag string. Separate them with commas or spaces inside the brackets, for example `flag: "gi<order 5><cbs>"`.

### Automatic trailing newline

If OUT ends with `>`, for example a closing HTML tag, the engine appends a newline automatically. The flag `<no_end_nl>` stops this.
<!-- src/ts/process/scripts.ts:163-165 -->

## Replacement syntax

First, the engine substitutes `$n` in OUT with a literal newline. Then it uses the result as the replacement.
<!-- src/ts/process/scripts.ts:154 -->

- The standard ECMAScript replacement patterns work: `$&` (whole match), `$1` to `$9` (capture groups), `` $` `` and `$'` (before and after the match), and `` $<name> `` (named group). They all work natively for a normal (non-`@@`) replacement.
  <!-- src/ts/process/scripts.ts:248,291 -->
- After a normal replacement, CBS parses the entire result again. So OUT can safely contain `{{...}}` macros.
  <!-- src/ts/process/scripts.ts:248,291 -->
- Inside the output of `@@move_top` and `@@move_bottom` (see below), the engine implements group substitution separately. It supports only `$0` to `$9` and `$&`. `$<name>` for named groups does not work now. It does not match the actual named group. So the engine leaves references to named groups as literal text in move directives. This is true for both the main script engine and the edittrans engine.
  <!-- src/ts/process/scripts.ts:231-237; src/ts/translator/translator.ts:736-742 -->

## `@@` output directives

If OUT starts with `@@`, or if the script has any bracket action (above), the script enters "directive mode". The engine first tests the regex against the current text. Then it runs only a recognized directive, or a plain fallback.
<!-- src/ts/process/scripts.ts:182 -->

| Directive | Syntax | Effect |
|---|---|---|
| `@@emo <name>` | OUT starts with `@@emo ` (no flag equivalent) | If IN matches, it adds `<name>` to the recent emotion images of that character. The name must exist among the emotion images that you configured for the character. The app keeps them as a stack of up to 5. The emotion or sprite view uses them. It does nothing for preview characters. <!-- src/ts/process/scripts.ts:184-206 --> |
| `@@inject` | OUT starts with `@@inject`, or the flag `<inject>` | If IN matches and the script runs on an actual chat message, it saves the current text (before the strip) back into the chat log at the position of that message. Then it removes the matched text from what the engine returns or displays. It always targets the selected character. So it has no effect for group members or preview characters. <!-- src/ts/process/scripts.ts:207-211 --> |
| `@@move_top <text>` | OUT starts with `@@move_top`, or the flag `<move_top>` | Removes the matched text from its original position. Then it re-inserts the replacement text at the very top. Only the first match moves. See the callout below. |
| `@@move_bottom <text>` | OUT starts with `@@move_bottom`, or the flag `<move_bottom>` | The same as above, but it appends at the bottom. |
| `@@repeat_back[ end\|start\|end_nl\|start_nl]` | OUT starts with `@@repeat_back`, or the flag `<repeat_back>` | Runs only when IN does not match the current text. It walks backward through the chat history to the nearest earlier message with the same role. If it finds none, it uses the text of the active greeting. It matches IN against that text and copies the match into the current text. The copy is appended (default, or `end`), prepended (`start`), or joined with a newline separator (`end_nl` or `start_nl`). The script must run on an actual chat message. If that earlier text does not match IN, the script throws a TypeError. It does not skip cleanly. The script runner catches the error and logs it to the console. The chat text stays unchanged. <!-- src/ts/process/scripts.ts:266-286,335-341 --> |
| any other `@@...` text | none | This is not a recognized prefix and reaches no directive branch. So the engine uses it as a literal replacement, the same as a normal, non-`@@` OUT. This includes the CBS parsing pass again. |

**The engine ignores the Global flag for move directives.** Suppose the Global (`g`) flag is checked. `@@move_top` and `@@move_bottom` still drop the `g` flag before they match. So only the first match moves, never all matches. This is true in both the main script engine and the edittrans engine.
<!-- src/ts/process/scripts.ts:160-162,216-217; src/ts/translator/translator.ts:686-688,719-720 -->

## Caching

The engine caches results for each combination of the active scripts, the input text, the modification type, the chat, and the current CBS state. The cache holds up to 1000 entries. The engine evicts the oldest entry first. So repeated renders of the same text skip the rerun of every script.
<!-- src/ts/process/scripts.ts:68-97 -->

## Related feature: Dynamic Assets

The same pipeline also runs a fuzzy-match pass. The pass compares `{{asset-type::name}}`-style tags in the text with the asset names of the character or module (Dynamic Assets). The pass always runs for `editoutput`. It runs for `editdisplay` only if the "Dynamic Assets on Display" setting is on. It never runs for `editinput` or `editprocess`. This is a separate feature inside the same pipeline. It is not a Regex Script directive. For the syntax of the asset tag itself, see [[HTML Syntaxes]] and [[@ Syntaxes]].
<!-- src/ts/process/scripts.ts:345-382 -->

## Legacy

- The Import and Export of a script list produce JSON in the form `{"type":"regex","data":[...]}`. An import merges into the target list. It does not replace the list.
  <!-- src/ts/process/scripts.ts:30-66 -->

## Worked examples

**Hide a status block, show HTML instead (Modify Display):**
- IN: `\[status\]`
- OUT: `<div class="status-box">{{getvar::hp}}/100 HP</div>`
- Type: Modify Display. Flag: the default (`g`).
- In its prompt, you instruct the AI to output the literal text `[status]`. This never touches chat storage. So the raw response stays cheap in tokens, and the display shows rendered HTML. For what you can use inside OUT, see [[HTML Syntaxes]].

**Strip a scratchpad that the model must not repeat, but keep it saved (Modify Output, `@@inject`):**
- IN: `<scratchpad>[\s\S]*?<\/scratchpad>`
- OUT: `@@inject`
- Type: Modify Output.
- The app writes the full text, including the scratchpad, into the stored message. For that turn, the app strips the scratchpad from what continues through the pipeline and the display.

**Move an out-of-band author's note to the end of the reply (Modify Output):**
- IN: `\(OOC:.*?\)`
- OUT: `@@move_top $&`
- Type: Modify Output. Use the flag `<order 10>` if the script must run before other scripts.
