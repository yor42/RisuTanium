## Project Overview

Risuai is a cross-platform AI chatting application built with:
- **Frontend**: Svelte 5 + TypeScript
- **Desktop**: Tauri 2 (Rust backend). The crate versions are not pinned: `src-tauri/Cargo.toml` asks for `tauri` 2.12.1 and the `tauri-plugin-*` crates at 2.4.0 to 2.13.1, but Cargo reads these as minimums within 2.x, and `src-tauri/Cargo.lock` is gitignored, so each build takes the newest compatible release when it resolves. A local lock on 2026-10-07 had `tauri` 2.12.1 and `tauri-plugin-fs` 2.6.0. Before citing crate source, check the `Cargo.lock` the build actually used. The JS packages are exact in `package.json`: `@tauri-apps/api` 2.12.1, `@tauri-apps/cli` 2.9.1 (the platform binaries come through its own optional dependencies, also at 2.9.1; from 2.9.0 it writes `src-tauri/gen/android/app/tauri.properties` during `tauri android build`), and the `@tauri-apps/plugin-*` packages 2.4.0 to 2.13.1 (`plugin-fs` 2.6.0)
- **Build Tool**: Vite 8
- **Styling**: Tailwind CSS 4
- **Package Manager**: pnpm

The application allows users to chat with various AI models (OpenAI, Claude, Gemini, and more) through a single unified interface. It features a rich user interface with support for themes, plugins, custom assets, and advanced memory systems.

## Directory Structure

```
RisuAI/
├── src/                    # Main application source code
│   ├── ts/                 # TypeScript business logic
│   ├── lib/                # Svelte UI components
│   ├── lang/               # Internationalization (i18n)
│   └── etc/                # Documentation and extras
├── src-tauri/              # Tauri desktop backend (Rust)
├── server/                 # Self-hosting server implementations
│   ├── node/               # Node.js server (current)
│   └── hono/               # Hono framework server (future)
├── public/                 # Static assets
├── dist/                   # Build output
└── .github/workflows/      # CI/CD pipelines
```

### Source Code Structure (`/src`)

#### `/src/ts` - TypeScript Business Logic

| Directory/File | Purpose |
|----------------|---------|
| `storage/` | Data persistence layer (database, save files, platform adapters) |
| `process/` | Core processing logic (chat, requests, memory, models) |
| `plugins/` | Plugin system (API v3.0, sandboxing, security) |
| `gui/` | GUI utilities (colorscheme, highlight, animation) |
| `drive/` | Local `.bin` backup and restore (the folder name is historical) |
| `translator/` | Translation system |
| `model/` | Model definitions and integrations |
| `cbs.ts` | Callback system |
| `characterCards.ts` | Character card import/export |
| `parser/` | Message parsing (`parser.svelte.ts`, `chatML.ts`, `chatVar.svelte.ts`, `partialEdit.ts`) |
| `stores.svelte.ts` | Svelte stores for state management |
| `globalApi.svelte.ts` | Global API methods |
| `bootstrap.ts` | Application initialization |

#### `/src/ts/process` - Core Processing

| Directory/File | Purpose |
|----------------|---------|
| `index.svelte.ts` | Main chat processing orchestration |
| `request/` | API request handlers (OpenAI, Anthropic, Google) |
| `memory/` | Memory systems (HypaMemoryV2/V3, SupaMemory, HanuraiMemory) |
| `models/` | NAI and local-model integrations only (`nai.ts`, `local.ts`, `modelString.ts`). OpenRouter and Ooba live in `src/ts/model/`, a sibling of `process/`, not here |
| `templates/` | Prompt templates and formatting |
| `mcp/` | Model Context Protocol support |
| `files/` | File handling (inlays, multisend) |
| `embedding/` | Vector embeddings |
| `lorebook.svelte.ts` | Lorebook/world info management |
| `scriptings.ts` | Scripting system |
| `triggers.ts` | Event triggers |
| `stableDiff.ts` | Stable Diffusion integration |
| `tts.ts` | Text-to-speech |

#### `/src/lib` - Svelte UI Components

| Directory | Purpose |
|-----------|---------|
| `ChatScreens/` | Chat interface components |
| `UI/` | General UI components (GUI, NewGUI, Realm) |
| `Setting/` | Settings panels |
| `SideBars/` | Sidebar components (Scripts, LoreBook) |
| `Others/` | Miscellaneous components |
| `Mobile/` | Mobile-specific UI |
| `Playground/` | Testing/playground features |

## Building and Running

### Prerequisites

- Node.js 20.19+ or 22.12+ and pnpm
- Rust and Cargo (for Tauri builds)

### Development

```bash
# Web development server
pnpm dev

# Tauri desktop development
pnpm tauri dev
```

### Production Builds

```bash
# Web build
pnpm build

# Web build for hosting
pnpm buildsite

# Tauri desktop build
pnpm tauribuild
pnpm tauri build

# Hono server build
pnpm hono:build
```

### Type Checking

```bash
pnpm check
```

## Development Conventions

### Coding Style

- **There is no configured formatter or linter.** No Prettier, ESLint, Biome or `.editorconfig` exists in this repo, and no `format` or `lint` script. Match the style of the surrounding file by hand; do not run a formatter across a file you are editing, because it will produce a diff nobody asked for and bury the real change
- Ensure code is formatted before committing
- **No in-repo line numbers in code or test comments.** Refer to code by name (function, effect, branch, test), for example "the preset effect above" or "prepareSaveIteration in globalApi.svelte.ts", never `file.ts:123`. Line numbers go stale on the next edit, reviewers here reject stale comments as false claims, and this has already cost review rounds. Exception: a pinned third-party source may be cited by line with its version (e.g. `svelte 5.55.1, proxy.js:201-206`). Reports, the roadmap and the ledger are dated snapshots and keep `file:line`; briefs may ask agents for line numbers in their reports, never in comments.

### State Management

The project uses Svelte 5 Runes system:
- `$state`, `$derived`, `$effect` for reactive state
- Svelte stores (writable, readable) in `stores.svelte.ts`

**`DBState` is not a store.** It is declared `export const DBState = $state({...})` in `stores.svelte.ts` — a rune-based reactive object, accessed as a plain object (`DBState.db`). There is no `$DBState`, and the `$`-prefix subscription syntax does not work on it.

Key `writable` stores:
- `selectedCharID` - Current character
- `settingsOpen`, `sideBarStore`, `MobileGUI` - UI state
- `loadedStore`, `alertStore` - Application state
- `DynamicGUI` - Responsive layout switching

### Styling & Theming

To ensure dynamic theme support across the app, always use the project's custom theme colors defined in `src/styles.css` when styling components with Tailwind CSS. If you need to check how these colors are dynamically managed or view available presets (like dark, light, cherry, etc.), reference `src/ts/gui/colorscheme.ts`. Only inspect this file when specifically working on theme-related logic.

Available custom theme colors include:
- `textcolor`, `textcolor2`
- `bgcolor`, `darkbg`, `darkbutton`, `selected`
- `borderc`, `darkborderc`
- `draculared`

You can safely apply Tailwind's opacity modifiers directly to these custom theme colors (e.g., `text-textcolor/90`, `bg-textcolor/5`, `border-textcolor/10`).

### File Naming Conventions

- `.svelte.ts` - Svelte 5 files with runes
- `.svelte` - Svelte component files
- Use camelCase for file names

### Testing

- Unit tests use Vitest (`pnpm test` runs `vitest run`); there are 197 `*.test.ts` files under `src/` as of 2026-09-30 — re-check with `git ls-files 'src/**/*.test.ts' | wc -l` rather than trusting this number, which has gone stale before. They are spread across `src/ts/process`, `src/ts/parser`, `src/ts/storage`, `src/ts/media`, `src/ts/network`, `src/ts/plugins`, `src/ts/translator`, `src/lib` and elsewhere — not exhaustive coverage, but a real and growing suite, not just a placeholder.
- Run `pnpm check` for type checking (svelte-check).
- Test coverage is uneven: some areas (e.g. `src/ts/storage/remoteSaveCleanup.test.ts`) only exercise Tauri/Node-specific code paths and say nothing about the pure web build's behavior in that area. Don't assume a file has tests nearby means that exact runtime path is covered — check what the test actually exercises.

## Key Architectural Patterns

### Data Layer

- Database abstraction: the persisted kinds (main file, backups, remote blocks, assets, cold-storage units) go through one byte store, chosen once per page load by `src/ts/storage/store/appStore.ts`: Tauri files, the Node server over HTTP, or IndexedDB on the web (or, for a page that fell back, a transitional store over OPFS). `AutoStorage` (`src/ts/storage/autoStorage.ts`) still builds the Node server client (`nodeStorage.ts`) or a plain LocalForage instance, and never selects OPFS.
- **OPFS is no longer written on the web build, except by a page that fell back to it.** The Backup & Files OPFS toggle is gone. A profile still flagged `localStorage['opfs_flag!'] === "able"` (set by an unreleased fork development build, or by hand by an upstream user) is copied back into IndexedDB at startup by `src/ts/storage/opfsCopyBack.ts` (run from the web branch of `appStore.ts`), once, under the exclusive storage-migration lock. If the copy cannot run or finish, the page runs from OPFS this time with a notice, and the next start tries again. The old OPFS files stay for one start and are deleted at a later start that loaded normally from IndexedDB. Cold-storage units (`src/ts/process/coldstorage.svelte.ts`, names decided in `coldUnitLocation.ts`) are values in the page's store under `coldstorage/<key>`; a legacy OPFS file `coldstorage_<key>.json` is read only when the store lacks the unit, is never written, and is deleted together with the unit. Don't assume "OPFS" in a file name means it's active for a given user — check the `opfs_flag!` flag first.
- Tauri desktop no longer bypasses this abstraction: `saveDb()` in `src/ts/globalApi.svelte.ts` writes the main file with `writeMainFile` and the numbered backup with `getAppStore()`'s `write`, and the Tauri files store writes through a temp file and a rename. "Remote" character blocks go through the same store on every platform (`getAppStore()` in `src/ts/storage/risuSave.ts`), not through `forageStorage`. `writeFile` calls remain for user-facing saves (a Download-folder save and `TauriWriter`, both in `globalApi.svelte.ts`), not persisted kinds.
- Save file format: `.bin` files with encryption support, structured as a block/chunk format (`RisuSaveType` in `src/ts/storage/risuSave.ts`) — a root block plus one block per character/module/preset/etc., only-changed-blocks-re-encoded incrementally.
- Character cards: Import/export in various formats (.risum, .risup, .charx)

### Processing Pipeline

1. Chat processing in `process/index.svelte.ts`
2. Request handling with provider abstraction
3. Memory systems for context management
4. Lorebook integration for world info

### Plugin System (API v3.0)

- Iframe-based sandboxing for security
- SafeDocument/SafeElement wrappers for DOM access
- Plugin storage (save-specific and device-specific)
- Custom AI provider support
- Hot reload support for development

See `plugins.md` for comprehensive plugin development guide.

### UI Architecture

- Component-based with Svelte 5
- Responsive design with mobile/desktop variants
- Theme system with custom color schemes
- Multiple UI modes, selected by the `theme` setting (`src/ts/setting/displaySettingsData.svelte.ts`): Standard Risu (`''`), Waifulike (`'waifu'`), Mobile Chat (`'mobilechat'`), CardBoard (`'cardboard'`) and Custom HTML (`'customHTML'`). `WaifuCut` was removed in the display-settings-to-renderer refactor
- Dynamic GUI switching based on viewport
- No traditional router; uses conditional rendering in App.svelte
- In-app drag-and-drop uses custom MIME types to avoid conflicting with file imports; see `src/ts/dragTypes.ts`

## Supported AI Providers

`LLMProvider` in `src/ts/model/types.ts` is authoritative — check it rather than trusting this list, which has drifted before. As of 2026-09-23 it covers:

- OpenAI (GPT series)
- Anthropic (Claude)
- Google (Gemini) and Vertex AI
- Mistral
- Cohere
- NovelAI, and NovelList
- DeepSeek
- DeepInfra
- NanoGPT
- AWS (Bedrock)
- AI Horde
- Ollama
- WebLLM (in-browser inference)
- OpenRouter and Ooba (Text Generation WebUI) — these are modelled by format in `src/ts/model/modellist.ts` rather than as `LLMProvider` entries
- Custom providers via plugins

`AsIs` and `Echo` are passthrough and developer entries, not user-facing providers.

## Internationalization

Supported languages:
- English (en)
- Korean (ko)
- Chinese Simplified (cn)
- Chinese Traditional (zh-Hant)
- Vietnamese (vi)
- German (de)
- Spanish (es)

Language files are located in `/src/lang/`.

## Deployment Targets

- **Web**: Vite static site
- **Desktop (Tauri)**: Windows (NSIS), macOS (DMG, APP), Linux (DEB, RPM, AppImage)
- **Docker**: Container (port 6001)
- **Self-hosted**: Node.js or Hono server

## Security

- Plugin sandboxing with iframe isolation
- DOM sanitization with DOMPurify
- Buffer encryption/decryption utilities
- CORS handling with proxy support
- Tauri HTTP plugin for native fetch

## Documentation

| File | Description |
|------|-------------|
| `README.md` | Main project documentation |
| `plugins.md` | Plugin development guide |
| `AGENTS.md` | AI assistant documentation |
| `src/ts/plugins/migrationGuide.md` | Plugin API migration guide |
| `server/hono/README.md` | Hono server documentation |
| `server/node/readme.md` | Node server documentation |

## AI Coding Agent Requirements

Use a senior-orchestrator workflow. Keep discovery, implementation, review, and arbitration in separate contexts whenever the available agent system permits it.

This effort is a targeted stabilization and improvement campaign, **not a rewrite or major overhaul**. Bug fixes, reliability and performance work, maintainability improvements, UI improvements, and new or enhanced features are permitted. The compatibility invariant is that a user can move between upstream and this fork in both directions: a backup `.bin` exported by upstream imports into this fork, and one exported by this fork imports into upstream, with nothing lost either way. That round trip is sufficient; upstream does not have to read this fork's own storage (its save folder, remote blocks or cold storage) directly. Upstream-compatible characters, modules, presets, plugins, and other supported integrations must also continue to work on this fork. One exception, for the fork-to-upstream direction only: data larger than upstream can hold may be left out of an upstream-compatible export, after a warning that names it and a confirmation before the export starts. Upstream to this fork must always work. (MC-175, amended by MC-223, which has the details)

**Scope amendments.** The campaign fixes accumulated design gaps in a coupled application, so fixing A can require B through a shared cause C. The Orchestrator may amend an item's implementation boundary, within already-authorized scope, for: required behaviour in the agreed mobile experience; a technical prerequisite for implementing an accepted requirement safely; a shared-cause correction needed for an agreed outcome or already-authorized work; or an explicit maintainer decision to reduce supported complexity. The case for an amendment states the concrete failure if it is left unfixed, its causal connection, and the smallest coherent correction across the endpoints that need it. Do not force endpoint-specific patches only to keep an original file list. A new product trade-off is still the maintainer's to decide. Record each amendment in the item's report or gate record. (MC-091)

**Release status — this fork has never shipped.** There is no released build of this fork and no userbase on it. The last build with actual users is **upstream** (`kwaroran/RisuAI`). This campaign is itself the blocker on shipping: there will be no release or deliverable until it closes the known data-loss and performance issues. Recorded as `MC-011` in `Agents/Maintainer-Context.md`, which is authoritative for maintainer-stated facts.

Two consequences follow, and they pull in opposite directions:

- **"Pre-existing behaviour" is not worth preserving, and is not by itself a reason to defer a fix.** Nobody was ever hit by a fork-local bug, and nobody depends on fork-local behaviour. Weigh a deferral on scope and blast radius alone. Do not argue for a design on the grounds that it is a Pareto improvement over current fork behaviour — there is no shipped behaviour to improve on, so pick what is right for the first release. Do not spend design effort migrating or recovering already-corrupted fork-local state.
- **This does not weaken the compatibility invariant above — it strengthens it.** Users will arrive by migrating *from* upstream and must be able to go back, so the `.bin` round trip in both directions, and upstream characters, modules, presets and plugins, must keep working, and that matters more under this framing, not less. User-reported symptoms cited anywhere in `Agents/**` are observations of *upstream* builds, not of this fork.

There is no release pressure. Quality and the gate pipeline win over shipping something partial.

### 1. Multi-Agent Routing Protocol (CRITICAL)
You are the **Opus 5 Senior Orchestrator**. To prevent token bleeding and maximize the Max 5x plan quota, you MUST delegate tasks to specialized subagents in `.claude/agents/` using this routing matrix:

1. **Code & File Search / Survey** -> Delegate immediately to `code-searcher` (powered by **Claude Haiku 4.5**). Never use Opus 5 or Sonnet 5 to read entire folders or run blind greps.
2. **Implementation / Type Bug Fixes** -> Delegate bounded scopes to `sonnet-coder` (powered by **Claude Sonnet 5**). Pass only the exact file paths and line ranges.
3. **Complex Architectural Decisions** -> Handled by you (Opus 5). When the decision meets an escalation trigger in 1.2, escalate to `senior-advisor` rather than deciding alone.
4. **Performance, Profiling, and Memory Leaks** -> Delegate to `perf-analyzer` (powered by **Claude Sonnet 5**). Give it access to execution logs, heap snapshots, and profiling data to isolate the root cause before any code changes.
5. **Writing Tests & Fixing Test Failures** -> Delegate to `test-warrior` (powered by **Claude Sonnet 5**). Use this agent exclusively for creating Vitest suites, mocking external APIs/Tauri file systems, and resolving test regressions without letting test logs bloat the main context.
6. **Adversarial Code & Plan Review** -> Delegate to `adversarial-reviewer` (powered by **Claude Sonnet 5**). This agent falsifies implementations, traces async race conditions, and gates changes on stated acceptance scenarios and invariants. It holds `Bash` for inspection and for read-only verification (`git diff`, `pnpm test`, `pnpm check`) and is expected to re-run a claim rather than accept it; it is read-only **by doctrine, not by sandbox**, exactly as `opus-reviewer` and `senior-advisor` are. **Check a profile's actual tool grant before a brief promises it a tool** — a brief that claimed Bash this agent did not yet have cost a review gate its execution evidence on 2026-09-21.
7. **Investigation / Verifying How Something Actually Behaves / Sizing a Change** -> Delegate to `investigator` (powered by **Claude Sonnet 5**). This is the default investigation tier. Use when you need to *know* rather than guess: tracing a mechanism end to end, counting a blast radius, or checking whether a premise you are about to act on is true. It acts as a context firewall — it absorbs the grep output, dead ends and framework internals, and returns a compact evidence packet. Do NOT use it for plain lookups — that is `code-searcher`'s job and costs a fraction as much.
8. **Deep Investigation (escalation only)** -> Delegate to `deep-investigator` (powered by **Claude Opus 5**) under the triggers in 1.3. Its question is not "what happens" but *"are we sure that is what happens"*. It is handed the prior investigation as an evidence packet and is required to re-open primary source itself for every decision-critical claim. It is an exception path, not the standard route for a hard question.
9. **High-Rigor Adversarial Review (expensive-to-reverse changes)** -> Delegate to `opus-reviewer` (powered by **Claude Opus 5**). Use instead of `adversarial-reviewer` when the failure mode is silent data loss or the change touches save/persistence, the save format, the reactive database, or asset caching. Unlike the Sonnet tier it also fact-checks the commit message, code comments, and whether the tests would genuinely fail against the pre-change code.
10. **Strategic Escalation (stuck, contradicted, or a foundational fork)** -> Escalate to `senior-advisor` (powered by **Fable 5.1**) under the triggers in 1.2. It gives direction only and never writes code.
11. **Reading an Implementation for Documentation** -> Delegate to `code-reader` (powered by **Claude Sonnet 5**). Use it when the question is *"describe all of it"*: every syntax, tag, function, option, default and edge case of a subsystem, enumerated from the dispatch point, cited, and marked TRACED or INFERRED. It is exhaustive by design, unlike `investigator`, which answers one decision question and cuts everything else. It lists suspected bugs and fork differences separately and never documents a suspected bug as intended behaviour. It is read-only and may dispatch `code-searcher`.
12. **Writing Documentation** -> Delegate to `doc-writer` (powered by **Claude Sonnet 5**). This covers reports, Roadmap and ledger entries, wiki pages, plugin and API docs, and commit-message drafts. It writes Markdown only, in named files, and only from supplied evidence or source it opened itself. It keeps confidence levels as the evidence states them, preserves line endings, and leaves `TODO(evidence)` rather than filling gaps. It never edits code, `src/lang/*`, or governance files unless named, and it never commits.
13. **Fact-Checking Documentation** -> Delegate to `doc-verifier` (powered by **Claude Sonnet 5**). It checks every claim against source and gives one verdict per claim: VERIFIED, WRONG, STALE CITATION, OVERSTATED, INCOMPLETE or UNVERIFIABLE. It is dispatched by the Orchestrator, never by the author, and it is read-only. For persistence-touching commits, `opus-reviewer` still owns the commit-message check.

14. **Translating UI Strings** -> Delegate to `translator` (powered by **Claude Sonnet 5**). It adds missing keys and fixes untranslated or stale entries in `src/lang/*.ts`, from `en.ts` into ko, cn, zh-Hant, vi, de and es. It preserves keys, `${…}` interpolations, CBS tags and CRLF line endings exactly. It never reverts the maintainer's own edits in those files. Warnings and consent strings must keep their full force. A new English source string goes to `sonnet-coder`, together with its call site, not to `translator`.

**Every subagent brief cites the context log.** Before dispatching, check `Agents/Maintainer-Context.md` for facts and decisions bearing on the task, and name the relevant `MC-` ids in the brief. A subagent has no other way to see what the maintainer has actually stated or decided, and an agent that re-derives a settled decision, or quietly contradicts one, has usually just not been told. Where the log is silent on something the task turns on, that is a question for the maintainer, not a gap to fill with an assumption. Start from `Agents/README.md` for what every other campaign document is authoritative for.

**Documentation flow:** `code-reader -> doc-writer -> doc-verifier -> Orchestrator`. When the evidence already exists (an investigator packet, a gate record or a measurement), skip `code-reader` and hand the packet straight to `doc-writer`. Documentation separates the author from the checker for the same reason code review does.

**Which code-reading agent?** Four agents read code, and each answers a different question. Pick by the shape of the answer you need, not by how hard the code is:

| Agent | Question | Output | Interprets code? | Completeness | Typical brief |
|---|---|---|---|---|---|
| `code-searcher` (Haiku 4.5) | *Where is X?* | A location map: `file:line` plus the literal matching line, and the command used | **No.** It must not say what code does | Exhaustive over **matches** of a query | "every call site of `setDatabase(` in `src/ts`" |
| `investigator` (Sonnet 5) | *What happens here, and does it matter for this decision?* | An evidence packet: refuted premises, findings with consequences, blast radius | Yes | **Selective:** keeps only what bears on the decision | "does a non-selected character edit reach the save file?" |
| `code-reader` (Sonnet 5) | *Describe everything this subsystem offers a user* | A reference packet: one row per syntax/function/option, with behaviour, defaults, aliases and citations | Yes | Exhaustive over **features**, enumerated from the dispatch point | "every CBS tag and its arguments", "the whole V3 plugin API surface" |
| `deep-investigator` (Opus 5) | *Are we sure that is what happens?* | A challenge to a prior packet | Yes | Selective | Only under the triggers in 1.3 |

Rules of thumb:
- If the answer is a list of places, use `code-searcher`. If it is a list of behaviours, use `code-reader`. If it is a yes/no or a number that drives a decision, use `investigator`.
- `code-searcher` counts **occurrences**, for example "14 call sites". `code-reader` counts **capabilities**, for example "N CBS tags" enumerated from the matcher, and describes each one. A grep for a tag name cannot tell you how the tag behaves, and a reference page cannot be built from a location map.
- `code-reader` and `investigator` may both dispatch `code-searcher` for a mechanical survey. Neither may dispatch the other.
- A `code-reader` packet is documentation input. When a finding in it drives a code change (a `SUSPECTED BUG`), the change goes through the usual `investigator` → plan → review path. The reference packet is not the evidence for the fix.

#### 1.1 Dynamic Subagent Generation (Autonomy Rule)
- If a task requires highly specialized domain knowledge not covered by existing subagents (e.g., Rust/Tauri backend native bridging, complex data migration scripts, security isolation checks), you (Opus 5) have the authority to dynamically create a new subagent.
- **Process:**
  1. Write a new markdown profile under `.claude/agents/<name>.md`.
  2. Define a strict YAML frontmatter choosing the optimal 2026 model (e.g., `claude-sonnet-5` for heavy logic, `claude-haiku-4.5` for lightweight tasks) and minimal required tools.
  3. Clearly separate its context and rules to keep it focused.
  4. Inform the user about the new agent creation before delegating the task.

#### 1.2 Escalation Ladder (cost-ordered)
Route to the cheapest tier that can answer the question. Escalating early wastes quota; escalating late wastes far more, because wrong direction compounds into work that has to be thrown away.

| Need | Agent | Model |
|---|---|---|
| Where is X | `code-searcher` | Haiku 4.5 |
| Implement a bounded change | `sonnet-coder` | Sonnet 5 |
| Routine plan or code review | `adversarial-reviewer` | Sonnet 5 |
| What actually happens / how big is this really | `investigator` | Sonnet 5 |
| Are we sure that is what actually happens | `deep-investigator` | Opus 5 |
| Review where a defect is expensive to reverse | `opus-reviewer` | Opus 5 |
| Direction when stuck or at a foundational fork | `senior-advisor` | Fable 5.1 |
| Describe a whole subsystem, for docs | `code-reader` | Sonnet 5 |
| Write or edit a document | `doc-writer` | Sonnet 5 |
| Fact-check a document | `doc-verifier` | Sonnet 5 |
| Translate UI strings | `translator` | Sonnet 5 |

**Escalate to `senior-advisor` when at least one holds:**
- Two materially different solution attempts have failed.
- Root cause remains unclear after targeted investigation.
- Evidence contradicts your current mental model.
- The fix requires changing a foundational architectural assumption.
- Multiple plausible approaches exist and choosing wrong creates substantial downstream work.
- A bug crosses several subsystem boundaries.
- Your confidence is below the required threshold after gathering available evidence.
- The team appears stuck in a loop.
- **A review gate has rejected the same item (`[REJECT]`) three rounds in a row, each time with new findings.**
  This is the concrete test for "stuck in a loop". Count plan gates and implementation gates
  alike. Escalate before writing the fourth revision, not after it; do not keep iterating between
  the Orchestrator and the reviewer.
  - **Only substantive rejections count:** a design, logic, data-safety or test defect. A round
    whose findings are editorial only ends `[EDITORIAL]`; its corrections are verified as in
    section 4's remediation rules. It neither counts toward the three nor breaks a streak.

Plus one standing use: **attacking a plan that is expensive to reverse, before implementing it.**

**Rules for escalating.** Hand `senior-advisor` a dossier — what was attempted, what was observed, what the evidence contradicts — so it verifies and extends rather than rediscovering. It never writes code; it returns ROOT CAUSE / MISSED INSIGHT / RECOMMENDED STRATEGY / NEXT INVESTIGATION / DO NOT / UNCERTAINTY. Do not invoke it as a second opinion alongside another reviewer, and do not invoke it for work that is merely hard rather than directionally unclear.

**Codex** remains available as an independent implementation-focused review (section 5) but is quota-constrained and is not the default escalation path. Prefer `senior-advisor` for direction and `opus-reviewer` for rigour; reserve Codex for cases where a genuinely independent toolchain is the point.

#### 1.3 Investigation Tiers

Four agents answer four different questions. Route to the one whose question you are actually asking:

| Question | Agent | Model |
|---|---|---|
| Where is X? | `code-searcher` | Haiku 4.5 |
| What actually happens? | `investigator` | Sonnet 5 |
| Are we sure that is what happens? | `deep-investigator` | Opus 5 |
| Given these facts, what should we do? | `senior-advisor` | Fable 5.1 |

**Default flow:** `Orchestrator -> investigator -> Orchestrator`.
**Escalated:** `Orchestrator -> investigator -> deep-investigator -> Orchestrator`.
**Simple lookup:** `Orchestrator -> code-searcher -> Orchestrator`.

Investigation contains a great deal of expensive mechanical work — greps, following imports, enumerating call sites, reading framework internals, checking git history, and walking dead ends. That work needs evidence discipline, not frontier reasoning. Running it on Opus pays Opus rates for repository archaeology *and* fills an Opus context with exploration exhaust immediately before the reasoning step that matters. The default tier exists to absorb that mess and return a compact evidence packet.

**Escalate to `deep-investigator` when at least one holds:**
- Ordinary investigation produced contradictory evidence.
- The mechanism still cannot be established confidently — only the symptoms correlate.
- Evidence contradicts your mental model, or the investigation's own conclusions do not cohere.
- The reported blast radius is unexpectedly large or strange.
- Behaviour depends on framework or runtime subtleties that were not pinned down in source.
- A possible load-bearing accident materially changes the decision.
- Multiple traces look individually valid but imply incompatible conclusions.
- You suspect the investigation itself may be wrong.
- The `investigator` returned a `REQUEST ESCALATION` section.

Do not escalate merely because a question is hard, or because the change is important. Escalate when the *direction of the facts* is in doubt.

**Conditional verification.** The common path does not pass through `deep-investigator`, so in most investigations a mid-tier inference reaches you unchallenged. Handoffs carry three kinds of information, treated differently:
- **Observations** (what source says, what a command printed) are reused when they are supported by accessible evidence that still applies.
- **Interpretations** (what the evidence means) are checked: does the evidence support the conclusion?
- **Settled maintainer decisions** are respected; new evidence that materially changes their consequences is raised with the maintainer.

A "VERIFIED" label from a model is not evidence. A source observation names the source it describes. Execution evidence names the command, the result, and the code, dependencies, runtime, configuration and inputs it ran against. **HEAD alone is not enough in the shared dirty worktree:** name the working changes that mattered, including untracked files. Evidence never transfers silently to a different implementation. Use existing logs and scratch artifacts; do not build an evidence-management system.

Every decision-critical, high-risk inference receives an independent source-level or execution check at the appropriate gate. The Orchestrator is accountable for evidence quality and for what it implies, but need not repeat an adequate independent check. **Re-verify when** evidence or its provenance is missing or ambiguous; the implementation or execution conditions changed; evidence conflicts; a conclusion goes beyond what its evidence establishes; or a critical claim has not yet had the independent scrutiny it needs. Verify the cheapest way that settles it: a count by re-running its command, a claim about what code means by opening the file. Do not read fifty files to check a number, and do not accept a mechanism because a map listed its location. Passing tests alone do not establish that the tests are adequate or how a real platform behaves. Compression is what makes the tier split affordable; unverified compression is how a wrong premise becomes established fact. Reviewers and investigators in this campaign have been wrong, and deferring to one has already cost a correct answer that had been derived and was then abandoned.

**Subagent nesting works, and `investigator` / `deep-investigator` may dispatch `code-searcher`.** Verified empirically on 2026-09-21, not taken from documentation: a subagent successfully spawned a third-level `code-searcher` whose answer cross-checked correctly against source. Two constraints came out of that test and both matter:

- **Delegation has a floor cost of ~9,000 tokens and ~5 seconds per dispatch**, even for one grep. So delegate *surveys* (broad, batched, mechanical enumeration that would otherwise flood a context), never individual *lookups* — an inline `rg` is cheaper and instant. Reflexive delegation is a net loss.
- **The tool grant is unrestricted.** A subagent with `Agent` can spawn any agent type, including another Opus one. The "only dispatch `code-searcher`" rule lives in the profiles as doctrine and is **not enforced by a sandbox**. If fan-out is ever observed going wider than that, the grant must be revoked rather than re-worded.

Profile changes register at **turn boundaries**, not immediately — a newly created or edited agent profile is not dispatchable within the same turn that wrote it. Budget an extra turn when adding an agent.

**Record every investigation in `Agents/Investigation-Ledger.md`.** The tier split is an architecture under test, not a settled result. Log the question, tier, token cost, whether it escalated, and whether escalation changed the conclusion. If the mid-tier cannot reliably produce packets good enough to resolve most investigations without escalation, that ledger is what justifies reverting to Opus as the default.

**Do not invoke both tiers in parallel on the same question.** `deep-investigator` consumes the prior investigation as input; running them concurrently discards its entire advantage and pays twice for it.

**Bound each dispatch.** Each additional agent has a distinct unresolved question or an independent verification responsibility; several agents do not reconstruct the same mechanism without an explicit reason. When an investigation needs runtime evidence it does not have, name the exact observation needed, stop expanding that branch speculatively, and obtain the observation (or ask the maintainer for it), continuing any independent work meanwhile. When the same kind of endpoint omission recurs, reconsider the shared mechanism, ownership or lifetime rule before adding another guard.

### 2. TypeScript & Svelte 5 Technical Guardrails
When writing or refactoring code for this repository, all agents must strictly adhere to the following language rules to prevent compile-time/runtime regressions:
- **Strict Anti-`any` Policy:** Do not use `any` or `unknown` as a lazy fix for type errors. Always declare precise `interface` or `type` aliases matching the Risuai domain architecture.
- **Svelte 5 Runes Invariant:** Ensure state management uses Svelte 5 Runes (`$state`, `$derived`, `$effect`) correctly. Do not mix legacy Svelte v4 store syntax (`$store`) inside new Svelte 5 components unless explicitly bridging older modules.
- **Fail-Fast Typing:** Before declaring a task complete, the agent runs `pnpm check` itself (it has Bash) and reports the result; the maintainer is not asked to run it.

### 3. Agentic Workflow Loop Control (Preventing Token Bleeding)
- **Budgets are checkpoints.** A time, token or tool-loop budget is a checkpoint for reassessing direction (summarise, and ask the maintainer when direction is unclear), never a reason to declare incomplete work accepted.
- **Context.** Preserve useful continuity within a coherent task. Reset (`/clear`) when context size, contamination or a change of scope warrants it, not automatically when tests pass or a diff is verified.

### 4. Two-step review for non-trivial code changes
For any **non-trivial** code change — new features, architectural changes, anything touching areas flagged in `Agents/Reports/` (save/persistence, the reactive database, asset caching, Tauri platform config), or anything the orchestrator judges risky or wide-reaching — use two independent review gates, once before implementing and once after:

1. **Plan review.** Before writing code, record the scope, proposed approach, expected files, invariants, risks, tests, design tradeoffs, and how compatibility with upstream artifacts and integrations will be preserved. Give that plan to a fresh Sonnet reviewer in a clean context and frame the task as an attempt to falsify the approach and its assumptions. The reviewer must look for accidental feature removal, plugin/module/provider incompatibility, inability to read or use existing characters, presets, modules, or backup files, unsafe format migration, and workflow regressions in addition to ordinary correctness risks. If the change meets a Codex escalation condition, run Codex adversarial review as an additional independent challenge before implementation. Resolve or explicitly disposition confirmed findings.
2. **Implement.** Delegate the bounded implementation to a Sonnet worker. Keep the accepted plan and its constraints available, but do not contaminate the later reviewer with the worker's private reasoning transcript.
3. **Code review.** Give the requirements, accepted plan, actual diff, relevant source, and test evidence to a different fresh Sonnet reviewer. Require it to look for defects, regressions, uncovered paths, incorrect assumptions, missing tests, and drift from the reviewed plan. If escalation is required, also run Codex `review` for implementation-focused inspection or `adversarial-review` when the design and assumptions must be challenged. Fold in confirmed corrections, rerun relevant checks, and review any material fix-up diff before considering the change done.
4. **Arbitrate.** Opus evaluates findings against source evidence. It must not resolve disagreement by seniority or majority vote. If material disagreement remains after targeted re-checks, escalate to `senior-advisor` with a dossier of both positions and the evidence each rests on; if that is unavailable, report the blocker and do not mark the disputed work final. Note that reviewers have been wrong in this campaign: before propagating a reviewer's factual claim into a plan, a commit message, or another agent's brief, verify it against source yourself.

**Review outcomes and remediation.** A gate ends in one of three outcomes (the reviewer's verdict token in brackets):
- **Behavioural changes required** (`[REJECT]`): a design, logic, data-safety or test defect.
- **Behaviour accepted; editorial corrections pending** (`[EDITORIAL]`): the behaviour is accepted, but a comment, test title or description, document or commit message is false or misleading. These corrections are required before final acceptance.
- **Accepted** (`[APPROVE]`), optionally with separately listed non-blocking improvements.

**Remediation** is one consolidated brief listing each finding, the requirement it affects, the change boundary and the verification it needs; optional improvements are listed separately and are not a precondition.
- **Editorial-only correction:** verify that the actual diff contains only the intended editorial changes, check each corrected claim against its evidence, and close the finding. It does not re-run application tests or unrelated verification, and it does not become a production cleanup stage. An editorial correction that exposes a substantive misunderstanding reopens the relevant analysis.
- **Executable remediation** always gets review of the behaviour it affects. Reopen a broader gate when the change affects a shared contract or invariant, materially alters the design, contradicts earlier evidence, or invalidates an earlier acceptance.
- **Reviewer continuity:** reuse the same independent reviewer for remediation while its context is usable and separate from the implementer's reasoning; give it the prior findings, the actual changes and the updated evidence. Use a fresh reviewer when independence or context is compromised, or when a new design challenge is needed — not automatically after every edit.
- **Acceptance is finite:** the stated acceptance scenarios hold, the important invariants are evidenced, and no substantiated blocker is outstanding. Not "every logical failure path exhausted".
- **Checks:** one owner (named in the brief; by default the Orchestrator at the pre-gate step) runs the full suite, `pnpm check` and the build on the final relevant implementation snapshot. During remediation, agents run targeted checks (the tests for what they touched, and `pnpm check`). Re-run the full checks when a change invalidates their applicability. Reviewers may still re-run any critical check and challenge any evidence; not every role repeats the whole suite against unchanged inputs. Editorial-only changes do not trigger application tests.
- **The three-round rule (1.2)** counts `[REJECT]` rounds only; `[EDITORIAL]` rounds neither count nor break a streak.

**Choosing a review tier.** Use `adversarial-reviewer` (Sonnet 5) by default. Use `opus-reviewer` (Opus 5) when the failure mode is silent data loss, or when the change touches save/persistence, the save format, the reactive database, or asset caching — it additionally fact-checks the commit message, the code comments, and whether the tests would actually fail against the pre-change code, all of which are part of the change and all of which have carried real defects here.

**Reviewer scratch files.** Reviewers are read-only in the repository. When a review needs a throwaway differential test, mutant or scratch config, tell the reviewer to put it in its session scratchpad, never under `src/` or anywhere in the tree: the maintainer's dev server watches `src/`, and the tree is shared.

**Test purposes.**
- **Regression reproducer:** fails against the relevant pre-fix behaviour and passes after the fix. The failure must demonstrate the intended defect: an import, setup or missing-export failure does not count. Write it against the unfixed code and confirm it fails first; commit it with the fix, and record the pre-fix failure in the commit message.
- **Compatibility guard:** may pass before and after, while demonstrating behaviour that must be preserved. Keep useful guards, and label them as guards in present tense so they are never mistaken for proof of a fix.
- **Diagnostic experiment:** establishes a mechanism; not necessarily an acceptance test, and usually kept in the scratchpad.

Tests stay isolated from real services. A mocked success is never presented as proof of native backend behaviour.

**Comments state invariants, never history.** A code or test comment says what must stay true and what breaks if it does not. It never cites a review round, a reviewer, a finding severity, a mutant, "the brief", "the first implementation", "previously", "no longer" or "used to". That history belongs in the gate record, the report and `Agents/Maintainer-Context.md`. Test titles name the behaviour ("fails if a successful save leaves the record in place"), not the finding that prompted them. Maintainer-Context entries record decisions and rules, not mechanisms, because mechanisms drift. Before commissioning any gate, the Orchestrator greps the `src/` diff for `round [0-9]|MAJOR|MINOR|mutant|brief|first implementation|previously|no longer|used to`. Every hit is a defect to fix before the reviewer sees it. The grep is necessary, not sufficient: after any change of mechanism, the brief to the fixer also asks it to read every comment in the change for descriptions of a mechanism that no longer exists (a removed effect, flag, snapshot or guard). In durable drafts' Gate 2 round 4, six such comments passed the grep with no trigger word. Durable drafts' Gate 2 was rejected three rounds running, largely on comments that narrated a superseded design; 44% of the lines added to `Chat.svelte` were comments. Comments and commit messages describe behaviour and non-obvious rationale; they do not retell the investigation.

**Briefs carry invariants and acceptance scenarios, not mechanisms.** An implementation brief states what must be true and the scenarios that prove it. If the Orchestrator has a mechanism in mind, it is labelled non-normative. Any equality-based skip ("do nothing while X equals its starting value") gets the return-to-origin scenario ("change X, then change it back") written beside it before the brief ships. Durable drafts' round-2 MAJOR came from a brief that specified such a skip; the coder implemented the mechanism, the reviewer checked it against the brief, and nobody checked it against the invariant.

**At the second rejection, ask whether the mechanism is the problem.** Remediation rounds are scoped to "verify the fixes", so they never ask why the same kind of finding keeps recurring. Before commissioning a third round, the Orchestrator asks that question itself. For durable drafts the answer was structural: an `$effect` mirroring a buffer that both the user and the component write cannot tell the two authors apart, and each flag added to reconstruct "did the user type" had a hole.

**Mutation briefs must use the scratchpad.** A brief that asks a reviewer for mutants must point it at an in-memory or scratchpad mechanism (e.g. a scratch Vitest config that swaps the module source at load), never at "back up, mutate in place, restore". Two durable-drafts gate briefs asked for in-place mutation, contrary to the paragraph above; the files were restored byte-identical, but the third reviewer correctly refused. Keep mutants focused on meaningful semantic failures, especially destructive operations and persistence invariants; investigate consequential survivors rather than optimising a kill count; reuse the existing fault-injection harnesses and still-applicable evidence from earlier rounds instead of rebuilding them.

**Carve-out:** skip the plan-review gate for changes that are small and low-risk on their face — a one-line fix, a config tweak, a typo/string change, or a well-contained bug fix with an obvious correct shape. The fresh post-implementation review remains mandatory for every AI-authored code change. When risk or scope is uncertain, use the plan-review gate. A reviewer may be reused for a later pass only if its context remains independent of implementation reasoning; never let an implementer self-approve.

### 5. Invoking Codex without slash commands

Slash commands are convenience wrappers. An agent with Bash and Node access may invoke the installed plugin runtime directly; it must not stop merely because it cannot issue a slash command. Preserve the requested arguments and focus text. `${CLAUDE_PLUGIN_ROOT}` must refer to the installed Codex plugin root.

```bash
# Native review of the working tree or branch
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" review "--wait --scope working-tree"
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" review "--wait --base <ref> --scope branch"

# Adversarial challenge to the approach, assumptions, and implementation
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" adversarial-review "--wait --scope working-tree <focus text>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" adversarial-review "--wait --base <ref> --scope branch <focus text>"

# Open-ended Codex investigation, rescue, or explicitly requested fix
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task --fresh "<bounded request with artifacts and questions>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task --resume "<follow-up request>"
```

- Use `review` for review-only defect finding against local Git state. It does not accept custom focus text.
- Use `adversarial-review` when Codex should challenge design choices, tradeoffs, assumptions, and real-world failure modes; it accepts focus text after the flags.
- Use `task --fresh` for a new targeted investigation or rescue task and `task --resume` only for a genuine follow-up to the current Codex thread. Before choosing automatically, an interactive agent may inspect `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task-resume-candidate --json`; use `--fresh` when no relevant resumable thread exists.
- Prefer `--wait` only for a clearly small review (roughly one or two files). Use `--background` for larger or unclear scopes when the hosting agent can actually launch a background process. The companion parses the flag, but background detachment is provided by the host shell/tool, not by the flag alone.
- Treat untracked files as reviewable work. For working-tree scope, inspect `git status --short --untracked-files=all` as well as staged and unstaged diffs before concluding there is nothing to review.
- `review` and `adversarial-review` are review-only. Do not ask that invocation to patch files. Return and preserve Codex's stdout as the review artifact, then let the orchestrator disposition findings and delegate any fixes.
- Do not invent, paraphrase, or claim a Codex result if the command cannot run. If the helper reports that Codex is missing or unauthenticated, report that exact blocker and ask the user to run `/codex:setup`. Continue safe work that does not depend on the escalation, but do not mark the escalated work final.

## Contribution Guidelines

1. Follow the existing coding style and conventions
2. Run `pnpm check` before submitting a pull request
3. Ensure your code is well-tested
4. Match the surrounding file's existing style; there is no configured formatter to run
5. Any AI-agent-authored code change or investigative report must go through the independent-review process above before being considered complete — non-trivial changes need both the plan review and the post-implementation code review, with Codex added when the escalation policy requires it
