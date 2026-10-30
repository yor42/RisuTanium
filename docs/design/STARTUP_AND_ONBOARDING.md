# Startup and first-run setup

Date: 2026-10-16. Design proposal for the two screens a new user sees first. Nothing here is wired. Read from the working tree on `main` at `3db5140c`.

Mockups: [mockups/startup.html](mockups/startup.html) and [mockups/onboarding.html](mockups/onboarding.html). Sample code: [boot/](boot/).

## 1. Startup screen

### Today

`src/App.svelte` shows a spinner, "Loading..." and one line of text from `LoadingStatusState.text`, until `loadedStore` turns true. `src/ts/bootstrap.ts` sets that text at each stage. `src/ts/storage/bootArchiveHost.ts` sets it while the archive pass runs ("Archiving characters 3/12"). The strings are English literals, because the save file holds the language setting and is not read yet.

Boot can also stop and wait, through the alert modal:

- storage-fallback notices, block-store notices, archive notices, format-update questions and the nightly warning wait for the modal to be cleared;
- when the save is damaged, the backup prompts (`bootUi` in `bootstrap.ts`) ask the person to choose or confirm;
- a returning account-sync profile gets a blocking notice whose OK reloads the page, so that boot never finishes.

The boot repair count is a toast and does not wait. A failure ends in `alertError`.

### Proposal

- **Mark.** The status mark at 112 px reuses existing statuses, so the mark needs no new states:

  | Step | Mark status |
  |---|---|
  | Storage, app checks, file listing | `scanning` |
  | Reading the save | `transfer_in` |
  | Preparing the library | `preparing` |
  | Recovering from a backup | `transfer_in` |
  | Plugins | `tool_call` |
  | Applying settings | `finishing` |
  | Waiting for an answer | `waiting` |
  | Failure | `error` |
  | Ready | `done` |

- **Progress bar.** Seven equal segments, one per step: `storage`, `save`, `library`, `app`, `files`, `plugins` and `finish`. The steps exist on web and Tauri alike, so the bar never jumps back.
  - A step that reports counts fills its segment by the count. Today that is the archive pass.
  - A step without counts shows a sweep inside its segment instead of fake progress.
  - The shown value only grows.
  - Equal segments are a placeholder. Proportional segments need measured boot timings, which do not exist yet, so none are guessed here.
- **Text.** The step label or the specific detail sits under the bar, with "3 / 7" beside it.
  - After 8 seconds on one step, a hint appears: "Large libraries can take a minute."
  - A collapsed "Details" list shows each step as done, current or pending, with its time.
- **Pauses and failure.** When boot waits for an answer (any of the prompts above), the bar holds with a pulse, the mark shows `waiting`, and the notice appears under the bar instead of a modal over the spinner. A failure tints the step it stopped at red (visible even at the first step, where nothing is filled), shows the `error` mark and puts the message under the bar with "Reload". The red never carries the meaning alone: the label says "Startup stopped".
- **Accessibility.**
  - The bar is `role="progressbar"`. Its `aria-valuetext` reads, for example, "Step 3 of 7: Preparing your library".
  - The mark's `role="status"` announces step and state changes only (`bootAnnouncement`). Counts are left to `aria-valuetext`, so archiving a large library does not queue one announcement per character. The visible label is `aria-hidden` so it is not read twice.
  - Under reduced motion the sweep becomes a steady tint and the fill jumps instead of easing.
  - Forced colours use `Highlight`.
- **Cost.** No network background while booting: decoding and archiving compete for the same thread. The mark is the only moving part, and low power removes its glow and the sweep.
- **Language.** Labels cannot come from the save's language setting, which is not loaded yet. A wired screen picks them from `navigator.language`, and the translator owns those strings.

### Sample code

| File | What it is |
|---|---|
| `boot/bootProgress.ts` | Contains:<ul><li>`BootStep`, `BootState` and `BootProgress`;</li><li>`bootFraction`, `bootMarkStatus` and `bootLabel`;</li><li>`bootProgressFromLegacyText`, which maps today's `LoadingStatusState.text` strings onto steps, so a screen can be built before the boot code reports structured progress. Text it does not know keeps the previous step. Text never yields `waiting` or `failed`: boot shows those through the alert modal, so a screen built on this mapping alone has no pause or failure states.</li><li>`bootAnnouncement`, the live-region text.</li></ul> |
| `boot/nexus-boot.css` | The bar. Transform and opacity only, with low-power, reduced-motion and forced-colors rules. |
| `boot/NexusBootScreen.svelte` | Svelte 5 sample: `progress`, `notice`, `lowPower`, `slowHint` and `slowAfterMs` props. `notice` (`BootNotice` in `bootProgress.ts`: message, optional detail and stack trace, OK or Cancel) shows a boot-time alert inline under the bar instead of the global alert modal, and switches the shown state to `waiting` for normal and error notices (`bootStateWithNotice`). Audit AUD-06 and review F-2; the alert-type mapping is [AUDIT_RESPONSE.md](AUDIT_RESPONSE.md) R-06. |

Wiring it later replaces the loading branch in `App.svelte`. Ideally `bootstrap.ts` then writes a structured `BootProgress` instead of text, and that is a change to boot code, so it needs its own review.

## 2. First-run setup

### Today

`src/lib/Others/WelcomeRisu.svelte` plays the horizontal logo (`/logo_typo_trans.png`) and then a chat transcript with the upstream mascot Airisu, using `src/etc/Airisu.webp`. The steps are:

1. **Language.** Skipped when the browser language is supported.
2. **Name.** It sets `db.username`, the user's name in chats, and must be filled in to continue.
3. **Guided setup or "I will setup myself".**
4. **Provider.** The options are Claude, OpenAI, Horde and OpenRouter.
5. **API key.** It must start with `sk-`. A wrong key raises an error alert.
6. **Chat language.** The three options are:
   - full English;
   - English processing with Google auto-translate;
   - your own language.
7. **Memory or cost.** It sets context and response sizes:

   | Choice | Context | Response |
   |---|---|---|
   | Cheap | 8,000 | 500 |
   | Balanced | 12,000 | 800 |
   | Memory | 16,000 | 1,000 |
   | Unlimited | 100,000 | 1,000 |

At the end the setup applies the OAI2 preset, the high-contrast text theme and `claudeCachingExperimental`, sets the model for the chosen provider (`FIRST_RUN_MODELS` for Claude and OpenAI, literal ids for OpenRouter and Horde), and sets `didFirstSetup`.

### Proposal

The proposal is a step card over the network background, with the status mark in the header. There is no mascot and no transcript. Each step is a real form:
- radio groups in fieldsets;
- labelled inputs;
- a heading that takes focus on every step change;
- a step rail (dots on desktop, "Step 3 of 7 · Persona" on phones).

Each step:

1. **Welcome and language.** The mark at 104 px and the seven languages, with the browser's language preselected and marked. It has three exits:
   - **Start setup**;
   - **Restore a backup**;
   - **Skip setup**, which replaces "I will setup myself".
2. **Use.** The options are Stories and roleplay, Both, or Assistant and tools, with Both in the middle.
   - The choice decides which steps follow.
   - For Stories or Tools alone, a checkbox asks **"Hide unused modes and features?"**. It is off by default, so nothing is hidden unless the person asks. Both is not offered it, because nothing is unused for Both. Exactly which modes and features it hides is decided at implementation.
   - Changing the use clears that checkbox, and switching to Tools clears a persona description, so a choice made for one use never applies silently to another.
3. **Persona or nickname.** Both are optional, and both leave the name as `User`, the existing default in `database.svelte.ts`, when not set.
   - **Stories or Both: Persona.** A name, a description and an avatar, plus **Skip**, which clears all three.
     - The avatar is a button. Clicking it opens a file picker for a PNG, the type today's persona picture picker (`selectUserImg` in `src/ts/persona.ts`) accepts. The picture replaces the initial-letter placeholder, and **Remove picture** brings the placeholder back.
     - The picture and the description become the first persona: the picture its image, the description its prompt.
     - Once a name is typed, a greeting appears under the field ("Nice to meet you, Mina."). It is decoration and is not announced.
   - **Tools: Nickname.** It asks "Would you like to set a nickname?" with Yes and No. Yes shows a nickname field, which must be filled to continue.
4. **Model provider.** Claude, OpenAI, Gemini, OpenRouter and Horde, plus "Set up later", shown as cards. Claude, OpenAI and Gemini each carry a Recommended tag. Gemini is new to first-run setup; its card names low prices and strength in many languages.
   - The key field is a password input with Show and Hide.
   - The key format check runs inline instead of in an alert. Today's setup checks `sk-` for every provider; Gemini keys from Google AI Studio start with `AIza` (TODO(evidence): confirm the current key format at implementation; Settings accepts any string, and a stale prefix would block valid keys), so the check takes its prefix from the provider. A mismatch is a non-blocking advisory in the warm hue ("Standard Claude keys start with sk-. Continue anyway if you use a proxy, a custom gateway or a newer key format."), never a blocker: proxies, enterprise gateways, custom endpoints and new key formats are legitimate (audit AUD-05, see [AUDIT_RESPONSE.md](AUDIT_RESPONSE.md)). Changing the provider clears a typed key.
   - A Gemini key is stored where Settings already keeps it (`DBState.db.google.accessToken`).
   - A yellow caution under the key field: "Keep your key private. It works like a password for your account: anyone who has it can spend your credits. Do not share it, or paste it into chats, character cards, screenshots or bug reports."
   - "Where do I get a key?" is a short text disclosure instead of the twelve screenshots the Claude path shows today.
   - Continue is enabled as soon as the trimmed key is non-empty. The mark shows `done` when the key has the standard prefix.
   - For Horde and "Set up later", the step instead asks **"Would you like to set up memory and chat language now?"** Yes keeps the next two steps. No skips them and applies Balanced memory (12,000 / 800) and the current chat-language setting, discarding any memory or chat-language choice made earlier in the flow.
5. **Chat language.** It is shown only when the app language is not English.
6. **Memory or cost.** The same four choices, with the token sizes shown.
7. **Review.** Every choice, each with Change, under "Ready when you are, Mina" when a name was given. **Finish** plays `finishing` and then `done` on the mark, and ends on "All set, Mina".

**Restore a backup** shows a file picker and progress (`transfer_in`, then `done`). The mockup simulates it. A real one uses the existing backup loader.

The tone follows the warmth rules in [DESIGN_PHILOSOPHY.md](DESIGN_PHILOSOPHY.md) section 1: friendly copy, the person's name in the warm hue (11.42:1 on the card), a warm avatar placeholder (canvas-coloured initial, 9.95:1 or more), a second warm bloom low on the canvas, and small transform-only responses on hover and selection, which reduced motion removes.

The card is nearly opaque (`rgb(6 7 34 / .88)`), because form text over the moving network needs steadier contrast than glass gives. The primary button is accent with canvas-coloured text (12.28:1). Error text uses `#ff6b81` (7.26:1 on the card). Muted text on the card is 6.22:1. The key caution's yellow `#ffd166` text is 12.48:1 on its tint, and its edge is 3.38:1; the warning icon and the bold first sentence carry the meaning without the colour.

### Maintainer decisions (2026-10-16)

1. **Utility users and names.** Utility users are asked whether they want a nickname. If they decline, the name stays `User`.
2. **What "Use" changes.** Apart from the persona step, the only setting it offers is "Hide unused modes and features?". There is no separate preset per use.
3. **Persona description.** Yes: it fills the first persona's prompt.
4. **Restore on first run.** Yes, offered on the welcome step. Still unverified: whether a restored backup also carries `didFirstSetup` and so ends setup. Check this at implementation.
5. **Horde and "set up later".** They ask "Would you like to set up memory and chat language now?" first. No skips both steps. For memory it applies Balanced (decision 8).
6. **Key guidance.** The mockup copy stays as it is; the maintainer reviews each provider's steps at implementation. A yellow caution about keeping the key private is added.
7. **Airisu and the setup screenshots.** The assets stay. Airisu will likely continue as an internal assistant (LLM side chat and data management) rather than as the setup mascot. The maintainer reports that other forks, such as Pocket Risu, use Airisu as their mascot, and that a community post by the upstream developer permits non-commercial adoption by forks; neither is recorded in this repository (TODO(evidence): link the post before relying on it). Asset changes are decided at implementation.

8. **"Use the defaults" means Balanced.** Skipping the memory step applies Balanced (12,000 / 800), the same choice the memory step preselects. This changes behaviour: today's Horde and "later" paths leave 16,000 / 1,000 in place.
9. **Use order.** Both sits in the middle, between Stories and roleplay and Assistant and tools.
10. **Persona picture.** Clicking the avatar on the persona step opens a file picker.
11. **Tone.** The interface should look sleek and professional, and also welcoming and charming, never soulless or cold. The design language is built on this (DESIGN_PHILOSOPHY.md section 1). Discord's interface copy is the tone reference for wording.
12. **Gemini joins the provider list.** Its pros are price and multilingual strength.
13. **Recommended tags.** OpenAI, Claude and Gemini all carry Recommended, not only Claude.

Open for implementation:

- which modes and features "Hide unused" hides for each use;
- the Gemini first-run model: an entry in `FIRST_RUN_MODELS` (`src/ts/model/firstRunModels.ts`), which the registry test requires to be registered and current;
- the provider card descriptions, reviewed with the key guidance (decision 6);
- the i18n keys for the new strings (translator-owned outside English).
