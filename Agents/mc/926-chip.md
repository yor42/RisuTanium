### MC-4868 — #926 the preset regex editor shows the save chip, and an unencodable presetRegex reads Not saved, 2026-11-29

- Tag: decision (a plan-level choice inside rulings already made). Date: 2026-11-29. Exact times: UNKNOWN. Related: `#926`, `#684`, `MC-4450` point 3, `MC-4451`, `MC-4864`.

**What was decided.** The preset regex pane shows the existing save-status chip for the active and for inactive presets, with the existing `studioChip*` strings and no new locale key. The preset commit verdict now judges `settings:presetRegex` together with the table working keys, ahead of the carried-list and liveness checks, so a refused active-preset regex list reads "Not saved" without Retry and never "Saved". The inactive preset's `botPresets[i].regex` was already covered through `presets:presets`.

**How.** The preset ack accepts a holder token from each component that begins it (the toggle builder and the regex pane). An entry ends only when its last holder ends, and a holder that never joined cannot end it, so the builder's late destroy cannot end the pane's ack for the same preset. Callers without a token keep today's behaviour.

**Why.** The chip was deferred from S6c because it changes the verdict contract (MC-4864). Holder tokens make the result independent of Svelte destroy and mount order.

**Format.** None: preset history stays memory-only, no stored key, no history record change.

**Consequence.** An unencodable `presetRegex` now also makes toggle edits and regex edits of any preset, inactive ones included, read permanent "Not saved" (the safe side; extends the MC-4451 limitation).
