# Creating a Basic Bot

This guide shows how to make a simple character from scratch. Before you start, pick a model and enter an API key. See [[RisuAI Basics]].

## 1. Create the character

1. Click **+** in the character list.
2. Choose **Create from Scratch**.

The app creates an empty character and selects it. The settings sidebar opens on the Basic page.

<!-- src/ts/characters.ts:684-736,876-908 -->

## 2. Fill in the Basic page

The Basic page has three fields that matter most:

- **Name** (the box at the top): The name of the character. The app replaces `{{char}}` in any text with this name.
- **Description**: Everything that the model must know about the character. Write the appearance, personality, background, and manner of speech here. This is the most important field. The app sends it with every message, so its length counts against **Max Context**. The app shows the length in tokens under the box.
- **First Message**: The opening message of the character. It strongly shapes the style and length of later replies. Write it the way you want the character to write.

These three fields are enough to start. Type a message in the chat and send it.

Use `{{user}}` for the name of your persona and `{{char}}` for the name of the character. If either name changes, the text still works. See [[Curly Brased Syntaxes]].

<!-- src/lib/SideBars/CharConfig.svelte:266-345 -->

### Author's Note

The **Author's Note** is on the same page. It belongs to the current chat, not to the character. Use it for things that apply right now, for example the current scene or the direction that you want for the next replies. It has a strong effect on replies. The app does not export it with the character.

## 3. Optional: more fields

The **Advanced Settings** page (activity icon) has these fields:

- **Example Message**: Sample conversations that show how the character talks. Start each sample with `<START>`:

  ```
  <START>
  {{user}}: Hi.
  {{char}}: Oh, hello! I didn't see you there.
  ```

- **Alternative First Messages**: Extra opening messages. At the start of a chat, use the arrows on the first message to switch between them.
- **Creator's Comment**: A note for the people who use your character. The app shows it above the first message. The app does not send it to the model.
- **System Prompt**: Replaces the main prompt for this character. Use `{{original}}` to keep the normal main prompt inside it. If a [[Prompt Template]] is on, the app does not use this field.

The **Personality** and **Scenario** fields exist so that the app works with other apps. The app shows them in two cases: **Show Unrecommended Settings** is on, or the fields already contain text. Otherwise the app hides them. To turn on **Show Unrecommended Settings**, go to **Settings → Advanced Settings**. Put this information in the Description instead.

You can add more features later:

- A [[Lorebook]], for facts that the model needs only after someone mentions them.
- [[Emotion images|Additional Character Screen]].
- A [[TTS]] voice.
- A [[Regex Script]] or a [[Trigger Script]].

<!-- src/lib/SideBars/CharConfig.svelte:1054-1284; src/lang/en.ts:105-116 -->

## 4. Set a character icon

1. Open the **Character Display** page (smile icon).
2. Open **Character Icon**.
3. Upload an image.

## 5. Export and share

Open the share page (share icon). Click **Export Character** to save the character as a file. You can choose one of these formats:

- **Character Card V3**, in the format **CHARX**, **CHARX-JPEG**, **PNG**, or **JSON**.
- **Character Card V2**, the older PNG format. More apps can read it.

Click **Share to RisuRealm** to publish the character to RisuRealm instead. If you did not accept the Terms of Service and the Privacy Policy of upstream RisuAI before, the app asks you to accept them first.

<!-- src/lib/Others/AlertComp.svelte:740-810; src/ts/characterCards.ts:689-717 -->
