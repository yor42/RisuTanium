# #595 stage handoff

## Implementation

The Tier 1 change is on `claude/595`, based on `5d6957db8`. The legacy sidebar shows only the rail while Home is mounted, including its Realm view (MC-2932 and MC-2933).

- `src/lib/SideBars/Sidebar.svelte` removes the panel on Home and completes any pending close before render. When the user leaves Home, the panel returns to its prior open or closed state.
- `src/lib/UI/GUI/SideBarArrow.svelte` hides the toggle for the docked Home rail. The overlay opener remains available where the phone drawer does not own navigation.
- `src/lib/SideBars/Sidebar.homeLanding.svelte.test.ts` and `src/lib/UI/GUI/SideBarArrow.svelte.test.ts` cover the rail, panel restoration, close without an animation event, and toggle behavior.

## Evidence

On the original production code, 6 added cases failed and 14 cases passed. On the changed code, 157 tests passed across 8 targeted files. The independent reviewer approved the change and ran the 6 arrow tests again. Both close tests failed when the immediate close path was disabled in a temporary source copy.

The local host had less than the 14 GiB of free RAM required for `pnpm check`. PR CI runs the type check. If the PR head matches the reviewed diff and CI passes, merge the PR.

## Note 9 smoke check

- Row DV-595-1 is open and follows the post-merge device check in PR #602. The affected code is shared UI, and the phone drawer path already has component coverage.
- Use a Note 9 assigned by the device pool. Use a debug build from the merged snapshot and record the artifact SHA-256. Use one synthetic character and one chat. Do not clear app data.
- In portrait, start at Home and make sure that the Home menu opens and closes. The legacy sidebar toggle and panel stay out of the phone landing.
- Open the synthetic chat. Use the chat sidebar opener and make sure that its panel appears. Return to Home and repeat the drawer check.
- Pass only if all steps match within 10 minutes. Record the screenshots and the guarded adb log. Follow `docs/workflow/live-checks.md` for the build, lease, and phone checks.
