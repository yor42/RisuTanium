# Hanurai Memory

Hanurai Memory is a retrieval-only [[Long Term Memory]] system. It does not summarize anything. Instead, it embeds the older messages of the chat and puts back into the prompt the ones most similar to the latest messages, verbatim. It makes no model calls, only embedding calls.

## Enabling

1. **Settings → Other Bots → Long Term Memory → Type → HanuraiMemory**.
2. Pick an **Embedding** model in the same section (see [[Embedding models|Long Term Memory#embedding-models]]).
3. Turn on the character's **HanuraiMemory** toggle in the chat toggles.

## Settings

- **Chunk Size** (default 1000, minimum 100): the number of tokens set aside for retrieved text when older messages are trimmed. It is also a cap: the retrieved block never grows past Chunk Size. See step 4 below.
  <!-- src/ts/process/memory/hanuraiMemory.ts:63-74,92-114 -->
  **Fork difference:** upstream treats it as a reservation only, not a cap.
- **Text Spliting** (default off): when on, each message is split at blank lines, and every paragraph is embedded and retrieved on its own. When off, whole messages are the unit.
- **Embedding**: the shared embedding model.

## How it works

This runs on every request while the toggle is on, whether or not the chat is over Max Context.

1. **Documents.** Every entry in the chat history except the last three is embedded, as a whole or per paragraph (see **Text Spliting**). Empty entries are skipped. This includes example messages, the "[Start a new chat]" marker and the first message, because they are part of the history the prompt builder passes in. Texts are embedded with a `search_document:` prefix, and vectors are cached, so each text is only embedded once per model.
2. **Queries.** The last three messages are each used as a query, with a `search_query:` prefix. Every document's similarity score is summed across the queries, weighted 1 for the newest message, ½ for the one before it and ⅓ for the third.
3. **Trim.** The oldest entries are removed until the prompt, plus **Chunk Size**, fits inside Max Context. The prompt here includes the reserved response length. If everything is removed and it still does not fit, the request fails with the "too much token" error.
4. **Fill.** The retrieved texts are considered in score order.
   - A text that is already in the prompt is skipped. The prompt's texts are its whole messages and, with **Text Spliting** on, their paragraphs too.
   - A text that would push the retrieved block over **Chunk Size** is skipped, and later, smaller texts can still be added.
   - Filling stops at the first text that would push the prompt to Max Context.
   <!-- src/ts/process/memory/hanuraiMemory.ts:76-114 -->
   **Fork difference:** the Chunk Size cap, and the skip of paragraphs already in the prompt. Upstream skips only texts equal to a whole message, and stops only at Max Context, so it can use more than Chunk Size when there is room (compared against local `upstream/main` 61d0eb79a, 2026-10-20).
5. **Insert.** The chosen texts are joined with blank lines and placed as one system message at the start of the chat history.

## Data

Hanurai Memory saves nothing in the chat. The only thing it stores is the embedding cache in the browser (see [[Embedding models|Long Term Memory#embedding-models]]). Turning it off, or switching to another system, leaves no memory data behind.
