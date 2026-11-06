# Playground

The Playground is a set of tools to test RisuAI features on their own, outside the chat of a character. You can try CBS syntax, Jinja templates, tokenizers, embeddings, image generation, translation, MCP servers, and more. The result appears at once.

The app saves nothing that you type in the Playground tools. There are two exceptions, noted below: the Playground chat, and deletions in the Inlay Assets Explorer.

## Opening the Playground

Click the **Playground** icon (a shell) in the sidebar. The Playground opens on a grid of tools.

- The back arrow at the top of a tool returns you to the grid.
- The **Home** icon in the sidebar leaves the Playground.
- With the compact (hamburger) sidebar, a second click on the Playground icon also closes it.
- If you switch characters, the Playground closes too. This includes a switch with the hotkeys for the previous and next character.

<!-- src/lib/SideBars/Sidebar.svelte:428-533,868-896; src/lib/Playground/PlaygroundMenu.svelte:57-154 -->

## Tools

| Tool | Use |
|---|---|
| [Chat](#chat) | A plain chat with your current model and no character |
| [CBS Doc](#cbs-doc) | A searchable list of every CBS tag and what it does |
| [Embedding](#embedding) | Compare how similar texts are under an embedding model |
| [Tokenizer](#tokenizer) | Count tokens with a chosen tokenizer |
| [Syntax](#syntax) | Evaluate CBS |
| [Jinja](#jinja) | Render a Jinja template |
| [Image Generation](#image-generation) | Test your image generator |
| [Parser](#parser) | See the full HTML that a message renders to |
| [Subtitles](#subtitles) | Make subtitles for an audio or video file |
| [Image Translation](#image-translation) | Translate the text inside an image |
| [Translator](#translator) | Test the translator on any text |
| [MCP](#mcp) | List and call tools from your MCP servers |
| [Inlay Assets Explorer](#inlay-assets-explorer) | Browse and delete images, audio, and video that chats saved |
| [Prompt Convertion](#prompt-convertion) | Turn SillyTavern preset files into a RisuAI preset |

### Chat

This is a minimal chat to test a model or a prompt without a character. It uses your current **Model** from **Settings → Chat Bot**.

It differs from a normal chat in these ways:

- It runs as a utility bot. So the app does not use your main prompt, jailbreak, and global note. The prompt is only the chat itself, plus the lorebook if you add one. If you use a [[Prompt Template]] and turn on **Utility Override**, the app uses your template instead.
- The messages have the labels **User** and **Assistant**. A swap button next to each label flips the role of the message.
- The **+** button next to the input box adds an empty Assistant message without a call to the model. Edit it to write the side of the assistant yourself, for example to build a few-shot example.

The app saves the Playground chat like a normal character, with the name "assistant". So the messages stay between sessions. The app hides that character from all of these places:
- the sidebar,
- the character grid in every layout (including its trash tab, the character count, and the search),
- the mobile character list,
- the group-member picker,
- the Previous and Next Character hotkeys.

A character of your own with the name "assistant" is not affected. Fork difference: Upstream shows the Playground character in the character grid.

You cannot restore the Playground character from the trash tab. So when you open the Playground, the app also takes its character out of the trash if it was ever in the trash. Suppose a Playground character is in the trash, and you never open the Playground again. Then the trash clean-up still deletes the character permanently. This happens on the first start more than 3 days after the character went to the trash.
<!-- src/ts/hiddenCharacters.ts; src/ts/playgroundChat.ts selectPlaygroundChat; src/lib/Others/GridCatalog.svelte formatChars; src/ts/hotkey.ts characterCycle; src/ts/bootstrap.ts checkNewFormat (trash purge) -->

<!-- src/lib/Playground/PlaygroundMenu.svelte:26-50; src/ts/process/index.svelte.ts:438-467; src/lib/ChatScreens/DefaultChatScreen.svelte:762-774; src/lib/ChatScreens/Chat.svelte:996-1004,1230-1240 -->

### CBS Doc

This tool is a searchable reference of every CBS tag, with its aliases and description. The app generates it from the app itself. Search by name or alias. For explanations and examples, see [[Curly Brased Syntaxes]] and [[CBS Functions]].

<!-- src/lib/Playground/PlaygroundDocs.svelte -->

### Embedding

Pick an embedding model and type a **Query**. Add one or more **Data** texts with **+**. The tool ranks the data texts by their similarity to the query. The [[Long Term Memory]] systems use the same search.

The list of models is the same as for long-term memory. See [[Embedding models|Long Term Memory#embedding-models]]. The tool lists GPU models only when your browser supports WebGPU. The OpenAI models show an OpenAI key field. **Custom** shows the fields for URL, key, and model. These are the same settings that long-term memory uses. So a change here also changes them for memory.

<!-- src/lib/Playground/PlaygroundEmbedding.svelte -->

### Tokenizer

Type text and choose a tokenizer. The tool shows the token count and the time that the encoding took. These tokenizers are available: Tiktoken (OpenAI, default), Mistral, NovelAI, Claude, Llama, Llama 3, NovelList, Gemma, Cohere, DeepSeek, DeepSeek V4, GLM 4, and GLM 5.

The tokenizer that you pick here does not depend on your model setting.

<!-- src/lib/Playground/PlaygroundTokenizer.svelte; src/ts/tokenizer.ts:32-46 -->

### Syntax

Type text with CBS in the input box. The result updates while you type. This is the quickest way to test a CBS expression before you put it in a character or a lorebook. See [[Curly Brased Syntaxes]].

<!-- src/lib/Playground/PlaygroundSyntax.svelte -->

### Jinja

Enter a Jinja template and the data to render it with, as JSON. The data box starts with a sample chat (`messages`, `bos_token`, `eos_token`). This helps you test the chat templates of instruct models. The output shows errors in the template or in the JSON.

<!-- src/lib/Playground/PlaygroundJinja.svelte -->

### Image Generation

Enter a **Prompt** and a **Neg. Prompt**, and generate. The generator that you set in **Settings → Other Bots → Image Generation** makes the image. The page shows the image. The app does not save it.

<!-- src/lib/Playground/PlaygroundImageGen.svelte -->

### Parser

This tool shows the HTML that a piece of text turns into after message formatting: Markdown, asset tags, styles, and HTML cleanup. It does not evaluate CBS. Use [Syntax](#syntax) for that. Use the Parser to see how [[Markdown Syntaxes]] and [[HTML Syntaxes]] render.

<!-- src/lib/Playground/PlaygroundParser.svelte -->

### Subtitles

This tool makes subtitles for an audio or video file. It downloads them as `.vtt` or `.srt`. It has three modes:

- **LLM**: Sends the file to your current chat model. The model must accept audio and video input, and streaming must be on. If one of them is missing, the page shows a warning.
- **Whisper**: Uses the Whisper API of OpenAI with your OpenAI key.
- **Whisper Local**: Runs Whisper in your browser. It downloads the model the first time. Without WebGPU it still works, but much more slowly, and the page shows a warning.

You can set the source language (Whisper Local only) and the destination language. You can also edit the prompt.

<!-- src/lib/Playground/PlaygroundSubtitle.svelte -->

### Image Translation

Load an image. The translation model reads the text in it and draws the translation over the image.

- **Auto** finds and translates all text in the image.
- **Manual** translates only a region that you select by dragging.

You can set the destination language, the prompt, and the font family and size. The page shows the answer of the model as JSON. You can edit it to fix the result and redraw it. The model must support image input and structured (JSON) output. Models that only stream are not supported.

<!-- src/lib/Playground/PlaygroundImageTrans.svelte -->

### Translator

Translate any text with the translator that you set in **Settings → Language**. Choose the source language and the target language.

- **Bulk** translates many pieces at once. Enter a JSON array of `{"text": "..."}` objects, or separate the pieces with blank lines.
- **Keep Context** (with Bulk) gives each piece the previous pieces as context, up to 10.
- **Clear Cache** clears the saved results of LLM translations.

<!-- src/lib/Playground/PlaygroundTranslation.svelte -->

### MCP

Click **Refresh** to connect to your MCP servers and list their tools. The servers include MCP modules from your active [[Modules]]. For each tool, you can enter its input as JSON and run it with **Execute**. The result opens in a popup. The list of tools stays empty until you click Refresh.

<!-- src/lib/Playground/PlaygroundMCP.svelte -->

### Inlay Assets Explorer

This tool lists the images, audio, and video that are attached to your chats or generated in them (inlay assets). It loads more while you scroll. You can delete them one at a time. Or select several and use **Delete Selected**.

A deletion here is permanent. A message that used a deleted asset cannot show it any more.

<!-- src/lib/Playground/PlaygroundInlayExplorer.svelte -->

### Prompt Convertion

This tool converts SillyTavern preset files into a RisuAI preset. Click **Add** and select one or more JSON files. Then click **Run**. The tool accepts chat-completion presets, instruct templates, context templates, and text-generation parameter presets. You cannot combine a chat-completion preset with an instruct template.

The app adds the result as a new preset in **Settings → Chat Bot → Presets**.

<!-- src/lib/Playground/ToolConversion.svelte; src/ts/process/prompt.ts:103-125,291-490 -->
