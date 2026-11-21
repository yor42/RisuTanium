# RisuTanium / RisuAI working instructions

RisuTanium is an Android-first product fork of RisuAI: an MVP on the maintainer's daily phone, the UI-S overhaul, the LTM/ChroMemory engine, encrypted .rtb backups and theme packs. It keeps lossless data compatibility with upstream. Bounded subsystem rewrites are allowed through the gates (MC-697, MC-777). Work is ticketed as GitHub issues on yor42/RisuTanium and delivered one PR per ticket, each from its own session, worktree and `claude/<ticket>` branch. Keep discovery, implementation, independent review and arbitration in separate contexts when the agent system permits it. Do not assume the orchestrator's model identity.

## Start with the smallest relevant context

- Read [Agents/README.md](Agents/README.md) for document authority and [Live-State](Agents/Live-State.md) for dated current state.
- Locate maintainer decisions through [Decision-Index](Agents/Decision-Index.md), then read the relevant original `MC-` entries in [Maintainer-Context](Agents/Maintainer-Context.md). Every subagent brief names the relevant IDs; where a product decision is missing, ask the maintainer rather than inventing it.
- Detailed local policy: [routing](docs/workflow/routing.md), [gates](docs/workflow/gates.md), [project reference](docs/workflow/project-reference.md). Claude skill entry point: `campaign-workflow`. Routing is native first (MC-2748, [routing](docs/workflow/routing.md)): Codex and Antigravity are opt-in only after a route-health check under 7 days old (until #387 defines the check, lane A confirms the route; see routing). `.claude/workflow-policy.json` and `Agents/Workflow-State.json` hold caps and durable batch state; [subscription-first](docs/workflow/subscription-first.md) still applies only for batch scope, critical-contract classification, durable acceptance and device stop conditions.
- A tiny, targeted lookup may run inline. Substantial surveys and ordinary behavior investigations go to native `code-searcher`/`investigator`. Never call the LSP tool for TypeScript or Svelte (MC-1836, MC-2749); rust-analyzer only. Keep each dispatch bounded by a question, named files or search scope, acceptance evidence and write ownership.

## Compatibility and authorization

- `.bin` backups must travel upstream → fork and fork → upstream without loss. Upstream need not read the fork's own storage directly. Upstream-compatible characters, modules, presets, plugins and supported integrations continue to work (MC-175). Exception: V2.1 plugin execution is retired; their data stays untouched in the database and `.bin` (MC-349, CHORE-206, MC-504).
- Export omissions: fork → upstream export leaves data out only where a decision allows it, always naming what it leaves out in a warning before export starts. Data larger than upstream can hold is left out only after confirmation (MC-223). Fork-only data with no upstream equivalent stays in store2/`.rtb`; where an equivalent exists, the `.bin` translates to upstream's shape (MC-774). Connection keys the Android Keystore can no longer decrypt are written empty, never as ciphertext, after a confirm whose cancel writes no file, in `.bin` and `.rtb` alike (MC-3074, MC-3076; #495, still open, enforces this). Upstream → fork must always work (MC-223), except encrypted risuai.xyz full backups, which are refused because only risuai.xyz can decrypt them; never trick the domain to get the key (MC-477).
- This fork has never shipped; upstream has the users. Fork-local behavior is not a reason to preserve a defect, and there is no release pressure (MC-011). Do not design recovery for already-corrupted fork-local state. Exception: from the first release-signed Android MVP install on, every later Android build reads that saved data in place without loss. A storage-format change ships an automatic forward migration, and data a build cannot read is kept, never overwritten (MC-350).
- Scope may be amended for agreed mobile behavior, necessary technical prerequisites, shared-cause corrections or an explicit complexity reduction. Record the failure, causal connection and smallest coherent correction. New product trade-offs remain the maintainer's (MC-091).
- Preserve existing working changes and untracked files. Do not overwrite, revert, stash, reset or clean someone else's work. Stage only named paths; no blanket staging. Commit, push, PR open and merge follow the approval matrix in [gates](docs/workflow/gates.md#approval-matrix-mc-2744) (MC-2744); nothing outward happens outside it.
- Do not edit `docs/branding/**`, `docs/Terms-of-Services.md`, `docs/Privacy-Policy.md` or `src/lib/Others/Legal.svelte` without the applicable authorization. Preserve `.claude/launch.json`, the existing Android manifest edits and the handoff evidence.
- Never read or quote signing secrets (`src-tauri/key.txt`, keystores, `keystore.properties`). Two community-code directories are protected; the rest of the evidence tree is not blanket-protected or ignored (MC-027; exact paths in the project reference). Inspect only task-relevant evidence; never quote protected code.

## Implementation traps

- `DBState` is a rune-based plain reactive object: `DBState.db`, never `$DBState`. Legitimate writable-store subscriptions remain valid. Use Svelte 5 runes appropriately.
- Do not use `any` or `unknown` as a lazy type-error fix. Use domain types; `unknown` at an actual boundary followed by narrowing is appropriate.
- Use custom theme colors from `src/styles.css` (`textcolor`, `textcolor2`, `bgcolor`, `darkbg`, `darkbutton`, `selected`, `borderc`, `darkborderc`, `draculared`); opacity modifiers are supported. Inspect `colorscheme.ts` only for theme work.
- No configured formatter/linter: match surrounding style by hand. Preserve each file's line endings; no formatter across an edited file.
- Code/test comments state invariants and consequences, not investigation history. No repository line numbers in comments. Dated reports may cite verified `file:line` evidence.
- Dirty tracking must retain every mutation dependency. Partition work without dropping dependencies; narrowing can silently omit saved blocks.
- Persisted kinds use the page's byte store in `storage/store/appStore.ts`; do not add platform bypasses. OPFS is transitional fallback/copy-back, not the normal web write store. Trace the current code before changing storage.
- Check the actual build's `src-tauri/Cargo.lock` before citing crate source: `Cargo.toml` ranges do not pin resolved versions. Check `package.json` and the installed dependencies rather than copying dated version claims.
- Sanitized-markup tests use jsdom (`// @vitest-environment jsdom`); happy-dom sanitizer output is not evidence. Prove an identity sanitizer makes relevant assertions fail (MC-239).
- Translator owns all non-English locales, including Korean; preserve the maintainer's edits, keys, interpolations, CBS tags and line endings (MC-058).

## Gates and evidence

- Every AI-authored application-code change gets a fresh independent post-implementation review. Tier 2 changes (size tiers, MC-2746) also get an independent plan review (Gate 1); Tier 1 gets a short in-session plan; uncertain scope or risk takes the higher tier.
- Tier 2 plans and their required tests come from the `designer`, which never reviews or arbitrates its own work; the orchestrator routes and decides routine arbitration, and sends disputed claims and borderline verdicts to a fresh `opus-reviewer` or `deep-investigator` (MC-785). Subagents write full reports to files and hand back three lines (path, status, blockers); a handback is never evidence.
- Changes to critical contracts (format, durability/commit order, dirty-tracking dependencies, persisted read/write/GC/asset lifecycle, migration or security enforcement) use `opus-reviewer`; name the changed contract and failure scenario. Filename/save-path adjacency alone does not qualify. Expensive-to-reverse plans receive `senior-advisor` challenge before implementation.
- Three consecutive substantive `[REJECT]` rounds require advisor escalation before a fourth revision. `[EDITORIAL]` neither counts nor breaks the streak. At the second rejection, reconsider the mechanism.
- Consequential report claims get an independent source/execution check at the consuming decision or accepting gate; reuse that check without recursive report verification. Raw location/triage packets are inputs, not separately accepted reports. Routine independent review and documentation verification use a fresh native Sonnet reviewer or `doc-verifier` (MC-2748). Reviewers never mutate repository files; scratch experiments stay outside the tree.
- Evidence names sources or commands plus applicable code, dirty/untracked changes, dependencies, runtime, configuration and inputs. HEAD alone is insufficient. Independently check decision-critical high-risk inferences; an agent's VERIFIED label is not evidence.
- Distinguish regression reproducers (intended defect fails on the relevant pre-fix base), compatibility guards (may pass before and after) and diagnostic experiments. Mocked success does not prove native behavior.
- PR CI (`.github/workflows/ci.yml`: sharded unit tests, `pnpm check`, build, release check and server smoke checks) is the full run on the PR's snapshot. Sessions run targeted tests, reproducers, mutants and `pnpm check`; a local full run is only for APK builds. CI skips Markdown, `docs/**` (except `docs/design/**`) and `Agents/**`, so a change those paths feed into still needs a CI-covered path or a manual run. Documentation-only edits do not trigger application tests.
- Before substantial Gate 1 work, size the mechanism/subsystems/stages and settle decision-critical product/error behavior; unresolved product questions block affected implementation. Tier 0 and Tier 1 work (size tiers, MC-2746) needs no separate sizing packet. See [gates](docs/workflow/gates.md).
- An item is COMPLETE when its PR is merged on green CI (or, if CI skips it, merged with a matching diff), its issue is closed with a link, its board card is moved and every leftover is dispositioned (MC-2747). Closeout uses incremental verification, not an automatic Gate 2 restart. See [records](docs/workflow/records.md).
- For required native high-risk review, resume a finished reviewer only within about 5 minutes; otherwise use a fresh same-role reviewer. Routine remediation uses the independent-review route (MC-895/899, amended 2026-11-03), seeded with verdict, diff, acceptance and accepted limitations. The round count continues.
- One session per ticket, each with its own worktree, branch and PR. Numeric caps (implementation sessions, device tracks) belong in `.claude/workflow-policy.json`, and a later maintainer decision wins where it disagrees; RAM run slots and quota are the practical limits. Device waits and administrative closeout block only actual dependent scope. Lane A starts ready tickets for idle lanes without a separate ask (MC-1676 item 3, MC-1677, made permanent by MC-2744).
- MC IDs come from a per-session block of 10 assigned by lane A, device rulings are asked in lane B directly, and the PR's session writes its own device rows from the actual diff (MC-2713). Derived from that: the PR's session also writes its own MC entries, gate dispositions and leftovers in the PR; only governance, Live-State and lane handoffs go through lane A. Routine supplied-evidence drafting may use the Haiku `record-clerk`. See [records](docs/workflow/records.md). The retired Haiku verification pilot stays retired; one independent consequential-claim check remains. [Write ownership](docs/workflow/ownership.md) keeps one app-code writer per checkout and exact named document ownership.
- Budgets prompt reassessment, never acceptance of incomplete work. Preserve useful context; reset only when size, contamination or scope warrants it. Do not invent token costs or unmeasured savings.

## Tickets and PRs

- The GitHub issue on yor42/RisuTanium and its project board 1 card are the ticket authority; `Agents/Roadmap.md` is scope history, and the issue wins where they disagree. Check the issue's and any PR's state (and `git log origin/main`) before offering or starting a ticket.
- Always pass `--repo yor42/RisuTanium` to `gh`: its default is the upstream repository.
- One ticket, one session, one worktree, one `claude/<ticket>` branch, one PR. Practice (derived, not an MC): turn Auto-fix on when the PR opens, and close each issue with its own keyword in the PR body (`Closes #a, closes #b`), since a shared keyword left an issue open.
- A PR that adds `en.ts` keys carries all 7 non-English locales and passes the localeParity test in the same PR (MC-058: the translator role writes the non-English strings).
- CI skips Markdown, `docs/**` (except `docs/design/**`) and `Agents/**`. Before merging a PR with no CI run, check that no CI-covered file imports what it changed (CI now covers `docs/design/**`, which `src` imports through `?raw`, for that reason).
- Size tiers, the approval matrix and the follow-up policy are in [gates](docs/workflow/gates.md).
## Commands and navigation

| Need | Command / source |
|---|---|
| Web development / build | `pnpm dev` / `pnpm build` |
| Hosted web build | `pnpm buildsite` |
| Desktop development / build | `pnpm tauri dev` / `pnpm tauri build` |
| Tests / type checks | `pnpm test` / `pnpm check` |
| Hono build | `pnpm hono:build` |
| Workflow validation / decision index | [docs/workflow/README.md](docs/workflow/README.md) |
| Measurement procedures | [Agents/Tools/README.md](Agents/Tools/README.md) |

Use the shell/tool actually available. Check a profile's real tool grant before promising it a tool. Kill only processes you own; do not remove a shared `node_modules` junction recursively. No probes of external community services; use synthetic fixtures.
