# HypaMemory V2

HypaMemory V2 is a [[Long Term Memory]] system. It summarizes old messages in token-sized chunks and keeps every summary. Each request, it builds a memory block from two parts: the earliest summaries, and summary paragraphs retrieved by embedding similarity to the latest messages. It is the predecessor of [[HypaMemory V3]], and its data can be converted to V3.

## Enabling

1. **Settings → Other Bots → Long Term Memory → Type → HypaMemory V2**. Selecting it sets the model to distilbart.
2. Pick an **Embedding** model in the same section (see [[Embedding models|Long Term Memory#embedding-models]]).
3. Turn on the character's memory toggle in the chat toggles. With V2 on it reads **Toggle HypaMemory**.
   <!-- src/lib/SideBars/Toggles.svelte:192-194,207-209; src/lang/en.ts:1486 -->
   **Fork difference:** upstream labels the toggle **Toggle SupaMemory** with V2 on; here it is **Toggle HypaMemory**. The toggle also shows when the memory model is none but V2 is on.

## Settings

- **SupaMemory Model**: the summarizer. The options are the same as for [[SupaMemory]]: **distilbart-cnn-6-6 (Free/Local)**, **OpenAI 3.5 Turbo Instruct** (needs the **SupaMemory OpenAI Key**, at most 600 output tokens) and **Auxiliary Model**.
- **Summarization Prompt**: blank uses a built-in "summarize the ongoing role story and remove redundancy" instruction. For the Auxiliary Model, a prompt starting with `<|im_start|>` is parsed as ChatML, with `{{slot}}` replaced by the chat text. Any other prompt is sent as a system message after the chat text. distilbart ignores the prompt. This is the same stored prompt as the SupaMemory Prompt.
- **Chunk Size** (default 3000, minimum 100): the maximum number of tokens of messages summarized into one summary.
- **Allocated Tokens** (default 3000, minimum 100): the token budget for the memory block.

## How it works

This runs on every request while the toggle is on.

1. **Budget.** V2 counts the prompt including the reserved response length (**Max Response**), as [[SupaMemory]] does, and adds **Allocated Tokens** as a placeholder for the memory block. It then compares the result with Max Context.
   <!-- src/ts/process/memory/hypav2.ts:391-393; src/ts/process/index.svelte.ts:1057 -->
   **Fork difference:** upstream subtracts Max Response from the count first.
2. **Clean up.** A summary is discarded, together with its paragraphs, only if a message it covers is gone from both the chat's full message list and the prompt, for example because that message was deleted. Hidden messages, and messages before an "all before" reset, do not invalidate a summary. A summary whose only covered entries have no message ID is never discarded. A stored empty memo is read back as no memo when the data loads.
   <!-- src/ts/process/memory/hypav2.ts:291-326,338-356 -->
   **Fork difference:** the discard rule and the null-memo handling.
3. **Resume.** The resume point is the latest position in the history of any message covered by any summary. Messages up to it are already summarized and are removed from the history. Entries without a message ID (the first message, example turns) count toward the resume point only when the first of them is something the summarizer would not skip.
   <!-- src/ts/process/memory/hypaResume.ts:28-62; src/ts/process/memory/hypav2.ts:402-416 -->
   **Fork difference:** upstream resumes after the last message of the last summary.
4. **Summarize while over budget.** Starting at the resume point, messages are collected until the next one would exceed **Chunk Size**. The last 4 messages are never summarized. Example turns (`example_user` / `example_assistant`), new-chat markers and blank messages are skipped, not collected (their tokens are still counted off the total once a round succeeds). <!-- src/ts/process/memory/hypaResume.ts:7-15; src/ts/process/memory/hypav2.ts:455-461 --> **Fork difference:** upstream skipped the first entry of the history and blank messages. The collected messages are sent as `role: text` lines, and the result becomes a new summary. It is also split at blank lines into paragraphs for retrieval. This repeats until the prompt fits. It stops with an error if nothing can be collected:
   - *"… can't summarize last 4 messages …"* when only the protected last messages remain. Increase Max Context.
   - *"Message tokens (…) exceeds chunk size (…)"* when a single message is larger than Chunk Size. Increase Chunk Size.
   - A summarization call may fail up to 3 times in a row before V2 gives up with *"Summarization failed multiple times"*. Each retry takes the same batch of messages again, so nothing is skipped. A failure to resolve the SupaMemory OpenAI Key (a secret reference that cannot be resolved) stops at once with no retries.
     <!-- src/ts/process/memory/hypav2.ts:67-78,513-535 -->
     **Fork difference:** the retry of the same batch.
5. **Build the memory block.**
   - **Past Events Summary**: summaries are taken **starting from the newest** and going back, until the next one would exceed half of Allocated Tokens. The ones taken are then shown in chronological order.
     <!-- src/ts/process/memory/hypav2.ts:588-603 -->
     **Fork difference:** upstream adds the oldest summaries first.
   - **Past Events Details**: every paragraph of every summary is scored against the last three messages. The weights are 1 for the newest, ½ and ⅓ for the others, and the scores are summed. Paragraphs are added in score order until the next one would exceed what is left of Allocated Tokens. They can include paragraphs of summaries already shown in the first part.
6. **Insert** one system message at the start of the remaining history:

```
<Past Events Summary>
…summaries…</Past Events Summary>
<Past Events Details>…paragraphs…
</Past Events Details>
```

Embedding runs on every request once summaries exist. New paragraphs are embedded once and cached, and the three query messages are embedded each time.

## Data

Stored per chat:

- The summaries, each with its text, the messages it covers, and the last of those messages. The resume point is worked out from all the covered messages of all summaries, not from that last one alone (see How it works).
  <!-- src/ts/process/memory/hypaResume.ts:28-62; src/ts/process/memory/hypav2.ts:557-562 -->

- The retrieval paragraphs, each with its text and a link back to the summary it came from.
- An internal counter used to number new summaries.

**Hypa V2 Modal** opens a viewer where you can edit the text of every paragraph (**Chunks**) and every summary (**Summarized**). Find it in the character settings, or in the chat menu if **Show Menu Hypa Modal** is on in Accessibility settings. Editing a summary does not update the paragraphs that were split from it.

Data in the old V2 format is migrated automatically the next time V2 runs, and current V2 data can be converted to V3 from the Hypa V3 Modal. See [[Conversion paths|Long Term Memory#conversion-paths]].
