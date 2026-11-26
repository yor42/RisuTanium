# Token usage and cost-efficiency review, 2026-11-22 to 2026-11-24

Scope: every RisuAI Claude Code session with activity since 2026-11-22 00:00 UTC. That is 81 sessions (main checkout plus worktrees), 1,109 agent transcripts and 61,149 deduplicated API calls. The week's quota ran out on 2026-11-24 during this review.

How the shares are weighted:
- Shares are cost-weighted with assumed list prices per million tokens: Opus 5/25, Sonnet 2/10 and Haiku 1/5. Fable is treated as Opus.
- Cache writes are weighted at 1.25x the input price and cache reads at 0.1x.
- Subscription quota may weigh tokens differently, so read the shares as close, not exact.

Data and scripts are in `C:\Users\yor42\AppData\Local\Temp\risu-b715\usage-full\`:
- `full.mjs` and `full-data.json`: the census and its aggregates.
- `work\`: the analysts' scripts.
- `journal-results.json`: every lens result and every verdict.

## Review status

The review workflow (wf_ad017319-0e6) did not finish:
- **Finished:** all five lens analyses, and adversarial re-checks for 11 of the 38 savings.
- **Not finished:** the other 27 re-checks and the synthesis step failed on the weekly limit.

Lane A wrote this report from the finished results. Each saving is marked as one of:
- **checked**: a second agent reproduced the numbers;
- **cut**: the re-check reproduced only part of the numbers, so the corrected range is shown;
- **not checked**: the analyst's own estimate only.

## Where the quota went

| Component | Share | Calls | Mean context |
|---|---|---|---|
| Agents started with the Agent tool | 60.6% | 40,923 | 139k |
| Session conversations (main loops) | 33.7% | 15,506 | 242k |
| Workflow agents | 5.7% | 4,720 | 88k |

| Role / model | Share | Detail |
|---|---|---|
| Main loop / Opus | 28.3% | 10,689 calls, mean context 233k |
| opus-reviewer | 28.3% | 284 runs, 48 calls each, mean context 136k |
| designer / Opus | 17.9% | 130 runs, 50 calls each (max 179), 79k output each |
| sonnet-coder | 11.1% | 241 runs, 56 calls each |
| Main loop / Sonnet | 5.4% | mean context 262k (two sessions use the 1M window) |
| perf-analyzer / Sonnet | 3.6% | 57 runs, 88 calls each |
| senior-advisor / Fable | 1.3% | |
| Everything else | 4.1% | investigators, adversarial reviewers, device runners, translators and so on |

| Cost type | Share |
|---|---|
| Cache reads (context re-read on every call) | 63.1% |
| Cache writes | 19.2% |
| Output (mostly thinking) | 17.8% |

| Context size of the call | Share |
|---|---|
| Under 100k | 16.3% |
| 100k to 200k | 41.5% |
| 200k to 300k | 27.4% |
| Over 300k | 14.9% |

| Model | Share |
|---|---|
| Opus | 75.3% |
| Sonnet | 23.1% |
| Fable | 1.3% |
| Haiku | 0.3% |

**Biggest sessions.** Lane A (6b51f827) is 10.2% of the total. The next largest:

| Session | Share |
|---|---|
| #596 S2 | 6.7% |
| #560 validator | 5.1% |
| #438 S3c-B | 4.3% |
| Lane B devices (cbd1c74b, Sonnet on the 1M window) | 4.2% |
| #514 | 3.7% |
| #599 | 3.5% |
| #603 | 3.5% |
| #708 | 3.3% |

**By day.**
- 2026-11-22: 49.2%. About ten Opus ticket sessions started within minutes of each other.
- 2026-11-23: 34.0%.
- 2026-11-24: 16.8%.

**Mechanism.** Cost tracks the number of calls multiplied by the size of the context each call re-reads. For designers, cost and call count correlate at 0.92, while the length of the brief barely matters. Every extra turn re-reads the whole growing context. The biggest levers are therefore smaller contexts, fewer turns, and Sonnet wherever Opus is not required.

## Savings, grouped by mechanism

Each range is a share of the total weighted cost.

### A. Main-loop context size (main loops are 33.7%)

**ML-1, not checked, 2.5-6%: lower the Opus auto-compaction window.**
- `C:\Users\yor42\.claude\settings.json` sets `modelSettings.claude-opus-5-5.autoCompactWindow` to 400000.
- All 89 compactions were automatic. Median size before compacting was 353k (max 376k); after, 24k.
- So every Opus loop saw-tooths between 24k and about 370k, averaging about 240k, and every call re-reads that.
- Setting it to 300000 (or 250000 after a trial) lowers the mean context.
- Cost: more frequent compactions in lane A and the ticket sessions. Lane A already resumes from its handoff files.

**ML-2, checked, 1.1-1.75%: cap the Sonnet 1M window at 300-400k.**
- `claude-sonnet-5-5.autoCompactWindow` is 1000000.
- Lane B devices (cbd1c74b) averaged 581k context over 573 calls. #438 S3c-B (849aad92) averaged 513k over 595 calls, with no compaction.

**ML-6, not checked, 0.3-0.8%: compact or close a session before a wait of more than an hour.**
- 48 rewrites of the whole context after more than an hour idle, about 143k tokens each.
- ML-1 already shrinks this.

### B. Turns started by messages (overlaps A: a smaller context makes each turn cheaper)

**ML-3, not checked, 1.2-2.6%: message the orchestrator only when it must decide or act.**
- 978 turns started by messages from other sessions cost 17.4% of the total.
- 342 of them made no tool call (2.1%), and 304 more were acknowledgements of one or two calls (1.2%).
- Status updates (PR opened, verdict given, head moved) go to the sender's session card instead.

**ML-7, not checked, 0.3-0.8%: handle completions of agents dispatched together as one group.**
- Turns started by task notifications cost 9.0% over 376 turns.
- Rule 5 (long jobs run in the background) stays.

**ML-4, cut to 0-0.4%: mute side-sessions events.**
- Only 171 no-tool turns (0.43%) reproduced, not 208.
- Muting them would also weaken the rule that lane A archives finished sessions unasked (MC-3764).

### C. Opus review routing (opus-reviewer is 28.3%)

What opus-reviewer covers:

| Run type | Runs | Share |
|---|---|---|
| Gate 1 first reviews | 53 | 6.5% |
| Gate 1 re-reviews | 81 | 7.1% |
| Gate 2 first reviews | 63 | 8.6% |
| Gate 2 re-reviews | 36 | 2.3% |
| Lane A PR-check lenses | 47 | 3.7% |

- About 12-15% of the total is reviews whose brief names a changed critical contract. That part must stay on Opus.
- Gate 1 first reviews return REJECT 43 of 53 times (81%), so plan quality drives most re-review rounds.

**GR-4 and F6, not checked, 1.3-2% combined (they overlap): lane A PR-check lenses run as Sonnet adversarial-reviewers.**
- Keep one Opus lens, and only when the PR's change since Gate 2 touches a critical contract.
- 29 of the 47 lens briefs named no contract.
- Cost: lane A's checks reject 23% of the time and catch real gaps (test purpose, mutants). Sonnet may catch fewer.

**GR-2, not checked, 1.3-2.1%: apply MC-3767 strictly.**
- A re-review after REJECT whose fix does not touch a contract goes to a Sonnet adversarial-reviewer, seeded with the earlier verdict and the fix diff.
- Opus re-reviews after REJECT cost 7.0%; 4.0% of that came from briefs that name no changed contract.
- Examples: #596 S2 ran Gate 1 to round 6 on Opus; #560 ran six Gate 1 and six Gate 2 re-reviews on Opus.

**GR-5, not checked, 0.5-1.8%: no Opus first review without a contract line.**
- An Opus first review requires the line "Changed contract: X; failure scenario: Y". Without it, the review goes to Sonnet.
- 23 first reviews (3.1%) had no contract keyword in their brief.

**GR-3, not checked, 0.8-1.5%: scope the remaining Opus re-reviews to the change.**
- Gate 1 re-reviews load 80% of a first review's tool results.
- The brief supplies the findings, the designer's "Changes in rN" section and the diff.

**GR-1, cut to 0.15-0.55%: no Opus re-check after EDITORIAL.**
- Run by run, most of the 21 runs were not pure editorial re-checks.

**GR-6, not checked, 0.8-2.2%: soft call budget and batched reads for reviewers.**
- 86.5% of reviewer calls carry exactly one tool.
- Calls after number 50 cost 5.5%.

**GR-7, not checked, 0.2-0.4%: an investigation fans out to plain investigators.**
- deep-investigator then runs only on contradicted items.
- All 33 deep-investigator runs were in #203 investigation workflows.

### D. Designers (17.9%)

**D1, checked, 0.6-1.5%: put the cost rules into `.claude/agents/designer.md` and a brief template.**
- The rules: batch independent reads in one turn, read line ranges, and target plans of about 15-20 KB.
- Only 2 of 130 briefs gave file:line ranges, and 4 asked for batching.
- 77% of tool turns issue a single tool.

**D4, checked, 0.4-1.2%: cap plans at about 20 KB; revisions are deltas.**
- Median plan Write is 47k characters (p90 85k), and 120 of 130 exceed 15k.
- 31 rewrites re-emitted whole plans.
- TB-1 (plans re-read by every reviewer and coder, 3.9% of total as tool results) overlaps this.

**D3, checked, 0.35-0.9%: split spec drafting.**
- A Sonnet investigator writes the inventory first, then one designer runs per spec part.
- The six spec drafts cost 3.0% in total. The #708 scripts spec alone was 0.86% over 179 calls.

**D5 and F7 (same saving), checked at 0.3-1.1%: Sonnet designers for clear tickets, as the rules already allow (MC-3643).**
- Only 3 of 133 designer runs used Sonnet.
- F7's own estimate, not checked, is 1.1-2.7%.

**D8, checked, 0.1-0.35%: medium effort for narrow revisions.**
- About 70% of designer output is thinking.

**Cut:**
- D2 (hand designers file:line ranges from sizing): 0-1%.
- D6 (fewer reject rounds through sizing): 0.2-0.8%; revisions are not one-to-one with rejects.
- D7 (write the plan once): 0.1-0.4%.

### E. Fixed cost of each session and agent

Starting sizes:
- **Main loops** start at about 93k tokens before any work. 53 tool schemas are about 48k of that.
- **Project subagents** start at about 31k tokens: CLAUDE.md and AGENTS.md about 6.4k, preloaded skills 3-5k, the memory index, and tool schemas.

**F1, not checked, 2.4-4.3%: remove unused tools and servers from ticket sessions.**
- In ticket worktrees, turn off what they never use: the photocraft, vectorcraft and cheapag MCP servers, the antigravity and codex plugins (this also removes the antigravity session-start hook), and rarely used tools.
- Artifact alone is 36.9k characters and was used in 1 session out of 79.
- cheapag is inactive by CLAUDE.md, but it is still loaded in every main loop and was called 7 times.
- Lane A and live-check sessions keep what they need.

**F2, not checked, 0.6-1.05%: keep MEMORY.md to pointers.**
- MEMORY.md was 17k characters on Nov 22-23 and 8k after today's trim.
- It loads into every subagent too.

**F3, not checked, 0.75-1.2%: split AGENTS.md by audience.**
- Subagents never ask the maintainer or open PRs.
- This changes governance files.

**F4, not checked, 0.4-0.7%: stop campaign-context restating AGENTS.md.**
- Also drop write-ownership from read-only roles.

**F5, not checked, 0.35-0.63%: drop unused tool grants.**
- Drop Agent from 8 profiles: subagents called it once in 1,110 runs.
- Drop Bash from read-only roles.

**F9, not checked, 0.1-0.3%: batch small dispatches.**
- For example, translator or record-clerk work per PR.

### F. Tool results and long runs

**TB-2, not checked, 0.8-2.3%: coder and perf-analyzer stop at about 60 calls or 200k context.**
- The agent writes a handoff file, and a fresh continuation picks up from it.
- Coder runs over 80 calls cost 6.0%. The longest reached 533-557k context.

**TB-3 and ML-5, not checked, 0.6-1.5% combined: bound shell output in main loops.**
- `grep -m` or `head`, `git diff --stat` before a patch, bounded `git log`.
- Never Read another session's .jsonl in a main loop.
- Main-loop tool results cost 7.4%, because each stays for about 79 later calls.

**TB-4, not checked, 0.3-0.55%: view a crop or half-scale preview of each screenshot.**
- Diff pixels by script, and keep the full image on disk as evidence.
- 1,100 images cost 0.71%.

**TB-5 and TB-6, not checked, 0.4-0.85% combined: run tests once per edit batch, no identical re-runs, filtered test output.**

### G. Orchestrator model

**F8, not checked, 0.9-3.1%: hold ticket orchestrators to the Sonnet default (MC-3765).**
- After MC-3765, 14 new ticket sessions still ran Opus main loops, for 5.2% of the total.
- Some had a real Opus trigger, so the saving is only the part that did not.

## Combined estimate

The groups overlap, so they do not simply add up:
- A smaller context (A) makes every other turn cheaper.
- C and G both move work from Opus to Sonnet.
- TB-1 and D4 cut the same plan bytes.

| Group | Low | High |
|---|---|---|
| A. Context | 3% | 6% |
| B. Message turns | 1% | 2.5% |
| C. Review routing | 3% | 6% |
| D. Designers | 1.5% | 3.5% |
| E. Fixed cost | 3% | 6% |
| F. Tool results | 2% | 4% |
| G. Orchestrator model | 1% | 3% |
| **Sum** | **about 14%** | **about 31%** |

After discounting the overlaps, a realistic combined saving is **about 12-25% of a week like this one**, without dropping any gate. Most of the estimates behind it were not re-checked, because the workflow ran out of quota.

## Suggested order (cheapest to apply first)

1. **Your settings, no repo change** (ML-1, ML-2): Opus `autoCompactWindow` from 400000 to 300000; Sonnet from 1000000 to 300000-400000.
2. **Ticket worktree settings** (F1): turn off the photocraft, vectorcraft and cheapag MCP servers and the antigravity and codex plugins.
3. **Lane A practice, which lane A can apply itself** (GR-4, ML-3):
   - PR-check lenses on Sonnet, with one Opus lens only when the change since Gate 2 touches a critical contract;
   - sessions report status to their cards instead of messaging lane A.
4. **Governance changes that need an MC and a PR** (GR-2, GR-5, D1, D4, TB-2, F3-F5): Sonnet re-reviews of fixes that do not touch a contract, a contract line before an Opus review, designer and coder profile rules, AGENTS.md split, profile tool trims.
5. **Dispatch habits** (D5, F7, F8): apply the existing Sonnet routes for clear-ticket designers and ticket orchestrators.

## Caveats

- **Prices:** they are assumed. Opus-heavy savings may count for more or less against the real quota.
- **Short window:** it is three days, and Nov 22 was a heavy launch day.
- **What the data cannot show:** whether a cheaper route would have missed a defect. The quality risks listed are judgement, not measurement.
- **Re-checks:** 27 of the 38 savings were never re-checked. Of the 11 that were, 6 held and 5 were cut.
