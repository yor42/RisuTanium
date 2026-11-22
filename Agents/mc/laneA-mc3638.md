### MC-3638 — Theme-pack findings block only on five invariants; safe start comes first, 2026-11-22

- Tag: decisions (maintainer via AskUserQuestion in lane A, after the read-only analysis of the #560 and #438 review rounds). Date: 2026-11-22. Answered 12:58:26Z. Related: `#560`, `#438`, `#629`, `MC-2493`, `MC-2745`.

**What was asked.** In a typed message to lane A earlier that day the maintainer had reported that each loosening of the validator led reviewers to craft hostile packs and the guard to be re-strengthened, and had proposed a trustworthy safe mode plus a risk warning. Lane A proposed: a pack finding blocks only if it shows (1) pack code running, (2) a network request leaving the app, (3) writes outside the pack's own records, (4) unbounded intake, or (5) broken safe start. Hiding, covering or restyling anything else becomes a one-line known limitation, with no new guard and no per-finding question to the maintainer. The question named the caveat that safe start was not reliable yet.

**What the maintainer chose.** "Adopt; safe start first (Recommended)", whose option text was: the MC is recorded and gates.md and the reviewer rules change now; a new small ticket makes safe start ordered on Android and adds the warning (opus review, Note 9 rows); #560 C-1 is dropped; #560 PR2/PR3 and #438 S3c-B are replanned smaller and merge only after that ticket. Not chosen: adopting and loosening at once; keeping the current rules.

**Consequence.** The rule is in `docs/workflow/gates.md` ("Theme-pack findings"), the review-change skill, both reviewer roles and the designer role. Lane A filed the safe-start ticket as `#629`. The details marked derived in gates.md are lane A's.

**Derived by lane A (not the maintainer's words; correct if wrong).** This amends `MC-2493` (a softlock blocks only if it survives safe start or outlives turn-off), `MC-2745`'s "failed acceptance row" for theme packs, `MC-3420` (readability of the settings route under a pack is no longer an acceptance guarantee; turn-off and removal after a safe start stay under invariant 5), `MC-3423` and `MC-3426` (floors become notes), `MC-3429` (mask and clip-path on interactive parts become notes), and the consequences of `MC-3427`, `MC-3430`, `MC-3432` and `MC-3444` (no longer acceptance guarantees). The own-colour behaviour of `MC-3424`, `MC-3428`, `MC-3433`, `MC-3445`, `MC-3447`, `MC-3644` and `MC-3645` is frozen as best-effort (`MC-3639`). The `MC-3422` bans stay. A ticket answer that added a pack guard is re-checked by its session against this rule, and a real conflict goes back to the maintainer.

### MC-3639 — Under a theme pack, data-loss prompts and the save-failure notice are best-effort, 2026-11-22

- Tag: decisions (maintainer via AskUserQuestion in lane A). Date: 2026-11-22. Answered 12:58:26Z. Related: `MC-3638`, `MC-3433`, `MC-3445`.

**What the maintainer chose.** "Best-effort, named (Recommended)": the own-colour protection already merged stays, frozen at today's list, as best-effort rather than a guarantee, and the warning names this limit. No new work, and it removes the mechanism behind #560 C-1. The question named the weakness: a pack that looks fine and hides one of these prompts never sends the user to safe mode. Not chosen: switching the whole pack off while such a prompt is open; keeping a guarantee that depends on the readability check.

**Consequence.** No new mechanism for these prompts. A pack that hides one is a known limitation.

### MC-3640 — After a renderer crash loop the next start runs without the theme pack, 2026-11-22

- Tag: decisions (maintainer via AskUserQuestion in lane A). Date: 2026-11-22. Answered 12:58:26Z. Amends `MC-3425` (which declined an automatic safe start). Related: `MC-3638`, `#629`.

**What the maintainer chose.** "After a crash loop (Recommended)": only after three renderer losses within 60 s (the existing crash-loop exit) does the next start run without the pack, for that session. Not chosen: after any renderer loss; the shortcut only.

**Consequence.** Lane A assigned it to `#629`. A single low-memory kill keeps the pack.

### MC-3641 — The theme-pack risk warning shows at each install from a file, 2026-11-22

- Tag: decisions (maintainer via AskUserQuestion in lane A). Date: 2026-11-22. Answered 12:58:26Z. Related: `MC-3638`, `MC-3639`, `#629`.

**What the maintainer chose.** "Each file install (Recommended)": at every install from a file. The warning says a pack can make the app hard to use and names the way out (long-press the app icon, "Start without theme pack"). Built-in packs and re-selecting an installed pack show nothing; a pack arriving with an `.rtb` restore is a recorded limitation. Not chosen: the first install only; every activation.

**Consequence.** Lane A assigned it to `#629`. The warning also names the `MC-3639` limit, and its new `en.ts` keys carry all 7 locales.
