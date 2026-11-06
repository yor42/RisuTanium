# HypaMemory V3

HypaMemory V3 is the most complete [[Long Term Memory]] system. When the chat overflows Max Context, it summarizes old messages in small batches and keeps every summary. On each request, it fills a fixed memory budget in four steps:

1. Summaries that you marked **important**.
2. The most **recent** summaries.
3. Summaries that are **similar** to the latest messages.
4. **Random** summaries.

The app stores its settings in presets. A modal lets you inspect, edit, reroll, tag, categorize, and merge summaries.

## Enabling

1. Go to **Settings → Other Bots → Long Term Memory → Type → HypaMemory V3**.
2. In the same section, pick an **Embedding** model. The step for similar memory needs it. See [[Embedding models|Long Term Memory#embedding-models]].
3. In the chat toggles, turn on **Toggle HypaMemory** of the character. Or turn on **Always Toggle On** in the preset.

## Presets

All V3 settings belong to a **Preset**. Presets are global. They do not belong to a character.

- The buttons next to the preset dropdown add, rename, delete, export, and import presets.
- At least one preset must exist.
- Export writes `hypaV3_export_<name>.json`.
- On import, the app ignores settings with an unknown name or a wrong type. Those settings keep their defaults.

## Settings

Defaults are in brackets.

- **SupaMemory Model** [Auxiliary Model]: What writes the summaries.
  - **Auxiliary Model** uses your Auxiliary Model. If **Separate Models for Auxiliary Models** is set up, it uses the memory model.
  - **Qwen3 1.7B / 4B / 8B (GPU)** run locally in the browser through WebGPU. The page lists them only when WebGPU is available. The app unloads the local model after each request.
- **Summarization Prompt** [blank]: If you leave it blank, the app uses a built-in instruction, "summarize the ongoing role story and remove redundancy". The app parses a prompt that starts with `<|im_start|>` as ChatML, and replaces `{{slot}}` with the messages. The app sends any other prompt as a system message after the messages.
- **Re-Summarizaion Prompt** [blank]: Only the bulk **Re-summarize** of the modal uses it. That action merges summaries. If it is blank, the instruction is "Re-summarize this summaries."
- **Max Memory Tokens Ratio (Estimated)**: Read only. It estimates how much of Max Context is left for memory. The calculation is Max Context minus these parts, divided by Max Context: the prompt template, the description, personality, and scenario of the character, the lorebook of the character (up to the lore token budget), and 3 × Max Response.
- **Memory Tokens Ratio** [0.2]: The memory budget as a fraction of Max Context.
- **Extra Summarization Ratio** [0; at most 1 − Memory Tokens Ratio]: After summarization starts, it continues until the prompt is below Max Context × (1 − this value). So it does not have to run again on the next message.
- **Max Messages Per Summary** [6]: The size of one summarization batch. It counts messages that the batch actually includes. Messages that the batch leaves out (see step 6 of How it works) do not count toward it.
- **Query Chat Count** [3; 1–20]: The number of latest messages that the app uses as the similarity query. The app never summarizes these messages.
- **Chunk Separator Regex** [`\n\n`]: How the app splits summaries into chunks for the similarity search. Write either a regex source or `/pattern/flags`. An invalid regex falls back to blank lines.
- **Recent Memory Ratio** [0.4] and **Similar Memory Ratio** [0.4]: The shares of the memory budget. If the two sliders add up to more than 1, the UI lowers the other one.
- **Random Memory Ratio**: Read only. The app calculates it as 1 − Recent − Similar.
- **Preserve Orphaned Memory** [off]: When it is off, the app deletes a summary at the start of a request in one case. A message that the summary covers is gone from both the full message list of the chat and the prompt. For example, someone deleted that message. Hidden messages do not orphan a summary. Messages before an "all before" reset do not orphan a summary either. The app never deletes a summary whose covered entries all have no message ID. When it is on, the app keeps orphaned summaries.
  <!-- src/ts/process/memory/hypav3.ts:1669-1696 -->
  **Fork difference:** The deletion rule. The on/off option itself is unchanged.
- **Apply Regex Script When Rerolling** [off]: Applies the regex scripts of the character to the messages that the modal sends when you reroll a summary. It also applies to the "will summarize" preview. It does not affect normal summarization.
- **Do Not Summarize User Message** [off]: The app leaves user messages out of the text that it sends to the summarizer. It still removes them from the prompt together with the rest of the batch.
- **Advanced Settings**
  - **Use Experimental Implementation** [off]: See [Experimental implementation](#experimental-implementation).
  - **Always Toggle On** [off]: Turns on the memory toggle of the character whenever you select a character.
  - Standard implementation only: **Enable Similarity Correction** [off]. It also summarizes the query messages and uses that summary as an extra query. This costs one additional model call on every request with more than one query message.
  - Experimental implementation only:
    - **Summarization Requests Per Minute** [20] and **Summarization Max Concurrent** [1, max 10]: They apply only when the SupaMemory Model is the Auxiliary Model. The app accepts a Max Concurrent value that is higher than Requests Per Minute. Both limits apply.
      <!-- src/ts/process/memory/taskRateLimiter.ts:31-38,96-121; src/ts/process/memory/hypav3.ts:401,647 -->
      **Fork difference:** In that case, upstream throws an error ("maxConcurrentTasks must be less than tasksPerMinute"). The same applies to the Embedding pair below.
    - **Embedding Requests Per Minute** [100] and **Embedding Max Concurrent** [1, max 10]: They apply to API embedding models.

## How it works

While the toggle is on, this process runs on every request.

1. **Check the settings.** If Recent + Similar is more than 1, the request stops with an error.
2. **Count the input.** The count includes the reserved length of the response (**Max Response**), as in [[SupaMemory]]. The app compares it with Max Context. The tip in the modal reads "Tip: HypaV3 begins summarization when input tokens exceed the maximum context size."
   <!-- src/ts/process/index.svelte.ts:1057; src/ts/process/memory/hypav3.ts:196-246,978-1023; src/lang/en.ts:1831 -->
   **Fork difference:** Upstream first subtracts Max Response from the count. In both cases, the tip in the modal does not mention Max Response.
3. **Clean orphans** (unless **Preserve Orphaned Memory** is on).
4. **Resume.** The resume point is the latest position in the history of any message that any summary covers. The messages up to that point are already summarized. The app removes them from the history. Entries without a message ID count toward the resume point only if the first of them is something that the summarizer does not skip.
   <!-- src/ts/process/memory/hypaResume.ts:28-62; src/ts/process/memory/hypav3.ts:229-246,1006-1023 -->
   **Fork difference:** Upstream resumes after the last message of the last summary.
5. **Reserve memory.**
   - If there are no summaries yet and the prompt fits, the app reserves only the size of an empty memory block.
   - Otherwise V3 reserves Max Context × **Memory Tokens Ratio**. The usable memory budget is that amount minus the tags of the empty block.
6. **Summarize** (only if the input is over Max Context). Each round does this:
   - Stop when the input is at or below Max Context × (1 − **Extra Summarization Ratio**).
   - If **Query Chat Count** messages or fewer are left after the resume point, stop if the input fits. Otherwise fail with *"Cannot summarize further …"*.
   - Take the next **Max Messages Per Summary** messages. Never touch the last **Query Chat Count** messages.
   - Leave out example messages, the "[Start a new chat]" marker, empty messages, and user messages (if **Do Not Summarize User Message** is on). Left-out messages do not count toward the batch size. The batch keeps walking past them until it holds **Max Messages Per Summary** included messages, or it reaches the protected last messages. They still leave the prompt, and the app still counts their tokens when it works out the prompt size.
     <!-- src/ts/process/memory/hypav3.ts:1093-1149,310-360 -->
     **Fork difference:** In the standard implementation, left-out messages used to count toward the batch size. The experimental implementation already behaved as described here.
   - If the input already fits, and the removal of this batch brings the input below the target, stop without a summary of this batch.
   - Send the batch as `role: text` lines. The app replaces inline images with `[Image]`. The reply becomes a new summary that links to those messages. The app removes `<Thoughts>` or `<think>` blocks from the reply first.
   - If a summarization fails, the request fails. But the app saves the summaries that it created earlier in the same request.
7. **Select summaries** within the memory budget, in this order:
   - **Important**: Every summary that you marked important, oldest first, until the first one that does not fit. The app takes their tokens out of the budget before it applies the ratios.
   - **Recent**: Budget × **Recent Memory Ratio**, filled with the newest first, until the first one that does not fit.
   - **Similar**: Budget × **Similar Memory Ratio**, plus any unused recent share when Random Memory Ratio is 0.
     - The app splits the remaining summaries with **Chunk Separator Regex** and embeds the chunks.
     - Each of the last **Query Chat Count** non-empty messages is a query. If **Enable Similarity Correction** is on, the correction summary is a query too.
     - The queries have weights by position. The newest query (and the correction summary) is the heaviest. The weights are 1…n divided by n(n+1)/2.
     - The app ranks chunks by weighted similarity. Then each summary gets a score: the sum of 1/(60 + rank) over its chunks. So a summary with several well-ranked chunks moves up.
     - The app adds summaries in that order, until the first one that does not fit.
     - The app skips this whole step, including all embedding, when Similar Memory Ratio is 0.
   - **Random**: Budget × Random Memory Ratio, plus whatever the recent and similar shares left unused. The app shuffles the remaining summaries (a Fisher-Yates shuffle, so every order is equally likely). It adds each summary if it fits. It skips summaries that are too large.
     <!-- src/ts/process/memory/hypav3.ts:124-131,850,1519 -->
     **Fork difference:** The shuffle method.
8. **Insert.** The app puts the selected summaries back in chronological order, joins them with blank lines, and places them as one system message at the start of the remaining history:

```
<Past Events Summary>
…summaries…
</Past Events Summary>
```

When there are no summaries yet, the app still inserts this block, empty. If the final prompt is still over Max Context, the request stops with an "Unexpected error".

The app saves with the chat which summaries it chose for each pool.

## Experimental implementation

**Use Experimental Implementation** changes these parts of the process above.

- **Batches run together.** The app first collects all summarization batches for the request. Then it sends them through a rate limiter. For the Auxiliary Model, the limits are **Summarization Requests Per Minute** and **Summarization Max Concurrent**. Local models always run one at a time.
- **Failures.** If a batch fails, the app keeps the summaries of the batches before it. It discards the rest of the summaries of that request. After the first failure, the app cancels pending batches.
- **Similarity search.** The app uses a different embedding processor, with cosine similarity. For API models, it follows **Embedding Requests Per Minute** and **Embedding Max Concurrent**. The app embeds local models in small sequential batches.
- **Queries per paragraph.** The app splits each query message at blank lines. Each paragraph is its own query. A message shares its weight equally between its paragraphs.
- **No Similarity Correction.** The option is hidden, and the app does not use it.
- **Memory reservation.** The app reserves memory tokens only when summaries exist or the input is over Max Context. With no summaries, the app inserts no memory block at all.
- **The selection is unchanged.** The app still chooses summaries in the order important, recent, similar, random, with the same budgets and rollover.

## Data

The app stores this data for each chat, in order of creation:

- Each summary has its text, the messages that it covers, whether it is marked important, an optional category, and its tags. The very first message of the chat has no ID of its own, so the app records it as none.
- The list of categories that the modal uses.
- Which summaries the app selected as important, recent, similar, or random on the last request.
- The display options of the modal.

Presets are global settings. They are not part of the chat data.

## Hypa V3 Modal

Open it with **Hypa V3 Modal** in the character settings. If **Show Menu Hypa Modal** is on in the Accessibility settings, you can also open it from the chat menu.

- **Search** by `#N`, by message ID, or by text.
- **For each summary**, you can do these things:
  - Edit the text.
  - Translate it.
  - Mark it important.
  - Set tags and a category.
  - View its connected messages.
  - **Reroll** it from its messages. This is unavailable if any of them no longer exist.
  - Delete it, or delete it and every summary after it.
- **Bulk edit**: Select summaries. Then set their category, toggle importance, or **Re-summarize** two or more of them into one. The merged summary takes the place of the first selected summary and covers all of their messages. The app removes the others.
- **Reset**: Deletes all V3 data for the chat, after two confirmations.
- **Convert to V3**: The modal shows it when the chat has V2 data and no V3 summaries. See [[Conversion paths|Long Term Memory#conversion-paths]].
- **Next target preview**: Shows which message the app summarizes next.
