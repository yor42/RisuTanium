# HTML Syntaxes

The app renders chat text with `html: true`. It keeps the raw HTML tags that you type in a message, description, or first message, and it renders them as real elements next to [[Markdown Syntaxes]]. Before the app shows the result, it runs the result through [DOMPurify](https://github.com/cure53/DOMPurify). DOMPurify removes everything that is unsafe.
<!-- src/ts/parser/parser.svelte.ts:24-30,807-859 -->

```html
<div style="border:1px solid green;padding:2px">Hello World</div>
```

## What the sanitizer changes

DOMPurify runs with its normal safe allow-list. It always removes `<script>`, `on*` event-handler attributes, and `javascript:` URLs. The app adds a few Risu-specific allowances and hooks:
<!-- src/ts/parser/parser.svelte.ts:807-810 -->

- **Links (`href`)**: The app keeps only `http://` and `https://` links. It forces them to open in a new tab (`target="_blank"`). For any other scheme, for example `javascript:` or `data:`, the app removes the `href` completely.
  <!-- src/ts/parser/parser.svelte.ts:102-109 -->
- **`<iframe>`**: The app allows an iframe only if its `src` starts with `https://www.youtube.com/embed/`. The app removes every other iframe. This is the only way to embed external content.
  <!-- src/ts/parser/parser.svelte.ts:46-52 -->
- **`class` attributes**: The app adds the prefix `x-risu-` to every class name that you write. For example, `class="box"` becomes `class="x-risu-box"`. The classes `hljs*` of highlight.js are the exception. The prefix stops the classes of cards and messages from colliding with the UI classes of the app or overriding them. The app adds the same prefix to your own `<style>` rules (see below). So the prefix is invisible to you if you style only with a `<style>` block in the same message.
  <!-- src/ts/parser/parser.svelte.ts:88-101,969-987 -->
- **`blob:` sources**: `<img>`, `<source>`, `<video>`, `<audio>`, and `<style>` can keep a `blob:` URL as `src`. The app uses these URLs for assets that it generates locally or inlays. Without this rule, DOMPurify can drop them.
  <!-- src/ts/parser/parser.svelte.ts:113-119 -->
- **Images**: If `loading` and `decoding` are not set, the app adds `loading="lazy" decoding="async"` to `<img>`.
  <!-- src/ts/parser/parser.svelte.ts:65-72 -->
- **"Hide All Images" setting**: When this setting is on, the app replaces the source of `<img>` with a local placeholder (`/none.webp`). The exception is the tiny built-in transparent GIF. The app also removes the `background-image` property and the `background: url(...)` property from any inline `style`.
  <!-- src/ts/parser/parser.svelte.ts:53-63,76-87; src/lang/en.ts:283,1031 -->

All other markup follows the normal safe HTML rules of the browser. Standard tags such as `<div>`, `<span>`, `<img>`, `<video>`, `<audio>`, `<details>`/`<summary>`, and `<table>` are allowed. `<script>` and inline event handlers never survive.

## `<style>` blocks are scoped automatically

You can put a `<style>` tag directly in your message or description. The app rewrites it, so it can affect only the chat text container and never the rest of the app:

```html
<style>.mybox { color: red; }</style>
<div class="mybox">hello</div>
```

The result is roughly this:

```html
<style>.chattext .x-risu-mybox{color:red}</style><div class="x-risu-mybox">hello</div>
```

The app puts the prefix `.chattext` before every selector. Every class inside the selector gets the same `x-risu-` prefix as the `class` attribute of your element. Your CSS still targets your own elements, and you do not write the prefix yourself.
<!-- src/ts/parser/parser.svelte.ts:960-999; src/ts/parser/tests/trimMarkdownStyle.test.ts:71-75 -->

- The app scopes `@media`, `@supports`, `@document`, `@host`, and `@container` blocks the same way, recursively.
  <!-- src/ts/parser/parser.svelte.ts:989-993 -->
- The app neutralizes `@import url("data:...")`. It rewrites the import to an empty data URI. A style block cannot smuggle in a data-URI import.
  <!-- src/ts/parser/parser.svelte.ts:994-998 -->
- The app drops CSS that does not parse. A CSS string can hide markup or text that closes the `<style>` tag, for example `content: "</style><img onerror=...>"`. This text cannot re-enter the page as HTML. It stays inert text.
  <!-- src/ts/parser/parser.svelte.ts:807-859; src/ts/parser/tests/trimMarkdownStyle.test.ts:101-157 -->
- **"Return CSS Error" setting**: If your CSS does not parse, the app normally drops it without a message. When this setting is on, the app shows `CSS ERROR: ...` in place of the style. This helps while you debug a card.
  <!-- src/ts/parser/parser.svelte.ts:1026-1031; src/lang/en.ts:1465 -->

## Risu-specific attributes

These attributes are not standard HTML. The sanitizer explicitly allows them, because the app listens for them:
<!-- src/ts/parser/parser.svelte.ts:809 -->

- **`risu-ctrl="bgm___<volume>___<url>"`**: On any element, this plays or switches background music. `<volume>` is `auto` (the default is 0.5) or a number. If you change the URL, the app swaps the track that plays now.
  <!-- src/ts/observer.svelte.ts:26,76-102 -->
- **`risu-trigger="<name>"`** (optionally with `risu-id="<id>"`) and **`risu-btn="<event>"`**: These turn any clickable element into a button. A click runs a manual [[Regex Script]] or trigger, or a Lua button handler. The trigger and event names come from the trigger or Lua setup of your character. To learn how to define them, see [[Regex Script]].
  <!-- src/lib/ChatScreens/Chat.svelte:332-372 -->
- **`x-hl-lang`**: This marks a rendered code block with its language. It turns on the right-click copy and download menu that [[Markdown Syntaxes]] describes. You normally get it from a fenced code block. Do not write it by hand.
  <!-- src/ts/observer.svelte.ts:26-73 -->
- **`risu-mark="quote1"/"quote2"/"blockquote1"/"blockquote2"`**: The smart-quote renderer adds this automatically to color dialogue text. See [[Markdown Syntaxes]]. Do not write it by hand.
  <!-- src/ts/parser/parser.svelte.ts:187-200; src/styles.css:281-303 -->

## Images, video, and audio

Standard `<img>`, `<video>`, and `<audio>` tags work directly. Most cards embed images, video, audio, and backgrounds with the `{{img::...}}`, `{{video::...}}`, `{{audio::...}}`, and `{{bg::...}}` family of [[Curly Brased Syntaxes]]. These functions turn the name of an uploaded asset of the character into a real `src`, and they emit the right tag for you. For the full list of asset functions, see that page.
<!-- src/ts/parser/parser.svelte.ts:408-609 -->

## Model "thinking" and tool tags (not authored HTML)

The app recognizes two pseudo-tags in raw model output. It does so before Markdown and sanitization run. A user does not type them.

- The app converts `<Thoughts>...</Thoughts>` into a collapsible `<details><summary>Chain of Thoughts</summary>...</details>` block.
  <!-- src/ts/parser/parser.svelte.ts:741-756; src/lang/en.ts:1091 -->
- The app converts `<tool_call>...</tool_call>` into a small "Tool '&lt;name&gt;' Called" notice.
  <!-- src/ts/parser/parser.svelte.ts:759-761; src/lang/en.ts:1546 -->

## Where full HTML is not available

Some places outside the chat render a deliberately smaller subset of HTML instead of the full pipeline above. For example, the export of a chat to HTML removes `<a>` and `<style>` completely. It also drops the `style`, `href`, and `class` attributes.
<!-- src/ts/parser/parser.svelte.ts:950-957; src/ts/characters.ts:219-220 -->

## See also

- [[Markdown Syntaxes]]: Markdown rendering, code blocks, quotes, and math.
- [[Curly Brased Syntaxes]]: The `{{...}}` macros, including the embedding of assets and images.
- [W3Schools HTML](https://www.w3schools.com/html/default.asp) and [MDN Web Docs](https://developer.mozilla.org/): General references for HTML and CSS.
