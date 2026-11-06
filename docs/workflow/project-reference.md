# Project reference

Read only the part needed by the task. Source and resolved dependencies override dated inventories. This reference is navigation and technical guardrails, not a second campaign status register.

## Architecture and entry points

RisuAI is a cross-platform AI chat application: Svelte 5/TypeScript frontend, Tauri 2/Rust desktop and Android backend, Vite/Tailwind tooling and pnpm. Self-hosted implementations live in `server/node/` and `server/hono/`. Check [package.json](../../package.json), [Cargo.toml](../../src-tauri/Cargo.toml), the actual build's `src-tauri/Cargo.lock` and relevant installed sources before version-specific claims. Cargo minimum/range specifications do not pin the resolution, and the lock is gitignored.

| Question | Authoritative source / entry point |
|---|---|
| Initialization and UI selection | [bootstrap.ts](../../src/ts/bootstrap.ts), [App.svelte](../../src/App.svelte), [displaySettingsData.svelte.ts](../../src/ts/setting/displaySettingsData.svelte.ts) |
| Reactive database and stores | [stores.svelte.ts](../../src/ts/stores.svelte.ts), [dbChangeEffects.svelte.ts](../../src/ts/storage/dbChangeEffects.svelte.ts) |
| Page byte store and platform choice | [appStore.ts](../../src/ts/storage/store/appStore.ts) |
| Save loop and incremental block format | [globalApi.svelte.ts](../../src/ts/globalApi.svelte.ts), [risuSave.ts](../../src/ts/storage/risuSave.ts) |
| OPFS copy-back / cold units | [opfsCopyBack.ts](../../src/ts/storage/opfsCopyBack.ts), [coldstorage.svelte.ts](../../src/ts/process/coldstorage.svelte.ts), [coldUnitLocation.ts](../../src/ts/process/coldUnitLocation.ts) |
| Chat/request orchestration | [process/index.svelte.ts](../../src/ts/process/index.svelte.ts), `src/ts/process/request/` |
| Provider definitions | [model/types.ts](../../src/ts/model/types.ts), [modellist.ts](../../src/ts/model/modellist.ts) |
| Parsing / lorebook / card interchange | [parser.svelte.ts](../../src/ts/parser/parser.svelte.ts), [lorebook.svelte.ts](../../src/ts/process/lorebook.svelte.ts), [characterCards.ts](../../src/ts/characterCards.ts) |
| Plugins | [plugins.md](../../plugins.md), `src/ts/plugins/`, [migration guide](../../src/ts/plugins/migrationGuide.md) |
| Theme / translations | [styles.css](../../src/styles.css), `src/lang/`; inspect [colorscheme.ts](../../src/ts/gui/colorscheme.ts) only for theme work |
| Server behavior | [Node readme](../../server/node/readme.md), [Hono README](../../server/hono/README.md) |

`DBState` is a `$state` object, not a writable store: use `DBState.db`. Actual writable stores such as `selectedCharID` support legitimate `$store` subscriptions. Avoid blanket bans on that syntax. Runes files use `.svelte.ts`. Use precise types; narrowing `unknown` at a real boundary is valid, hiding a type error behind `any`/`unknown` is not.

Persisted main files, backups, remote blocks, assets and cold units go through one byte store chosen per page by `appStore.ts`. `AutoStorage` constructs Node/LocalForage clients and does not choose OPFS. A flagged legacy OPFS profile is copied back to IndexedDB under the migration lock; failed copy-back may use a transitional OPFS store for that page and retry later. Cold units use store keys; legacy OPFS units are read only when missing and deleted with the unit. Do not infer an active storage path from a filename.

Dirty-tracking flags control whether blocks are encoded at all. Preserve every relevant mutation dependency and partition the work; dropping dependencies can silently lose writes. Asset caches may carry correctness contracts: trace those contracts before bounding or replacing them. Secure-context APIs must be checked for plain-HTTP self-hosting (`crypto.randomUUID`, service workers).

Use the custom theme colors listed in [AGENTS.md](../../AGENTS.md); Tailwind opacity modifiers are supported. Preserve each file's line endings and hand-match surrounding style. No configured formatter/linter means no unsolicited format pass. Comments express invariants, not review history or repository line numbers.

## Evidence and protected work

MC-027 protects exactly these two community-code directories:

- `Agents/Evidences of Investigations/Community plugins to solve common pain points/`
- `Agents/Evidences of Investigations/Asset Cache/Community Mitigation_Webrowser Plugin/`

Never commit those directories or quote their code into publishable documentation. Any access must be task-relevant and within the current authorization; honor separately stated access restrictions. Other entries in that tree are tracked maintainer evidence, not covered by a blanket ignore. Never open/quote signing secrets. Preserve unowned changes, `.claude/launch.json`, Android manifest work and `Agents/Handoff-2026-10-08.md` plus its evidence folder. The handoff is a pending record source; contradictions with settled decisions are not silently adopted.

Branding and legal documents are separate protected work lanes. `docs/wiki/` is ordinary documentation since the wiki session was retired (maintainer, 2026-11-06): it is edited by the item that changes the behaviour it describes, with the usual doc-verifier check. Tone: the README is where the jokes live; wiki pages stay plain, simple English (maintainer, 2026-11-06). Do not carry README jokes into the wiki or strip them from the README. Never automatically set `VITE_RISU_LEGAL_CONFIGURED`; inspect the applicable maintainer decision and legal constraints before any authorized run. Keep scratch experiments outside the tree. Remove only your own processes; shared worktree `node_modules` junctions must not be recursively deleted. External service probes are out of scope; use synthetic data.

## Runtime validation and measurement

Run the commands appropriate to the affected target; web, Tauri, Node, Android and real-browser evidence are distinct. A test beside a module need not cover its pure-web branch. Check what was exercised. Test counts and dependency versions drift; re-count tracked files or inspect installed metadata instead of copying old numbers.

Sanitized-markup assertions run under jsdom with `// @vitest-environment jsdom` first, and meaningful assertions must fail if sanitization becomes identity (MC-239). Check exit status, not just pass counts. Keep guards and reproducers distinct as [gates](gates.md) requires.

Follow [Agents/Tools/README.md](../../Agents/Tools/README.md) for live measurement, fixtures and mutate/restore procedures. `$state.snapshot` cost follows node count, not simply serialized bytes. Harness and browser absolute timing may differ; do not extrapolate a ratio as universally hardware-independent. Name runtime, hardware, workload and limitations. Real frame-budget claims need measurements on the target hardware.

## External worker runtimes

Codex and Antigravity are the primary ordinary routes under [subscription-first execution](subscription-first.md). Verify installed/authenticated runtime and current help; do not hardcode cache/plugin paths or infer working provider calls from configuration. The parent uses the checked-in exporter/runner directly. Codex writes only in a sanitized exported workspace; Antigravity remains read-only scouting. Routine independent review uses a fresh context, not the implementer.

Use explicit approved model/effort and isolated instructions/configuration. Do not launch another Claude session merely to compare external output. Record exact host-observed failures, cache unavailable routes and use permitted fallbacks; no automatic installation or model upgrades. Independently verify consequential claims at their consuming gate without repeating adequate source checks.
