# Long Term Memory

A chat eventually grows past the **Max Context** size of the model. Without a memory system, RisuAI drops the oldest messages from the prompt until the prompt fits. A long-term memory system replaces that step. It decides which old content survives. The content is usually summaries, retrieved passages, or both.

RisuAI has five memory systems:

- [[Hanurai Memory]]: Vector search over raw old messages. It does no summarization.
- [[SupaMemory]]: One rolling summary that the app summarizes again as it grows.
- **HypaMemory (v1)**: SupaMemory plus vector search over the stored chunk summaries. It is a checkbox inside SupaMemory. The [[SupaMemory]] page documents it.
- [[HypaMemory V2]]: A list of chunk summaries, plus vector search over their paragraphs.
- [[HypaMemory V3]]: A list of summaries that the app picks for each request from four pools (important, recent, similar, random) within a token budget. It has presets, a management modal, and an experimental implementation.

## Turning memory on

You must turn on two switches:

1. **Settings → Other Bots → Long Term Memory → Type**: Pick a system. The dropdown turns the other systems off, so only one system is active when you set it here.
2. **The memory toggle of the character.** It appears in the chat toggles after you select a system. Its label depends on the system: **Toggle SupaMemory**, **Toggle HypaMemory** (HypaMemory v1, V2, and V3), or **HanuraiMemory**. The toggle belongs to the character or group. So every chat with that character uses it.
   <!-- src/lib/SideBars/Toggles.svelte:192-194,207-209; src/lang/en.ts:1321,1486,1607 -->
   **Fork difference:** With V2 on, upstream labels the toggle **Toggle SupaMemory**. Here it is **Toggle HypaMemory**. The toggle also appears when the memory model is none and V2 is on. Upstream gives the label of V3 priority over Hanurai. Here HanuraiMemory comes first.

With HypaMemory V3, **Always Toggle On** turns the toggle of the character on automatically each time you select a character. You find **Always Toggle On** in the Advanced Settings of the preset.

## Priority when more than one is enabled

The Type dropdown enables only one system. Data that you did not set through the dropdown can still have several flags set at once. In that case, the prompt builder checks the flags in this order and runs **only the first match**:

1. [[Hanurai Memory]]
2. [[HypaMemory V2]]
3. [[HypaMemory V3]]
4. [[SupaMemory]], or HypaMemory v1 if **Enable HypaMemory** is checked

The Type dropdown shows the same order. So for such data, it displays the system that actually runs.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1015-1019; src/ts/process/index.svelte.ts:1529-1605 -->
**Fork difference:** The displayed value follows this order. The option list itself is unchanged.

## Comparison

| | Hanurai | SupaMemory | HypaMemory v1 | HypaMemory V2 | HypaMemory V3 |
|---|---|---|---|---|---|
| **Mechanism** | Retrieves old raw messages by similarity to the last 3 messages. It skips messages that are already in the prompt. | Summarizes the oldest messages into one running summary. It summarizes that summary again when it gets long. | SupaMemory, plus retrieval of up to 3 stored chunk summaries | Summarizes old messages in chunks of a set token size. The prompt gets the earliest summaries plus paragraphs that the app retrieves by similarity. | Summarizes old messages in batches of a set message count. The prompt gets important summaries, then recent, then similar, then random summaries within a budget. |
| **Runs on** | Every request | Only when the prompt is over Max Context | Only when the prompt is over Max Context | Every request (it summarizes only when over) | Every request (it summarizes only when over) |
| **Persisted in the chat** | Nothing | Plain text | The same storage as SupaMemory, but as `hypa:` + JSON | JSON | JSON. The settings live in global presets. |
| **Model calls** | None | 1 for each summarized chunk, plus the re-summarization of the running summary | The same as SupaMemory | 1 for each summarized chunk | 1 for each summarized batch. **Enable Similarity Correction** adds 1 for each request. |
| **Embeddings** | The app embeds every older message one time (cached). It adds 3 query embeddings for each request. | None | The stored chunk summaries (cached), plus 1 query, only when over Max Context | All summary paragraphs (cached), plus 3 queries for each request | The chunks of the unselected summaries (cached), plus one query for each recent message (for each paragraph in the experimental mode). The app skips this when **Similar Memory Ratio** is 0. |
| **Memory budget** | The app reserves **Chunk Size**. It is also the limit for the retrieved block. | No fixed limit. A chunk has at most min(Max Context ÷ 3, **Max SupaMemory Chunk Size**) tokens. | The same as SupaMemory | **Allocated Tokens** (at most half of it for the summaries part) | **Memory Tokens Ratio** × Max Context |
| **Editable** | No | Text box in the character settings | Text box in the character settings (raw JSON) | Hypa V2 Modal | Hypa V3 Modal (edit, reroll, importance, tags, categories, merge) |

"Cached" means that the app stores the vector in the local embedding cache of the browser (see below). If you embed the same text again with the same model, it costs nothing.

In this table, the app counts "prompt tokens" the same way for every system. When the app compares the prompt with Max Context, the prompt includes the reserved length of the response (**Max Response**).
<!-- src/ts/process/index.svelte.ts:1057; src/ts/process/memory/hypav2.ts:391-393; src/ts/process/memory/hypav3.ts:196-246,978-1023 -->
**Fork difference:** Upstream HypaMemory V2 and V3 first subtract Max Response. So they compare only the input with Max Context.

## Conversion paths

- **Legacy HypaMemory V2 → current V2**: Automatic. Each entry of the old format recorded only one target message. When V2 runs and finds data in that format, it rebuilds the data from the current message list. It attaches each summary again to the range of messages between its target and the target of the previous summary. It drops summaries whose target message no longer exists. The app saves the converted data after that request succeeds.
- **HypaMemory V2 → V3**: Manual. Open the **Hypa V3 Modal** in a chat whose V3 data has no summaries and that still has V2 data. The modal shows *"No summaries yet, but you may convert HypaV2 data to V3."* with a **Convert to V3** button. Each V2 summary becomes one V3 summary with the same message links. It is not marked as important. The app does not carry over the retrieval paragraphs of V2. It leaves the V2 data in place. You cannot convert V2 data in the legacy format directly. The conversion fails with "chatMemos is not an array". Let V2 run once first, so that the automatic migration above happens.
- **SupaMemory ↔ HypaMemory v1**: No conversion. Both are stored in the same place, in different formats. Suppose you turn **Enable HypaMemory** on over an existing SupaMemory summary. The app ignores the summary and overwrites it the next time it saves memory. Suppose you turn it off over v1 data. Then SupaMemory stops with *"SupaMemory: Data saved in hypaMemory, loaded as SupaMemory."*
- **SupaMemory / v1 → V2 or V3**: No conversion path exists.
- **Old V3 settings → presets**: The V3 settings from before presets existed became a preset named "Default".

## Embedding models

Hanurai, HypaMemory v1, V2, and V3 all use the **Embedding** setting at the bottom of the Long Term Memory section. Other features use the same setting too. See its help text.

- **Local, in the browser**: MiniLM L6 v2, Nomic Embed Text v1.5, BGE Small English, BGE Medium 3, Multilingual MiniLM L12 v2, BGE Medium 3 Korean. Each has a CPU variant. The app lists a GPU variant only when the browser supports WebGPU. The app downloads the model on first use. BGE Medium 3 is heavy. Weaker GPUs can fail with a "Device is lost" error.
- **OpenAI**: text-embedding-3-small, text-embedding-3-large, Ada. These use the **OpenAI API Key** field under the dropdown. It is the same stored key as the **SupaMemory OpenAI Key**.
- **Voyage Context 3**: This needs a **Voyage API Key**. It is a contextual model. HypaMemory V3 embeds all chunks of one summary together. So the vector of each chunk reflects its sibling chunks. The other systems embed each text on its own.
- **Custom (OpenAI-compatible)**: **URL** (the app appends `/embeddings` if it is missing), **Key/Password** (sent as a Bearer token), and **Request Model**.

The app caches vectors locally in the browser. The key is the text plus the model name. For Custom, it also includes the request model. For Voyage, it also includes the group context. The cache is local to the browser. It is not part of your save data. If you change the embedding model, the app embeds everything again the first time.

## Which to choose

- **HypaMemory V3** is the most complete system. It has presets, a management modal, importance flags, a selection for each request across several pools, and an option for a local summarizer. Use it for new long chats, unless you have a reason not to.
- **HypaMemory V2** is the previous design. Keep it for chats that already rely on V2 data, or convert those chats to V3.
- **SupaMemory** needs no embedding model. Everything collapses into one ever-shorter summary, so detail fades quickly. **HypaMemory v1** brings some detail back through retrieval.
- **Hanurai Memory** makes no model calls. It makes only embedding calls. It keeps old messages word for word instead of summaries. It has no memory of anything that it does not retrieve.

The systems that summarize spend extra model calls whenever the chat overflows. Pick a summarization model that you are willing to pay for, or a local model:

- **distilbart** for SupaMemory and V2
- **Qwen3 (GPU)** for V3
