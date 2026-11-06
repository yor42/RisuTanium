# HypaMemory V2

HypaMemory V2 is a [[Long Term Memory]] system. It summarizes old messages in chunks of a set token size, and it keeps every summary. On each request, it builds a memory block from two parts: the earliest summaries, and summary paragraphs that the app retrieves by embedding similarity to the latest messages. It is the predecessor of [[HypaMemory V3]]. You can convert its data to V3.

## Enabling

1. Go to **Settings → Other Bots → Long Term Memory → Type → HypaMemory V2**. When you select it, the app sets the model to distilbart.
2. In the same section, pick an **Embedding** model. See [[Embedding models|Long Term Memory#embedding-models]].
3. In the chat toggles, turn on the memory toggle of the character. With V2 on, it reads **Toggle HypaMemory**.
   <!-- src/lib/SideBars/Toggles.svelte:192-194,207-209; src/lang/en.ts:1486 -->
   **Fork difference:** With V2 on, upstream labels the toggle **Toggle SupaMemory**. Here it is **Toggle HypaMemory**. The toggle also appears when the memory model is none and V2 is on.

## Settings

- **SupaMemory Model**: The summarizer. The options are the same as for [[SupaMemory]]: **distilbart-cnn-6-6 (Free/Local)**, **OpenAI 3.5 Turbo Instruct** (needs the **SupaMemory OpenAI Key**, at most 600 output tokens), and **Auxiliary Model**.
- **Summarization Prompt**: If you leave it blank, the app uses a built-in instruction, "summarize the ongoing role story and remove redundancy". For the Auxiliary Model, the app parses a prompt that starts with `<|im_start|>` as ChatML, and replaces `{{slot}}` with the chat text. The app sends any other prompt as a system message after the chat text. distilbart ignores the prompt. This is the same stored prompt as the SupaMemory Prompt.
- **Chunk Size** (default 3000, minimum 100): The maximum number of tokens of messages that the app summarizes into one summary.
- **Allocated Tokens** (default 3000, minimum 100): The token budget for the memory block.

## How it works

While the toggle is on, this process runs on every request.

1. **Budget.** V2 counts the prompt including the reserved length of the response (**Max Response**), as [[SupaMemory]] does. It adds **Allocated Tokens** as a placeholder for the memory block. Then it compares the result with Max Context.
   <!-- src/ts/process/memory/hypav2.ts:391-393; src/ts/process/index.svelte.ts:1057 -->
   **Fork difference:** Upstream first subtracts Max Response from the count.
2. **Clean up.** The app discards a summary, together with its paragraphs, only in one case. A message that the summary covers is gone from both the full message list of the chat and the prompt. For example, someone deleted that message. Hidden messages do not make a summary invalid. Messages before an "all before" reset do not make a summary invalid either. The app never discards a summary whose covered entries all have no message ID. When the data loads, the app reads a stored empty memo as no memo.
   <!-- src/ts/process/memory/hypav2.ts:291-326,338-356 -->
   **Fork difference:** The discard rule and the handling of a null memo.
3. **Resume.** The resume point is the latest position in the history of any message that any summary covers. The messages up to that point are already summarized. The app removes them from the history. Entries without a message ID (the first message and example turns) count toward the resume point only in one case. The first of them must be something that the summarizer does not skip.
   <!-- src/ts/process/memory/hypaResume.ts:28-62; src/ts/process/memory/hypav2.ts:402-416 -->
   **Fork difference:** Upstream resumes after the last message of the last summary.
4. **Summarize while over budget.** The app starts at the resume point and collects messages until the next message exceeds **Chunk Size**. The app never summarizes the last 4 messages. The app skips example turns (`example_user` / `example_assistant`), new-chat markers, and blank messages. It does not collect them. After a round succeeds, the app still subtracts their tokens from the total. <!-- src/ts/process/memory/hypaResume.ts:7-15; src/ts/process/memory/hypav2.ts:455-461 --> **Fork difference:** Upstream skipped the first entry of the history and blank messages. The app sends the collected messages as `role: text` lines. The result becomes a new summary. The app also splits the summary at blank lines into paragraphs for retrieval. The app repeats this until the prompt fits. It stops with an error if it can collect nothing:
   - *"… can't summarize last 4 messages …"*: Only the protected last messages remain. Increase Max Context.
   - *"Message tokens (…) exceeds chunk size (…)"*: A single message is larger than Chunk Size. Increase Chunk Size.
   - A summarization call can fail up to 3 times in a row. After that, V2 gives up with *"Summarization failed multiple times"*. Each retry takes the same batch of messages again, so the app skips nothing. If the app cannot resolve the SupaMemory OpenAI Key (a secret reference that does not resolve), it stops at once with no retries.
     <!-- src/ts/process/memory/hypav2.ts:67-78,513-535 -->
     **Fork difference:** The retry of the same batch.
5. **Build the memory block.**
   - **Past Events Summary**: The app takes summaries **starting from the newest** and goes back. It stops before the summary that exceeds half of Allocated Tokens. Then it shows the summaries that it took in chronological order.
     <!-- src/ts/process/memory/hypav2.ts:588-603 -->
     **Fork difference:** Upstream adds the oldest summaries first.
   - **Past Events Details**: The app scores every paragraph of every summary against the last three messages. The weights are 1 for the newest message, ½ for the one before it, and ⅓ for the third. The app adds up the scores. It adds paragraphs in the order of their scores. It stops before the paragraph that exceeds what is left of Allocated Tokens. These paragraphs can include paragraphs of summaries that the first part already shows.
6. **Insert** one system message at the start of the remaining history:

```
<Past Events Summary>
…summaries…</Past Events Summary>
<Past Events Details>…paragraphs…
</Past Events Details>
```

Once summaries exist, embedding runs on every request. The app embeds new paragraphs one time and caches them. It embeds the three query messages each time.

## Data

The app stores this data for each chat:

- The summaries. Each summary has its text, the messages that it covers, and the last of those messages. The app works out the resume point from all the covered messages of all summaries, not from that last message alone. See How it works.
  <!-- src/ts/process/memory/hypaResume.ts:28-62; src/ts/process/memory/hypav2.ts:557-562 -->

- The retrieval paragraphs. Each paragraph has its text and a link back to the summary that it came from.
- An internal counter that numbers new summaries.

**Hypa V2 Modal** opens a viewer. In it, you can edit the text of every paragraph (**Chunks**) and every summary (**Summarized**). You find it in the character settings. If **Show Menu Hypa Modal** is on in the Accessibility settings, you also find it in the chat menu. If you edit a summary, the app does not update the paragraphs that it split from that summary.

The app migrates data in the old V2 format automatically the next time V2 runs. You can convert current V2 data to V3 in the Hypa V3 Modal. See [[Conversion paths|Long Term Memory#conversion-paths]].
