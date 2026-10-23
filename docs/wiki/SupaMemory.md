# SupaMemory

SupaMemory is the oldest [[Long Term Memory]] system. When the prompt no longer fits in Max Context, it summarizes the oldest messages and adds the result to one running summary. When that summary gets long, it summarizes the summary. Nothing happens while the chat still fits.

**HypaMemory (v1)** is SupaMemory with one extra step: it keeps every chunk summary it has written and retrieves the most relevant ones by embedding similarity. It is covered at the end of this page. It is not the same thing as [[HypaMemory V2]] or [[HypaMemory V3]].

## Enabling

1. **Settings → Other Bots → Long Term Memory → Type → SupaMemory**. Selecting it sets the model to distilbart.
2. Optionally check **Enable HypaMemory** to get v1, and pick an **Embedding** model.
3. Turn on the character's memory toggle in the chat toggles. It reads **Toggle SupaMemory**, or **Toggle HypaMemory** when v1 is on (it also reads **Toggle HypaMemory** when HypaMemory V2 or V3 is on, and **HanuraiMemory** when Hanurai is on). The toggle shows when the memory type is not none, or when Hanurai, V2 or V3 is on.
   <!-- src/lib/SideBars/Toggles.svelte:192-194,207-209; src/lang/en.ts:1321,1486,1607 -->
   **Fork difference:** with V2 on, the label is **Toggle HypaMemory** (upstream shows **Toggle SupaMemory**). The toggle also shows when the memory model is none but V2 is on. Upstream gives V3's label priority over Hanurai; here HanuraiMemory comes first (checked against local `upstream/main` 61d0eb79a, 2026-10-20).

## Settings

- **SupaMemory Model**: what writes the summaries.
  - **distilbart-cnn-6-6 (Free/Local)**: a small summarization model run in the browser. It ignores the SupaMemory Prompt.
  - **OpenAI 3.5 Turbo Instruct**: calls OpenAI's completions endpoint with `gpt-3.5-turbo-instruct`, at most 600 output tokens and temperature 0. The prompt sent is the chat text, then the SupaMemory Prompt, then `Output:`. It needs the **SupaMemory OpenAI Key**. A saved model of `davinci` or `curie` is changed to this option every time the settings load.
    <!-- src/ts/storage/database.svelte.ts:257-261; src/lib/Setting/Pages/OtherBotSettings.svelte:1072-1075 -->
    **Fork difference:** upstream's request code still sends the old `text-davinci-003` and `text-curie-001` ids for those saved values (checked against local `upstream/main` 61d0eb79a, 2026-10-20).
  - **Auxiliary Model**: your Auxiliary Model, or the memory model if **Separate Models for Auxiliary Models** is set up. If the prompt starts with `<|im_start|>`, it is parsed as ChatML and `{{slot}}` is replaced by the chat text. Otherwise the model gets the chat text as a user message, followed by the prompt as a system message.
- **Max SupaMemory Chunk Size** (default 1200, minimum 100): the maximum size of one chunk of messages sent to be summarized. The effective limit is the smaller of this and Max Context ÷ 3.
- **SupaMemory OpenAI Key**: only shown for the OpenAI option.
- **SupaMemory Prompt**: the summarization instruction. When blank, a built-in "summarize the ongoing role story and remove redundancy" instruction is used.
- **Enable HypaMemory**: switches to v1 (see below).
- **Memory Punctuation Removal** (Settings → Advanced Settings): strips most punctuation from the saved SupaMemory summary when it is loaded, and from v1's stored chunk summaries before they are embedded. It is not applied to v1's running summary, and it affects no other memory system.

## How it works

The check counts the prompt including the reserved response length, plus 10 tokens. If that fits in Max Context, SupaMemory does nothing. The saved summary is not inserted either.

Otherwise:

1. **Drop the preamble.** Everything before the "[Start a new chat]" marker is removed, which is the example messages.
2. **Resume.** If a summary was saved before, the messages it already covers are removed from the front of the history. Coverage is by position in the chat's full message list, hidden messages included: every message before the saved resume message is dropped, and the resume message itself is dropped too when the chat's covered marker names it (see Data). Messages without an ID, or whose ID is not in the chat's message list, are dropped as well. The summary's tokens are counted instead. If the resume message is not in the chat's message list, SupaMemory falls back to scanning the prompt for it, and if that fails it stops with *"SupaMemory: the saved resume point (a message that no longer exists) cannot be found. Press 'Reset SupaMemory data' in the character's chat memory settings to continue."*
   <!-- src/ts/process/memory/supaMemory.ts:112-159 -->
   **Fork difference:** upstream scans the prompt only and stops with *"SupaMemory: chat ID not found"*. HypaMemory v1 keeps its own *"hypaMemory: chat ID not found"* message (see below).
3. **If it fits now**, the summary is inserted as a system message at the start of the history, and the request continues.
4. **Otherwise, summarize until it fits.** Each round:
   - Take messages from the oldest end until the next one would exceed the chunk size. If the very first message is already larger than the chunk size, it is taken on its own, unless it is a system or function message, in which case SupaMemory stops with *"Not Enough Tokens to summarize in SupaMemory"*. <!-- src/ts/process/memory/supaMemory.ts:379-397 --> **Fork difference:** upstream has no error for this case; it takes nothing for that chunk. Messages are written as `Name: text`: the character's name for assistant messages (left blank in group chats) and your user name for others.
   - Summarize that chunk and append the result to the running summary as a new paragraph. Before appending, if the running summary already has 4 or more paragraphs, the whole summary is summarized into one first.
   - If all remaining messages would fit in a single chunk, SupaMemory first re-summarizes the running summary instead. If that is still not enough, it shrinks the chunk size to 70% and tries again. Once the chunk size would go below 500, it stops with *"Not Enough Tokens to summarize in SupaMemory"*.
5. **Insert** the running summary as a system message at the start of the remaining history.

## Data

The summary is saved per chat, as plain text:

```
<id of the first message not yet summarized>
<summary text>
```

The character settings panel shows this as a **SupaMemory** text box, when the chat has data (longer than 4 characters) or the character's memory toggle is on. You can edit or clear it there. Keep the first line as a message ID from the chat.
<!-- src/lib/SideBars/CharConfig.svelte:1249-1251,1289-1291 -->

**Fork difference:** each chat can also carry a covered marker (`supaMemoryCoveredId`). It only counts while it equals the first line of the summary data, and then it means that first-line message is already summarized, not just the ones before it. A write after a send keeps the marker only if it was valid before the write and still matches the new first line; otherwise the write deletes it. Clearing or hand-editing the text box does not remove the marker; the next send deletes a stale one. The marker is not removed from exports, and upstream ignores it (upstream handling of it was not traced).
<!-- src/ts/storage/database.svelte.ts:1882-1888; src/ts/process/memory/supaResume.ts:143-159 -->

### Reset SupaMemory data

**Fork difference.** Under the **SupaMemory** text box, in the character's Advanced Settings, there is a **Reset SupaMemory data** button. It asks for confirmation first ("Clear this chat's SupaMemory summary data? This cannot be undone."), and only on yes does it empty the chat's SupaMemory text and delete its covered marker. Because the whole text is emptied, a v1 `hypa:` snapshot list stored in the same place is wiped too. It does not touch HypaMemory V2 or V3 data. For a normal character the button shows only when neither HypaMemory V2 (with a memory model other than none) nor V3 is on; in those cases the Hypa V2/V3 modal buttons are shown instead. For a group it shows whenever the text box shows.
<!-- src/lib/SideBars/CharConfig.svelte:1226-1264,1288-1305; src/lang/en.ts:1323-1324 -->

### When messages are removed

**Fork difference.** Plain SupaMemory keeps its resume point valid when messages are deleted:

- If a removal deletes the resume message, the resume point moves to the first surviving message that came after it (hidden messages count). The summary text stays the same, and a stale covered marker is deleted. If nothing came after it, the last surviving message becomes the resume point and is marked covered. Nothing is re-summarized. If no message survives, or the resume message was not in the old list, nothing changes.
- This applies to: removing one message, "remove from here", shift-click truncate and Branch (the new branch chat is repointed against the full old message list) in the chat screen; the chat commands `/cut` (by index, range or id) and `/del` (see [[Chat Commands]]); the `cutchat` and `v2CutChat` trigger effects (see [[Trigger Script]]); and the Lua `cutChat` and `removeChat` functions (see [[Lua API Reference]]).
- **Empty-chat rule.** A chat that ends up with zero messages has its SupaMemory text (plain and `hypa:`) and covered marker cleared. This happens in `/send` clear mode, in Lua `setFullChat`, in a removal that empties the chat, and when plugins write with `setChatToIndex` (that chat), `setCharacterToIndex` or `setCharacter` (that character's chats), or `setDatabase` or `setDatabaseLite` when the written data has a `characters` list (every character's chats). Boot, restore and import never apply it. It does not touch HypaMemory V2 or V3 data.
<!-- src/ts/process/memory/supaResume.ts:59-141; src/lib/ChatScreens/Chat.svelte:258-265,302-309,1312-1314; src/ts/process/command.ts:222-258,296; src/ts/process/triggers.ts:1578,2013; src/ts/process/scriptings.ts:349,361,443 -->
<!-- src/ts/plugins/apiV3/v3.svelte.ts:726,1043; src/ts/plugins/plugins.svelte.ts:664-666,770,1029,1046,1077 -->


## HypaMemory (v1)

With **Enable HypaMemory** checked, the steps above change in three ways:

- **Chunk summaries are kept.** Every chunk summary is also stored in a separate list.
- **Retrieval, only when over Max Context.** The stored chunk summaries that are not already in the running summary are embedded. The query is the oldest remaining non-system messages of the history (up to four of them). The top three matches are added to the prompt as a `past events:` line (the three matches are separated by newlines), either in the same system message as the summary or in a separate system message before it.
- **Earlier compaction.** The running summary is re-summarized once it reaches 3 paragraphs instead of 4.

v1 keeps a history of snapshots in the same place as the plain-text summary above, marked with `hypa:` on the first line followed by a JSON array, newest first:

```
hypa:
[
  { "id": "<resume message id>", "supa": "<running summary>", "hypa": ["<chunk summary>", "..."] }
]
```

When the chat is loaded, the first snapshot whose resume message is still in the chat is used. So if you delete recent messages, v1 falls back to an older snapshot instead of failing. A new snapshot is added whenever the resume point moves. If none of the snapshots match, v1 stops with *"hypaMemory: chat ID not found"*. The loaded snapshot's running summary is counted toward the token total.
<!-- src/ts/process/memory/supaMemory.ts:100-110,194 -->

**Fork difference:** the loaded snapshot's tokens are now counted, and the `past events:` matches are joined with newlines (upstream does not count the loaded snapshot's summary and joins the matches with commas; compared against local `upstream/main` 61d0eb79a, 2026-10-20).

Switching between SupaMemory and v1 does not convert data; see [[Conversion paths|Long Term Memory#conversion-paths]].
