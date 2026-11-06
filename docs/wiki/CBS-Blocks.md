# CBS: Block Syntax

This page belongs to [[Curly-Brased-Syntaxes]]. A block wraps a region of text. It can keep the text under a condition, drop it, repeat it, or leave it unparsed. You open a block with `{{#name ...}}`. You close it with the matching `{{/name}}` or with the generic closer `{{/}}`. Both closers work for every block type. <!-- src/ts/parser/parser.svelte.ts:1759-1815 -->

You can nest blocks to any depth. The parser tracks each nesting level on its own stack frame. So the whitespace mode and the parsing mode of an inner block do not leak into the outer block. The exceptions are documented below, for example `#each` and `#when` that interact with `:else`. <!-- src/ts/parser/parser.svelte.ts:1646-1656,1700-1857 -->

## `{{#when}}`: conditional block (preferred)

```
{{#when condition}}...{{/when}}
{{#when::not::condition}}...{{/when}}
```

`{{#when}}` replaced the older `{{#if}}` because it supports operators. A bare condition (no operators) is truthy if it equals `1` or `true`. Anything else is falsy. You can write a single condition with `::` (`{{#when::condition}}`) or with a space and no `::` at all (`{{#when condition}}`). Do not mix a condition in the space form with operators. That does not work. When you use an operator, you must use `::` throughout. <!-- src/ts/parser/parser.svelte.ts:1229-1452 -->

### Operators

The parser combines operators by a walk through the `::`-separated list of arguments from **right to left**. It consumes two-argument operators as `(rightOperand, operator, leftOperand)`. So `and`/`or` chains evaluate from right to left. Mixed chains can give surprising results. For example, `{{#when::a::tis::3::or::b::tis::7}}` evaluates `b::tis::7` before it combines the result with `or`. It does not evaluate `a::tis::3` first. Test long chains of different operators carefully before you rely on them. <!-- src/ts/parser/parser.svelte.ts:1246-1420; src/ts/parser/tests/cbs/conditionals.test.ts:265-281 -->

Comparison and equality operators take the operand to their right and the operand further right as their two sides:

| Operator | Meaning |
|---|---|
| `A::is::B` | `A === B` (string equality) |
| `A::isnot::B` | `A !== B` |
| `A::>::B` | `parseFloat(A) > parseFloat(B)` |
| `A::<::B` | `parseFloat(A) < parseFloat(B)` |
| `A::>=::B` | `parseFloat(A) >= parseFloat(B)` |
| `A::<=::B` | `parseFloat(A) <= parseFloat(B)` |

<!-- src/ts/parser/parser.svelte.ts:1289-1408 -->

Logical operators:

| Operator | Meaning |
|---|---|
| `not::A` | Negates `A` (the truthy check is `A === "1" \|\| A === "true"`) |
| `A::and::B` | Both are truthy |
| `A::or::B` | Either one is truthy |

<!-- src/ts/parser/parser.svelte.ts:1250-1288 -->

Shortcuts for variables and toggles:

| Operator | Meaning |
|---|---|
| `var::name` | Truthy check on the chat variable `name` |
| `toggle::name` | Truthy check on the global chat variable `toggle_name` |
| `A::vis::B` | The value of the chat variable `A` equals the literal `B` |
| `A::visnot::B` | The value of the chat variable `A` does not equal the literal `B` |
| `A::tis::B` | The global toggle variable `A` (that is, `toggle_A`) equals the literal `B` |
| `A::tisnot::B` | The global toggle variable `A` does not equal the literal `B` |

<!-- src/ts/parser/parser.svelte.ts:1309-1368 -->

The whitespace modifiers `keep` and `legacy` (see the next section) can go with any condition. For example, `{{#when::keep::not::condition}}`.

### Whitespace handling

By default, you write `{{#when condition}}` with no `keep` or `legacy`. Then a **truthy** block trims the leading and trailing blank lines of its content. It also strips the leading whitespace of every line, so each line is left-trimmed on its own. A falsy block produces nothing. <!-- src/ts/parser/parser.svelte.ts:1504-1562 -->

| Modifier | Effect |
|---|---|
| `{{#when::keep::condition}}` | Keeps all whitespace exactly as written, including inside `:else` |
| `{{#when::legacy::condition}}` | Falls back to the whitespace handling of `{{#if}}`. It trims the start of the block, the end of the block, and the start of every line. It **does not support `:else`**. |

<!-- src/ts/parser/parser.svelte.ts:1424-1447,1427-1447,1554-1562; src/ts/cbs.ts:2383-2421,2423-2428 -->

### `{{:else}}`

Use `{{:else}}` only inside `{{#when}}`. It does not work in `{{#if}}` or `{{#if_pure}}`, and not with the `legacy` operator. If the block spans one line, `{{:else}}` can appear inline on that line. If the block spans several lines, `{{:else}}` must be alone on its own line, with no other text before or after it on that line. Otherwise the parser does not recognize it as the separator. <!-- src/ts/parser/parser.svelte.ts:1516-1552; src/ts/cbs.ts:2423-2428 -->

```
{{#when condition}}
shown when true
{{:else}}
shown when false
{{/when}}
```

`{{:else}}` also works correctly when the `{{#when}}` is nested inside another `{{#when}}` or inside the body of an `{{#each}}` loop. <!-- src/ts/parser/tests/cbs/conditionals.test.ts:353-376 -->

## `{{#if}}` / `{{#if_pure}}` (deprecated, still supported)

```
{{#if 1}}...{{/if}}
{{#if_pure 1}}...{{/if_pure}}
```

Both blocks are truthy only for a literal `1` or `true` right after the space. The check reads the first token that whitespace delimits, so the parser ignores trailing text after that token. For example, `{{#if 1 because reasons}}` still renders. For anything else, the block is dropped. These blocks exist because `{{#when}}` did not support extra operators when `{{#if}}` was written. They are now deprecated in favor of `{{#when}}` and `{{#when::keep::...}}`. <!-- src/ts/cbs.ts:2361-2381; src/ts/parser/parser.svelte.ts:1216-1227 -->

- `{{#if}}`: It trims whitespace the same way as the default mode of `{{#when}}`. It trims the edges of the block and the leading whitespace of each line. <!-- src/ts/parser/parser.svelte.ts:1504-1505 -->
- `{{#if_pure}}`: It keeps all whitespace exactly. This equals `{{#when::keep::...}}`. <!-- src/ts/parser/parser.svelte.ts:1513-1515 -->
- Neither block supports `{{:else}}`.

## `{{#each}}`: loop over an array

```
{{#each arrayExpr as varName}}...{{slot::varName}}...{{/each}}
{{#each arrayExpr varName}}...{{/each}}          (the "as" keyword can be omitted)
{{#each::keep arrayExpr as varName}}...{{/each}}
```

The parser first evaluates `arrayExpr` as CBS, so `{{getvar::arr}}` and similar tags work. Then it parses the result as JSON. Two cases fall back to a split. In the first case, the result is not valid JSON. In the second case, the result is valid JSON but not an array. Then the parser splits the raw text (after the CBS evaluation) on `§`. If the text has no `§`, the fallback produces an array with one element, which holds the whole expression text. So the body still runs one time, and `{{slot::varName}}` becomes that raw text. The parser does not skip the loop. An empty array produces no output. <!-- src/ts/parser/parser.svelte.ts:1187-1197,1467-1478,1772-1791; src/ts/parser/tests/cbs/loop.test.ts:100-108 -->

Inside the body, the parser replaces `{{slot::varName}}` in each iteration with the current element. If the element is a string, the parser inserts it directly. Otherwise, the parser turns it into a JSON string. So nested arrays and objects round-trip as JSON text. This lets you nest `{{#each}}` over a two-dimensional array. <!-- src/ts/parser/parser.svelte.ts:1772-1791 -->

By default, the block trims its outer whitespace and left-trims each line, the same as the default mode of `{{#when}}`. `{{#each::keep ...}}` keeps everything. `{{#each}}` works correctly inside `{{#when}}` and `{{:else}}`, and the reverse also works. <!-- src/ts/parser/parser.svelte.ts:1507-1512; src/ts/parser/tests/cbs/loop.test.ts:126-151 -->

```
{{#each [1, 2, 3] as n}}{{slot::n}} {{/each}}    → "1 2 3 "
{{#each [] as n}}{{slot::n}}{{/each}}            → ""
```

## `{{#func}}` / `{{call::}}`: reusable snippets

```
{{#func name arg1 arg2}}
  body using {{arg::0}} and {{arg::1}}
{{/func}}
...
{{call::name::value1::value2}}
```

`{{#func name ...argNames}}` stores its body, unparsed, under `name`. You can use the body later in the same CBS run, including in nested recursive calls. A function declaration produces no output by itself. <!-- src/ts/parser/parser.svelte.ts:1479-1485,1792-1799 -->

`{{call::name::arg0::arg1::...}}` replaces `{{arg::0}}`, `{{arg::1}}`, and so on in the stored body with the literal arguments of the call. This is plain string substitution before parsing. It does not pass CBS arguments. Then the parser parses the substituted body again. Calls nest up to a depth of 20. The general CBS recursion limit shares this depth. Past that depth, `{{call::...}}` and any other nested CBS evaluation return `ERROR: Call stack limit reached`. <!-- src/ts/parser/parser.svelte.ts:1667-1671,1816-1834 -->

## `{{#pure}}` (deprecated) / `{{#puredisplay}}`

```
{{#puredisplay}}raw {{content}} shown as-is{{/puredisplay}}
```

The block emits its content completely unparsed, after it trims leading and trailing whitespace. No CBS function inside it is evaluated. `{{#puredisplay}}` also re-escapes any `{{` and `}}` in its content (to `\{\{` and `\}\}`). So a later re-parse of the surrounding text, for example by a display or Markdown pass, does not evaluate the content by accident. `{{#pure}}` is the deprecated predecessor, which the app keeps for backward compatibility. It does not re-escape. So the app can evaluate its content again, and can render it wrongly, if the app parses the text a second time. Prefer `{{#puredisplay}}`. <!-- src/ts/cbs.ts:2430-2445; src/ts/parser/parser.svelte.ts:1499-1503,1800-1803; src/ts/parser/tests/cbs/escapes.test.ts:117-134 -->

## `{{#escape}}`: escape literal braces and parentheses

```
{{#escape}}literal {curly} (parens) text{{/escape}}
{{#escape::keep}}...{{/escape}}
```

The block converts every `{`, `}`, `(`, and `)` inside it into private-use placeholder characters. These characters survive any further CBS parsing as inert text. The app converts them back to plain `{`, `}`, `(`, and `)` only when it unescapes the final text. This happens automatically wherever RisuAI renders the final chat text or assembles the model prompt. See "Escaping and nesting" on [[Curly-Brased-Syntaxes]]. The default mode trims the surrounding whitespace. `{{#escape::keep}}` keeps it. <!-- src/ts/cbs.ts:2447-2457; src/ts/parser/parser.svelte.ts:1462-1466,1593-1594; src/ts/parser/tests/cbs/escapes.test.ts:136-152 -->

## `{{#code}}`: normalize escaped text

```
{{#code}}line1\nline2A{{/code}}
```

The built-in function registry does not document this block. The parser implements it directly. It strips all literal newline and tab characters from the block. Then it unescapes `\uXXXX` sequences and the usual backslash escapes (`\n` `\r` `\t` `\b` `\f` `\v`). Two escapes are broken:
- `\a` outputs a literal `a`. It does not output a bell character.
- `\x` always emits a NUL character (U+0000) and ignores any hex digits after it. For example, `\x41` produces a NUL followed by the literal text `41`. It does not produce `A`.

Use the block to embed a code sample that someone wrote with escaped newlines. <!-- src/ts/parser/parser.svelte.ts:1565-1591 -->

## Legacy single-brace block: `{# ... #}`

The parser still recognizes an older block form. It is hard-coded, so users cannot extend it. It uses single braces instead of double braces:

```
{#if 1
shown only if the condition is 1
#}
```

The parser treats the first line after `{#`, up to the first space, as the keyword. Only `if` is implemented. The condition token is the second word on that first line. It is falsy for `""`, `"0"`, or `"-1"`. Anything else counts as **truthy**, including arbitrary text. This differs from `{{#if}}`, which is truthy only for `1` or `true`. If the keyword does not match `if`, or if parsing fails, the parser leaves the original `{#...#}` text untouched in the output. This form is older than `{{#if}}` and `{{#when}}`. Prefer those two. <!-- src/ts/parser/parser.svelte.ts:1161-1183,1712-1723 -->

## `{{slot}}` and `{{position}}`

- `{{slot::name}}` / `{{slot}}`: A placeholder that the construct that created it consumes. That construct is the loop variable of `{{#each}}` or the content slot of a prompt template. The placeholder has no meaning of its own outside those contexts. <!-- src/ts/cbs.ts:2471-2476 -->
- `{{position::name}}`: Declares a named insertion point. Other features can target it, for example the `@@position <name>` decorator. See [[Prompt-Template]] for how the app consumes positions. <!-- src/ts/cbs.ts:2478-2483 -->
