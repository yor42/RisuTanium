# TTS

TTS (text to speech) reads messages aloud. You set it for each character. To set it, open the settings sidebar of the character. Go to the page with the speaker icon, which has the heading **TTS**, and pick a **Provider**. Group chats have no TTS page.

API keys and server addresses are global. You find them at **Settings → Other Bots → TTS**.

<!-- src/lib/SideBars/CharConfig.svelte:752-1053; src/lib/Setting/Pages/OtherBotSettings.svelte:944-966 -->

## When it plays

- **Auto Speech** (**Settings → Other Bots → TTS**): When this setting is on, the app reads out every new reply as soon as the reply is finished. This includes a regenerated reply.
- **The speaker button** on each message: It reads that message when you click it. The button appears when the current character has a provider. It reads the stored text of the message. CBS tags that the app has not resolved are read as they are written.
- **Stop TTS** in the chat menu: It stops playback. The menu shows it only for Web Speech and ElevenLabs.

<!-- src/ts/process/index.svelte.ts:1850-1851,1918-1919; src/lib/ChatScreens/Chat.svelte:848-858; src/lib/ChatScreens/DefaultChatScreen.svelte:1025-1032 -->

## What is read

Before it speaks, the app removes every `*` from the text. It removes nothing else, such as other Markdown or HTML.

**Read Only Quoted** is on the TTS page of the character. It exists for every provider. When it is on, the app reads only the text inside `"…"` or `「…」`. If the message has no quotes, the app reads nothing.

Plugins can also change the text or skip it. See [[Plugin API Reference]].

<!-- src/ts/process/tts.ts:95-114 -->

## Providers

| Provider | Cost | Needs |
|---|---|---|
| [Web Speech](#web-speech) | Free | Nothing. It uses the voices of your browser or OS. |
| [ElevenLabs](#elevenlabs) | Paid | An ElevenLabs API key |
| [OpenAI](#openai) | Paid | An OpenAI key, or any OpenAI-compatible endpoint |
| [NovelAI](#novelai) | Subscription | A NovelAI API key |
| [fish-speech](#fish-speech) | Paid | A fish.audio API key |
| [Huggingface](#huggingface) | Free tier | A Huggingface key |
| [VOICEVOX](#voicevox) | Free | A running VOICEVOX Engine |
| [GPT-SoVITS](#gpt-sovits) | Free | A running GPT-SoVITS API server |
| [VITS](#vits) | Free | Nothing. It runs in the browser. |

### Web Speech

Pick a **Speech** voice, or pick **Auto**. The list comes from your browser and OS. A voice that you picked on one device can be missing on another device. In that case, the app uses Auto (the first voice). If your browser has no speech support, the page says so.

### ElevenLabs

1. Get an API key from [ElevenLabs](https://elevenlabs.io/).
2. Enter it at **Settings → Other Bots → TTS → ElevenLabs API key**.
3. On the TTS page of the character, pick a **Speech** voice. The app loads the list from your ElevenLabs account.

Requests use the `eleven_multilingual_v2` model.

### OpenAI

Enter your key at **Settings → Other Bots → TTS → OpenAI Key**. Then pick a **Voice** (alloy, echo, fable, onyx, nova, or shimmer). The default model is `tts-1`.

To use another server with the same API, check **Advanced (OpenAI-compatible endpoint)**. This shows **Base URL**, **API Key (overrides global)**, **Model**, and **Response Format** (mp3, opus, aac, flac, wav, or pcm).

### NovelAI

Enter your key at **Settings → Other Bots → TTS → NovelAI API key**. Pick a **Voice** from the list. Or check **Custom Voice Seed** and type a seed. **Version** is v1 or v2. The default is v2.

### fish-speech

Enter your key at **Settings → Other Bots → TTS → fish-speech API Key**. Then pick a **Model**. The app passes **Chunk Length** (default 200) and **Normalize** to the fish.audio API. If you speak without a selected model, the app shows an error.

### Huggingface

Enter your key at **Settings → Other Bots → TTS → Huggingface Key**. On the page of the character, type the **Model** (a Huggingface model id) and its **Language** (default `en`). If the model is still loading, the app waits and retries until the model is ready.

If **Language** is not `en`, the app machine-translates the text before it sends the text.

Note: This translation now goes from the chosen language into English. So a model for another language can receive English text.

### VOICEVOX

VOICEVOX is a Japanese TTS engine that you run yourself.

1. Start a VOICEVOX Engine and note its URL.
2. Enter the URL at **Settings → Other Bots → TTS → VOICEVOX URL**.
3. On the page of the character, pick a **Speaker** and a **Style**. You can also set **Speed scale**, **Pitch scale**, **Volume scale**, and **Intonation scale**.

The app machine-translates the text into Japanese before it sends the text.

### GPT-SoVITS

This provider is for a GPT-SoVITS API server that you run yourself. The page of the character has these settings:

- The **URL** of the server and the **Volume**.
- A reference voice. Use **Reference Audio Data** (a wav, ogg, aac, or mp3 file of 3 to 10 seconds), or use a **Reference Audio Path** on the server. **Use Auto Path** asks the server for the path.
- **Use Reference Audio Script**, with the **Reference Audio Script** text and the **Reference Audio Language**.
- **Use Long Audio**, **Text Language**, **Top P**, **Temperature**, **Speed**, **Top K**, and **Text Split Method**.

### VITS

This provider runs a VITS model in the browser. It needs no server. Click **Select Model** and choose a `.zip` file that contains the ONNX model. If you select no model, the app downloads a default English model on first use.

<!-- src/ts/process/tts.ts:116-419; src/ts/process/transformers.ts -->

## Web version and local servers

The browser sends the requests of ElevenLabs, Web Speech, VOICEVOX, and Huggingface directly. A server that you run yourself, such as VOICEVOX, must allow cross-origin requests.

On the web version, the app blocks requests to `localhost`, `127.0.0.1`, or `0.0.0.0`. For example, this affects a GPT-SoVITS server on the same machine. Use the desktop app, a LAN address, or a tunnel instead.

<!-- src/ts/globalApi.svelte.ts:1404,1546-1548 -->
