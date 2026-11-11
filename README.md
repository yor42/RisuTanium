# RisuTanium (a fork of RisuAI)

Originally a few small data-hardening fixes. I admit that things have escalated.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/logo_wordmark_bright.svg">
  <img alt="RisuTanium" src="public/logo_wordmark_dark.svg" width="400">
</picture>

[![Svelte](https://img.shields.io/badge/svelte-5-red?logo=svelte)](https://svelte.dev/) [![Typescript](https://img.shields.io/badge/typescript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/) [![Tauri](https://img.shields.io/badge/tauri-2-%2324C8D8?logo=tauri)](https://tauri.app/) [![Vite](https://img.shields.io/badge/vite-8-%23646CFF?logo=vite)](https://vite.dev/) [![Tailwind CSS](https://img.shields.io/badge/tailwindcss-4-%2306B6D4?logo=tailwindcss)](https://tailwindcss.com/)

RisuTanium (also written Risutanium, Risu-Tan or RT) is a fork of [RisuAI](https://github.com/kwaroran/RisuAI), an AI character-chat app for desktop, web and self-hosting. We call it **upstream** below, mostly because "the application from which this increasingly ambitious situation originated" is too long.

The original mission was modest: stop losing data, make storage less fragile, and improve a few things along the way. Keeping upstream characters, modules, presets, `.bin` backups and plugins compatible remains a priority. The mission, meanwhile, has developed a worrying number of sub-missions.

> **Status: experimental. No public releases yet.** There is nothing to download. You can build from source or with Docker, but expect unfinished edges and keep a `.bin` backup of anything you care about. Especially anything you *really* care about. This is not a promise of safety just because the project is about safety.

## How did we get here?

The maintainer had roughly **350 MB of application data** and **40 GB of assets**. The existing storage model was not especially thrilled about those numbers, and a browser-based workaround was an awkward home for tens of gigabytes of data on Android. It turns out Chrome and Firefox are not very happy when single page hosts 40gb of data.

The plan was to harden storage and get a native Android build working. Then it turned out that fixing storage properly involved rather more than changing a few settings. And since much of the engine might be reusable for other things, the project is also growing beyond roleplay. I am fully aware that this is how scope creep works, but hey, more cool stuffs. for free.

RisuAI itself is the result of years of work by a small number of contributors and a heavily burdened maintainer. This fork is not an invitation to dunk on them. Shipping and maintaining an app *and* the services around it is a lot of work, especially when done largely for free. Our different priorities, intrusive architectural changes and AI-assisted workflow made a separate fork a better fit than handing upstream an enormous PR to review.

### Where this is heading (not a feature-completion checklist)

The longer-term vision has three modes:

- **RP:** Character-driven roleplay and storytelling, in the neighborhood of what RisuAI already does.
- **Hybrid:** An assistant with a persona; useful when you want both a task done and a personality attached to it. or have your waifu crunching with you. Live2D or Holographic display not included.
- **Utility:** A task-oriented assistant with specialized modules, because apparently an AI chat frontend wasn't a large enough project.

**These are plans, not a claim that all three modes are available today.** The current feature list below describes existing Risu-derived functionality; consult the actual project status before assuming a planned feature works.

## Features

The existing engine already does quite a lot. This list is about the present Risu-derived feature set, not a promise that the future Utility framework has quietly shipped while nobody was looking.

- Many AI providers: OpenAI, Anthropic (Claude), Google (Gemini) and Vertex AI, Mistral, Cohere, NovelAI, NovelList, DeepSeek, DeepInfra, NanoGPT, AWS (Bedrock), AI Horde, Ollama, WebLLM (runs the model in your browser), OpenRouter and Ooba (Text Generation WebUI). Plugins can add more.
- Emotion Images: The app shows the character image that matches the current expression.
- Additional Assets: You can embed images, audio and video in a character. The app shows them in the chat or as the background.
- Group Chats: You can put many characters in one chat.
- Plugins: Plugins add features and providers. You can share them.
- Scripting: Regex scripts, trigger scripts, Lua scripting and modules.
- Translators: The app can translate your input and the replies automatically.
- Lorebook: Also called world info or memory book. It gives a character more to remember.
- UI modes: Standard Risu, Waifulike, Mobile Chat, CardBoard and Custom HTML. Each mode has color schemes.
- Prompting: You can change the prompt order, and you can use conditions and variables.
- TTS (text to speech): The app reads the output text aloud.
- Long-term memory: HypaMemory V2 and V3, SupaMemory and Hanurai Memory.

## What's different from upstream

The list of differences grew long, so it now lives on its own wiki page: [What changed from upstream RisuAI](docs/wiki/Changes-from-upstream.md). To move your data, start with [Migrating from upstream](docs/wiki/Migrating-from-upstream.md).

## Development process

This project is developed with extensive AI assistance and two poor Galaxy Note 9s with cracked screens, because apparently ADB doesn't care about broken glass.

The AI writes code. Other AI models review the code. Sometimes they disagree. Occasionally, all of them are wrong. Sometimes the human is wrong, too.

The maintainer, who is not particularly fond of TypeScript or Rust, then tries their best to figure out which answer is least likely to delete 350 MB of irreplaceable yet deeply cringe roleplay/fanfic history that they honestly wouldn't wish upon anyone else.

This process is repeated until morale improves or Gate 2 Claude Opus says **APPROVE**.

Approval is not a guarantee that a feature has been tested. That's why this README keeps calling out the difference.

## Privacy, security, and other regrettable decisions

**Backups contain things that matter.** Your `.bin` archives may include chats, assets, and sensitive credentials such as API keys. The current upstream-compatible `.bin` format should **not** be treated as a secure encrypted vault. Protect copies of it accordingly.

**Encrypted backups (planned, not shipped):** A separate RisuTanium-specific backup format is being designed around AES-256-GCM and password-based key derivation, with salts, nonces and authenticated data handling. Because the government uses strong cryptography to protect classified material, and apparently your fanfiction deserves a fighting chance too. The actual security guarantees depend on the implementation and testing, not on the number 256.

**Lost your future encrypted-backup password?** Congratulations. The encryption is working exactly as intended. Your data is now safe from unauthorized access, including yours.

The intended design has no password recovery, master key or maintainer backdoor. Use a password manager. Preferably a good one. These statements describe the planned format, **not** a current feature.

**Third-party AI providers are a different privacy boundary.** Backup encryption does not encrypt prompts sent to your chosen provider. Providers may process or retain submissions under their own policies, including for safety investigations. RisuTanium cannot promise what another service does with what you send it. Read the provider's terms and privacy policy before submitting anything you would rather not explain to another human being.

The project aims to avoid application telemetry; this is not a promise about your AI provider, hosting environment, or other services. The maintainer has enough problems with their own fanfiction.

**Your dignity:** Best effort. No warranty expressed or implied.

**Actually serious warning:** Exposed API keys can cost real money. and by money, I mean a LOT of money. Keep backups private, rotate any credentials you think were exposed, and do not treat encryption plans as protection already in place.

## Documentation

- [Wiki](docs/wiki/Home.md): the pages in this repository, rewritten for this fork.
- [Plugin development guide](plugins.md)

## Building from source

There is no download yet, so you're joining the construction crew. Hard hats are metaphorical; backups are not. last sentence is not part of the joke.

You need these tools:

- Node.js 22.13 or newer.
- pnpm 11.28.10. The file `package.json` pins this version, so `corepack enable` is enough.
- For the desktop build only: Rust and Cargo, and the platform prerequisites in the [Tauri guide](https://tauri.app/start/prerequisites/).

Run these commands from the root of the repository:

```
pnpm install
pnpm dev          # web development server, http://localhost:5174
pnpm build        # web build into dist/
pnpm tauri dev    # desktop development
pnpm tauri build  # desktop build
pnpm check        # type checking
pnpm test         # unit tests
```

To run the self-hosted Node server, build the web app. Then start the server from the root of the repository:

```
pnpm build
pnpm runserver
```

The server serves `dist/` and keeps its data in `save/`. Both folders are relative to the folder where you start the server. The server listens on port 6001, or on `PORT` if you set that variable.

### The legal-documents notice

If `VITE_RISU_LEGAL_CONFIGURED` is empty or unset at build time, the frontend shows a "legal documents not configured" notice instead of the app. In this repository, the variable is on by default, because this fork has its own Terms of Service and Privacy Policy. Settings links to both.

These files set the variable to `TRUE`:

- `.env.production`. The commands `pnpm build`, `pnpm buildsite`, `pnpm tauribuild` and `pnpm hono:build` read it.
- `.env.development`. The command `pnpm dev` reads it.
- The Docker build. See [Docker](#docker).

The unit tests do not load these files.

To opt out and get the notice, set the variable to an empty value in the environment of the build command. Vite lets an existing environment variable override the `.env.*` files, even if the variable is empty. In bash:

```
VITE_RISU_LEGAL_CONFIGURED= pnpm build
```

Windows `cmd` cannot hold an empty variable. In that shell, and in any other shell, you can put the line `VITE_RISU_LEGAL_CONFIGURED=` in an untracked `.env.production.local` file. For `pnpm dev`, use `.env.development.local`. Vite loads these files after the committed file, so they win. The `.gitignore` file lists `*.local`.

### Known problem with the Node server

This one is a genuine limitation, not an invitation to try increasingly creative browser flags.

A plain-HTTP address other than localhost does not work at present. If you open the server over a LAN or VPN address without HTTPS, the boot stops with this error: "Cannot read properties of undefined (reading 'generateKey')". The reason is that the browser does not offer `crypto.subtle` outside a secure context.

localhost works. The authors did not test HTTPS. The asset-by-URL route of the server signs its read token in the browser in the same way, so it also needs a secure context. The issue is CHORE-49 in `Agents/Roadmap.md`.

## Docker

Containers are convenient. They do not exempt you from the backup warnings above.

This fork builds from source with Docker. It uses its own project, container and volume names: `risutanium` and `risutanium-save`. It does not touch a Docker install of upstream. To bring your data over, make a `.bin` backup on upstream and load it here. See [Migrating from upstream](docs/wiki/Migrating-from-upstream.md).

1. Clone this repository.
2. From the root of the repository, build and start the container:
   ```
   docker compose up -d --build
   ```
3. Open `http://localhost:6001`.

The image comes from the `Dockerfile` in this repository. The base image is `node:24-slim`. The build needs Docker with BuildKit, because the `Dockerfile` uses `RUN --mount=type=cache`.

The save lives in the `risutanium-save` volume. Docker names this volume `risutanium_risutanium-save`, which is the project name plus the volume name.

The Node server problem above also applies to this container. Use `localhost`.

The compose file of upstream also maps host port 6001. For that reason, this container and a container of upstream cannot run at the same time. To run both, change the left-hand number of `6001:6001` under `ports:` in one of the two compose files.

### The legal-documents notice in a Docker build

The Docker build has the variable on by default, so the image shows the app and not the [legal-documents notice](#the-legal-documents-notice). The default is `ARG VITE_RISU_LEGAL_CONFIGURED=TRUE` in the `Dockerfile`. The `.dockerignore` file keeps the `.env` files of the repository out of the build context, so the `Dockerfile` must set the default. The file `docker-compose.yml` passes `${VITE_RISU_LEGAL_CONFIGURED-TRUE}`, so an unset variable becomes `TRUE`.

The build bakes the value into the frontend. You must opt out at build time. If you set the variable on a running container, nothing changes. To opt out, set the variable to an empty value in the shell that runs `docker compose up -d --build` or `docker compose build`:

```
# bash
VITE_RISU_LEGAL_CONFIGURED= docker compose up -d --build

# plain docker
docker build --build-arg VITE_RISU_LEGAL_CONFIGURED= .
```

You can also put `VITE_RISU_LEGAL_CONFIGURED=` in your own `.env` file next to `docker-compose.yml`. This works from any shell. Compose reads that file, and `.gitignore` lists `.env`, so the file stays yours. With an empty value, the notice replaces the app.

## Frequently asked questions

**Why the name RisuTanium?** The original plan involved carbon: lightweight, strong, and black, which is an excellent color. The naming attempts did not stick, so titanium won. In retrospect, choosing a metal associated with surviving structural stress was oddly prophetic.

**Why not just submit a PR upstream?** The changes grew large, intrusive, and heavily AI-assisted. Upstream already has a significant review and maintenance burden, and it has restrictions on large AI-written contributions. Maintaining a separate fork seemed the less inconsiderate option.

**Is this production-ready?** There are no releases yet. That is the shortest answer in this README.

**Why does the roadmap have so many review gates?** Data-loss bugs have an unfortunate habit of surviving confidence. The gates are there to catch mistakes; they cannot prove there are none.

**Is the roleplay history really that important?** To their respective owners, yes. They would also prefer that nobody else read it. Both statements can be true.

## Credits

RisuTanium exists because [RisuAI](https://github.com/kwaroran/RisuAI) exists. Credit belongs to its maintainers and contributors for building and sustaining the upstream project. The fork's new problems belong to the fork. We are keeping the original GPLv3 licensing obligations; see [LICENSE](LICENSE) for the actual legal text, which is intentionally less entertaining than this README.

## License & Copyright
This project is licensed under the GNU General Public License v3.0 (GPLv3).
- Original work: Copyright (C) 2024 Kwaroran
- Modified work: Copyright (C) 2026 yor42 (Modified on 2026-11-11)

The home-screen logo uses NanumSquare Neo by NAVER (designed by Sandoll). It has the SIL Open Font License 1.1. The font file and its full license are in [`src/etc/fonts/NanumSquareNeo/`](src/etc/fonts/NanumSquareNeo/).<br>
이 프로그램에는 네이버에서 제공한 나눔글꼴이 적용되어 있습니다.
