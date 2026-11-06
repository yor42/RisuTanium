# Additional Character Screen

The Additional Character Screen shows a picture of the character outside the chat messages. The picture changes as the chat goes on. You set it for each character.

To set it, open the settings sidebar of the character. Go to the **Character Display** page and pick the **Additional Character Screen** tab. The other two tabs on that page are **Character Icon** and **Additional Assets**.

<!-- src/lib/SideBars/CharConfig.svelte:353-372, 473-577 -->

## Modes for a character

| Mode | What it shows |
|---|---|
| **None** | Nothing. This is the default. |
| **Emotion Images** | One of the images that you uploaded. The emotion of the latest reply of the character decides which one. See [Emotion Images](#emotion-images). |
| **Image Generation** | A new image that the app generates after each reply. See [Image Generation](#image-generation). |

## Emotion Images

"Emotion Images" (also called expressions) is the most common mode.

### Setting it up

1. Select **Emotion Images**.
2. Click **+** under the table and pick image files (png, webp, or gif). You can pick several files at once.
3. The app takes the emotion name of each image from the file name without the extension. Afterward, you can edit the **Emotion Name** in the table.

Use plain words as names, for example `joy`, `anger`, `fear`, or `surprise`. An image with exactly the name `neutral` (lowercase) is the default. The app shows it before it detects any emotion. The app recommends more than three images. With fewer images, the app has little to choose from, but nothing stops you.

<!-- src/ts/characters.ts:168-206; src/ts/util.ts:289-298; src/lang/en.ts:80-81 -->

### How the app picks the emotion

After each reply, the app picks one of the emotion names. The method is a global setting: **Settings → Other Bots → Emotion Images → Emotion Method**.

- **Ax. Model** (default): The app asks the **Auxiliary Model** to choose one word from your emotion names that fits the reply best. You set the Auxiliary Model in **Settings → Chat Bot**. The app makes recently shown emotions less likely, so the image does not get stuck. If the answer matches a name exactly, the app uses that name. If it does not, the app uses a name that the answer contains. If there is no such name, the app uses `neutral` when it exists. If nothing matches, the previous image stays.
- **MiniLM-L6-v2**: A small embedding model runs locally. It compares the reply with your emotion names and picks the closest name. It makes no API calls. It always picks something.

To replace the prompt that **Ax. Model** uses, go to **Settings → Advanced Settings → Emotion Prompt**. To use the built-in prompt, leave the box blank.

<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:969-977; src/ts/process/index.svelte.ts:2050-2229; src/ts/setting/advancedSettingsData.ts:33-34 -->

### Inlay Screen

When you check **Inlay Screen**, the app makes no separate model call. Instead, it tells the model of the character to write a tag such as `<Emotion="joy">` in its reply. The app shows the tag as the matching image inside the message. The app shows no side image box.

The text that tells the model to do this is in the **Image Generation Instructions** box. Both modes use the same label for this box. The app replaces `{{slot}}` in the text with the list of emotion names.

If you change the mode or the Inlay Screen checkbox, your edits in this box stay. The app resets the box to the default only in two cases: the box is empty, or it still holds a built-in default text. An empty box that you emptied on purpose also counts as unedited.

<!-- src/ts/process/inlayScreen.ts:1-113; src/ts/process/index.svelte.ts:626-639 -->

### Other ways to show an emotion image

- `{{emotion::name}}` in a message shows that emotion image inline. See [[CBS Assets]].
- A [[Regex Script]] with the output `@@emo name` sets the displayed emotion directly. When the script fires, the app skips the automatic pick for that reply. It works in any mode, if the character has an image with that name. See [[@ Syntaxes]].

<!-- src/ts/parser/parser.svelte.ts:532-539; src/ts/process/scripts.ts:182-206 -->

## Image Generation

In this mode, the **Auxiliary Model** reads the chat after each reply and writes an image prompt. You set the Auxiliary Model in **Settings → Chat Bot**. The app sends the prompt to the image generator. The result replaces the displayed image.

This mode needs an image generator. Set one in **Settings → Other Bots → Image Generation**. Examples are Stable Diffusion WebUI, NovelAI, ComfyUI, Dall-E, Stability API, Fal.ai, Imagen, or an OpenAI-compatible endpoint.

The character has these fields:

- **Image Generation Instructions**: The instructions that the app gives to the Auxiliary Model so that it turns the chat into a prompt.
- **Image Generation Prompt**: The prompt that the app sends to the image generator. The app replaces `{{slot}}` with the output of the Auxiliary Model.
- **Image Generation Negative Prompt**.
- **Inlay Screen**: When you check it, the model of the character writes `<ImgGen="prompt">` in its reply instead. The app generates the image and shows it inside the message.

The **Image Generation Instructions** box does a different job depending on **Inlay Screen**:
- If Inlay Screen is off, the box is the system prompt for the Auxiliary Model that writes the image prompt above.
- If Inlay Screen is on, the app adds the box directly to the main chat. The text in it must tell the own model of the character to write the `<ImgGen="...">` tag.

When you toggle **Inlay Screen**, the box keeps what you typed. It does not switch to match. After you toggle, rewrite the text yourself. If you do not, the model with Inlay on can fail to write the tag, and no images appear.

Image Generation mode does not work for a character inside a group chat. The app shows "Stable diffusion in group chat is not supported".

<!-- src/ts/process/stableDiff.ts:12-61; src/ts/process/inlayScreen.ts:81-113; src/ts/process/index.svelte.ts:626-639,2230-2249; src/lib/SideBars/CharConfig.svelte:562-577 -->

## Group chats

A group has its own setting on the same tab. The setting decides how the app lays out the images of the members. Each member still uses its own mode.

| Mode | What it shows |
|---|---|
| **None** | Nothing. |
| **Single View** | Only the member whose image changed most recently. |
| **Multiple Character View** | The images of all members side by side. |
| **Double Character View** | The first two members, overlapping. The app does not show other members. |

<!-- src/ts/util.ts:313-368; src/lib/ChatScreens/TransitionImage.svelte:113-136 -->

## Where the image appears

The position depends on **Settings → Display & Audio → Theme**:

- **Waifulike**: The image stands beside the chat. **Waifu Chat Width** and **Waifu Character Size** set the two widths.
- Other themes: A small box appears in the top-right corner of the chat. Drag its bottom-left corner to resize it.

The image cross-fades when it changes. The **Hide All Images** option hides it together with all other images.

<!-- src/lib/ChatScreens/ChatScreen.svelte:35-80; src/lib/ChatScreens/ResizeBox.svelte -->
