# Lorebook

A Lorebook is a set of text entries ("lore"). The app inserts them into the prompt under conditions that depend on the content of the chat. A lorebook lets you give a character a large amount of background knowledge, and you do not pay its token cost on every turn.
<!-- src/ts/process/lorebook.svelte.ts:114 -->

## Where lorebooks live

For every scan, the app merges three scopes into one list, in this order: **Character Lore**, then the **Chat Lore** of the current chat, then the **Module Lore** of enabled modules.
<!-- src/ts/process/lorebook.svelte.ts:137-140 -->

- **Character Lore**: Belongs to the character and travels with the character card.
  <!-- src/ts/storage/database.svelte.ts:1409 -->
- **Chat Lore**: Belongs to one specific chat only.
  <!-- src/ts/storage/database.svelte.ts:1879 -->
- **Module Lore**: Comes from any enabled [[module|Modules]]. The app joins the entries of all enabled modules in the order of the modules.
  <!-- src/ts/process/modules.ts:767-778 -->

The database still initializes a global `loreBook` list on load. But there is no Global Lorebook settings page, and chats never use its entries. The scan builds its list only from character lore, chat lore, and module lore.
<!-- src/ts/storage/database.svelte.ts:364-371,873; src/ts/process/lorebook.svelte.ts:137-140 -->
**Fork difference:** Upstream has a `GlobalLoreBookSettings.svelte` page. It is present in local `upstream/main` 61d0eb79a. It is absent here, because no such file exists under `src/lib/Setting/Pages`.

Folders only group entries in the UI. They have a placeholder key that practically never matches chat text. So they organize the list, but they never insert content themselves.
<!-- src/ts/process/lorebook.svelte.ts:78-106; src/lib/SideBars/LoreBook/LoreBookData.svelte:121-133 -->

Suppose you toggle **Locally Active** on a Character Lore entry from within a chat. Then the app creates a linked copy in the Chat Lore of that chat. The copy mirrors the name and text of the parent entry. It is always active for that chat only. The original entry is not duplicated.
<!-- src/ts/process/lorebook.svelte.ts:375-388; src/lib/SideBars/LoreBook/LoreBookData.svelte:52-87 -->

## Entry fields

- **Name**: A label for display only.
- **Activation Keys**: Separated by commas. Any one key that matches activates the entry, unless a negative decorator says otherwise (see Activation below). With **Use Regex** on, a comma inside a `/pattern/flags` key stays part of that key (see Activation).
- **Secondary Keys**: The app uses them only when **Selective** is on. See Activation below. The app splits and matches them the same way as the Activation Keys.
- **Always Active**: Skips the key matching entirely. The entry is always included, within the token budget.
- **Insertion Order**: See Ordering and token budget below.
- **Prompt**: The text to insert, plus any leading `@@decorator` lines (see the decorator list below).
- **Use Regex**: Treats keys written as `/pattern/flags` as regular expressions. The app still matches any other key in the list as plain text (see Activation). The page hides it for Always Active entries and in lorePlus mode. The default is off.
- **Activation Probability**: The current save format expresses this as an `@@probability` decorator (see Legacy).
- **Case Sensitive**: A checkbox next to Use Regex. It is off by default. When it is on, plain keys must match the letter case exactly. The help text says: "If enabled, plain keys must match the letter case exactly. Regex keys (/regex/flags) use their own flags." It has no effect on `/pattern/flags` keys, which follow their own flags. Without `i`, they are already case-sensitive. The page hides the checkbox for Always Active entries and, like Use Regex, in lorePlus mode. The app stores the setting for each entry. It round-trips through the export and import of character cards (V2 and V3). The app now matches a card that you import with `case_sensitive: true` in a case-sensitive way.
  <!-- src/lib/SideBars/LoreBook/LoreBookData.svelte:288-297; src/ts/process/lorebook.svelte.ts:212-223,629; src/ts/characterCards.ts:1577,1607,1622,2038,2054; src/lang/en.ts:598,1629 -->
  **Fork difference:** Upstream RisuAI keeps the field and the card round trip. But it has no checkbox, and its matcher always lowercases. The authors compared this with local `upstream/main` 61d0eb79a, 2026-10-20.

## Activation

Each time the app builds the prompt, the engine scans all entries that have not activated yet. It repeats the scan until no new entry activates. This repetition makes recursive scanning possible.
<!-- src/ts/process/lorebook.svelte.ts:342-697 -->

The engine does these steps for each entry. It skips them for an entry that is Always Active or that a decorator force-activated:

1. The engine checks the primary **Activation Keys** against the last *N* messages (Scan Depth, see below), plus any lore text that recursion already activated. One matching key is enough. The engine trims each key and drops empty keys before it matches.
   <!-- src/ts/process/lorebook.svelte.ts:166-183,612-615 -->
2. If **Selective** is on and Secondary Keys are set, the engine checks the secondary key group too. Both groups must match for the entry to activate. The page hides the Selective checkbox while Use Regex is on. But the engine still enforces a saved Selective entry with Secondary Keys when it checks the keys.
   <!-- src/ts/process/lorebook.svelte.ts:617-622,624-646; src/lib/SideBars/LoreBook/LoreBookData.svelte:282 -->
3. The engine matches a plain key against the message text after it removes `{{// ...}}` and `{{comment: ...}}`. If **Case Sensitive** is off, it first lowercases both the text and the key. If Full Word Matching is off, the engine ignores spaces in both the key and the searched text before it compares substrings. If Full Word Matching is on, the engine splits the text on spaces, and a key must equal one of the words.
   <!-- src/ts/process/lorebook.svelte.ts:212-223,270-313 -->
4. If **Use Regex** is on, the engine first splits the key list. A comma inside a `/pattern/flags` key stays in the key. So `/a,b/i`, `/dragon{1,2}/`, `/a\/,b/`, and `/[/],x/` are each one key. A backslash escapes the next character. A `[...]` class can contain slashes. Two kinds of keys end at the next comma: a key that starts with `/` but has no closing `/flags` followed by a comma or the end of the list, and any key that does not start with `/`. The recognized flags are `d g i m s u v y`. Edge cases: `/x/, /y/` is two keys. `/a/i/` is one key. `http://a.b/c,d` splits at the comma. `/` and `//` are single keys. `and/or,x` splits.
   <!-- src/ts/process/loreKeys.ts:1-74; src/ts/process/lorebook.svelte.ts:613,619 -->
5. In regex mode, the engine tests a key written as `/pattern/flags` as a regular expression with its own flags. It tests against the raw message text (`m.data`), with no lowercasing and no removal of comments. An invalid regular expression makes the whole check fail, so the entry does not activate. A key that is not in the `/pattern/flags` form no longer fails the check. The engine matches it as a plain key (comments removed, spaces ignored, lowercased unless Case Sensitive). In regex mode, the engine does not apply Full Word Matching to these plain keys. In both modes, the engine never matches against the wrapped form `name: text` (`m.prompt`). It uses that form only to label matches in the debug match log.
   <!-- src/ts/process/lorebook.svelte.ts:225-268 -->
   **Fork difference:** Upstream splits every key list on `,`. So a comma inside a regex key breaks it. In regex mode, a key that is not `/pattern/flags` makes the whole check fail. The authors compared this with local `upstream/main` 61d0eb79a, 2026-10-20.
6. `@@additional_keys`, `@@exclude_keys`, and `@@exclude_keys_all` take their keys from the list of arguments of the decorator, separated by commas. They use the Use Regex and Case Sensitive settings of the entry. The regex branch does not read the "all" mode. So `@@exclude_keys_all` on a Use Regex entry deactivates the entry as soon as one key matches. The authors inferred this from the code. They did not run it. The decorator parser probably splits a regex key that contains a comma inside a decorator argument. The authors inferred this too, and did not check it. For `@@exclude_keys` and `@@exclude_keys_all`, an invalid regular expression counts as "no match". So the decorator does not exclude the entry.
   <!-- src/ts/process/lorebook.svelte.ts:529-550,624-633,225-268 -->
7. The export of character cards (V2 and V3) writes keys and secondary keys with the same splitter. So a comma inside a regex key stays in the key. The import joins keys with `, `.
   <!-- src/ts/characterCards.ts:1568-1582,1612-1613,2044-2045 -->
   **Fork difference:** The upstream export uses a plain `,` split.

**Scan Depth** and **Token Budget**: Each character (or group) can override the defaults of the whole app. If it does not override them, the default Scan Depth is 5 and the default Token Budget is 800.
<!-- src/ts/storage/database.svelte.ts:90-94,870-871,1559-1562; src/ts/process/lorebook.svelte.ts:150-154 -->

**Recursive scanning**: After an entry activates, its content joins the pool of text that later entries can match against. So lore can chain. You can toggle this globally for each character (default: on). Or you can toggle it for each entry with the decorators `@@recursive` and `@@unrecursive`. `@@no_recursive_search` excludes only the own text of that entry from the recursive matches of other entries.
<!-- src/ts/process/lorebook.svelte.ts:154,204,589-600,682-694 -->

## Ordering and token budget

1. The engine sorts all activated entries by **priority**, descending. Priority defaults to Insertion Order. You can override it for each entry with the `@@priority` decorator.
   <!-- src/ts/process/lorebook.svelte.ts:361-362,584-587,699-701 -->
2. The engine adds entries in that priority order until the next entry exceeds the Token Budget. It drops everything past the budget entirely.
   <!-- src/ts/process/lorebook.svelte.ts:703-724 -->
3. Then the engine sorts the surviving entries again by **Insertion Order** (descending) and reverses them. So an entry with a higher Insertion Order ends up later in the prompt. It is closer to the next reply of the model and generally has more influence. Priority only controls which entries survive the cut by the budget.
   <!-- src/ts/process/lorebook.svelte.ts:741-743,780-783 -->
4. `@@ignore_on_max_context` forces the priority to `-1000`. That entry is the first to be dropped once the budget is tight. It does not exclude the entry outright when the budget allows it.
   <!-- src/ts/process/lorebook.svelte.ts:525-528 -->
5. The engine applies `@@inject_lore` merges after the cut by the budget. It matches them against the names of the surviving entries. Suppose the budget dropped the target entry. Then the engine drops the injecting entry too. It gives the tokens of the injecting entry back to the entries after it in priority order, and it repeats the cut until no injector is left without its target. A target that the latest run cut stays cut, even if the refunded tokens now fit it. Note: The engine appends the injected text after the cut. So the actual token count can still exceed the configured budget.
   <!-- src/ts/process/lorebook.svelte.ts:703-778 -->
   **Fork difference:** Upstream filters one time. So a lost target silently loses the injection, but the injector still used up its share of the budget. The authors compared this with local `upstream/main` 61d0eb79a, 2026-10-20.

## Positions

You set positions with the decorators `@@position`, `@@depth`, `@@reverse_depth`, and `@@role`. The default position is the normal lorebook block. The default role is `system`.

- **Normal** (no position decorator): The engine inserts the entry as part of the main lorebook block, in the order described above.
  <!-- src/ts/process/index.svelte.ts:968-978 -->
- **Before/After Character Description, Personality, Scenario** (`@@position before_desc|after_desc|personality|scenario`): The engine splices the entry next to those specific prompt fields.
  <!-- src/ts/process/index.svelte.ts:980-997 -->
- **Custom Prompt Template slot** (`@@position pt_<name>`): The engine pulls the entry in only where you place a `{{position::<name>}}` [[CBS|Curly Brased Syntaxes]] tag inside another prompt piece. This is typically a [[Prompt Template]] block. The engine resolves this up to 5 nesting levels deep. Then it strips any leftover `{{position::...}}` tags.
  <!-- src/ts/process/index.svelte.ts:939-966 -->
- **`@@depth 0`** (the same as the `@@end` decorator): The engine places the entry at the very end of the prompt, after everything else. It splits the entries into groups for roles other than assistant and for the assistant role. It adds assistant-role entries after user and system entries, because assistant content must stay a prefill.
  <!-- src/ts/process/index.svelte.ts:1025-1054 -->
- **`@@depth N`** (`N` > 0) / **`@@reverse_depth N`**: The engine splices the entry directly into the list of messages in context. It does not use the area of the system prompt. It uses an index that it computes from `N`. `depth` and `reverse_depth` count from opposite ends of the message list. This is useful for content that must appear to come from a specific point in the conversation, not from the system prompt.
  <!-- src/ts/process/index.svelte.ts:1513-1523,1665-1672 -->
- **`@@role user|assistant|system`**: Sets the chat role that the engine uses when it turns the entry into a message. It matters only for the depth-based positions above.
  <!-- src/ts/process/lorebook.svelte.ts:453-459 -->

## Injection decorators

These decorators are separate from `@@position`:

- **`@@inject_lore <target name>`**: Merges the text of this entry into another lore entry. The engine matches the target by the Name of that entry, after the cut by the token budget. The default operation is append.
- **`@@inject_at <target>`**: Targets a [[Prompt Template]] block instead of another lore entry. The default operation is append.
- **`@@inject_prepend`** / **`@@inject_replace <substring>`**: Change the operation that `inject_lore` or `inject_at` set. The new operation is prepend, or the replacement of a literal substring (`param`) inside the text of the target. You can combine these with `inject_lore` or `inject_at` on the same entry. The choice of the target and the operation are independent decorators.
  <!-- src/ts/process/lorebook.svelte.ts:481-523; src/ts/process/index.svelte.ts:1040-1047,1063-1088 -->

## All `@@` decorators

You write decorators one per line at the start of the Prompt text of an entry. The first line that is not `@@...` ends the decorator block. Everything from there on is the literal prompt text.
<!-- src/ts/process/lorebook.svelte.ts:390-605 -->

`@@@name args` (triple `@`) is a fallback form. It runs only if the decorator `@@name` immediately before it was not recognized. `@@@end` and `@@end` are always equivalent, and they always run, regardless of that fallback state. This lets you write a primary decorator plus a fallback for compatibility with other card formats during import and export.

Arguments follow the decorator name, separated by commas. For example, `@@depth 3` gives `["3"]`, and `@@additional_keys foo, bar` gives `["foo","bar"]`.

| Decorator | Arg(s) | Effect |
|---|---|---|
| `@@end` / `@@@end` | none | Resets the position to depth-based insertion at depth 0 (the same as `@@depth 0`). |
| `@@depth N` | int | See Positions above. |
| `@@reverse_depth N` | int | See Positions above. |
| `@@instruct_depth`, `@@reverse_instruct_depth`, `@@instruct_scan_depth` | none | Recognized but not supported, because "instruct mode" does not exist in this app. They count as not recognized. So any `@@@` fallback line that follows is used instead, if present. |
| `@@role user\|assistant\|system` | string | Sets the role that the engine uses when this entry becomes a message. The engine rejects any other value. |
| `@@scan_depth N` | int | Overrides the own scan depth of this entry (the look-back in messages) for the matching of keys. |
| `@@is_greeting N` | int | Activates only if the active greeting is the greeting with index `N-1`. (0 is the default First Message of the character. This matches the index of the alternate greetings plus 1.) |
| `@@position <target>` | `pt_<name>` or one of `after_desc`, `before_desc`, `personality`, `scenario` | See Positions above. The engine rejects any other value. |
| `@@inject_lore <name>` | text | See Injection decorators above. |
| `@@inject_at <target>` | text | See Injection decorators above. |
| `@@inject_replace <substring>` | text | See Injection decorators above. |
| `@@inject_prepend` | none | See Injection decorators above. |
| `@@ignore_on_max_context` | none | See Ordering above (forces priority `-1000`). |
| `@@additional_keys k1, k2` | list | Adds a required key group. The engine combines it with the primary key group by AND. Keys inside the group are combined by OR. |
| `@@exclude_keys k1, k2` | list | Deactivates the entry if any of these keys is present. |
| `@@exclude_keys_all k1, k2` | list | Deactivates the entry only if all of these keys are present. |
| `@@match_full_word` | none | Forces whole-word matching for this entry. It overrides the setting of the whole app or of the character. |
| `@@match_partial_word` | none | Forces substring matching for this entry. |
| `@@is_user_icon` | none | Recognized but not implemented. It has no effect. |
| `@@activate` | none | Force-activates the entry, regardless of key matching. |
| `@@dont_activate` | none | Force-deactivates the entry, regardless of key matching. |
| `@@keep_activate_after_match` | none | After this entry matches one time, it force-activates on every future turn of that chat. |
| `@@dont_activate_after_match` | none | After this entry matches one time, it force-deactivates on every future turn of that chat. |
| `@@disable_ui_prompt <target>` | `post_history_instructions` or `system_prompt` | Suppresses that built-in UI prompt block when this entry is active. The engine rejects any other value. |
| `@@probability N` | int (0–100) | The engine rolls again on every scan pass. The entry has roughly an `N`% chance to activate even if keys match. |
| `@@priority N` | int | See Ordering above. It is independent of Insertion Order. |
| `@@recursive` | none | Forces the activated text of this entry to be scannable by the recursive matching of other entries. It overrides the setting of the whole app or of the character. |
| `@@unrecursive` | none | Forces the opposite. |
| `@@no_recursive_search` | none | The engine excludes the own recursive-match text pool of this entry when other entries scan recursively. It does not matter whether this entry itself does recursive scanning. |
| `@@activate_only_after N` | int | Activates only after the chat reaches at least `N` messages, including the active greeting. |
| `@@activate_only_every N` | int | Activates only on every `N`th message. |
| any unrecognized `@@name` | none | The engine drops it silently. It enables the next `@@@` fallback line, if any. |

## Character, module, and chat lorebooks

- You edit Character Lore and Chat Lore in the same Lorebook panel in the sidebar of a character, on separate "Character" and "Chat" tabs. Chat Lore exists only in the current chat. Other chats with the same character do not share it.
  <!-- src/lib/SideBars/LoreBook/LoreBookSetting.svelte:50-66 -->
- Module Lore ships inside a module. The app merges it in for every character that has that module enabled. There is no override of the own lorebook entries of a module for each character.
- Import and export write and read JSON in the form `{"type":"risu","ver":1,"data":[...]}`. The import also accepts a `character_book` object of a Character Card V2 or V3. It uses its `entries` list. It maps fields such as `keys`, `secondary_keys`, `order`, `priority`, `constant`, and `selective` onto the fields described above.
  <!-- src/ts/process/lorebook.svelte.ts:787-822,847-889 -->

## Legacy

- The app migrates the old Activation Probability number field on load into an `@@probability N` decorator. It prepends the decorator to the content of the entry. Then it clears the field itself. This runs one time for each entry.
  <!-- src/ts/characters.ts:788-805 -->
- In the same pass, the app migrates the legacy tags `<end>`, `<bot>`, and `<user>` inside lore content to `@@depth 0`, `{{char}}`, and `{{user}}`.
  <!-- src/ts/characters.ts:800 -->
- The app still accepts two other internal entry types from older save formats, for backward compatibility. But the current UI writes only Normal, Child, or Folder entries. The Always Active toggle fully controls the always-active behavior.
  <!-- src/ts/storage/database.svelte.ts:1379; src/ts/process/lorebook.svelte.ts:375-388 -->
- The export and import of character cards round-trip a lore-cache field for compatibility. The current activation engine does not read it.
  <!-- src/ts/characterCards.ts:1579,1609,2040 -->

## Worked examples

**Simple keyword lore:**
- Name: `Hara`, Activation Keys: `hara, idol`, Insertion Order: `100`
- Prompt: `Hara is a 22-year-old idol who...`
- Whenever "hara" or "idol" appears in the last 5 messages (the default Scan Depth), the app inserts the text of this entry.

**Selective (AND) lore:**
- Activation Keys: `sword`. Secondary Keys: `broken`. Selective: on.
- The entry activates only when a recent message contains "sword" **and** a recent message contains "broken". The two words can be in different messages.

**An always-on note pinned to the very end of the prompt:**
- Always Active: on
- Prompt:
  ```
  @@depth 0
  @@role system
  Stay in character. Never break the fourth wall.
  ```

**Chained (recursive) lore with a probability gate:**
- Entry A: Activation Keys: `forest`. Prompt: `The forest hides an old shrine.`
- Entry B: Activation Keys: `shrine`. Prompt:
  ```
  @@probability 50
  The shrine grants one wish per century.
  ```
- If a message mentions "forest", entry A activates. The text of A then makes the "shrine" key of B match on the same scan (recursive scanning). B has a 50% chance on each pass to activate too.
