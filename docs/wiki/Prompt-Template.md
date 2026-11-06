# Prompt Template

A prompt template sets exactly what goes into the prompt and in what order. It is a list of items, for example prompt text, description, lorebook, and chat history. You arrange the items by dragging. The template replaces the older fields **Main Prompt**, **Jailbreak Prompt**, **Global Note**, and **Formatting Order**.

The template is part of the current preset. If you switch presets, the template and all its [settings](#template-settings) switch too.

<!-- src/ts/storage/database.svelte.ts:2170-2229 -->

## Turning it on

Go to **Settings → Chat Bot → Others → Prompt Template** and check **Use Prompt Template**. Then:

- **Settings → Chat Bot → Prompt** shows the item list of the template instead of the legacy fields.
- **Settings → Chat Bot → Others → Prompt Template** shows the [template settings](#template-settings).

With the legacy layout of the settings, a **Prompt Template** button opens an editor. The editor has the tabs **Template** and **Settings**.

A new template starts empty. If the template has no **End-Injected Prompts** item, the app always adds one at the end (see below).

If you turn the template off, the app does not delete the legacy fields. If you turn it on, the app does not delete them either. While the template is on, the app ignores the legacy fields.

<!-- src/lib/Setting/Pages/BotSettings.svelte:713-723,828-853; src/ts/process/index.svelte.ts:424-436 -->

### Without a template

When the template is off, the app builds the prompt from **Main Prompt**, **Jailbreak Prompt** (only while **Toggle Jailbreak** is on), **Global Note**, and the other parts. The order comes from **Formatting Order**. In this mode, the **System Prompt** of the character replaces the Main Prompt, and `{{original}}` stands for the Main Prompt. When a template is on, the app does not use the System Prompt of the character.

<!-- src/ts/process/index.svelte.ts:469-499 -->

## Items

Each item has a type. Every item can also have a **Name**. The name only labels the item in the editor.

| Type | What it inserts |
|---|---|
| **Plain Prompt** | Your text, with a **Role** (User, Character, or System Prompt). Its **special type** can be **No Special Type**, **Main Prompt**, or **Global Note**. If the character has a **Replace Global Note**, it replaces a Global Note item, and `{{original}}` stands for the text of the item. |
| **Jailbreak Prompt** | The same as Plain Prompt, but only when **Toggle Jailbreak** is on. |
| **Chain of Thoughts** | The same as Plain Prompt, but only when chain of thought is on. The app offers this type only when the unrecommended **Custom Chain of Thoughts** setting is on. |
| **Persona Prompt** | The description of the selected persona. |
| **Character Description** | The description of the character, plus personality and scenario, and lorebook entries that the app places before or after the description. |
| **Lorebook** | The active lorebook entries that have no special position. See [[Lorebook]]. |
| **Author's Note** | The Author's Note of the chat. If it is empty, the app uses the **Default Prompt** of the item. |
| **Supa/HypaMemory** | The summaries from the active [[Long Term Memory]] system. The item is empty if no system is active. |
| **Chat** | A part or all of the chat history. See [Chat ranges](#chat-ranges). |
| **End-Injected Prompts** | Everything that the app adds at the end. This includes depth-0 lorebook injections, trigger output, the instruction for Chain of Thoughts, the instructions for group chats and the character screen, "[Continue the last response]" when you continue, and the **Post End** text. |
| **ChatML** | Several messages written in ChatML. Each message starts with `<|im_start|>`, followed by `user`, `system`, or `assistant`. Text that does not start with `<|im_start|>` inserts nothing. |
| **Cache Point** | Nothing. It marks the last **Depth** messages that the app built so far as a cache point. It uses the chosen role, or **All**. It is for providers that support prompt caching. |

<!-- src/ts/process/index.svelte.ts:1333-1519; src/lib/UI/PromptDataItem.svelte:64-104,261-374 -->

### Custom Inner Format

The items Persona Prompt, Character Description, Author's Note, and Supa/HypaMemory have a **Custom Inner Format** checkbox. When you check it, the app places the content of the item inside your text, where `{{slot}}` appears. For example:

```
<character>
{{slot}}
</character>
```

The app replaces only the first `{{slot}}`. It processes CBS in the rest of the text. These items can also set a role. Without a role, the app sends them as system messages.

### Chat ranges

By default, a **Chat** item inserts the whole history. To set **Range Start** and **Range End**, check **Advanced**. Negative numbers count from the end. For example, a start of `-4` with **Until Chat End** checked inserts the last four messages. If the start is not before the end, the item inserts nothing.

You can use several Chat items to put other items between parts of the history. For example, you can place a note four messages before the end. Use one Chat item from the start to `-4`, then the note, then one Chat item from `-4` until chat end.

### How items are combined

The app processes items from top to bottom. It merges consecutive system messages into one message, joined by a blank line. It drops empty messages.

The editor warns you, but it does not block you, in these cases:
- The template has no Main Prompt, or more than one.
- The template has no Global Note, or more than one.
- The template has no Character Description or Lorebook item.
- No Chat item reaches the end of the chat.
- Advanced chat ranges do not line up.

<!-- src/ts/process/index.svelte.ts:1294-1317; src/ts/process/templates/templateCheck.ts -->

## Text in items

All item text goes through CBS (see [[Curly Brased Syntaxes]]). So `{{char}}`, `{{user}}`, `{{#if}}`, `{{getvar::...}}`, and the other tags work.

Two tags are especially useful here:

- `{{position::name}}` is replaced with the lorebook entries whose position is `@@position pt_name`. See [[Lorebook]].
- `{{prefill_supported}}` returns `1` when the id of the selected model starts with `claude`, otherwise `0`. To prefill only where it works, wrap a Plain Prompt with the Character role at the end in `{{#if {{prefill_supported}}}}…{{/if}}`.

## Utility bots

For a character that you marked as **Utility Bot**, the app does not use your template. It uses a fixed template: main prompt, description, lorebook, chat, global note, and end-injected prompts. To use your template for utility bots too, check **Utility Override** in the template settings.

<!-- src/ts/process/index.svelte.ts:438-467 -->

## Template settings

These settings are in **Settings → Chat Bot → Others → Prompt Template** after you turn the template on.

| Setting | What it does |
|---|---|
| **Post End** | Text that the app adds as a system message after the End-Injected Prompts. |
| **Send Chat as System** | Sends the chat history as system messages. Each line has its role as a prefix. A Chat item can opt out with **Send as original role**. |
| **Format Group in Single** | Formats a chat with one character like a group chat, with names in front of messages. |
| **Trim 'Start New Chat' Messages** | Leaves out the "[Start a new chat]" marker. |
| **Utility Override** | See [Utility bots](#utility-bots). |
| **Enable Schema**, **Strict Schema**, **JSON Schema**, **Extract JSON** | Ask the model for JSON output that follows a schema, and pull one field out of the response. |
| **Max Thought Tag Depth** | How far back in the history the app handles `<Thoughts>` tags. The value -1 means no limit. |
| **Non-Speaker Role in Group** / **Non-Speaker Inner Format** | The role and the wrapper (with `{{slot}}`) for the messages of other characters in group chats. |
| **Custom Toggles** | Switches that appear in the side panel of the chat. The syntax is the same as the syntax of a module. See [[Custom Toggles|Modules#custom-toggles]]. Read them with `{{getglobalvar::toggle_key}}`. |
| **Default Variables** | Lines in the form `name=value` that set starting values for chat variables. If a default variable of the character has the same name, the variable of the character wins. |
| **Predicted Output** | The app sends it as the predicted output of OpenAI. |
| **Auto Suggest** | The prompt that the Auto Suggest feature uses. |

<!-- src/lib/Setting/Pages/PromptSettings.svelte -->
