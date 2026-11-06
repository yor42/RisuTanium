# SupaMemory

SupaMemory is the oldest [[Long Term Memory]] system. When the prompt no longer fits in Max Context, it summarizes the oldest messages and adds the result to one running summary. When that summary gets long, it summarizes the summary. While the chat still fits, nothing happens.

**HypaMemory (v1)** is SupaMemory with one extra step. It keeps every chunk summary that it wrote, and it retrieves the most relevant summaries by embedding similarity. The end of this page covers it. It is not the same as [[HypaMemory V2]] or [[HypaMemory V3]].

## Enabling

1. Go to **Settings → Other Bots → Long Term Memory → Type → SupaMemory**. When you select it, the app sets the model to distilbart.
2. Optional: Check **Enable HypaMemory** to get v1, and pick an **Embedding** model.
3. In the chat toggles, turn on the memory toggle of the character. It reads **Toggle SupaMemory**. When v1 is on, it reads **Toggle HypaMemory**. It also reads **Toggle HypaMemory** when HypaMemory V2 or V3 is on, and **HanuraiMemory** when Hanurai is on. The toggle appears when the memory type is not none, or when Hanurai, V2, or V3 is on.
   <!-- src/lib/SideBars/Toggles.svelte:192-194,207-209; src/lang/en.ts:1321,1486,1607 -->
   **Fork difference:** With V2 on, the label is **Toggle HypaMemory**. Upstream shows **Toggle SupaMemory**. The toggle also appears when the memory model is none and V2 is on. Upstream gives the label of V3 priority over Hanurai. Here HanuraiMemory comes first. The authors checked this against local `upstream/main` 61d0eb79a, 2026-10-20.

## Settings

- **SupaMemory Model**: What writes the summaries.
  - **distilbart-cnn-6-6 (Free/Local)**: A small summarization model that runs in the browser. It ignores the SupaMemory Prompt.
  - **OpenAI 3.5 Turbo Instruct**: Calls the completions endpoint of OpenAI with `gpt-3.5-turbo-instruct`, at most 600 output tokens, and temperature 0. The prompt that the app sends is the chat text, then the SupaMemory Prompt, then `Output:`. It needs the **SupaMemory OpenAI Key**. Every time the settings load, the app changes a saved model of `davinci` or `curie` to this option.
    <!-- src/ts/storage/database.svelte.ts:257-261; src/lib/Setting/Pages/OtherBotSettings.svelte:1072-1075 -->
    **Fork difference:** The request code of upstream still sends the old ids `text-davinci-003` and `text-curie-001` for those saved values. The authors checked this against local `upstream/main` 61d0eb79a, 2026-10-20.
  - **Auxiliary Model**: Your Auxiliary Model. If **Separate Models for Auxiliary Models** is set up, it is the memory model. If the prompt starts with `<|im_start|>`, the app parses it as ChatML and replaces `{{slot}}` with the chat text. Otherwise the model gets the chat text as a user message, followed by the prompt as a system message.
- **Max SupaMemory Chunk Size** (default 1200, minimum 100): The maximum size of one chunk of messages that the app sends to be summarized. The effective limit is the smaller of this value and Max Context ÷ 3.
- **SupaMemory OpenAI Key**: The page shows it only for the OpenAI option.
- **SupaMemory Prompt**: The summarization instruction. If you leave it blank, the app uses a built-in instruction, "summarize the ongoing role story and remove redundancy".
- **Enable HypaMemory**: Switches to v1 (see below).
- **Memory Punctuation Removal** (Settings → Advanced Settings): Strips most punctuation from the saved SupaMemory summary when the app loads it. It also strips punctuation from the stored chunk summaries of v1 before the app embeds them. It does not apply to the running summary of v1. It affects no other memory system.

## How it works

The check counts the prompt including the reserved length of the response, plus 10 tokens. If that fits in Max Context, SupaMemory does nothing. It does not insert the saved summary either.

If it does not fit:

1. **Drop the preamble.** The app removes everything before the "[Start a new chat]" marker. This is the example messages.
2. **Resume.** Suppose the app saved a summary before. Then the app removes the messages that the summary already covers from the front of the history. Coverage is by position in the full message list of the chat, including hidden messages. The app drops every message before the saved resume message. It also drops the resume message itself when the covered marker of the chat names it (see Data). The app also drops messages without an ID, and messages whose ID is not in the message list of the chat. The app counts the tokens of the summary instead. If the resume message is not in the message list of the chat, SupaMemory falls back to a scan of the prompt for it. If that fails too, it stops with *"SupaMemory: the saved resume point (a message that no longer exists) cannot be found. Press 'Reset SupaMemory data' in the character's chat memory settings to continue."*
   <!-- src/ts/process/memory/supaMemory.ts:112-159 -->
   **Fork difference:** Upstream scans only the prompt. It stops with *"SupaMemory: chat ID not found"*. HypaMemory v1 keeps its own message, *"hypaMemory: chat ID not found"* (see below).
3. **If it fits now**, the app inserts the summary as a system message at the start of the history, and the request continues.
4. **If it does not fit, summarize until it fits.** Each round does this:
   - Take messages from the oldest end until the next message exceeds the chunk size. Suppose the very first message is already larger than the chunk size. Then SupaMemory takes it alone. The exception is a system message or a function message. For these, SupaMemory stops with *"Not Enough Tokens to summarize in SupaMemory"*. <!-- src/ts/process/memory/supaMemory.ts:379-397 --> **Fork difference:** Upstream has no error for this case. It takes nothing for that chunk. The app writes messages as `Name: text`. It uses the name of the character for assistant messages (blank in group chats) and your user name for other messages.
   - Summarize that chunk and append the result to the running summary as a new paragraph. Before the append, if the running summary already has 4 or more paragraphs, the app first summarizes the whole summary into one paragraph.
   - If all remaining messages fit in a single chunk, SupaMemory first summarizes the running summary again. If that is still not enough, it shrinks the chunk size to 70% and tries again. When the chunk size drops below 500, it stops with *"Not Enough Tokens to summarize in SupaMemory"*.
5. **Insert** the running summary as a system message at the start of the remaining history.

## Data

The app saves the summary for each chat, as plain text:

```
<id of the first message not yet summarized>
<summary text>
```

The character settings panel shows this as a **SupaMemory** text box. It appears when the chat has data (longer than 4 characters) or when the memory toggle of the character is on. You can edit or clear the text there. Keep the first line as a message ID from the chat.
<!-- src/lib/SideBars/CharConfig.svelte:1249-1251,1289-1291 -->

**Fork difference:** Each chat can also carry a covered marker (`supaMemoryCoveredId`). It counts only while it equals the first line of the summary data. Then it means that the message on the first line is already summarized, not only the messages before it. A write after a send keeps the marker only if two conditions hold: the marker was valid before the write, and it still matches the new first line. Otherwise the write deletes it. If you clear the text box or edit it by hand, the marker stays. The next send deletes a stale marker. The app does not remove the marker from exports. Upstream ignores it. The authors did not trace how upstream handles it.
<!-- src/ts/storage/database.svelte.ts:1882-1888; src/ts/process/memory/supaResume.ts:143-159 -->

### Reset SupaMemory data

**Fork difference.** In the Advanced Settings of the character, under the **SupaMemory** text box, there is a **Reset SupaMemory data** button. It first asks you to accept ("Clear this chat's SupaMemory summary data? This cannot be undone."). Only after you accept, it empties the SupaMemory text of the chat and deletes its covered marker. The whole text is emptied. So a v1 `hypa:` list of snapshots in the same place is wiped too. The button does not touch HypaMemory V2 or V3 data. For a normal character, the button appears only when neither HypaMemory V2 (with a memory model other than none) nor V3 is on. In those cases, the page shows the Hypa V2 or V3 modal buttons instead. For a group, the button appears whenever the text box appears.
<!-- src/lib/SideBars/CharConfig.svelte:1226-1264,1288-1305; src/lang/en.ts:1323-1324 -->

### When messages are removed

**Fork difference.** Plain SupaMemory keeps its resume point valid when someone deletes messages:

- If a removal deletes the resume message, the resume point moves to the first surviving message that came after it. Hidden messages count. The summary text stays the same, and the app deletes a stale covered marker. If nothing came after it, the last surviving message becomes the resume point and the app marks it as covered. The app summarizes nothing again. If no message survives, or if the resume message was not in the old list, nothing changes.
- This applies to these actions:
  - In the chat screen: removing one message, "remove from here", shift-click truncate, and Branch. For Branch, the app points the new branch chat again against the full old message list.
  - The chat commands `/cut` (by index, range, or id) and `/del`. See [[Chat Commands]].
  - The trigger effects `cutchat` and `v2CutChat`. See [[Trigger Script]].
  - The Lua functions `cutChat` and `removeChat`. See [[Lua API Reference]].
- **Empty-chat rule.** If a chat ends up with zero messages, the app clears its SupaMemory text (plain and `hypa:`) and its covered marker. This happens in these cases:
  - `/send` in clear mode.
  - Lua `setFullChat`.
  - A removal that empties the chat.
  - A plugin write with `setChatToIndex` (that chat), `setCharacterToIndex` or `setCharacter` (the chats of that character), or `setDatabase` or `setDatabaseLite` when the written data has a `characters` list (the chats of every character).

  Boot, restore, and import never apply the rule. It does not touch HypaMemory V2 or V3 data.
<!-- src/ts/process/memory/supaResume.ts:59-141; src/lib/ChatScreens/Chat.svelte:258-265,302-309,1312-1314; src/ts/process/command.ts:222-258,296; src/ts/process/triggers.ts:1578,2013; src/ts/process/scriptings.ts:349,361,443 -->
<!-- src/ts/plugins/apiV3/v3.svelte.ts:726,1043; src/ts/plugins/plugins.svelte.ts:664-666,770,1029,1046,1077 -->


## HypaMemory (v1)

When **Enable HypaMemory** is checked, the steps above change in three ways:

- **The app keeps chunk summaries.** The app also stores every chunk summary in a separate list.
- **Retrieval, only when over Max Context.** The app embeds the stored chunk summaries that are not already in the running summary. The query is the oldest remaining non-system messages of the history, up to four of them. The app adds the top three matches to the prompt as a `past events:` line. Newlines separate the three matches. The line goes in the same system message as the summary, or in a separate system message before it.
- **Earlier compaction.** The app summarizes the running summary again once it reaches 3 paragraphs, not 4.

v1 keeps a history of snapshots in the same place as the plain-text summary above. The first line is marked `hypa:`. A JSON array follows, newest first:

```
hypa:
[
  { "id": "<resume message id>", "supa": "<running summary>", "hypa": ["<chunk summary>", "..."] }
]
```

When the app loads the chat, it uses the first snapshot whose resume message is still in the chat. So if you delete recent messages, v1 falls back to an older snapshot and does not fail. Whenever the resume point moves, the app adds a new snapshot. If none of the snapshots match, v1 stops with *"hypaMemory: chat ID not found"*. The app counts the running summary of the loaded snapshot toward the token total.
<!-- src/ts/process/memory/supaMemory.ts:100-110,194 -->

**Fork difference:** The app now counts the tokens of the loaded snapshot. The app joins the `past events:` matches with newlines. Upstream does not count the summary of the loaded snapshot, and it joins the matches with commas. The authors compared this with local `upstream/main` 61d0eb79a, 2026-10-20.

A switch between SupaMemory and v1 does not convert data. See [[Conversion paths|Long Term Memory#conversion-paths]].
