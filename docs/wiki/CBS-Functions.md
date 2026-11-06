# CBS: Function Reference

This page belongs to [[Curly-Brased-Syntaxes]]. It lists every general-purpose CBS function that is not a [[block|CBS Blocks]] and not an [[asset/media|CBS Assets]] function. Unless noted otherwise, `::` separates arguments, and every function returns a plain string. Booleans are the strings `"1"` and `"0"`.

The parser matches function names without regard to case. It strips spaces, underscores, and hyphens. So `{{not_equal}}`, `{{NotEqual}}`, and `{{not equal}}` all call the same function. <!-- src/ts/parser/parser.svelte.ts:1120 -->

## Comparison and logic

| Syntax | Aliases | Result |
|---|---|---|
| `{{equal::a::b}}` | none | `1` if `a === b` (string comparison), otherwise `0` |
| `{{notequal::a::b}}` | `not_equal` | `1` if `a !== b` |
| `{{greater::a::b}}` | none | `1` if `Number(a) > Number(b)` |
| `{{less::a::b}}` | none | `1` if `Number(a) < Number(b)` |
| `{{greaterequal::a::b}}` | `greater_equal` | `1` if `Number(a) >= Number(b)` |
| `{{lessequal::a::b}}` | `less_equal` | `1` if `Number(a) <= Number(b)` |
| `{{and::a::b}}` | none | `1` only if both `a` and `b` are exactly `"1"` |
| `{{or::a::b}}` | none | `1` if either `a` or `b` is exactly `"1"` |
| `{{not::a}}` | none | `0` if `a` is `"1"`, otherwise `1` |
| `{{iserror::a}}` | none | `1` if `a` starts with `error:` (case-insensitive) |

<!-- src/ts/cbs.ts:883-890,892-899,901-908,910-917,919-926,928-935,937-944,946-953,955-962,1922-1929 -->

Here, `and`, `or`, and `not` are strict comparisons of two string values against `"1"`. The operator chain inside `{{#when}}` is different. See [[CBS-Blocks]]. It is more forgiving about truthy values (`"1"` or `"true"`).

## Strings

| Syntax | Aliases | Result |
|---|---|---|
| `{{startswith::str::sub}}` | none | `1` or `0`, case-sensitive |
| `{{endswith::str::sub}}` | none | `1` or `0`, case-sensitive |
| `{{contains::str::sub}}` | none | `1` or `0`, case-sensitive |
| `{{replace::str::search::replacement}}` | none | All occurrences of `search` replaced |
| `{{split::str::delimiter}}` | none | A JSON array of the pieces |
| `{{join::jsonArray::sep}}` | none | Joins a JSON array into one string |
| `{{spread::jsonArray}}` | none | Joins a JSON array with `::`. This helps you feed the argument list of another CBS function. |
| `{{trim::str}}` | none | Removes leading and trailing whitespace only |
| `{{length::str}}` | none | The length of the string |
| `{{lower::str}}` | none | Lowercase that follows the locale |
| `{{upper::str}}` | none | Uppercase that follows the locale |
| `{{capitalize::str}}` | none | Uppercases only the first character |
| `{{reverse::str}}` | none | Reverses by Unicode code point (`[...str].reverse()`), not by grapheme cluster. A single-code-point emoji survives. A cluster of several code points comes out visually broken, because nothing treats grapheme clusters as a special case. Examples are a ZWJ family emoji, and a base character plus combining marks. Card authors use it to lightly obfuscate spoilers in a description. If you apply it again, it restores the text (code point by code point). For something less readable at a glance, see `{{xor}}` (XOR + base64, reversed by `{{xordecrypt}}`) or `{{crypt}}`. None of these is encryption. |
| `{{unicodeencode::str[::index]}}` | `unicode_encode` | The char code (decimal) of the character at `index` (default `0`) |
| `{{unicodedecode::code}}` | `unicode_decode` | The character for a decimal char code |
| `{{u::hex}}` | `unicodedecodefromhex` | The character for a **hex** char code |
| `{{ue::hex}}` | `unicodeencodefromhex` | The same as `{{u}}`. The name is misleading, because it also decodes. |
| `{{tonumber::str}}` | none | Strips everything except digits `0-9` and `.` |

<!-- src/ts/cbs.ts:977-984,986-993,995-1002,1004-1011,1013-1020,1022-1029,1031-1038,1040-1047,1049-1056,1068-1075,1077-1084,1086-1093,2101-2108,1752-1759,1761-1768,1770-1777,1779-1786,1150-1159; src/ts/parser/tests/cbs/strings.test.ts:155-168 -->

## Math

| Syntax | Aliases | Result |
|---|---|---|
| `{{calc::expression}}` | none | Evaluates a math expression. See **Calc expressions** below. |
| `{{? expression}}` | none | The same evaluator as `{{calc}}`, but written with a literal space instead of `::`. You must write `{{? ` with the space. |
| `{{round::n}}` | none | Rounds to the nearest integer |
| `{{floor::n}}` | none | Rounds down |
| `{{ceil::n}}` | none | Rounds up |
| `{{abs::n}}` | none | The absolute value |
| `{{remaind::a::b}}` | none | `a % b` |
| `{{pow::base::exp}}` | none | `base ** exp` |
| `{{fixnum::n::digits}}` | `fixnumber` | `n` fixed to `digits` decimal places |
| `{{min::a::b::...}}` or `{{min::jsonArray}}` | none | The smallest value. Non-numeric items count as `0`. |
| `{{max::a::b::...}}` or `{{max::jsonArray}}` | none | The largest value. Non-numeric items count as `0`. |
| `{{sum::a::b::...}}` or `{{sum::jsonArray}}` | none | The sum of all values |
| `{{average::a::b::...}}` or `{{average::jsonArray}}` | none | The arithmetic mean |
| `{{fromhex::hex}}` | none | Hex string to decimal number |
| `{{tohex::n}}` | none | Decimal number to hex string |

<!-- src/ts/cbs.ts:794-801,2245-2250,1095-1102,1104-1111,1113-1120,1122-1129,1131-1138,1161-1168,1743-1750,1678-1692,1694-1708,1710-1724,1726-1741,1830-1837,1839-1846; src/ts/parser/parser.svelte.ts:1107-1110 -->

For `min`, `max`, `sum`, and `average`: If you give more than one argument, the function treats all arguments as the list of values. If you give exactly one argument, the function parses it as a JSON array instead.

### Calc expressions (`{{calc}}` / `{{? }}`)

`{{calc}}` and `{{? }}` share the expression evaluator. It supports these operators, in this order of precedence from low to high:
1. `<` `>` `|` (or) `&` (and) `<=` `>=` `==` `!=`
2. `+` `-`
3. `*` `/` `%`
4. `^` (power)
5. The unary `!` (not)

Parentheses `()` group sub-expressions, and the evaluator evaluates them first. It treats `null` (case-insensitive) as `0`. Comparison and boolean operators produce `1` or `0`. A bare `$name` reads the chat variable `name` as a number (`0` if it is not numeric). `@name` reads a global chat variable the same way. <!-- src/ts/process/infunctions.ts:1-160 -->

```
{{calc::2+2*3}}        → 8
{{calc::(2+2)*3}}      → 12
{{calc::$hp <= 0}}     → 1 if chat var "hp" is 0 or less
{{? 10 % 3}}           → 1
```

## Random, dice, and hashing

| Syntax | Aliases | Result |
|---|---|---|
| `{{random}}` | none | A random float from `0` to `1` |
| `{{random::a,b,c}}` | none | A random element. The function first tries a single argument as a JSON array (`[...]`). Otherwise it splits the argument on `,` and `:`. Use `\,` to escape a literal comma. |
| `{{random::a::b::c}}` | none | With 2 or more arguments, it picks one of the arguments themselves at random. |
| `{{pick}}` / `{{pick::a,b,c}}` | none | The same handling of arguments as `{{random}}`, but deterministic. The "random" value is a hash of the message count of the chat and the character and chat id. So the same message position always picks the same element. |
| `{{randint::min::max}}` | none | A random integer, including both ends. The result is `"NaN"` if either bound is not a number. |
| `{{roll::XdY}}` | none | The sum of the roll of `X` dice with `Y` sides (default `1d6` if you give no argument) |
| `{{rollp::XdY}}` | `rollpick` | The same as `{{roll}}`, but deterministic (hash-based, like `{{pick}}`) |
| `{{dice::XdY}}` | none | The same computation as `{{roll}}`. It is a separate, older function. |
| `{{hash::str}}` | none | A deterministic 7-digit number that the function derives from the string |

<!-- src/ts/cbs.ts:1988-2016,2018-2028,1797-1809,2030-2057,2059-2090,1811-1828,1788-1795 -->

## Time and date

| Syntax | Aliases | Result |
|---|---|---|
| `{{time}}` | none | The current local time as `H:M:S` (not zero-padded) |
| `{{time::format}}` / `{{time::format::unixtimeMs}}` | none | Formats a custom pattern (see below). With a second argument, it formats that Unix time in **milliseconds** instead of the current time. |
| `{{date}}` | none | The current local date as `YYYY-M-D` (not zero-padded) |
| `{{date::format}}` / `{{date::format::unixtimeMs}}` | `datetimeformat` | The same custom formatting as `{{time::format}}` |
| `{{isotime}}` | none | The current UTC time as `H:M:S` |
| `{{isodate}}` | none | The current UTC date as `YYYY-M-D` |
| `{{unixtime}}` | none | The current Unix time in **seconds** |
| `{{messagetime}}` | `message_time` | The local time at which someone sent the current message. For old messages and tokenization contexts, an explanatory `[Cannot get time...]` string. |
| `{{messagedate}}` | `message_date` | The local date on which someone sent the current message (the same fallbacks as above) |
| `{{messageunixtimearray}}` | `message_unixtime_array` | A JSON array of the Unix time of every message in **milliseconds** (`0` if missing) |
| `{{idleduration}}` | `idle_duration` | `H:MM:SS` since the last message of the chat |
| `{{messageidleduration}}` | `message_idle_duration` | `H:MM:SS` between the current **user** message and the previous one |

<!-- src/ts/cbs.ts:1570-1590,1548-1568,529-537,539-547,509-517,454-474,476-495,497-507,605-638,550-603 -->

### Custom format tokens (`{{date::...}}` / `{{time::...}}`)

The tokens are: `YYYY` `YY` `MMMM` `MMM` `MM` `DDDD` (day of year) `DD` `dddd` `ddd` `HH` (24h) `hh` (12h) `mm` `ss` `X` (Unix seconds) `x` (Unix ms) `A` (AM/PM). The parser strips a leading `:` in the format string. A format string longer than 300 characters returns an empty string. <!-- src/ts/parser/parser.svelte.ts:1130-1159 -->

## Arrays and dictionaries

Arrays and dictionaries are plain JSON text (`["a","b"]`, `{"k":"v"}`). Invalid JSON parses to `[]` or `{}`. <!-- src/ts/cbs.ts:17-24 -->

| Syntax | Aliases | Result |
|---|---|---|
| `{{makearray::a::b::c}}` | `array`, `a`, `makearray` | Builds `["a","b","c"]` from the arguments |
| `{{makedict::k1=v1::k2=v2}}` | `dict`, `d`, `makeobject`, `object`, `o` | Builds `{"k1":"v1","k2":"v2"}`. The function skips an argument that has no `=`. |
| `{{arraylength::jsonArray}}` | none | The number of elements |
| `{{arrayelement::jsonArray::i}}` | none | The element at index `i` (0-based). `"null"` if the index is out of range. The function serializes objects to JSON again. |
| `{{dictelement::jsonObject::key}}` | `objectelement` | The value at `key`. `"null"` if it is missing. |
| `{{element::json::key1::key2::...}}` | `ele` | Walks nested keys and indices one at a time. `"null"` on any failure (a missing key, or a non-object). |
| `{{objectassert::jsonObject::key::value}}` | `dictassert`, `object_assert` | Sets `key` only if it is falsy now. Returns the whole object. |
| `{{arrayshift::jsonArray}}` | none | Removes the first element and returns the rest |
| `{{arraypop::jsonArray}}` | none | Removes the last element and returns the rest |
| `{{arraypush::jsonArray::value}}` | none | Appends `value` and returns the whole array |
| `{{arraysplice::jsonArray::start::deleteCount::value}}` | none | Splices in `value` at `start`, after it removes `deleteCount` elements. Returns the whole array. |
| `{{arrayassert::jsonArray::index::value}}` | none | Sets `index` to `value` only if `index` is out of bounds now. This extends the array and leaves holes. |
| `{{range::[n]}}` / `{{range::[start,end]}}` / `{{range::[start,end,step]}}` | none | Builds a JSON array of a numeric sequence. Note that the argument is itself a JSON array literal. |
| `{{filter::jsonArray::mode}}` | none | `mode` is `all` (the default, which drops empty strings **and** duplicates), `nonempty`, or `unique`. |
| `{{all::a::b::...}}` or `{{all::jsonArray}}` | none | `1` if every value is `"1"` |
| `{{any::a::b::...}}` or `{{any::jsonArray}}` | none | `1` if any value is `"1"` |

<!-- src/ts/cbs.ts:1286-1293,1295-1313,1059-1066,1170-1178,1180-1188,1203-1226,1190-1201,1228-1237,1239-1248,1250-1259,1261-1270,1272-1284,1529-1546,1624-1650,1652-1663,1665-1676 -->

## Variables

For the full explanation of chat, global, and temp variables, see the "Variables" section on [[Curly-Brased-Syntaxes]]. This is a quick reference:

| Syntax | Aliases | Notes |
|---|---|---|
| `{{getvar::name}}` | none | Reads a persistent chat variable (`"null"` if it is unset) |
| `{{setvar::name::value}}` | none | Writes a persistent chat variable. It takes effect only while the app builds the outgoing prompt for a generation. In other places, it does nothing. |
| `{{addvar::name::amount}}` | none | Adds a number to a persistent chat variable. It has the same restriction as `setvar`. |
| `{{setdefaultvar::name::value}}` | none | Like `setvar`, but only if the variable is unset, empty, or `"null"` now. It has the same restriction. |
| `{{getglobalvar::name}}` | none | Reads a global chat variable (shared across characters and chats) |
| `{{tempvar::name}}` | `gettempvar` | Reads a temp variable (limited to the script execution, not persisted) |
| `{{settempvar::name::value}}` | none | Writes a temp variable |
| `{{return::value}}` | none | Ends the current parser run at once and yields `value` as the final result |

<!-- src/ts/cbs.ts:785-792,819-833,803-817,835-852,854-861,746-756,758-769,771-783 -->

## Formatting helpers

| Syntax | Result |
|---|---|
| `{{tex::expr}}` (aliases `latex`, `katex`) | Wraps `expr` in `$$...$$` for KaTeX rendering |
| `{{ruby::base::reading}}` (alias `furigana`) | `<ruby>` markup for furigana or ruby text |
| `{{codeblock::code}}` / `{{codeblock::lang::code}}` | A `<pre><code>` block. When you give a language, a highlighted code block. |
| `{{comment::text}}` | Shows `text` in a `.risu-comment` div **only while the app displays it**. It resolves to an empty string when the app parses the text for the model request. |
| `{{//  anything}}` | A comment. The parser removes the whole `{{// ...}}` tag, including the leading `//`. Unlike `{{comment}}`, it never displays. |
| `{{button::label::triggerId}}` | An HTML button (`risu-trigger="triggerId"`) that fires a manual trigger when you click it |
| `{{risu}}` / `{{risu::sizePx}}` | The Risu logo image, default 45px |
| `{{file::name::base64}}` | While the app displays the text: a `.risu-file` div that shows `name`. Otherwise: decodes `base64` as UTF-8 text. |
| `{{bkspc}}` | Deletes back to the previous whitespace in the text that this parser run generated so far (word-level backspace) |
| `{{erase}}` | Deletes back to the previous sentence-ending punctuation (`.`, `!`, `?`, newline) in the text that this run generated so far |
| `{{declare::name}}` | Marks a flag for `name`. Nothing reads it back now, so it has no visible effect. |

<!-- src/ts/cbs.ts:2122-2129,2131-2138,2140-2157,2110-2119,2238-2243,863-870,872-880,964-974,2160-2190,2192-2226,2228-2236 -->

`{{bkspc}}` and `{{erase}}` work only on text that an earlier step of the *same* CBS run produced. An example is the edit of the own message of the character during a display or output regex pass. They cannot reach outside the current parse.

## Encoding / obfuscation

| Syntax | Aliases | Result |
|---|---|---|
| `{{xor::str}}` | `xorencrypt`, `xorencode`, `xore` | XORs each byte with `0xFF` and base64-encodes the result |
| `{{xordecrypt::base64}}` | `xordecode`, `xord` | Reverses `{{xor}}` |
| `{{crypt::str[::shift]}}` | `crypto`, `caesar`, `encrypt`, `decrypt` | Caesar-shifts UTF-16 code units by `shift` (default `32768`, which is its own inverse). So the default shift both encrypts and decrypts. |

<!-- src/ts/cbs.ts:1932-1943,1945-1956,1958-1983 -->

These functions are light obfuscation. They are not real security. Do not rely on them to hide anything from a user who is determined.

### Example: keep a spoiler out of sight in a character description

A description often holds a twist that the user must not read by accident. For example, the user opens the character to fix a typo somewhere else. You can store that part in encoded form. The editor then shows only an unreadable string, and the model still gets the plain text. The app runs the description through CBS each time it builds the prompt.

1. Open **Playground → Syntax**. It runs CBS on whatever you type, in a sandbox.
2. Type the secret part, wrapped in `{{xor::…}}`:

   ```
   {{xor::hello}}
   ```

   The Result box shows the encoded text, here `l5qTk5A=`.
3. Copy the result. Put only the decoding call in the description of the character:

   ```
   {{char}} is a travelling merchant. {{xordecrypt::l5qTk5A=}}
   ```

   When the app builds the prompt, the model reads `hello` in place of the call. A person who looks at the description sees only `l5qTk5A=`.

`{{reverse::…}}` works the same way. Encode in the Playground, then put `{{reverse::<reversed text>}}` in the description. It is easier to read by eye. But the reversed text must not contain `::`, `{{`, or `}}`, because the parser reads those as CBS syntax. XOR output is base64 (letters, digits, `+`, `/`, `=`), so it has no such problem. Keep CBS tags such as `{{user}}` out of the encoded part, and write them outside it.

Anyone can paste the string back into the Playground and decode it. This keeps a user from a spoiler by accident. It does not stop a user who goes looking.

## System, model, and app metadata

| Syntax | Aliases | Result |
|---|---|---|
| `{{model}}` | none | The id or name of the current chat model |
| `{{axmodel}}` | none | The id of the current auxiliary or sub model |
| `{{maxcontext}}` | none | The configured length of the max context |
| `{{jbtoggled}}` | none | `1` or `0`: whether the jailbreak prompt is enabled |
| `{{prefillsupported}}` | `prefill_supported`, `prefill` | `1` if the model id starts with `claude` |
| `{{screenwidth}}` | `screen_width` | The current width of the browser window in pixels |
| `{{screenheight}}` | `screen_height` | The current height of the browser window in pixels |
| `{{moduleenabled::namespace}}` | `module_enabled` | `1` or `0`: whether a module with that namespace is active |
| `{{metadata::key}}` | none | See the table below. |

<!-- src/ts/cbs.ts:649-657,659-667,709-717,699-707,1346-1354,1356-1363,1365-1372,1592-1605,1848-1920 -->

The keys of `{{metadata::key}}` (case-insensitive) are: `mobile`, `local` (desktop or Tauri build), `node` (self-hosted Node server), `version`, `majorversion`/`majorver`/`major`, `language`/`locale`/`lang` (language of the app), `browserlanguage`/`browserlocale`/`browserlang`, `modelshortname`, `modelname`, `modelinternalid`, `modelformat`, `modelprovider`, `modeltokenizer`, `risutype` (`local`, `node`, or `web`), `maxcontext`, and the joke key `imateapot` (🫖). An unrecognized key returns `Error: <key> is not a valid metadata key.`. <!-- src/ts/cbs.ts:1848-1920 -->

## Chat/character context

| Syntax | Aliases | Result |
|---|---|---|
| `{{chatindex}}` | `chat_index` | The index of the current message. `-1` if there is none (for example the first message). |
| `{{firstmsgindex}}` | `firstmessageindex`, `first_msg_index` | The index of the selected alternate greeting. `-1` for the default first message. |
| `{{role}}` | none | `"user"`, `"char"`, or `"system"` for the current message context |
| `{{isfirstmsg}}` | `isfirstmessage` | `1` or `0` |
| `{{lastmessage}}` | none | The content of the last message of the chat (any role) |
| `{{lastmessageid}}` | `lastmessageindex` | The index of the last message of the chat |
| `{{previouschatlog::i}}` | `previous_chat_log` | The content of message `i`. `"Out of range"` if the index is invalid. |
| `{{trigger_id}}` | `triggerid` | The value of the `risu-id` attribute on the element that triggered the click of a manual trigger. `"null"` if there is none. |
| `{{hiddenkey::anything}}` | none | Always an empty string. A lorebook or keyword scanner sees the argument text as an activation key, but it does not appear in the model request. |

<!-- src/ts/cbs.ts:426-433,435-443,669-685,687-697,719-730,732-743,1140-1148,210-218,2092-2099 -->

For the accessors of character and prompt text (`{{char}}`, `{{description}}`, `{{lorebook}}`, `{{history}}`, and so on), see [[Curly-Brased-Syntaxes]]. For `#if`, `#when`, `#each`, and the other blocks, see [[CBS-Blocks]].
