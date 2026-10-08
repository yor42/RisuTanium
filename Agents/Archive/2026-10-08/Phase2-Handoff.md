# Phase 2 Initiation Brief — RAM / Rendering Performance (checkpoint 2)

You are the **Opus 5 Senior Orchestrator** for the RisuAI stabilization campaign.
Governance is in `AGENTS.md`; agent profiles are in `.claude/agents/`. Read AGENTS.md
section 1 (routing), 1.2 (escalation ladder), 1.3 (investigation tiers) and 4 (review gates)
before dispatching anything.

*This brief replaces the original Phase 2 brief. The module-editor work it proposed is done,
and it shipped a different design from the one that brief recommended — see "What is done".*

## Standing constraints

- **English only** in all thinking, subagent briefs, and replies.
- **No blind over-reading.** Delegate surveys; read only what a decision needs.
- **You do not write application code.** All `.ts` / `.svelte` / `.rs` / `.yml` edits — test files
  included — go through `sonnet-coder` or `test-warrior`. You may edit `AGENTS.md`,
  `Agents/*.md` and `.claude/agents/*.md` directly.
- **Do not overwrite, revert, or clean existing uncommitted changes without asking.**
- **Commit or push only when the maintainer asks.** Commits are local unless told otherwise.
- **COMPATIBILITY INVARIANT.** Upstream-compatible characters, modules, presets, backup `.bin`
  files and plugins must keep working. Any breaking proposal needs explicit approval plus
  impact / migration / fallback analysis.
- **Targeted stabilization, not a rewrite.**

## Repo state at handoff

- **History was rewritten on 2026-09-21** (a plugin-bundle purge, then a rebase back onto the
  true main base). Every SHA on this branch changed twice that day. SHAs cited in `Agents/**.md`
  were remapped and audited. **Find a commit by its message, not by a remembered hash.**
- `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap` sometimes shows modified
  with an **empty, line-endings-only diff** after `pnpm test`. Never commit it, revert it, or
  re-record it. Upstream branch `cubicj-fix-vitest-snapshot-churn` may fix this properly.

Branch status, test baselines, and other per-session repo state now live in
`Agents/Live-State.md`, rewritten fresh each session. This file holds only durable doctrine and
traps that outlive any one session.

## What is done — the module-editor keystroke freeze

Typing in a module text field froze the UI. **Fixed in two stages, and both are load-bearing.**

| Stage | Commit | What it did |
|---|---|---|
| A | `f4867e63` | Narrowed the GUI-side effect (`stores.svelte.ts:197`) to the 4 fields `moduleUpdate()` reads |
| B | `847bb8e8` | **Partitioned** the save-side effect (`dbChangeEffects.svelte.ts:54-71`): outer effect over array shape plus one child per module |

**Measured in the live app** (module editor open, real input events, i9-13900K, dev build):

| Modules | Before | After |
|---|---|---|
| 52 | 13.2 ms | 1.9 ms |
| 104 | 25.1 ms | 1.8 ms |
| scaling 52→104 | 1.9x | **0.95x — flat** |

Stage B was first planned as a **draft copy** of the edited module. That design was rejected at two
`opus-reviewer` gates and retired after a `senior-advisor` escalation. Do not revive it as a
performance fix. Evidence: `Agents/Reports/10-stage-b-module-draft-copy-plan.md`. What shipped:
`Agents/Reports/11-stage-b-module-effect-partition-plan.md`.

## Doctrine learned this checkpoint — read before touching any effect

1. **Partition, never narrow, a dirty-tracking effect.** In `dbChangeEffects.svelte.ts` the tracker
   flags decide whether a block is encoded **at all**, so a missed mutation is never written — silent
   data loss, not a late save. *Narrowing* (reading fewer dependencies) loses writes; the `:19-24`
   presets comment records a real bug from exactly that (`8bc0f426`). *Partitioning* keeps the
   dependency set identical but splits it across per-element effects. That is what made Stage B
   safe. Roadmap Phase 2 item 2 now carries a warning against its old "shallow signals" suggestion.
2. **`$state.snapshot` cost tracks node count, not bytes.** A 1.03 MB module holding 10k asset
   references costs about 8x a 1.65 MB module that is mostly one large string. Target node count.
3. **Every number here is a best case.** All measurements came from an **i9-13900K / 64 GB DDR5**.
   This project targets Raspberry Pi self-hosting and mobile. Argue from **ratios**, which do not
   depend on hardware when the gain comes from doing less work. **Never claim frame-budget
   compliance without naming the hardware.**
4. **The Node harness overstates absolute cost.** Chromium ran the same fixture about **2.6x
   faster**, but the ratios held. Use the harness to compare designs and the live app for anything
   user-facing.
5. **Real profiles are larger than the fixture.** The maintainer runs **100+ modules** and reports
   50+ as common in the community. Asset modules bundle **10,000+ images** to get around RisuRealm's
   150 MB limit, reaching 1-2 GB on disk. The images stay in asset storage; only `[name, id, ext]`
   references sit in `db.modules`.
6. **Measure the premise before planning.** Three plan revisions for Stage B failed. The
   design was retired because its central premise — that the cost was a persistence problem
   rather than an effect-granularity problem — had never been tested; the revisions only patched
   the layers built on top of it. The maintainer's own context (profile sizes, asset modules,
   hardware, the character-editor comparison) settled more than either review gate did. **Ask the
   maintainer what real usage looks like** before sizing work.
7. **Test comments are shipped artifacts.** Tests written *before* a change, in the future tense
   ("expected to pass once…", "this file is not modified"), become false when they land in the same
   commit. That got a correct change rejected once. Rewrite them in the past tense before
   committing.

## How to measure in the live app

See **`Agents/Tools/README.md` → "Measuring in the live app"**. It covers the setup, how to reach
the app's own `DBState`, the mutate-and-restore protocol, and **three traps** that each gave a
plausible wrong number: Vite's `?t=` cache-busting handing back an empty module copy; importing
`svelte` loading a second runtime whose `flushSync` measures 0 ms; and `requestAnimationFrame` not
firing while the browser pane is hidden. Pass `VITE_RISU_LEGAL_CONFIGURED=TRUE` **inline, for one
run only** — `Legal.svelte:6-8` forbids setting it automatically.

## Current session state

Moved to `Agents/Live-State.md`, which is rewritten fresh each session rather than appended to.
**Read it first after a context compaction.** What finished stages leave for later ones is in
`Agents/Carry-Forward.md`. This file (`Phase2-Handoff.md`) holds only durable doctrine and
constraints that outlive any one session.

## What is next — the maintainer chooses

Everything open is in **`Agents/Roadmap.md`**, which is authoritative for phase and item scope,
sequencing, and per-item status. Work currently in flight is in **`Agents/Live-State.md`**.

This section used to carry its own copy of the open Phase 2 items and the CHORE-01..05 catalogue.
That copy went stale: it still described the chores as "none fixed" and CHORE-05's nine
save-conflict strings as untranslated, after CHORE-01 Stage 1 (`152cc563`), those nine strings
(`0291ea36`) and CHORE-17 (`dfabaa15`) had all shipped and merged. It was removed on 2026-09-23
rather than re-synchronised, because keeping a second copy of the Roadmap here is what allowed it
to drift unnoticed. The Roadmap carries every item this section listed, including the
trash-restore reproduction harness.

## Open items NOT in scope (documented, do not silently absorb)

- **The `alertStore` hijack** — investigated and deliberately deferred. The "obvious" mutex was
  rejected at a plan gate. Details in the Roadmap.
- `loadPages` is never reset on character switch.
- `streamingDisplayOptimizationMode` defaults to `'off'`.
- Last-writer-wins whole-DB overwrite — pre-existing and architectural.
- **Asset-heavy modules** still exceed the frame budget while being edited. That needs its own
  plan, and the no-narrowing rule applies.
- `src/ts/kei/backup.ts:86` reads `db.account.kei` without optional chaining. **It is confirmed
  live**: the dev console logs `KEI auto-backup failed` on every load. Known, and still not fixed.
- `Agents/Maybe-Later.md` is QOL and unscheduled.

## Area traps

- **`crypto.randomUUID()` needs a secure context**; it is `undefined` on plain-HTTP LAN self-hosting.
  Use `v4()` from `uuid`.
- **Service workers also need a secure context**, so LAN falls back to base64 `data:` URIs.
- **`fileSrcCache` and `blobUrlCache`** (`parser.svelte.ts`) are unbounded but load-bearing for this
  fork's asset-corruption fix. Trace that fix before bounding them.
- **Asset reads are local only on Tauri.** Non-Tauri builds with Account Sync fetch from
  `sv.risuai.xyz`. Never make the `isAccount` branch more aggressive.
- **`getModules()` caches on the joined enabled-id string**, and `lastModuleData` holds live proxies.
  Its freshness is a lucky accident. `refreshModules()` has exactly one caller.
- **Duplicate module ids are reachable.** A `.risum` import keeps the id; only JSON imports
  regenerate it.
- **`Agents/Evidences of Investigations/`** holds third-party plugin bundles and is gitignored on
  purpose. Never commit it.

## Cautions earned the hard way

Every expensive error in this campaign got past a green test suite.

1. **Check the exit code, not the pass count.** A run reporting matching counts once exited
   ELIFECYCLE.
2. **Re-verify every cited line number.** Off-by-one citations were caught at most gates,
   including once in a reviewer's own findings.
3. **Reviewers and investigators have been wrong.** Before propagating a factual claim into a plan,
   a commit message, or another agent's brief, check it against source. At the first Stage B gate
   the reviewer made two errors the Orchestrator caught: a set of citations off by one, and a
   replacement count that did not reproduce. Re-verify on the triggers in AGENTS.md 1.3 (conditional
   verification); an adequate independent check need not be repeated.
4. **Your own briefs carry errors too.** A wrong figure ("6+N+1" where the answer was 6+N) went into
   a brief, was copied verbatim into a test comment, and was caught only at the post-implementation
   gate. Check arithmetic before briefing.
5. **Classify tests by purpose (AGENTS.md section 4):** a regression reproducer is written against
   the unfixed code and shown to fail first on the intended defect; compatibility guards are kept
   and labelled. **A remediation test is a reproducer only if it fails against the pre-change
   base.** At the composer stage's S2 a test that failed only against the change's own first
   implementation was called a reproducer; the commit-message check ran it against the base and
   found it was a guard.
6. **Count, do not estimate.** Cite the command that produced a count, not just the number.
7. **Check an agent's `tools:` line before a brief promises it a tool.**
8. **Brief investigators so that disproof is an acceptable result.** The trash reproduction was
   useful because the agent was told a clean disproof was welcome.
9. **When a plan keeps failing on rules for one edge case, ask whether a product constraint removes
   the case.** Gate 1 rejected the composer stage's S1 plan six times in a row; each time the
   rejected rule had been added only to merge text typed during a wait. The fix was a constraint put
   to the maintainer (the `MC-100` lock), not more rules.
10. **Test titles state the required behaviour, never the defect.** Five S1 titles had to be renamed.
    Weak assertions (`toContain` where exact equality was meant) let two reds pass against the
    defect.
11. **Live checks in Chrome:**
    - prove a remount by tagging the element (a textarea, say) and checking that the tag is gone;
    - auto mode is offered only in group chats;
    - the plugin `getDatabase` proxy only writes `allowedDbKeys`, so set the model in Settings (Echo
      is under "For Developer", behind "show unrecommended settings");
    - a click meant to land during a wait must be in the **same** `browser_batch` as the action that
      starts the wait, because the latency between tool calls is seconds;
    - the window must be visible (see `Agents/Live-State.md`, "How to live-check this app").
12. **Do not trust an agent's claims about the tree, and give an index-free check.** A coder ran
    `git add -N` and a bare `git reset` to read line endings. A test writer said all its files were
    LF and three were CRLF. A test writer made and deleted a probe file inside `src/ts/process/`.
    Tell agents to check line endings with `git ls-files --eol` or a byte count, and to keep every
    scratch file in the scratchpad.

## Agent tiers — all exercised now

`investigator` (Sonnet) is the default. `deep-investigator` (Opus) is for escalation only.
`opus-reviewer` handles persistence-adjacent gates. `senior-advisor` (Fable) is for direction, not
difficulty: its one use this checkpoint retired a failing design and redirected the work
correctly. `adversarial-reviewer` and `opus-reviewer` both have Bash and are read-only by doctrine,
not by sandbox. Record every investigation and gate in **`Agents/Investigation-Ledger.md`**,
including outcomes that argue against the current architecture.

## First actions

1. Read `Agents/Live-State.md` for the current branch state and test baselines, then confirm they
   still hold, **checking exit codes**.
2. Ask the maintainer which Roadmap item or chore comes next. Do not pick one yourself.
3. For whatever is chosen: measure the premise first, plan it, pass the plan gate, implement, then
   pass the post-implementation gate. Anything persistence-adjacent uses `opus-reviewer`.
