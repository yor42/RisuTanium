# Chat Commands

Chat commands are short lines that start with `/`. They act on a chat. They can post a message, delete messages, set a variable, run a trigger, and more. This page is the reference for all of them. It describes what the code does now. Where the help window (`/?`) disagrees with the code, this page follows the code.

Related pages: [[RisuAI Basics]] (the message box), [[Trigger Script]] (the `command` effects), and [[Settings Hotkeys]].

## Where commands run

Commands run from exactly three places:

- **The message box.** Press Send (or use **Continue Response**) with a line that **starts with `/` in the first column**. If the line starts with a space, it is an ordinary message.
- **The `command` effect of a trigger (V1).**
- **The `v2Command` effect of a trigger (V2).** A trigger button runs its trigger, so it reaches the same effects.

Nothing else runs commands. The plugin API, the translate box, and Post File do not run them. In a trigger effect, the app runs the text through CBS first. The text does not need a leading `/`. The app parses each argument as CBS again afterward. So the command text of a trigger is parsed as CBS twice. This matters for side effects such as `{{setvar::...}}`. The app silently skips a `command` or `v2Command` effect when the trigger run has no origin chat.

<!-- src/ts/process/composerActions.svelte.ts:280,283; src/ts/process/triggers.ts:1198-1212,1537-1541,2038-2042; src/ts/process/command.ts:63-104 -->

## How a line is parsed

| Rule | What happens |
|---|---|
| Chaining | `\|` separates commands. The app trims each command. Each command receives the result of the previous command as its **pipe**. The app throws away the result of the last command. |
| Runs of `\|` | The app leaves a run of three or more `\|` in the text. This is how `/multisend` separates its segments. One or two `\|` split the line. `\|\|` leaves an empty command between the two. That command is unknown, so the line fails. |
| The `/` | It is optional on every command after the first. `/send hi \| send there` works. The first command needs it only so that the message box treats the line as a command. |
| Case | Command names are case-sensitive. `/Send` is not a command. |
| Quoting | Only `"` is a quote. It only stops `\|` from splitting. The quotes stay in the text. There is no escaping. An unbalanced `"` makes the rest of the line unsplittable. |
| Tokenising | After the command name, the app splits the text on the space character only. It drops empty pieces and joins the rest with single spaces. So runs of spaces collapse. Tabs and newlines are not separators. |
| Named arguments | Any token that contains `=` becomes a **named argument** (`key=value`). The app removes it from the positional text. Only the first `=` splits. `key=a=b` gives the value `a`. So `/send 1+1=2` posts nothing for that token. These commands read named arguments: `/setvar`, `/addvar`, `/getvar` (`key=`), and `/buttons` (`labels=`). Tip: Avoid `=` in text that you pass as a positional argument. |
| `{{pipe}}` and `{{slot}}` | Only in the positional text, the app replaces the **first** `{{pipe}}` (SillyTavern style) and the **first** `{{slot}}` with the result of the previous command. It replaces both placeholders, one occurrence each. This does not apply inside named arguments. |
| Empty argument | If the positional text is empty, the argument is the incoming pipe. `/send` alone posts the pipe. |
| CBS | After the tokenising, the app runs the argument and each value of a named argument through CBS. The tokeniser splits CBS that contains spaces or `\|` first. This happens before the app looks up the command. So CBS side effects such as `{{setvar::...}}` run even when the command name is unknown. The messages that `/send`, `/sendas`, and `/comment` store hold the text after the CBS parse. |

<!-- src/ts/process/command.ts:63-104,124-139,415-437 -->

## Text that is not a command

- **A line that does not start with `/`:** An ordinary message.
- **A line that starts with `/`, but the line fails and no writing command has run yet:** For example, the command name is unknown, or the command is `/setinput`. The app sends the line as an ordinary message with the raw `/...` text, plus any staged files. The character replies.
- **The line succeeds:** It counts as handled. The app posts nothing as a message, and the box ends empty. The app puts staged files and input translation back in the draft of the box.
- **A writing command has already run, and a later command fails:** The app neither posts the text nor puts it back. For example, `/send x|/nosuchcommand` posts only `x`.

The writing commands are `send`, `sendas`, `comment`, `cut`, `del`, `setvar`, `addvar`, `multisend`, `trigger`, and `test_lorebook`. A command counts as writing from its start, even if it then changes nothing.

<!-- src/ts/process/composerActions.svelte.ts:280-308,310-374; src/ts/process/command.ts:59-61,120-122 -->

## Which chat a command acts on, and stopping

A line acts on the chat that it **started in**. For the message box, this is the chat in which you pressed Send. For a trigger, this is the chat to which the trigger run belongs. The line keeps acting on that chat if you switch to another chat or go Home. The app looks up the chat again by id before every command. If the chat no longer exists, the line stops silently.

To stop a line, click the busy Send button. This stops a line that runs from the message box, and the triggers that the send owns. The busy button does not stop a trigger run that a trigger button started. Only the deletion of its chat stops it. The app checks for the stop before each command, and between `/multisend` segments. A command that already runs finishes first.

- If a writing command has already run, the message box stays empty after the stop, and what the command wrote stays.
- If nothing has written yet, your text comes back into the box. An example is a line that was only `/speak` or `/input` so far. Staged files and input translation always come back.

<!-- src/ts/process/command.ts:17-50,91,110-118,275-277; src/ts/process/composerActions.svelte.ts:105-107,590-644 -->

## Command reference

"Pipe out" is the value that the command hands to the next command. "Unchanged" means that the pipe passes through as it came in.

| Command | Syntax | What it does | Pipe out |
|---|---|---|---|
| `/input` | `/input [text]` | Shows an input dialog with the text as its prompt. | The text in the box when you press **OK**. The dialog has no Cancel button. |
| `/echo`, `/popup` | `/echo [text]` | Shows the text as an information notice. The line does not wait for the notice to close. | Unchanged |
| `/pass` | `/pass [text]` | Sets the pipe to the text (default: the incoming pipe). | The text |
| `/buttons` | `/buttons labels=["A","B"]` | Shows a choice dialog. It reads only the named argument `labels`, and that must be a JSON array. The tokeniser breaks up JSON that contains spaces or `=`. | The **index** of the clicked button as a string (`"0"`, `"1"`, ...), not its label. Unchanged if `labels` is missing, invalid, or not an array (no error). |
| `/setinput` | none | Does nothing and fails. The source marks it "NOT IMPLEMENTED". The app treats the line as not a command (see above). | none |
| `/speak` | `/speak [text]` | In a chat with a single character, reads the text aloud with the TTS of the character (the line waits for it). In a group chat, it does nothing. | Unchanged |
| `/send` | `/send [text]` | Appends a **user** message with the text (parsed as CBS) to the chat. No time stamp. The app generates no reply. | Unchanged |
| `/sendas` | `/sendas [text]` | The same, as a **character** message. It reads no speaker name argument. | Unchanged |
| `/comment` | `/comment [text]` | Appends `<Comment>`, a newline, the text, a newline, and `</Comment>` to the last message. Does nothing on an empty chat. | Unchanged |
| `/cut` | `/cut N`, `/cut a-b`, or `/cut <message id>` | Removes messages. See below. | Unchanged |
| `/del` | `/del N` | Removes the **last N** messages. Digits only. If N is larger than the chat, the chat is emptied. `0` or non-digits do nothing. | Unchanged |
| `/len` | `/len [JSON array]` | Counts the items of a JSON array. | The count as a string. Unchanged if the text is not a JSON array (no error). |
| `/multisend` | `/multisend [clear\|\|\|] seg1 \|\|\| seg2 ...` | Posts each segment as a user message. See below. | `''` (empty) |
| `/setvar` | `/setvar key=NAME [value]` | Sets the chat variable `NAME` to the text (a string, parsed as CBS). The app stores it under the name `$NAME` in the variable state of the chat. Without `key=`, it sets the variable `$undefined`. | `''` |
| `/addvar` | `/addvar key=NAME [number]` | Adds the number to the variable. An unset variable counts as 0. A current value or argument that is not numeric gives `NaN`. | `''` |
| `/getvar` | `/getvar key=NAME` | Reads the variable. | Its string value, or the literal text `null` if it is unset. |
| `/test_lorebook` | `/test_lorebook` | Loads the lorebook prompt of the chat. Shows an information notice that lists the prompts of the active entries, joined by `§`. It counts as a writing command. | The whole lorebook result as JSON text |
| `/trigger` | `/trigger NAME` | Runs the trigger of that name as a `manual` trigger of the current character. In a group chat, it does nothing. See below. | Unchanged |
| `/?` | `/?` | Opens a help window. See below. | `help` |
| anything else | none | The line fails (see "Text that is not a command"). | none |

The app stores variables in the own variable state of the chat (`scriptstate`), with a `$` in front of the name.

### `/cut`

The app trims the argument and reads it in this order:

1. **`/cut N`** (an integer, possibly negative): Removes message number N. A negative N counts from the end (`-1` is the last message). If N is out of range, nothing happens.
2. **`/cut a-b`** (two non-negative integers, spaces around `-` allowed): Removes the messages from index `a` up to but **not including** `b`. If `a` is not below `b`, nothing happens.
3. **Anything else** is a message id: Removes every message whose id equals it, if at least one matches. An empty argument matches nothing.

Indexes count from 0. The first message is 0.

**Fork difference:** `/cut` and `/del` keep plain [[SupaMemory]] valid. Suppose the removal deletes the message from which SupaMemory resumes. Then the resume point moves to the next surviving message. A chat that ends up empty loses its SupaMemory data. See [[SupaMemory#when-messages-are-removed]].

<!-- src/ts/process/command.ts:209-250; src/ts/process/memory/supaResume.ts:59-141 -->

### `/multisend`

The command splits the text on `|||`. If the first segment, trimmed, is `clear`, the command drops it and turns on clear mode. For each segment, the command does these steps in order:
1. It stops if the line was stopped or the chat is gone.
2. In clear mode, it empties the messages of the chat. This happens for **every** segment. So each segment wipes the segments that the command posted before it, and their replies.
3. It posts the segment as a user message. It does not trim segments.
4. If it is allowed to generate, it asks for a reply. It stops the loop if that reply does not complete.

The command decides one time, at the start, whether it generates. It generates only when no reply runs and no send starts (or this line is itself that send). Suppose a `/multisend` comes from a trigger or button while a send runs. Then it posts the messages without replies. It keeps going in its own chat if you leave that chat.

<!-- src/ts/process/command.ts:260-295 -->

### `/trigger`

The command runs the named trigger with the same stop signal as the line. The `/trigger` commands of one line share a counter. Each `/trigger` adds 1 to it. The app never lowers it within that line. So after it has reached 10, further `/trigger` calls in that line silently do nothing, unless the trigger has low-level access. A nested trigger run receives the current value as a plain number. So the count adds up down a chain of nested runs. Increments inside a nested run do not flow back to the parent run or to sibling runs. When the command comes from the `command` effect of a trigger, the counter is the own recursion count of that run. The Run Trigger effect also advances it.

<!-- src/ts/process/command.ts:92,327-349; src/ts/process/triggers.ts:1198-1212,1553-1554 -->

### `/?`

The help window lists input, echo, popup, pass, buttons, speak, send, sendas, comment, cut, del, len, setvar, addvar, getvar, trigger, and `/?`. It leaves out setinput, multisend, and test_lorebook. Some of its text does not match the code:
- Its examples `/buttons Yes§No` and `/len Hello§World` do not work. `/buttons` needs `labels=["Yes","No"]` and returns an index. `/len` needs a JSON array.
- Its `/cut [index]` line does not mention ranges, message ids, or the semantics above.

Use this page instead.

<!-- src/ts/process/command.ts:350-407 -->

## Post File `.po`

Post File accepts `.po` files. The fork runs them as a job that is bound to the chat in which you clicked. Each entry must end with a blank line. The app never posts an entry that has no blank line after it. The app adds `#. Note =` and `#. Speaker =` lines in front of the posted text as `Note: ...` and `Speaker: ...`. It removes them from the value of the entry. A request for a reply follows each posted entry. Before each entry, the job stops in three cases: someone stopped it, a reply runs or a send starts, or the chat is gone. Suppose it stops this way after it posted something. Then it still downloads what it built as `translated.po`. Suppose it stops this way before it posted anything (an early exit). Then it produces no file. A job that runs to the end, or that stops because a reply failed, always downloads `translated.po`, even if it posted nothing. On Tauri, it downloads again after every entry. A `.po` file stages nothing in the message box.

<!-- src/ts/process/files/multisend.ts:28-152,288-299 -->

## Coming from upstream or SillyTavern

- In the source, a single comment `STScript compatibility commands` sits before `case 'input'`. It has no end marker. So it does not say which commands count as SillyTavern-compatible. The source does state some individual markings: `{{pipe}}` is marked as STScript compatibility. `{{slot}}` is marked as "Risu default". The cut by message id is marked as working for Risu but not STScript. `/setinput` is marked as "NOT IMPLEMENTED". `/sendas` is marked as "name not implemented" (it reads no speaker name).
- **Fork differences, compared against upstream `command.ts`:**
  - `/cut N` and `/cut a-b`: Upstream kept the named messages and dropped the rest. `/cut N` kept only message N, and `/cut a-b` kept that range. Upstream `/cut a-b` was already end-exclusive. Here the command removes the named messages instead. Negative indexes (`/cut -1`) are new. Upstream treated any argument that contains `-` as a range. So it could not cut message ids that contain `-` by id.
  - `/del N`: Upstream kept the last N messages. Here it removes the last N.
  - Upstream failed outright in only two cases: `/getvar` on an unset variable, and `/comment` on an empty chat. Here they return `null` and do nothing. Upstream `/addvar` on an unset variable stored `NaN`. Here an unset variable counts as 0.
  - `/trigger`: Upstream always passed `undefined` down the pipe. Here the pipe passes through unchanged. The shared counter of 10 described above is new.
  - Runs of three or more `|` stay in the text.
  - Commands act on the chat in which the line started, and mark that chat for saving. Upstream acted on the selected chat and saved through `setDatabase`.
  - The rules for stopping and writing above are new. The binding of Post File `.po` to the chat in which you clicked is new too.
- The authors did not compare against upstream that trigger effects stop at the next effect when you click the busy button.

<!-- src/ts/process/command.ts:142-181,209-250,296-349; git upstream/main:src/ts/process/command.ts -->
