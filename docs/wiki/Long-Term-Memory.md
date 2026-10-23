# Long Term Memory

A chat eventually grows past the model's **Max Context** size. Without a memory system, RisuAI simply drops the oldest messages from the prompt until it fits. A long-term memory system replaces that step: it decides which old content survives, usually as summaries, retrieved passages, or both.

RisuAI has five memory systems:

- [[Hanurai Memory]]: vector search over raw old messages. No summarization.
- [[SupaMemory]]: one rolling summary that is re-summarized as it grows.
- **HypaMemory (v1)**: SupaMemory plus vector search over the stored chunk summaries. It is a checkbox inside SupaMemory, and is documented on the [[SupaMemory]] page.
- [[HypaMemory V2]]: a list of chunk summaries, plus vector search over their paragraphs.
- [[HypaMemory V3]]: a list of summaries picked for each request from four pools (important, recent, similar, random) within a token budget. It has presets, a management modal and an experimental implementation.

## Turning memory on

Two switches must both be on:

1. **Settings → Other Bots → Long Term Memory → Type**: pick a system. The dropdown turns the other systems off, so only one is active when you set it here.
2. **The character's memory toggle.** This appears in the chat toggles once a system is selected. Its label depends on the system: **Toggle SupaMemory**, **Toggle HypaMemory** (HypaMemory v1, V2 and V3), or **HanuraiMemory**. The toggle belongs to the character or group, so every chat with that character uses it.
   <!-- src/lib/SideBars/Toggles.svelte:192-194,207-209; src/lang/en.ts:1321,1486,1607 -->
   **Fork difference:** with V2 on, upstream labels the toggle **Toggle SupaMemory**; here it is **Toggle HypaMemory**. The toggle also shows when the memory model is none but V2 is on. Upstream gives V3's label priority over Hanurai; here HanuraiMemory comes first.

With HypaMemory V3, **Always Toggle On** (in the preset's Advanced Settings) turns the character toggle on automatically each time you select a character.

## Priority when more than one is enabled

The Type dropdown only ever enables one system. Several flags can still be set at once in data that was not set through the dropdown. In that case the prompt builder checks them in this order and runs **only the first match**:

1. [[Hanurai Memory]]
2. [[HypaMemory V2]]
3. [[HypaMemory V3]]
4. [[SupaMemory]], or HypaMemory v1 if **Enable HypaMemory** is checked

The Type dropdown shows the same order, so in such data it displays the system that actually runs.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1015-1019; src/ts/process/index.svelte.ts:1529-1605 -->
**Fork difference:** the displayed value follows this order (the option list itself is unchanged).

## Comparison

| | Hanurai | SupaMemory | HypaMemory v1 | HypaMemory V2 | HypaMemory V3 |
|---|---|---|---|---|---|
| **Mechanism** | Retrieves old raw messages by similarity to the last 3 messages, skipping any that are already in the prompt | Summarizes the oldest messages into one running summary, and re-summarizes that summary when it gets long | SupaMemory, plus retrieval of up to 3 stored chunk summaries | Summarizes old messages in token-sized chunks. The prompt gets the earliest summaries plus paragraphs retrieved by similarity | Summarizes old messages in message-count batches. The prompt gets important, then recent, then similar, then random summaries within a budget |
| **Runs on** | Every request | Only when the prompt is over Max Context | Only when the prompt is over Max Context | Every request (summarizes only when over) | Every request (summarizes only when over) |
| **Persisted in the chat** | Nothing | Plain text | Same storage as SupaMemory, but as `hypa:` + JSON | JSON | JSON. Settings live in global presets |
| **Model calls** | None | 1 per summarized chunk, plus re-summarization of the running summary | Same as SupaMemory | 1 per summarized chunk | 1 per summarized batch. **Enable Similarity Correction** adds 1 per request |
| **Embeddings** | Every older message is embedded once (cached), plus 3 query embeddings per request | None | The stored chunk summaries (cached), plus 1 query, only when over Max Context | All summary paragraphs (cached), plus 3 queries per request | The unselected summaries' chunks (cached), plus one query per recent message (per paragraph in the experimental mode). Skipped when **Similar Memory Ratio** is 0 |
| **Memory budget** | **Chunk Size** is reserved and is also the cap on the retrieved block | No fixed cap. Chunks are at most min(Max Context ÷ 3, **Max SupaMemory Chunk Size**) | Same as SupaMemory | **Allocated Tokens** (at most half of it for the summaries part) | **Memory Tokens Ratio** × Max Context |
| **Editable** | — | Text box in character settings | Text box in character settings (raw JSON) | Hypa V2 Modal | Hypa V3 Modal (edit, reroll, importance, tags, categories, merge) |

"Cached" means the vector is stored in the browser's local embedding cache (see below). Embedding the same text again with the same model costs nothing.

In this table, "prompt tokens" is counted the same way for every system: the prompt includes the reserved response length (**Max Response**) when it is compared with Max Context.
<!-- src/ts/process/index.svelte.ts:1057; src/ts/process/memory/hypav2.ts:391-393; src/ts/process/memory/hypav3.ts:196-246,978-1023 -->
**Fork difference:** upstream's HypaMemory V2 and V3 subtract Max Response first, so they compare only the input against Max Context.

## Conversion paths

- **Legacy HypaMemory V2 → current V2**: automatic. When V2 runs and finds data in the old format, where each entry recorded only one target message, it rebuilds it from the current message list. Each summary is re-attached to the range of messages between its target and the previous summary's target. Summaries whose target message no longer exists are dropped. The converted data is saved after that request succeeds.
- **HypaMemory V2 → V3**: manual. Open the **Hypa V3 Modal** in a chat whose V3 data has no summaries and which still has V2 data. The modal shows *"No summaries yet, but you may convert HypaV2 data to V3."* with a **Convert to V3** button. Each V2 summary becomes one V3 summary with the same message links, not marked important. The V2 retrieval paragraphs are not carried over, and the V2 data is left in place. Legacy-format V2 data cannot be converted directly: it fails with "chatMemos is not an array". Let V2 run once first, so the automatic migration above happens.
- **SupaMemory ↔ HypaMemory v1**: no conversion. Both are stored in the same place, in different formats. If you turn **Enable HypaMemory** on over an existing SupaMemory summary, the summary is ignored and overwritten the next time memory is saved. If you turn it off over v1 data, SupaMemory stops with *"SupaMemory: Data saved in hypaMemory, loaded as SupaMemory."*
- **SupaMemory / v1 → V2 or V3**: no conversion path exists.
- **Old V3 settings → presets**: V3 settings from before presets existed became a preset named "Default".

## Embedding models

Hanurai, HypaMemory v1, V2 and V3 all use the **Embedding** setting at the bottom of the Long Term Memory section. The same setting is used by other features too; see its help text.

- **Local, in the browser**: MiniLM L6 v2, Nomic Embed Text v1.5, BGE Small English, BGE Medium 3, Multilingual MiniLM L12 v2, BGE Medium 3 Korean. Each has a CPU variant, and a GPU variant that is listed only when the browser supports WebGPU. The model is downloaded on first use. BGE Medium 3 is heavy, and weaker GPUs may fail with a "Device is lost" error.
- **OpenAI**: text-embedding-3-small, text-embedding-3-large, Ada. These use the **OpenAI API Key** field shown under the dropdown. It is the same stored key as the **SupaMemory OpenAI Key**.
- **Voyage Context 3**: needs a **Voyage API Key**. This is a contextual model. HypaMemory V3 embeds all chunks of one summary together, so each chunk's vector reflects its sibling chunks. The other systems embed each text on its own.
- **Custom (OpenAI-compatible)**: **URL** (`/embeddings` is appended if missing), **Key/Password** (sent as a Bearer token) and **Request Model**.

Vectors are cached locally in the browser, keyed to the text plus the model name, plus the request model for Custom and the group context for Voyage. The cache is local to the browser and is not part of your save data. Changing the embedding model means everything is embedded again the first time.

## Which to choose

- **HypaMemory V3** is the most complete system. It has presets, a management modal, importance flags, per-request selection across several pools, and a local summarizer option. Use it for new long chats unless you have a reason not to.
- **HypaMemory V2** is the previous design. Keep it for chats that already rely on V2 data, or convert them to V3.
- **SupaMemory** needs no embedding model. Everything collapses into one ever-shorter summary, so detail fades quickly. **HypaMemory v1** brings some detail back through retrieval.
- **Hanurai Memory** makes no model calls, only embeddings. It keeps verbatim old messages instead of summaries, but has no memory of anything that is not retrieved.

The summarizing systems spend extra model calls whenever the chat overflows. Pick a summarization model you are willing to pay for, or a local one:

- **distilbart** for SupaMemory and V2
- **Qwen3 (GPU)** for V3
