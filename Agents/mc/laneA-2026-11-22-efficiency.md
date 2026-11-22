# Lane A decisions, 2026-11-22: token efficiency

Source for all three entries: the maintainer asked "btw: since you have access to transcript and cost report of previous sessions, do you have any other suggestion to make token/quota spending more efficient?" and then answered one multi-select AskUserQuestion in lane A.

The question: "Which token-saving rule changes should I adopt? I measured about 38 hours of this project's transcripts at list price (plan quota may weight differently) and a fresh reviewer checked the estimates. Percentages are estimated savings on total project usage. Together with switching off unused connectors (your setting, 0.5-1%) they come to about 3-8%. Anything you don't pick stays as it is."

The answer: "Sonnet re-checks (Recommended),Scripted device rows (Recommended),Quieter messages (Recommended)". The fourth option, "None for now", was not picked.

Evidence limits: list-price equivalents from local transcripts, 2026-11-21T00:00Z to 2026-11-22T14:00Z, not plan quota. The savings are estimates and the ranges overlap.

### MC-3767 — First critical reviews and fixes touching the contract stay Opus; other fix re-checks go to Sonnet, 2026-11-22

- Tag: decisions (maintainer, AskUserQuestion answer in lane A). Date: 2026-11-22. Amends: `MC-895`, `MC-899` (what counts as a changed critical contract at a re-check). Related: `MC-912`, `MC-2748`.

**The option picked.** "Sonnet re-checks (Recommended)", whose description read: "Save 1-3%. 193 of 196 Opus reviews were tagged critical. First critical reviews stay Opus, as does any fix touching the contract. Other fix re-checks go to Sonnet. Risk: a fix that breaks the contract indirectly gets a weaker review."

**Derived by lane A (not the maintainer's words; correct if wrong).** It applies to fix re-checks at both gates. The test of "touches", the escalation from Sonnet and the registration are in routing.md "Remediation re-checks".

### MC-3768 — Repeated device rows run through guarded scripts or batched commands, 2026-11-22

- Tag: decisions (maintainer, AskUserQuestion answer in lane A). Date: 2026-11-22. Related: `MC-1666`, `MC-3767`.

**The option picked.** "Scripted device rows (Recommended)", whose description read: "Save 1-2.5%. Lane B's device agents are 8.4% of usage, mostly one command per request. Repeated rows get guarded scripts or batched commands, and screenshots are still checked. Risk: script upkeep and false passes."

**Derived by lane A (not the maintainer's words; correct if wrong).** It covers PC rows too, and changes no device permission. The mechanics are in live-checks.md "Repeated rows".

### MC-3769 — Sessions send fewer messages and group background jobs, 2026-11-22

- Tag: decisions (maintainer, AskUserQuestion answer in lane A). Date: 2026-11-22. Related: `MC-2713`, `MC-3764`.

**The option picked.** "Quieter messages (Recommended)", whose description read: "Save 0.5-1.5%. Sessions message only when blocked, needing a decision, ready to merge or finished, with no acknowledgements, and group background jobs. Risk: lane A notices drift later."

**Derived by lane A (not the maintainer's words; correct if wrong).** Assignments and their results, answers, incidents and corrections still get a message (routing.md "Messages between sessions and wakes").
