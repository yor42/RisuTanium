# Curly Braced Syntaxes (CBS)

Curly Braced Syntaxes (CBS) are the built-in templating language of RisuAI. They can appear in almost any text field that flows into a chat. Examples are the description, personality, scenario, and example dialogue of a character, the main prompt, the jailbreak, the global note, the author's note, lorebook entries, the input and output of regex scripts, first messages, and the chat messages themselves.

For example, the main prompt contains `{{char}} is cute`, and you chat with a character named "Hana". The app renders the text as `Hana is cute`.

This page covers the basics, the accessors for characters and prompts, and variables. These pages cover the rest:

- [[CBS-Blocks]]: `{{#when}}` and `{{#if}}`, `{{#each}}`, `{{#func}}` and `{{call}}`, `{{#pure}}` and `{{#puredisplay}}`, `{{#escape}}`, and the legacy `{# #}` block.
- [[CBS-Functions]]: Comparisons, string, array, and dictionary functions, math, random and dice, time and date formatting, system metadata, and encoding helpers.
- [[CBS-Assets]]: How to display character assets, emotion images, inlays, and profile pictures.

To try CBS while you read, use the **Syntax** tool in the [[Playground]]. The **CBS Doc** tool in the Playground lists every tag with a short description.

## How CBS is evaluated

One scanner parses CBS. It walks the text and looks for `{{...}}` and for the block form `{{#...}}...{{/...}}`. The same parser runs when the app shows the text on screen and when the app sends the text to the model. A few functions behave differently in the two cases. For example, `{{comment}}` and `{{file}}` produce visible markup only when the app displays the text. <!-- src/ts/parser/parser.svelte.ts:1602-1692; src/ts/cbs.ts:2110-2119,964-974 -->

CBS runs in these places, among others:

- **Prompt assembly**: While the app builds the request to the model, it parses the following as CBS: the main prompt, the jailbreak, the global note, the author's note, the persona, the description, personality, scenario, and example dialogue, lorebook entries, and the blocks of the prompt template. `{{setvar}}`, `{{addvar}}`, and `{{setdefaultvar}}` write only during this one pass. Suppose a variable write sits in a lorebook entry that the app evaluates several times for other reasons. The write does not fire again and again. <!-- src/ts/process/index.svelte.ts:147,446-1502 -->
- **Chat display**: The app parses the messages of the character again for display. So the CBS output reflects the latest state of the variables, even for older messages. <!-- src/ts/parser/parser.svelte.ts:764-805; src/ts/process/scripts.ts:99-133 -->
- **Regex scripts (lorebook and elsewhere)**: The app always parses the text that a regex script works on as CBS first. The app parses the own pattern of a script as CBS first only if the script has the `<cbs>` flag (or the `cbs` action). The app parses the text again after it replaces a match. See [[Regex-Script]] for details. <!-- src/ts/process/scripts.ts:71-79,133,176-179,248 -->
- **Other places**: Triggers, the input of the translator, the estimate of the tokenizer for chat variables, exported example messages, and slash commands all run through CBS too. <!-- src/ts/process/triggers.ts; src/ts/translator/translator.ts:713; src/ts/tokenizer.ts:403; src/ts/process/exampleMessages.ts:61; src/ts/process/command.ts:52-58 -->

Nested CBS calls share a call-stack counter. An example is `{{call::...}}` that invokes another parsing pass. Another example is a function like `{{personality}}` that parses character text again. At a depth of 20, the parser returns the literal string `ERROR: Call stack limit reached` and does not recurse further. <!-- src/ts/parser/parser.svelte.ts:1667-1671,1816-1834 -->

## Syntax rules

- **The matching of function names is forgiving.** The parser strips whitespace, underscores, and hyphens and lowercases the name before the lookup. So `{{not_equal}}`, `{{NotEqual}}`, and `{{not-equal}}` all resolve to the same function. This is why many functions have aliases that differ only by punctuation. <!-- src/ts/parser/parser.svelte.ts:1120 -->
- **The argument separator.** Arguments are normally separated by `::`. The parser looks at the first colon in the tag. If the character right after it is also a colon, the parser splits the whole tag on `::`. Otherwise it splits on single `:`. Use `::` consistently. If you mix `:` and `::` in the same tag, it does not work as you expect. <!-- src/ts/parser/parser.svelte.ts:1111-1120 -->
- **`{{? expression}}`** is a special case. The parser recognizes it before the colon-splitting rule above. It needs a literal space after `?`. It evaluates the expression as math, with the same evaluator as `{{calc}}`. See [[CBS-Functions]]. <!-- src/ts/parser/parser.svelte.ts:1107-1110 -->
- **The parser leaves unresolved tags alone.** If `{{something}}` does not match any registered function and is not a recognized block, the parser keeps the literal text `{{something}}` in the output. It does not delete the text, and it shows no error. <!-- src/ts/parser/parser.svelte.ts:1835-1838 -->
- **`<char>`, `<user>`, `<bot>`**: The parser rewrites them to `{{char}}`, `{{user}}`, and `{{bot}}` before parsing. So the old angle-bracket syntax still works, but do not use it. See [[HTML-Syntaxes]] for the reason why bare angle brackets are otherwise risky in this context. <!-- src/ts/parser/parser.svelte.ts:1694 -->
- **Nesting depth.** You can nest CBS freely, for example `{{calc::9 + {{getvar::a}} + 1}}`. The scanner supports up to 512 nesting levels. This is far more than any real template needs. Nesting far beyond normal use is not supported. The limit of 20 levels for the call stack, described above, is different. It produces a clear `ERROR:` string. <!-- src/ts/parser/parser.svelte.ts:1648,1667-1671 -->

## Escaping literal braces, parentheses, and colons

The characters `{`, `}`, `(`, `)`, `<`, `>`, `:`, and `;` all have a syntactic meaning somewhere in the rendering of CBS and HTML. So dedicated functions produce them as inert placeholder characters from the Unicode Private Use Area. The placeholders survive further CBS parsing. The app converts them to the real character only when it unescapes the final text for display or for the model request:

| You want | Use |
|---|---|
| `{` | `{{decbo}}` |
| `}` | `{{decbc}}` |
| `{{` | `{{bo}}` |
| `}}` | `{{bc}}` |
| `(` | `{{displayescapedbracketopen}}` / `{{debo}}` / `{{(}}` |
| `)` | `{{displayescapedbracketclose}}` / `{{debc}}` / `{{)}}` |
| `<` | `{{displayescapedanglebracketopen}}` / `{{deabo}}` / `{{<}}` (renders as `&lt;`) |
| `>` | `{{displayescapedanglebracketclose}}` / `{{deabc}}` / `{{>}}` (renders as `&gt;`) |
| `:` | `{{displayescapedcolon}}` / `{{dec}}` / `{{:}}` |
| `;` | `{{displayescapedsemicolon}}` / `{{;}}` |
| a literal newline | `{{br}}` / `{{newline}}` |
| a literal `\n` (backslash-n text, not an actual newline) | `{{cbr}}` / `{{cnl}}` / `{{cnewline}}` (`{{cbr::3}}` does not repeat. It behaves the same as `{{cbr}}` with no argument.) |

<!-- src/ts/cbs.ts:640-647,1374-1475; src/ts/parser/parser.svelte.ts:122-150; src/ts/parser/tests/cbs/escapes.test.ts:81-108 -->

To escape a whole block of text at once, use the `{{#escape}}...{{/escape}}` block instead of individual escape functions. See [[CBS-Blocks]]. RisuAI converts the placeholders back to real characters in its final unescape pass. This pass runs when the app renders chat Markdown for display. It also runs when the app assembles the final message content for the model request. So escaped text is safe to nest inside further CBS. The parser does not interpret it again. <!-- src/ts/parser/parser.svelte.ts:133-150,179; src/ts/process/request/request.ts:218 -->

## Basics

| Syntax | Aliases | Output |
|---|---|---|
| `{{char}}` | `bot` | The nickname (or name) of the current character. For group chats, the group name. In consistent-character or estimation mode, `"botname"`. |
| `{{user}}` | none | The display name of the user (`"username"` in consistent-character mode) |
| `{{personality}}` | `charpersona` | The personality field of the character, itself parsed as CBS |
| `{{description}}` | `chardesc` | The description field of the character, itself parsed as CBS |
| `{{scenario}}` | none | The scenario field of the character, itself parsed as CBS |
| `{{exampledialogue}}` | `examplemessage`, `example_dialogue` | The example dialogue of the character, itself parsed as CBS |
| `{{persona}}` | `userpersona` | The prompt of the active user persona, itself parsed as CBS |
| `{{mainprompt}}` | `systemprompt`, `main_prompt` | The main system prompt, itself parsed as CBS |
| `{{jb}}` | `jailbreak` | The jailbreak prompt, itself parsed as CBS |
| `{{globalnote}}` | `systemnote`, `ujb` | The global note (UJB), itself parsed as CBS |
| `{{authornote}}` | `author_note` | The author's note of the current chat. If it is empty, the default author's note text of the prompt template. |
| `{{blank}}` | `none` | An empty string |
| `{{lorebook}}` | `worldinfo` | A JSON array of every lorebook entry that is active now (character, chat, and module lorebooks). Each entry is a JSON string. |
| `{{history}}` | `messages` | A JSON array of the full chat history including the greeting. Each message is parsed as CBS. |
| `{{history::role}}` | none | The chat history as a plain-text array. Each line has the prefix `role: `. |
| `{{userhistory}}` | `usermessages`, `user_history` | A JSON array of only the messages of the user, each parsed as CBS |
| `{{charhistory}}` | `charmessages`, `char_history` | A JSON array of only the messages of the character, each parsed as CBS |
| `{{previouscharchat}}` | `lastcharmessage` | The nearest earlier message of the character. If there is none, the first message or greeting. |
| `{{previoususerchat}}` | `lastusermessage` | The nearest earlier message of the user. Outside a chat-message context, an empty string. |

<!-- src/ts/cbs.ts:174-196,198-208,259-271,273-285,287-299,301-313,316-323,325-333,384-392,394-402,404-424,445-452,335-350,1500-1527,352-366,368-382,220-235,237-256 -->

For the many other accessors for chats, messages, and the system, see [[CBS-Functions]]. Examples are `{{chatindex}}`, `{{role}}`, `{{model}}`, `{{maxcontext}}`, and the time and date functions. For anything that displays an image, video, or audio, see [[CBS-Assets]].

## Variables

CBS has three kinds of variables. The app reads and writes all of them as plain strings.

### Chat variables: `{{getvar}}` / `{{setvar}}` / `{{addvar}}` / `{{setdefaultvar}}`

The app stores these variables for each chat. So they persist with that specific conversation across sessions. `{{getvar::name}}` returns `"null"` (the string) if nobody ever set the variable. The exception is a default value for that name that the character or a preset defines. Then the function returns the default. Chat variables do not re-render older messages automatically. So if you edit the value that a prompt reads from a variable, already generated text can stay the same until the next generation. <!-- src/ts/parser/chatVar.svelte.ts:17-59; src/ts/cbs.ts:785-852 -->

The writes (`{{setvar}}`, `{{addvar}}`, `{{setdefaultvar}}`) take effect only while the app builds the outgoing prompt for a generation. In all other cases, for example the re-render for display, these three do nothing and give no message. So a tag that writes a variable does not fire each time the app parses the surrounding text again. `{{addvar}}` converts both sides with `Number(...)`. So if you add to a non-numeric variable, the result is `NaN`. <!-- src/ts/cbs.ts:803-852; src/ts/process/index.svelte.ts:147 -->

### Global chat variables: `{{getglobalvar}}` / used through the "set global var" effects of triggers

By default, all characters and chats share these variables. RisuAI also supports **overrides for each chat** of a global variable name. The app uses them when a chat has the **Local Toggles** option on. In that mode, a read or write of a "global" variable reads or writes a copy that belongs to that one chat. It does not use the shared value. Plain `{{getglobalvar::name}}` prefers the override of the chat if one exists. Otherwise it uses the shared value. <!-- src/ts/parser/chatVar.svelte.ts:90-126; src/ts/cbs.ts:854-861 -->

### Temp variables: `{{tempvar}}` / `{{settempvar}}`

These variables exist only during one CBS parsing run, and during the recursive calls that the run makes, for example through `{{call::}}`. The app never persists them. They are useful for intermediate values inside a `{{#func}}`. `{{return::value}}` ends the current parser run at once and yields `value` as the whole result of that run. The parser discards anything else that is queued in the same run. <!-- src/ts/cbs.ts:746-783; src/ts/parser/parser.svelte.ts:1661-1665,1835-1848 -->

### Shortcuts for variables in math expressions

These shortcuts work only inside `{{calc::...}}` and `{{? ...}}` expressions. They do not work in general CBS text. `$name` reads the chat variable `name` as a number. `@name` reads the global chat variable `name` as a number. The parser treats non-numeric values as `0`. For the full syntax of expressions, see [[CBS-Functions]].

## Legacy syntax

These forms still work, so older character cards keep working. New content must not use them:

| Legacy form | Use instead |
|---|---|
| `{#if <a>` on its own line, with a block that ends in `#}` | `{{#when a}}...{{/when}}`. See [[CBS-Blocks]] for the exact truthiness rule of this legacy form, which is different. |
| `{{#if condition}}...{{/if}}` | `{{#when condition}}...{{/when}}` |
| `{{#if_pure condition}}...{{/if_pure}}` | `{{#when::keep::condition}}...{{/when}}` |
| `{{#pure}}...{{/pure}}` | `{{#puredisplay}}...{{/puredisplay}}` |
| `<char>`, `<user>`, `<bot>` | `{{char}}`, `{{user}}`, `{{bot}}` |
| `{{dice::XdY}}` | `{{roll::XdY}}`. The behavior is identical. `roll` is the name that the authors actively maintain. It also has a deterministic sibling, `{{rollp}}`. |

<!-- src/ts/cbs.ts:2361-2381,2430-2439; src/ts/parser/parser.svelte.ts:1161-1183 -->
