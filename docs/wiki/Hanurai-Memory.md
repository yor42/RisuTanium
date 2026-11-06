# Hanurai Memory

Hanurai Memory is a [[Long Term Memory]] system that only retrieves. It does not summarize. It embeds the older messages of the chat (turns each message into a list of numbers). Then it puts the messages that are most similar to the latest messages back into the prompt, word for word. It makes no model calls. It makes only embedding calls.

## Enabling

1. Go to **Settings → Other Bots → Long Term Memory → Type → HanuraiMemory**.
2. In the same section, pick an **Embedding** model. See [[Embedding models|Long Term Memory#embedding-models]].
3. In the chat toggles, turn on the **HanuraiMemory** toggle of the character.

## Settings

- **Chunk Size** (default 1000, minimum 100): The number of tokens that the app reserves for retrieved text during the trim of older messages. It is also a limit. The retrieved block never grows past Chunk Size. See step 4 below.
  <!-- src/ts/process/memory/hanuraiMemory.ts:63-74,92-114 -->
  **Fork difference:** Upstream uses Chunk Size only as a reservation, not as a limit.
- **Text Spliting** (default off): When on, the app splits each message at blank lines. It embeds and retrieves every paragraph on its own. When off, the unit is the whole message.
- **Embedding**: The shared embedding model.

## How it works

While the toggle is on, this process runs on every request. It runs whether or not the chat is over Max Context.

1. **Documents.** The app embeds every entry in the chat history except the last three. It embeds each entry as a whole or per paragraph, depending on **Text Spliting**. The app skips empty entries. The prompt builder passes example messages, the "[Start a new chat]" marker, and the first message in as part of the history. The app embeds them too. The app adds a `search_document:` prefix to each text. It caches the vectors, so it embeds each text only one time for each model.
2. **Queries.** The app uses each of the last three messages as a query, with a `search_query:` prefix. For every document, the app adds up the similarity scores from the queries. The newest message has weight 1, the message before it has weight ½, and the third message has weight ⅓.
3. **Trim.** The app removes the oldest entries until the prompt plus **Chunk Size** fits inside Max Context. The prompt here includes the reserved length of the response. If the app removes everything and the prompt still does not fit, the request fails with the "too much token" error.
4. **Fill.** The app considers the retrieved texts in the order of their scores.
   - If a text is already in the prompt, the app skips it. The texts of the prompt are its whole messages. When **Text Spliting** is on, they also include the paragraphs of those messages.
   - If a text makes the retrieved block larger than **Chunk Size**, the app skips it. The app can still add later, smaller texts.
   - The app stops at the first text that makes the prompt reach Max Context.
   <!-- src/ts/process/memory/hanuraiMemory.ts:76-114 -->
   **Fork difference:** The fork has the Chunk Size limit. The fork also skips paragraphs that are already in the prompt. Upstream skips only texts that equal a whole message. Upstream stops only at Max Context. When there is room, it can use more than Chunk Size. This compares with local `upstream/main` 61d0eb79a, 2026-10-20.
5. **Insert.** The app joins the chosen texts with blank lines. It places them as one system message at the start of the chat history.

## Data

Hanurai Memory saves nothing in the chat. It stores only the embedding cache in the browser. See [[Embedding models|Long Term Memory#embedding-models]]. If you turn it off or switch to another system, no memory data stays behind.
