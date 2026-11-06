# RisuAI Basics

This page covers the main screen, the first settings that you need, and common errors. Other pages describe each feature in detail.

## First steps

1. Open **Settings → Chat Bot**. On the **Model** tab, pick a **Model** and enter the API key for its provider.
2. Open **Settings → Persona** and set your name and icon.
3. Add a character. You can import a card, pick one from RisuRealm, or make your own. See [[Creating a Basic Bot]].
4. Select the character and start to chat.

## The main screen

The screen has three parts:

- **The character list** on the far left.
- **The character settings sidebar** next to it, for the selected character.
- **The chat** on the right.

If the sidebar is closed, open it with the arrow button in the top-left corner. On a small screen, the open sidebar can cover the chat.

<!-- src/lib/SideBars/Sidebar.svelte; src/lib/UI/GUI/SideBarArrow.svelte -->

### Character list

- Click a character to switch to it. Drag characters to reorder them.
- Drag one character onto another to make a folder. Right-click a folder to rename it or to change its color or image.
- The **+** button opens the add-character menu:
  - **Choose from RisuRealm**: Browse shared characters. The first time you use Realm, the app asks you to accept the Terms of Service and the Privacy Policy of upstream RisuAI. Until you accept them, the Realm preview and browser show a placeholder instead of listings.
  - **Import Character**: Load a character card file (`.png`, `.json`, `.charx`, `.jpg`, or `.jpeg`).
  - **Create from Scratch**: Make an empty character.
  - **Create Group Chat**: Chat with several characters at once.
- The menu button opens **Settings** and the other pages of the app.
- The **Playground** icon opens a set of testing tools. See [[Playground]].

<!-- src/lib/SideBars/Sidebar.svelte:147-334,631-690; src/lib/Others/AlertComp.svelte:594-670; src/ts/characterCards.ts:52-171 -->

### Character settings sidebar

The icons at the top switch between pages:

| Icon | Page |
|---|---|
| Person | Basic: **Description**, **First Message**, and the **Author's Note** of the chat |
| Smile | **Character Display**: icon, [[Additional Character Screen]], and additional assets |
| Book | [[Lorebook]] |
| Speaker | [[TTS]] (single characters only) |
| Braces | **Scripts**: background HTML, [[Regex Script]], and [[Trigger Script]] (single characters only) |
| Activity | **Advanced Settings**: example messages, alternative first messages, creator's comment, system prompt, default variables, and more |
| Share | Export or remove the character (single characters only) |

The **Author's Note** belongs to the current chat, not to the character. So the export of the character does not include it.

The Basic page also shows the chat toggles. These include the memory toggle (see [[Long Term Memory]]), the custom toggles from [[Modules]] and the preset, and **Toggle Jailbreak**. **Toggle Jailbreak** appears only when the current prompt contains a jailbreak prompt. It is a global switch. It is not a switch for each character.

<!-- src/lib/SideBars/CharConfig.svelte:235-345,1054-1284; src/lib/SideBars/Toggles.svelte:25-54,185-205 -->

### Chat

Type in the box at the bottom and press the send button. **Send with Enter Key** (**Settings → Accessibility**) decides whether Enter sends or adds a new line. When it is on, Shift+Enter is a new line. When it is off, Shift+Enter sends. When **Auto Translate Input** is on, there is a second box, the translate box. Enter sends from it only if **Send with Enter Key** is on. Otherwise it has no send key. Ctrl+M in either box rerolls. See [[Settings Hotkeys]].

The app runs a line that starts with `/` in the first column as a chat command. See [[Chat Commands]].

The menu button next to the send button opens the chat menu. What it shows depends on your settings:

- **Chat List**: Switch between the chats of this character, or start a new chat. The menu shows it only when **Show Menu Chat List** is on.
- **Continue Response**: Let the character continue its last message. The menu always shows it. It is greyed out and does nothing unless the chat has at least two messages and the last one is from the character. It takes whatever is in the message box, like Send.
- **Modules**: Turn [[Modules]] on for this chat or this character.
- **Auto Suggest**: Suggests replies for you.
- **Post File**: Attach a file. The picker offers these types:
  - Images (jpg, jpeg, png, webp, gif, avif).
  - Audio (wav, mp3, ogg, flac).
  - Video (mp4, webm, mpeg, avi).
  - `.txt`. The app uses the text in the box as a search query and adds matching snippets.
  - `.po` translation files. The app posts them into the chat as a job. See [[Chat Commands]].
- **Screenshot**: Save an image of the chat.
- **Auto Translate Input**: The menu shows it when a translator is set up.
- **Stop TTS**: The menu shows it for Web Speech and ElevenLabs voices.
- **Auto Mode**: In group chats.
- **Regenerate**: Only if **Side Menu Reroll Button** is on.
- **Easy Panel**: The menu shows it when **Enable Risuai Pro Tools** is on.
- Memory windows for HypaMemory, and items that plugins add.

On the Playground character, the menu button is a **+** that adds an empty character message.

<!-- src/lib/ChatScreens/DefaultChatScreen.svelte:608-622,734-745,965-1126; src/ts/process/files/multisend.ts:245-367 -->

#### Sending, the busy button, and stopping

- **Send and Continue empty the box at once.** The moment you press the button, the app moves your text, staged files, and input translation out of the box.
- **The box is read-only until the reply starts to generate.** While the box is locked, the app ignores these actions: pasting an image, choosing Post File, picking a sticker, and clicking a suggestion. A paste or Post File that began before the lock still lands, in the chat where it began.
- **The send button turns busy** while a reply generates or a send starts. It also turns busy during a whole reroll, undo reroll, or auto-mode run. Click it to stop the work:
  - **Before the app adds your message to the chat:** The app cancels the send. This includes the time when the input trigger runs, which is before the app adds the message. Your text, files, and translation come back into the box. Suppose the line was a `/` command and a writing command already ran. Then the box stays empty instead. What a trigger already wrote stays.  A send in a group chat has no input trigger.
  - **While the reply generates:** The click stops the reply. It also stops the start trigger and the output triggers of the send at their next effect. The effect that already runs finishes.
  - The busy button stops a send and the triggers that the send owns. It does not stop a trigger run that started from a trigger button. Only the deletion of its chat stops that run.
- **The app keeps what you type during generation.** The box unlocks when generation starts. What you type stays as your next draft. The app does not clear it when the reply ends.
- **Only one of Send, Continue, Regenerate, Undo Reroll, and Auto Mode runs at a time.** If you start another while one runs, nothing happens, and the app gives no message. The busy button is the only sign. A Send while a cold-storage chat still loads shows an error instead.
- **Each chat keeps its own draft.** Unsent text, input translation, and staged files stay with the chat in which you wrote them. They survive a switch of chats, opening Settings, and other changes of the screen. The app keeps them in memory only. So a reload of the page drops them. The app keeps only the 200 drafts that you wrote most recently. It never drops the draft of the chat on the screen.

<!-- src/ts/process/composerActions.svelte.ts:187-261,376-390,590-644,675-679; src/ts/process/composerDrafts.svelte.ts:12-15,73,85-101; src/lib/ChatScreens/DefaultChatScreen.svelte:623-676,682-689,786-813,1072-1098; src/lib/ChatScreens/Suggestion.svelte:196-219; src/ts/process/triggers.ts:1376-1381,1473-1478; src/ts/process/sendCharacterMessage.ts:39; src/ts/process/index.svelte.ts:1308,2279,2411 -->

#### Switching chats during a send

- The reply to a send goes into the chat that you sent from. This holds even if you switch to another chat of the same character, or go Home, while the reply generates. Text that you type in another chat stays in the draft of that chat.
- You can switch to another chat of the same character, or go Home, at any time.
- While a reply generates, the app refuses a switch to a **different character** silently. The sidebar, the grid, the mobile list, and the Previous and Next Character hotkeys all behave this way. The switch is allowed in the short moment between the press of Send and the start of generation.
- The app shows no notice when you switch away in the middle of a send.

<!-- src/ts/globalApi.svelte.ts:3529-3546; src/ts/characters.ts:1003-1025; src/ts/process/composerActions.svelte.ts:224-229,249 -->

#### Deleting while something is writing

Suppose a reply, an auto mode, a command line, `/multisend`, or a Post File job writes into a chat. If you delete that chat or its character, the app asks you first:

- **Deleting a chat** adds this line to the dialog: "Something is currently writing into this chat. Deleting it stops that, though a step that is already running may still finish." When you accept, the app stops all work in that chat and removes it. Work in other chats carries on. A step that cannot be interrupted can finish. The app drops its later write to the removed chat without a message. You cannot delete the only chat of a character.
- **Trashing or permanently deleting a character or group** adds the line "Something is currently writing into this character. Deleting it stops that, though a step that is already running may still finish." to the first of its two dialogs. When you accept, the app stops the work in it, whether or not the app showed the line. A trashed character stays where it is. So a write that still lands goes into it.
- **Deleting a member of a busy group shows no warning.** The app does not delete the group chat, and the turn in progress finishes.

<!-- src/ts/characters.ts:856-909,921-944; src/ts/process/chatOrigin.ts:993-1029; src/lang/en.ts:21,771-774 -->

### Message buttons

Each message has these buttons:

- **Edit** and **Remove**. Long-press Remove to choose between two options: remove only that message, or remove that message and every message after it. Or turn on **Remove subsequent when message remove** in **Settings → Accessibility**.
- **Translate**, when a translator is set up.
- **Copy**, if **Use Chat Message Copy** is on in **Settings → Display & Audio**.
- **TTS**, when the character has a voice.
- **Regenerate** on the latest reply. When **Use Swipe for Regeneration** is on (**Settings → Accessibility**), arrows let you move between regenerated versions. The first message has arrows whenever the character has alternative first messages.

The extra menu of the message has more actions: **Bookmark** (if enabled), **Branch** (start a new chat from this message), **Disable Message** (leave it out of the prompt), and **Cut Messages for AI**.

<!-- src/lib/ChatScreens/Chat.svelte:573-992 -->

## Settings

Open **Settings** from the menu in the character list. The main sections are:

| Section | What is there |
|---|---|
| **Chat Bot** | Model, API keys, parameters, prompts, and presets. See [[Prompt Template]]. |
| **Persona** | Your name, icon, and description. You can keep several personas. |
| **Other Bots** | [[Long Term Memory]], [[TTS]], emotion images, and image generation. |
| **Display & Audio** | Theme, sizes, colors, and sounds. |
| **Language** | The language of the app and the translator. |
| **Accessibility** | Options for input and accessibility. |
| **Modules** | See [[Modules]]. |
| **Plugin** | See [[Plugin Docs]]. |
| **Backup & Files** | Local backups and storage settings. This is a name specific to the fork. Upstream calls this tab "Account & Files". See [[Settings Backup and Files]]. |
| **Hotkey** | Keyboard shortcuts. |
| **Advanced Settings** | Options for advanced users. |

<!-- src/lib/Setting/Settings.svelte:41-184 -->

## Common errors

- **"Error: The minimum required token is greater than the Max Context Size."**: The parts that the app must always send (description, prompts, persona, and so on) do not fit in **Max Context**. Shorten them. Or raise Max Context in **Chat Bot → Parameters** if your model allows it.
- **"The file is invalid, or it's data is corrupted."**: The file that you tried to import is not a character card that RisuAI can read.
- **"Error: Unknown model selected"**: The selected model is not available. Pick another model in **Chat Bot**.
- **"You are trying local request on web version…"**: The web version cannot reach `localhost` addresses. Use the desktop app or another address.
- Errors that mention quota, billing, or an invalid key come from your AI provider, not from RisuAI. Look at your key and your account on the site of the provider.

<!-- src/lang/en.ts:16-53; src/ts/globalApi.svelte.ts:1546-1548 -->
