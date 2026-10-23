# HypaMemory V3

HypaMemory V3 is the most complete [[Long Term Memory]] system. When the chat overflows Max Context, it summarizes old messages in small batches and keeps every summary. On each request, it fills a fixed memory budget in four steps:

1. summaries you marked **important**
2. the most **recent** summaries
3. summaries **similar** to the latest messages
4. **random** summaries

Its settings are stored in presets. A modal lets you inspect, edit, reroll, tag, categorize and merge summaries.

## Enabling

1. **Settings → Other Bots → Long Term Memory → Type → HypaMemory V3**.
2. Pick an **Embedding** model in the same section, which the similar-memory step needs (see [[Embedding models|Long Term Memory#embedding-models]]).
3. Turn on the character's **Toggle HypaMemory** in the chat toggles, or turn on **Always Toggle On** in the preset.

## Presets

All V3 settings belong to a **Preset**. Presets are global, not per character.

- The buttons next to the preset dropdown add, rename, delete, export and import presets.
- At least one preset must exist.
- Export writes `hypaV3_export_<name>.json`.
- On import, settings with an unknown name or a wrong type are ignored, and those settings keep their defaults.

## Settings

Defaults are in brackets.

- **SupaMemory Model** [Auxiliary Model]: what writes the summaries.
  - **Auxiliary Model** uses your Auxiliary Model, or the memory model if **Separate Models for Auxiliary Models** is set up.
  - **Qwen3 1.7B / 4B / 8B (GPU)** run locally in the browser through WebGPU, and are listed only when WebGPU is available. The local model is unloaded after each request.
- **Summarization Prompt** [blank]: blank uses a built-in "summarize the ongoing role story and remove redundancy" instruction. A prompt starting with `<|im_start|>` is parsed as ChatML, with `{{slot}}` replaced by the messages. Any other prompt is sent as a system message after the messages.
- **Re-Summarizaion Prompt** [blank]: used only by the modal's bulk **Re-summarize**, which merges summaries. When blank, the instruction is "Re-summarize this summaries."
- **Max Memory Tokens Ratio (Estimated)**: read only. It estimates how much of Max Context is left for memory. The calculation is Max Context minus the prompt template, the character's description, personality and scenario, the character's lorebook (up to the lore token budget) and 3 × Max Response, divided by Max Context.
- **Memory Tokens Ratio** [0.2]: the memory budget as a fraction of Max Context.
- **Extra Summarization Ratio** [0; at most 1 − Memory Tokens Ratio]: once summarization starts, it continues until the prompt is below Max Context × (1 − this value), so that it does not have to run again on the next message.
- **Max Messages Per Summary** [6]: the size of one summarization batch, counted in messages that are actually included. Messages that are left out (see step 6 of How it works) do not count toward it.
- **Query Chat Count** [3; 1–20]: the number of latest messages used as the similarity query. These messages are also never summarized.
- **Chunk Separator Regex** [`\n\n`]: how summaries are split into chunks for similarity search. Write either a regex source or `/pattern/flags`. An invalid regex falls back to blank lines.
- **Recent Memory Ratio** [0.4] and **Similar Memory Ratio** [0.4]: shares of the memory budget. When the two sliders add up to more than 1, the UI lowers the other one.
- **Random Memory Ratio**: read only, calculated as 1 − Recent − Similar.
- **Preserve Orphaned Memory** [off]: when off, a summary is deleted at the start of a request if a message it covers is gone from both the chat's full message list and the prompt, for example because the message was deleted. Hidden messages, and messages before an "all before" reset, do not orphan a summary, and a summary whose only covered entries have no message ID is never deleted. When on, orphaned summaries are kept.
  <!-- src/ts/process/memory/hypav3.ts:1669-1696 -->
  **Fork difference:** the deletion rule (the on/off option itself is unchanged).
- **Apply Regex Script When Rerolling** [off]: applies the character's regex scripts to the messages the modal sends when you reroll a summary. It also applies to the "will summarize" preview. It does not affect normal summarization.
- **Do Not Summarize User Message** [off]: user messages are left out of the text sent to the summarizer. They are still removed from the prompt along with the rest of the batch.
- **Advanced Settings**
  - **Use Experimental Implementation** [off]: see [Experimental implementation](#experimental-implementation).
  - **Always Toggle On** [off]: turns the character's memory toggle on whenever you select a character.
  - Standard implementation only: **Enable Similarity Correction** [off]. Also summarizes the query messages and uses that summary as an extra query. This costs one additional model call on every request with more than one query message.
  - Experimental implementation only:
    - **Summarization Requests Per Minute** [20] and **Summarization Max Concurrent** [1, max 10]: apply only when the SupaMemory Model is the Auxiliary Model. A Max Concurrent value higher than Requests Per Minute is accepted; both limits apply.
      <!-- src/ts/process/memory/taskRateLimiter.ts:31-38,96-121; src/ts/process/memory/hypav3.ts:401,647 -->
      **Fork difference:** upstream throws an error ("maxConcurrentTasks must be less than tasksPerMinute") in that case. The same applies to the Embedding pair below.
    - **Embedding Requests Per Minute** [100] and **Embedding Max Concurrent** [1, max 10]: apply to API embedding models.

## How it works

This runs on every request while the toggle is on.

1. **Check the settings.** If Recent + Similar is more than 1, the request stops with an error.
2. **Count the input.** The count includes the reserved response length (**Max Response**), as in [[SupaMemory]], and is compared with Max Context. The tip in the modal reads "Tip: HypaV3 begins summarization when input tokens exceed the maximum context size."
   <!-- src/ts/process/index.svelte.ts:1057; src/ts/process/memory/hypav3.ts:196-246,978-1023; src/lang/en.ts:1831 -->
   **Fork difference:** upstream subtracts Max Response from the count first. The modal tip does not mention Max Response either way.
3. **Clean orphans** (unless **Preserve Orphaned Memory** is on).
4. **Resume.** The resume point is the latest position in the history of any message covered by any summary. Messages up to it are already summarized and are removed from the history. Entries without a message ID count toward the resume point only when the first of them is something the summarizer would not skip.
   <!-- src/ts/process/memory/hypaResume.ts:28-62; src/ts/process/memory/hypav3.ts:229-246,1006-1023 -->
   **Fork difference:** upstream resumes after the last message of the last summary.
5. **Reserve memory.**
   - With no summaries yet and a prompt that fits, only the size of an empty memory block is reserved.
   - Otherwise V3 reserves Max Context × **Memory Tokens Ratio**. The usable memory budget is that amount minus the empty block's tags.
6. **Summarize** (only if the input is over Max Context). Each round:
   - Stop once the input is at or below Max Context × (1 − **Extra Summarization Ratio**).
   - If no more than **Query Chat Count** messages are left after the resume point, stop if the input fits. Otherwise fail with *"Cannot summarize further …"*.
   - Take the next **Max Messages Per Summary** messages, never touching the last **Query Chat Count** messages.
   - Leave out example messages, the "[Start a new chat]" marker, empty messages, and (with **Do Not Summarize User Message**) user messages. Left-out messages do not count toward the batch size: the batch keeps walking past them until it holds **Max Messages Per Summary** included messages or reaches the protected last messages. They still leave the prompt, and their tokens still count when the prompt size is worked out.
     <!-- src/ts/process/memory/hypav3.ts:1093-1149,310-360 -->
     **Fork difference:** in the standard implementation, left-out messages used to count toward the batch size. The experimental implementation already behaved as described here.
   - If the input already fits and removing this batch would go below the target, stop without summarizing it.
   - Send the batch as `role: text` lines, with inline images replaced by `[Image]`. The reply, with `<Thoughts>` or `<think>` blocks removed, becomes a new summary linked to those messages.
   - If a summarization fails, the request fails, but summaries created earlier in the same request are saved.
7. **Select summaries** within the memory budget, in this order:
   - **Important**: every summary marked important, oldest first, until the first one that does not fit. Their tokens are taken out of the budget before the ratios are applied.
   - **Recent**: budget × **Recent Memory Ratio**, filled newest first, until the first one that does not fit.
   - **Similar**: budget × **Similar Memory Ratio**, plus any unused recent share when Random Memory Ratio is 0.
     - The remaining summaries are split with **Chunk Separator Regex**, and the chunks are embedded.
     - Each of the last **Query Chat Count** non-empty messages is a query, plus the correction summary when **Enable Similarity Correction** is on.
     - Queries are weighted by position, newest (and the correction summary) heaviest, with weights 1…n divided by n(n+1)/2.
     - Chunks are ranked by weighted similarity. Each summary then scores the sum of 1/(60 + rank) over its chunks, so a summary with several well-ranked chunks moves up.
     - Summaries are added in that order, until the first one that does not fit.
     - This whole step, including all embedding, is skipped when Similar Memory Ratio is 0.
   - **Random**: budget × Random Memory Ratio, plus whatever the recent and similar shares left unused. The remaining summaries are shuffled (a Fisher-Yates shuffle, so every order is equally likely). Each one is added if it fits, and ones that are too large are skipped.
     <!-- src/ts/process/memory/hypav3.ts:124-131,850,1519 -->
     **Fork difference:** the shuffle method.
8. **Insert.** The selected summaries are put back in chronological order, joined with blank lines, and placed as one system message at the start of the remaining history:

```
<Past Events Summary>
…summaries…
</Past Events Summary>
```

When there are no summaries yet, this block is still inserted, empty. If the final prompt would still be over Max Context, the request stops with an "Unexpected error".

Which summaries were chosen for each pool is saved with the chat.

## Experimental implementation

**Use Experimental Implementation** changes these parts of the process above.

- **Batches run together.** All summarization batches for the request are collected first, then sent through a rate limiter. The limits are **Summarization Requests Per Minute** and **Summarization Max Concurrent** for the Auxiliary Model. Local models always run one at a time.
- **Failures.** If a batch fails, the summaries of the batches before it are kept, and the rest of that request's summaries are discarded. Pending batches are cancelled after the first failure.
- **Similarity search.** A different embedding processor is used, with cosine similarity. For API models, it follows **Embedding Requests Per Minute** and **Embedding Max Concurrent**. Local models are embedded in small sequential batches.
- **Queries per paragraph.** Each query message is split at blank lines, and each paragraph is its own query. A message's weight is shared equally between its paragraphs.
- **No Similarity Correction.** The option is hidden and not used.
- **Memory reservation.** Memory tokens are reserved only when summaries exist or the input is over Max Context. With no summaries, no memory block is inserted at all.
- **Selection is unchanged.** Summaries are still chosen important → recent → similar → random, with the same budgets and rollover.

## Data

Stored per chat, in creation order:

- Each summary has its text, the messages it covers (the chat's very first message has no ID of its own, so it's recorded as none), whether it's marked important, an optional category, and its tags.
- The category list used by the modal.
- Which summaries were selected as important, recent, similar or random on the last request.
- The modal's display options.

Presets are global settings, not part of the chat data.

## Hypa V3 Modal

Open it with **Hypa V3 Modal** in the character settings, or from the chat menu when **Show Menu Hypa Modal** is on in Accessibility settings.

- **Search** by `#N`, by message ID, or by text.
- **Per summary**:
  - edit the text
  - translate it
  - mark it important
  - set tags and a category
  - view its connected messages
  - **reroll** it from its messages, which is unavailable if any of them no longer exist
  - delete it, or delete it and every summary after it
- **Bulk edit**: select summaries, then set their category, toggle importance, or **Re-summarize** two or more of them into one. The merged summary takes the place of the first selected one and covers all of their messages; the others are removed.
- **Reset**: deletes all V3 data for the chat, after two confirmations.
- **Convert to V3**: shown when the chat has V2 data and no V3 summaries (see [[Conversion paths|Long Term Memory#conversion-paths]]).
- **Next target preview**: shows which message will be summarized next.
