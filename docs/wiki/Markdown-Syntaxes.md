# Markdown Syntaxes

The app renders chat text with [markdown-it](https://github.com/markdown-it/markdown-it) and then sanitizes it. Chat text includes messages, the first message, and example messages. You can also write raw HTML in the same text. See [[HTML Syntaxes]]. The app expands [[Curly Brased Syntaxes]] (`{{...}}`) before Markdown runs.
<!-- src/ts/parser/parser.svelte.ts:764-805 -->

The renderer uses these options:

- `html: true`: The renderer keeps inline HTML tags. It does not escape them.
- `breaks: true`: A single newline becomes `<br>`. You do not need a blank line to break a paragraph.
- `linkify: false`: The renderer does not turn bare URLs into links. Use `[text](https://example.com)`.
- `typographer: true`: This turns on the smart-quote handling that the section below describes.
- The rule for indented code blocks is off. A line that you indent by 4 spaces does not create a code block. Only fenced code blocks work.
<!-- src/ts/parser/parser.svelte.ts:24-30,43-44 -->

## Basic syntax

```
*italic*        **bold**        ***bold italic***      ~~strikethrough~~
# Heading 1     ## Heading 2 ... ###### Heading 6
- list item
1. numbered item
> blockquote
---             (horizontal rule)
[link](https://example.com)
![alt text](https://example.com/image.png)
```

These forms come from the default rule set of markdown-it (CommonMark and GFM). The app loads no extra plugin. The app does not turn on any form that this page does not list, for example task-list checkboxes or footnotes.
<!-- src/ts/parser/parser.svelte.ts:1-2,24-44 -->

### Tables

GFM-style tables work without extra setup:

```
| Name | Age |
|------|-----|
| Hana | 20  |
```
<!-- src/ts/parser/parser.svelte.ts:43-44 -->

## Code blocks

The renderer shows only fenced code blocks as code. It does not show indented code as code:

````
```js
console.log("hello");
```
````

If you write a language after the opening fence, the app highlights the block with highlight.js. The app knows these language tags (aliases are in parentheses):
`bash`, `c`/`cpp`, `cs`/`csharp`, `css`, `dart`, `html`/`svg`/`xml`, `java`, `js`/`jsx`/`javascript`, `json`, `lua`, `markdown`/`md`, `py`/`python`, `rust`, `shell`, `ts`/`tsx`/`typescript`, `txt`/`vtt` (shown as plain text), `yaml`.
For any other language tag, the app shows a `<pre><code>` block without highlighting.
<!-- src/ts/parser/parser.svelte.ts:206-397 -->

The language tag `risuerror` is special. It shows the block as an error box in the chat instead of code. The app uses it internally to show parser and rendering errors. Do not write it by hand.
<!-- src/ts/parser/parser.svelte.ts:373-377,389-391 -->

If you right-click a rendered code block, a context menu opens with **Copy** and **Download**. The file extension of the download matches the language tag.
<!-- src/ts/observer.svelte.ts:26-73 -->

## Smart quotes and dialogue coloring

The app does not leave straight double quotes (`"..."`) and single quotes (`'...'`) as they are. It converts them to typographic quotes. By default, it also colors and marks them, so that dialogue stands out from narration. It uses `<mark risu-mark="quote1">` and `quote2` for this.
<!-- src/ts/parser/parser.svelte.ts:152-204; src/styles.css:281-289 -->

These display settings control the behavior:
- **Custom Quotes**: You pick which quote glyphs the app uses instead of the default `“ ” ‘ ’`.
- **Disable Quote Formatting**: The app stops coloring and marking quotes. It outputs the chosen quote glyphs as plain text.
- **Blockquote Styling**: When on, a `"..."` that stands on its own turns into a highlighted block with a left border, like a blockquote. A `'...'` still appears as inline colored text.
<!-- src/ts/parser/parser.svelte.ts:181-201; src/lang/en.ts:1282,1307,1663 -->

## Math

`$$formula$$` renders inline LaTeX with [KaTeX](https://katex.org/). The output is MathML. It is not display (block) mode, so it stays inline in the paragraph. If the formula does not parse, the app leaves the raw `$$formula$$` text as it is. It does not show an error.
<!-- src/ts/parser/parser.svelte.ts:157-178 -->

```
The area is $$\pi r^2$$.
```

## Legacy

- Raw HTML tags work directly inside chat text. See [[HTML Syntaxes]]. You do not need to escape `<` or `>`.
- `<user>`, `<char>`, and `<bot>` are not real HTML. They are literal angle-bracket "tags". The app rewrites them to `{{user}}`, `{{char}}`, and `{{bot}}` before Markdown runs. See [[Curly Brased Syntaxes]].
<!-- src/ts/parser/parser.svelte.ts:1694 -->

## See also

- [[HTML Syntaxes]]: Which raw HTML and CSS the app allows, and how it sanitizes them.
- [[Curly Brased Syntaxes]]: The `{{...}}` macros. They include the asset and image functions that generate `<img>`, `<video>`, and `<audio>` tags.
- [[@ Syntaxes]]: The prompt and regex decorators that start with `@@`.
