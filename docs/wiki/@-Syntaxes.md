# @ Syntax

The syntax that starts with `@` has no relation to Markdown, HTML, or [[Curly Brased Syntaxes]]. Each form below has an effect in one specific place in the app.

## Prompt role decorators

You can use these decorators in the **Main Prompt**, the **Jailbreak Prompt**, and the **Global Note**. Start a line with `@@system`, `@@user`, or `@@assistant` to give the text after it a chat role. Three `@` characters also work, for example `@@@system`. The app sends everything up to the next role marker, or to the end of the text, with that role.
<!-- src/ts/process/index.svelte.ts:423-453 -->

```
@@system
Assistant must act as SomeThing, and must follow the rules.
@@assistant
Ok, I understand, here is the output:
```

If the text does not start with `@@`, the app treats all of it as the `system` role.
<!-- src/ts/process/index.svelte.ts:428-429 -->

The decorators apply only when the character does not use a [[Prompt Template]] and is not a Utility Bot. With a Prompt Template, each prompt block has its own role in the template. In that case, the app does not read this text-based syntax.
<!-- src/ts/process/index.svelte.ts:375-453 -->

### `@@system` / `@@@system`
Marks the text after it as the `system` role.

### `@@assistant` / `@@@assistant`
Marks the text after it as the `assistant` role.

### `@@user` / `@@@user`
Marks the text after it as the `user` role.

## Regex Script effects

You write these decorators as the **output** of a [[Regex Script]] entry. They change what the script does. They can replace the normal text substitution, or add to it. To learn how to create and run scripts, see [[Regex Script]]. This page documents only the `@@` decorators.
<!-- src/ts/process/scripts.ts:160-289 -->

### `@@emo <name>`
When the pattern of the script matches, the app adds `<name>` to the recent emotion images of the character. It does not replace text.
<!-- src/ts/process/scripts.ts:184-206 -->

### `@@repeat_back <pos>`
If the pattern of the script does **not** match the current message, the app looks for the pattern in the previous message of the same role. It then copies that match into the current message. `<pos>` sets where the copied text goes:
- `end`: at the end.
- `start`: at the start.
- `end_nl`: at the end, on a new line.
- `start_nl`: at the start, on a new line.

If you leave out `<pos>`, the app adds the text at the end.
<!-- src/ts/process/scripts.ts:252-287 -->

### `@@move_top <replacement>` / `@@move_bottom <replacement>`
The app removes the matched text from its original position. It inserts `<replacement>` at the very top or the very bottom of the message. `<replacement>` can use the capture-group references `$&`, `$1`, `$2`, and so on, and `$<name>`. These work the same way as in normal regex replacement text. The app drops the `g` flag for these directives. If Global is checked, only the first match still moves. See [[Regex Script]] for details.
<!-- src/ts/process/scripts.ts:160-162,216-246 -->

### `@@inject`
When the pattern matches, the app immediately saves the full current text of the message back into the chat log. Without this directive, the script changes only what the app displays. Then the app removes the matched text from the working copy. This has an effect only on an actual chat message. It has no effect on prompts that you preview. It always targets the selected character, so it has no effect for group members or preview characters.
<!-- src/ts/process/scripts.ts:207-211 -->

## Lorebook decorators

A line that starts with `@@` at the top of the content of a lorebook entry is a **lorebook decorator**. The `@@@` form also works as a fallback. Lorebook decorators set the position and the conditions for the insertion of the entry. Examples are `@@depth 0`, `@@end`, `@@position`, `@@activate_only_after`, `@@probability`, and `@@inject_lore`. The full list is on [[Lorebook]].
<!-- src/ts/process/lorebook.svelte.ts:302-507 -->

## Other notes

- The app recognizes these decorators only in the places that this page describes: the splitting of prompt roles, the output field of a Regex Script, and the top of a lorebook entry. If you write `@@system` or `@@emo` in ordinary chat text, nothing happens.
- Only `@@move_top` and `@@move_bottom` substitute capture-group references (`$1`, `$&`, and so on) in their replacement text. Named `$<name>` references do not work now. See [[Regex Script]]. `@@emo`, `@@repeat_back`, and `@@inject` do not use the output text for substitution.
  <!-- src/ts/process/scripts.ts:184-289 -->

## See also
- [[Regex Script]]: The full documentation for the scripts that these effects belong to.
- [[Curly Brased Syntaxes]]: The `{{...}}` macros.
- [[Prompt Template]]: The system that gives each block its own role. When it is in use, it replaces the `@@` prompt decorators.
