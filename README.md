# Risutanium (a fork of RisuAI)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/logo_wordmark_bright.svg">
  <img alt="RisuTanium" src="public/logo_wordmark_dark.svg" width="400">
</picture>

[![Svelte](https://img.shields.io/badge/svelte-5-red?logo=svelte)](https://svelte.dev/) [![Typescript](https://img.shields.io/badge/typescript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/) [![Tauri](https://img.shields.io/badge/tauri-2-%2324C8D8?logo=tauri)](https://tauri.app/) [![Vite](https://img.shields.io/badge/vite-8-%23646CFF?logo=vite)](https://vite.dev/) [![Tailwind CSS](https://img.shields.io/badge/tailwindcss-4-%2306B6D4?logo=tailwindcss)](https://tailwindcss.com/)

Risutanium (also written RisuTanium, Risu-Tan or RT) is a fork of [RisuAI](https://github.com/kwaroran/RisuAI) (called "upstream" below), a cross platform AI chatting application (desktop, web and self-hosted). The fork is for stabilization and improvement: fixing data-loss and reliability problems, and making targeted improvements. Characters, modules, presets, `.bin` backups and plugins made for upstream RisuAI must keep working here.

**Status: there are no releases yet. This fork is experimental and heavily work in progress.** There is nothing to download. You can build it from source or with Docker, as described below. Keep a `.bin` backup of anything you care about.

## Features

- **Many AI providers**: OpenAI, Anthropic (Claude), Google (Gemini) and Vertex AI, Mistral, Cohere, NovelAI, NovelList, DeepSeek, DeepInfra, NanoGPT, AWS (Bedrock), AI Horde, Ollama, WebLLM (in-browser inference), OpenRouter and Ooba (Text Generation WebUI). Plugins can add more.
- **Emotion Images**: Show the character image that matches the current expression.
- **Additional Assets**: Embed images, audio and video in a character and show them in the chat or as the background.
- **Group Chats**: Multiple characters in one chat.
- **Plugins**: Add features and providers, and share them.
- **Scripting**: Regex scripts, trigger scripts, Lua scripting and modules.
- **Translators**: Translate input and output automatically.
- **Lorebook**: Also known as world info or memory book. It gives a character more to remember.
- **UI modes**: Standard Risu, Waifulike, Mobile Chat, CardBoard and Custom HTML, plus colour schemes.
- **Prompting**: Change the prompt order, and use conditions and variables.
- **TTS**: Read the output text aloud.
- **Long-term memory**: HypaMemory V2 and V3, SupaMemory and Hanurai Memory.

## What's different from upstream

This is a short list of changes you will notice. See [Migrating from upstream](docs/wiki/Migrating-from-upstream.md) for moving your data.

- **A new identity.** The product is called Risutanium. The desktop app's identifier is `io.github.yor42.risutanium`, a fresh app-data folder on purpose. The version is SemVer from `0.1.0`, with the upstream version it is based on as a suffix: the home screen's Version line shows `0.1.0-up2026.10.292`. The desktop app registers two deep-link schemes, `risutaniumlocal` and `risuailocal`; the second stays so that upstream Realm's open-in-app links still reach the app. The in-app updater is switched off until the first release.
- **The CBS version tags report this fork's version.** `{{version}}` returns `0.1.0` and `{{majorversion}}` returns `0`, so an upstream card that compares them against a 2026 version behaves differently.
- **No RisuAccount and no Google Drive backup.** Account sign-in, sync and Drive backup are removed. RisuRealm still works, and the first time you use it the app asks you to accept upstream's Terms of Service and Privacy Policy. Move data with a local `.bin` backup. A `.bin` made while signed in to RisuAccount on `risuai.xyz` cannot be read here.
- **Saving across tabs and devices.** A self-hosted Node server refuses a save from a stale tab instead of overwriting newer data. When another tab or device saves first, a tab that has fallen behind stops saving and asks what to do. With no unsaved edits it offers Reload or Keep reading, and it never reloads by itself. With unsaved edits it offers Reload, which loses them, and sometimes Save mine, which replaces the other change with this tab's version. Save mine is not offered on the Node server, after the profile was replaced, or when this tab holds characters that are not loaded yet; then Reload is the only choice. On the Node server, a tab with unsaved edits is also offered "Export this tab first, then reload": it writes a `.bin` of this tab and reloads once you confirm. That choice is not offered after the profile was replaced. This is traced in the code and has not been run against a real server.
- **Restoring a backup is guarded.** Load Backup Locally and Load Internal Backup refuse to run on the web build while another tab of the app is open, and warn you if the browser cannot check. They also refuse while a reply is being written into a chat. Load Internal Backup is a picker of restore points, and loading a `.bin` from Settings keeps the data you had before as an earlier saved version.
- **Local backups include every asset, not only `.png` files.** Audio, video, WebP, JPEG, font and CSS assets are included. Full `.bin` backups also include the inlay images, video and audio in chat messages; partial backups do not.
- **A new storage format, and old files are cleaned up for you.** The first start of this build converts your existing save. A damaged or unreadable save shows a recovery screen with choices, and importing a `.bin` at startup or from Settings shows notices before the app reloads. There is no manual clean-up button on a normal page. The start after the conversion deletes the old-format files automatically once the app has been quiet (hidden after a save, or about 30 seconds without input), and it shows nothing while it does. There is no way yet to clear out unused data or assets by hand; the old "Clean Unused Archived Data and Assets" button stays only on pages that fall back to the older storage. This is traced in the code and has not been run.
- **Characters start as stubs and load when you open them.** The automatic 10-day archiving of characters is gone. Instead, at startup characters are left as small stubs (except any with a missing, hidden or duplicated id), and a character loads when you open it; nothing is deleted. Once you move on to another character and the loaded one has not been edited, it goes back to its stub. A large one waits for a quiet moment, and this does not happen while a plugin that needs every character is on. It is on by default, and the app tells you once when it turns on. Turn it off in Settings > Advanced Settings > "Archive characters at startup", and on the next start every character loads in full.
- **Work stays in the chat it started in.** A reply, and the memory summaries and variable writes that come with it, are written into the chat the message was sent from, even if you switch chats, add a branch or reorder chats while it generates.
- **Deleting a chat or character stops the work in it.** Deleting a chat warns you if something is still writing into it, and deletes the chat you confirmed even if the list changed meanwhile.
- **Escape no longer answers a prompt.** Escape does nothing on a confirm or input prompt that waits for an answer, instead of answering it with an empty answer. It still closes information alerts.
- **A `.bin` made here warns you before leaving out huge items.** Before a backup is written, the app names each item of 4 GiB or more, which a backup entry cannot hold, and asks whether to create the backup without them; cancelling writes nothing, and the final summary repeats the names. That covers character data, and assets only where the app can list file sizes (the desktop app). Elsewhere, an asset that large stops the backup with a message when it is reached. This is traced in the code and not run against a real backup.
- **`.bin` backups stay compatible with upstream.** Hand-made upstream backups were loaded here, exported again and loaded in upstream, and their characters, chats and messages were all there when the files were decoded. Only the in-progress streaming flag differs, on purpose. These were single runs on one PC with synthetic files, and not every character was opened in upstream's interface. Upstream's newer plugin-index format is read and converted. Its key-value data is kept and written back in upstream's format only when a backup has some; the values keep their content but not their key order. That was tested with hand-made files only, since upstream does not write it yet. On the Node server, restoring a backup asset of about 101 MiB or more is skipped after a warning that names it and asks you to confirm.
- **Exports keep unloaded characters as stubs.** A `.bin` made here writes each character that is not loaded as a small stub plus a separate entry for its chats, instead of loading it first. A trashed character, and one whose chats name cold-storage data (a pointer, an error-text key or archived chats), is still written whole. With 500 synthetic characters on one fast PC (three runs each), the export's peak JavaScript heap fell from about 202 to 145 MiB, and the file grew from about 43 to 94 MB because the chat entries are not compressed. Upstream opened and re-exported a stub-form file in a single run with synthetic files. Nothing was measured on a phone.
- **Cut-off card imports are refused before anything is saved.** A `.charx`, PNG or module (`.risum`) file that is cut short is refused with a message, and the card or module is not imported. The check looks at the file's structure. A file whose content is damaged inside can still fail partway, leaving the assets it had already saved unused. A `.jpg` card cut short cannot be told from a plain image. This is traced in the code and not run on real files.
- **The model list uses online data.** Model data such as context size is downloaded from the public LiteLLM dataset and provider lists and cached, with a status line and a "Refresh model data" button in the bot settings. The model picker does not offer retired models, and a model you already use is tagged "retired", "now uses ..." or "retires" with a date. The download is not run here.
- **A reply that is streaming when the app is hidden is saved.** Hiding the app or page mid-reply saves the text so far, and the message shows "Interrupted — the reply may be incomplete" when it reloads in that state. A reply that finishes while hidden shows no note. This is best effort: if the app is killed right away, the save may not finish. The save-on-hide trigger is traced in the code; the device behaviour is from the commit message.
- **A reworked character list.** Search covers the name, the shown description, tags and creator, including characters that are not loaded (tags and creator for single characters, not groups). The Grid tab sorts by My order, Recent or Name, shows folders as tiles under My order, and remembers open folders on this device. Edit mode moves several characters to the trash, or groups them into a new folder, at once. Long descriptions have a "Show more" link. Traced in the code and lang strings, not run.

## Documentation

- [Wiki](docs/wiki/Home.md): the pages in this repository, rewritten for this fork.
- [Plugin development guide](plugins.md)

## Building from source

Prerequisites:

- Node.js 20.19+ or 22.12+.
- pnpm 10.34.1. `package.json` pins it, so `corepack enable` is enough.
- For the desktop build only: Rust and Cargo, plus the platform prerequisites in the [Tauri guide](https://tauri.app/start/prerequisites/).

```
pnpm install
pnpm dev          # web development server, http://localhost:5174
pnpm build        # web build into dist/
pnpm tauri dev    # desktop development
pnpm tauri build  # desktop build
pnpm check        # type checking
pnpm test         # unit tests
```

To run the self-hosted Node server, build the web app, then start the server from the repo root:

```
pnpm build
pnpm runserver
```

It serves `dist/` and keeps its data in `save/`, both relative to the folder you start it from. It listens on port 6001, or on `PORT` if you set that.

### The legal-documents notice

The frontend shows a "legal documents not configured" notice instead of the app when `VITE_RISU_LEGAL_CONFIGURED` is empty or unset at build time. In this repository it is on by default, because this fork has its own Terms of Service and Privacy Policy, linked from Settings. `.env.production` (read by `pnpm build`, `pnpm buildsite`, `pnpm tauribuild` and `pnpm hono:build`) and `.env.development` (read by `pnpm dev`) set it to `TRUE`, and the Docker build sets it too (see [Docker](#docker)). The unit tests do not load these files.

To opt out and get the notice, set the variable to an empty value in the environment of the build command. Vite lets an existing environment variable, even an empty one, override the `.env.*` files. In bash:

```
VITE_RISU_LEGAL_CONFIGURED= pnpm build
```

Windows `cmd` cannot hold an empty variable. There, and in any shell, you can instead put the line `VITE_RISU_LEGAL_CONFIGURED=` in an untracked `.env.production.local` (or `.env.development.local` for `pnpm dev`). It loads after the committed file and wins, and `*.local` is in `.gitignore`.

### Known problem with the Node server

- **A plain-HTTP address other than localhost does not work at present.** Opening the server over a LAN or VPN address without HTTPS stops the boot with "Cannot read properties of undefined (reading 'generateKey')", because the browser does not offer `crypto.subtle` outside a secure context. localhost works. HTTPS has not been tested. The server's asset-by-URL route signs its read token in the browser the same way, so it needs the same secure context. This is tracked as CHORE-49 in `Agents/Roadmap.md`.

## Docker

This fork builds from source with Docker. It uses its own project, container and volume names (`risutanium` and `risutanium-save`), so it does not touch an upstream Docker install. To bring your data over, make a `.bin` backup on upstream and load it here, as described in [Migrating from upstream](docs/wiki/Migrating-from-upstream.md).

1. Clone this repository.
2. From the repo root, build and start it:
   ```
   docker compose up -d --build
   ```
3. Open `http://localhost:6001`.

The image is built from the `Dockerfile` in this repo (base image `node:24-slim`). The build needs Docker with BuildKit, because the `Dockerfile` uses `RUN --mount=type=cache`. The save lives in the `risutanium-save` volume, which Docker names `risutanium_risutanium-save` (the project name plus the volume name). The Node server problem above applies to this container as well, so use `localhost`.

Upstream's compose file also maps host port 6001, so this container and an upstream one cannot run at the same time. To run both, change the left-hand number of `6001:6001` under `ports:` in one of the two compose files.

### The legal-documents notice in a Docker build

The Docker build has the flag on by default, so the image shows the app and not the [legal-documents notice](#the-legal-documents-notice). The default is `ARG VITE_RISU_LEGAL_CONFIGURED=TRUE` in the `Dockerfile`, because `.dockerignore` keeps the repository's `.env` files out of the build context. `docker-compose.yml` passes `${VITE_RISU_LEGAL_CONFIGURED-TRUE}`, so an unset variable becomes `TRUE`.

The value is baked into the frontend when the image is built, so opting out has to happen at build time. Setting it on a running container does nothing. To opt out, set it to an empty value in the shell that runs `docker compose up -d --build` or `docker compose build`:

```
# bash
VITE_RISU_LEGAL_CONFIGURED= docker compose up -d --build

# plain docker
docker build --build-arg VITE_RISU_LEGAL_CONFIGURED= .
```

Or put `VITE_RISU_LEGAL_CONFIGURED=` in your own `.env` file next to `docker-compose.yml`, which works from any shell. Compose reads that file, and `.env` is in `.gitignore`, so it stays yours. With an empty value the notice replaces the app.

## Credits

The home-screen logo uses NanumSquare Neo by NAVER (designed by Sandoll), licensed under the SIL Open Font License 1.1. The font file and its full license are in [`src/etc/fonts/NanumSquareNeo/`](src/etc/fonts/NanumSquareNeo/).

이 프로그램에는 네이버에서 제공한 나눔글꼴이 적용되어 있습니다.
