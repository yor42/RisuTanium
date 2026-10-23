# Chat Commands

Chat commands are short `/` lines that act on a chat: post a message, delete messages, set a variable, run a trigger and so on. This page is the reference for all of them. It describes what the code does now. Where the help window (`/?`) disagrees with the code, this page follows the code.

Related pages: [[RisuAI Basics]] (the message box), [[Trigger Script]] (the `command` effects), [[Settings Hotkeys]].

## Where commands run

Commands run from exactly three places:

- **The message box.** Press Send (or use **Continue Response**) with a line that **starts with `/` in the first column**. A leading space means it is an ordinary message.
- **A trigger's `command` effect (V1).**
- **A trigger's `v2Command` effect (V2).** A trigger button runs its trigger, so it reaches the same effects.

Nothing else runs commands: not the plugin API, not the translate box, not Post File. In a trigger effect the text is run through CBS first, and it does not need a leading `/`. Because each argument is CBS-parsed again afterwards, a trigger's command text is CBS-parsed twice, which matters for side effects such as `{{setvar::...}}`. A `command` or `v2Command` effect is skipped silently when the trigger run has no origin chat.

<!-- src/ts/process/composerActions.svelte.ts:280,283; src/ts/process/triggers.ts:1198-1212,1537-1541,2038-2042; src/ts/process/command.ts:63-104 -->

## How a line is parsed

| Rule | What happens |
|---|---|
| Chaining | `\|` separates commands. Each command is trimmed and receives the previous command's result as its **pipe**. The result of the last command is thrown away. |
| Runs of `\|` | A run of three or more `\|` is left in the text (that is how `/multisend` separates its segments). One or two `\|` split the line. `\|\|` leaves an empty command between the two, which is unknown, so the line fails. |
| The `/` | Optional on every command after the first: `/send hi \| send there` works. The first command needs it only so the message box treats the line as a command. |
| Case | Command names are case-sensitive. `/Send` is not a command. |
| Quoting | Only `"` is a quote, and it only stops `\|` from splitting. The quotes stay in the text. There is no escaping. An unbalanced `"` makes the rest of the line unsplittable. |
| Tokenising | After the command name, the text is split on the space character only. Empty pieces are dropped and the rest is joined with single spaces, so runs of spaces collapse. Tabs and newlines are not separators. |
| Named arguments | Any token containing `=` becomes a **named argument** (`key=value`) and is removed from the positional text. Only the first `=` splits: `key=a=b` gives the value `a`. So `/send 1+1=2` posts nothing for that token. Commands that read named arguments: `/setvar`, `/addvar`, `/getvar` (`key=`) and `/buttons` (`labels=`). Tip: avoid `=` in text you pass as a positional argument. |
| `{{pipe}}` and `{{slot}}` | In the positional text only, the **first** `{{pipe}}` (SillyTavern style) and the **first** `{{slot}}` are each replaced by the previous command's result (both placeholders are replaced, one occurrence each). Not applied inside named arguments. |
| Empty argument | If the positional text is empty, the argument is the incoming pipe. `/send` alone posts the pipe. |
| CBS | The argument and each named-argument value are run through CBS after tokenising. CBS that contains spaces or `\|` is split by the tokeniser first. This happens before the command is looked up, so CBS side effects such as `{{setvar::...}}` run even when the command name is unknown. Messages stored by `/send`, `/sendas` and `/comment` hold the CBS-parsed text. |

<!-- src/ts/process/command.ts:63-104,124-139,415-437 -->

## Text that is not a command

- **Not starting with `/`:** an ordinary message.
- **Starting with `/`, but the line fails and no writing command has run yet** (for example an unknown command name, or `/setinput`): it is sent as an ordinary message with the raw `/...` text, plus any staged files, and the character replies.
- **The line succeeds:** it counts as handled. Nothing is posted as a message and the box ends empty. Staged files and input translation are put back in the box's draft.
- **A writing command has already run and a later command fails:** the text is neither posted nor put back. For example `/send x|/nosuchcommand` posts only `x`.

The writing commands are `send`, `sendas`, `comment`, `cut`, `del`, `setvar`, `addvar`, `multisend`, `trigger` and `test_lorebook`. A command counts as writing from its start, even if it then changes nothing.

<!-- src/ts/process/composerActions.svelte.ts:280-308,310-374; src/ts/process/command.ts:59-61,120-122 -->

## Which chat a command acts on, and stopping

A line acts on the chat it **started in** (for the message box, the chat you pressed Send in; for a trigger, the chat the trigger run belongs to). It keeps acting on that chat if you switch to another chat or go Home. The chat is looked up again by id before every command. If it no longer exists, the line stops silently.

To stop a line, click the busy Send button. This stops a line run from the message box (and the triggers that send owns). A trigger run started by a trigger button is not stopped by the busy button; only deleting its chat stops it. The stop is checked before each command (and between `/multisend` segments). A command that is already running finishes first.

- If a writing command has already run, the message box stays empty after the stop and what was written stays.
- If nothing has written yet (for example the line was only `/speak` or `/input` so far), your text comes back into the box. Staged files and input translation always come back.

<!-- src/ts/process/command.ts:17-50,91,110-118,275-277; src/ts/process/composerActions.svelte.ts:105-107,590-644 -->

## Command reference

"Pipe out" is the value handed to the next command. "Unchanged" means the pipe passes through as it came in.

| Command | Syntax | What it does | Pipe out |
|---|---|---|---|
| `/input` | `/input [text]` | Shows an input dialog with the text as its prompt. | The text in the box when you press **OK**. The dialog has no Cancel button. |
| `/echo`, `/popup` | `/echo [text]` | Shows the text as an information notice. The line does not wait for the notice to be closed. | Unchanged |
| `/pass` | `/pass [text]` | Sets the pipe to the text (default: the incoming pipe). | The text |
| `/buttons` | `/buttons labels=["A","B"]` | Shows a choice dialog. Only the named argument `labels` is read, and it must be a JSON array. JSON containing spaces or `=` is broken up by the tokeniser. | The **index** of the clicked button as a string (`"0"`, `"1"`, ...), not its label. Unchanged if `labels` is missing, invalid or not an array (no error). |
| `/setinput` | (none) | Does nothing and fails. The source marks it "NOT IMPLEMENTED". The line is treated as not a command (see above). | none |
| `/speak` | `/speak [text]` | In a single-character chat, reads the text aloud with the character's TTS (the line waits for it). In a group chat it does nothing. | Unchanged |
| `/send` | `/send [text]` | Appends a **user** message with the text (CBS-parsed) to the chat. No time stamp, no reply is generated. | Unchanged |
| `/sendas` | `/sendas [text]` | Same, as a **character** message. No speaker name argument is read. | Unchanged |
| `/comment` | `/comment [text]` | Appends `<Comment>`, a newline, the text, a newline and `</Comment>` to the last message. Does nothing on an empty chat. | Unchanged |
| `/cut` | `/cut N`, `/cut a-b` or `/cut <message id>` | Removes messages. See below. | Unchanged |
| `/del` | `/del N` | Removes the **last N** messages. Digits only. N larger than the chat empties it. `0` or non-digits do nothing. | Unchanged |
| `/len` | `/len [JSON array]` | Counts the items of a JSON array. | The count as a string. Unchanged if the text is not a JSON array (no error). |
| `/multisend` | `/multisend [clear\|\|\|] seg1 \|\|\| seg2 ...` | Posts each segment as a user message. See below. | `''` (empty) |
| `/setvar` | `/setvar key=NAME [value]` | Sets the chat variable `NAME` to the text (a string, CBS-parsed). Stored under the name `$NAME` in the chat's variable state. Without `key=` it sets the variable `$undefined`. | `''` |
| `/addvar` | `/addvar key=NAME [number]` | Adds the number to the variable. An unset variable counts as 0. A non-numeric current value or argument gives `NaN`. | `''` |
| `/getvar` | `/getvar key=NAME` | Reads the variable. | Its string value, or the literal text `null` if unset. |
| `/test_lorebook` | `/test_lorebook` | Loads the chat's lorebook prompt, shows an information notice listing the active entries' prompts joined by `§`. It counts as a writing command. | The whole lorebook result as JSON text |
| `/trigger` | `/trigger NAME` | Runs the trigger of that name as a `manual` trigger of the current character. In a group chat it does nothing. See below. | Unchanged |
| `/?` | `/?` | Opens a help window. See below. | `help` |
| anything else | | The line fails (see "Text that is not a command"). | none |

Variables are stored in the chat's own variable state (`scriptstate`) with a `$` in front of the name.

### `/cut`

The argument is trimmed and read in this order:

1. **`/cut N`** (an integer, possibly negative): removes message number N. A negative N counts from the end (`-1` is the last message). Out of range does nothing.
2. **`/cut a-b`** (two non-negative integers, spaces around `-` allowed): removes messages from index `a` up to but **not including** `b`. If `a` is not below `b`, nothing happens.
3. **Anything else** is taken as a message id: removes every message whose id equals it, if at least one matches. An empty argument matches nothing.

Indexes count from 0 (the first message is 0).

**Fork difference:** `/cut` and `/del` keep plain [[SupaMemory]] valid. If the removal deletes the message SupaMemory resumes from, the resume point moves to the next surviving message, and a chat left empty loses its SupaMemory data. See [[SupaMemory#when-messages-are-removed]].

<!-- src/ts/process/command.ts:209-250; src/ts/process/memory/supaResume.ts:59-141 -->

### `/multisend`

Splits the text on `|||`. If the first segment, trimmed, is `clear`, it is dropped and clear mode is on. For each segment it stops if the line was stopped or the chat is gone; then, in clear mode, empties the chat's messages (this happens for **every** segment, so each segment wipes the ones posted before it and their replies); then posts the segment as a user message (segments are not trimmed); then, if it is allowed to generate, asks for a reply and stops the loop if that reply does not complete.

Whether it generates is decided once, at the start: only when no reply is running and no send is starting (or this line is itself that send). A `/multisend` from a trigger or button while a send is running posts the messages without replies. It keeps going in its own chat if you leave it.

<!-- src/ts/process/command.ts:260-295 -->

### `/trigger`

Runs the named trigger with the same stop signal as the line. The `/trigger` commands of one line share a counter. Each `/trigger` adds 1 to it and it is never lowered within that line, so once it has reached 10, further `/trigger` calls in that line do nothing, silently (unless the trigger has low-level access). A nested trigger run receives the current value as a plain number, so the count adds up down a chain of nested runs. Increments made inside a nested run do not flow back to the parent or to sibling runs. When the command comes from a trigger's `command` effect, the counter is that run's own recursion count, which the Run Trigger effect also advances.

<!-- src/ts/process/command.ts:92,327-349; src/ts/process/triggers.ts:1198-1212,1553-1554 -->

### `/?`

The help window lists input, echo, popup, pass, buttons, speak, send, sendas, comment, cut, del, len, setvar, addvar, getvar, trigger and `/?`. It leaves out setinput, multisend and test_lorebook. Some of its text does not match the code: its `/buttons Yes§No` and `/len Hello§World` examples do not work (`/buttons` needs `labels=["Yes","No"]` and returns an index; `/len` needs a JSON array), and its `/cut [index]` line does not mention ranges, message ids or the semantics above. Use this page instead.

<!-- src/ts/process/command.ts:350-407 -->

## Post File `.po`

Post File accepts `.po` files, and the fork runs them as a job bound to the chat you clicked in. Each entry must end with a blank line (an entry with no blank line after it is never posted). `#. Note =` and `#. Speaker =` lines are added in front of the posted text as `Note: ...` and `Speaker: ...`, and are removed from the entry's value. Each posted entry is followed by a request for a reply. Before each entry the job stops if it was stopped, if a reply is running or a send is starting, or if the chat is gone. If it stops this way after posting something, it still downloads what it has built as `translated.po`. If it stops this way before posting anything (an early exit), no file is produced. A job that runs to the end, or that stops because a reply failed, always downloads `translated.po`, even if it posted nothing. On Tauri it downloads again after every entry. A `.po` file stages nothing in the message box.

<!-- src/ts/process/files/multisend.ts:28-152,288-299 -->

## Coming from upstream or SillyTavern

- In the source, a single comment `STScript compatibility commands` sits before `case 'input'` and has no end marker, so it does not say which commands count as SillyTavern-compatible. Individual markings that the source does state: `{{pipe}}` is marked as STScript compatibility, `{{slot}}` as "Risu default", cutting by message id as working for Risu but not STScript, `/setinput` as "NOT IMPLEMENTED", and `/sendas` as "name not implemented" (no speaker name is read).
- **Fork differences, compared against upstream `command.ts`:**
  - `/cut N` and `/cut a-b`: upstream kept the named messages and dropped the rest (`/cut N` kept only message N, `/cut a-b` kept that range). Upstream `/cut a-b` was already end-exclusive. Here the named messages are removed instead. Negative indexes (`/cut -1`) are new. Upstream treated any argument containing `-` as a range, so message ids containing `-` could not be cut by id.
  - `/del N`: upstream kept the last N messages. Here it removes the last N.
  - Only two commands failed outright upstream: `/getvar` on an unset variable and `/comment` on an empty chat. Here they return `null` and do nothing. Upstream `/addvar` on an unset variable stored `NaN`; here an unset variable counts as 0.
  - `/trigger`: upstream always passed `undefined` down the pipe. Here the pipe passes through unchanged, and the shared counter of 10 described above is new.
  - Runs of three or more `|` stay in the text.
  - Commands act on the chat the line started in and mark that chat for saving. Upstream acted on the selected chat and saved through `setDatabase`.
  - The stop and write rules above, and Post File `.po` binding to the clicked chat, are new.
- Trigger effects stopping at the next effect when you click the busy button is not compared against upstream.

<!-- src/ts/process/command.ts:142-181,209-250,296-349; git upstream/main:src/ts/process/command.ts -->
