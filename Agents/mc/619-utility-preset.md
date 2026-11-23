### MC-3820 — #619: the Utility preset choice lives in module state, session-only, 2026-11-23

- Tag: decisions (session, no maintainer ask needed). Date: 2026-11-23. Related: `#619`, `#202`, `#615`.

**What was decided.** The chosen task preset moved from component-local `$state` in `UtilityScreen.svelte` to `utilitySelection` in `utilityConversation.svelte.ts`, next to the conversation it feeds. A remount keeps it, so Send stays enabled. It is not persisted: no database field and no format change, so no persisted-format question arose (the issue asks only that a remount keep the preset). It survives New conversation and is lost on app restart. If the chosen preset is deleted, `chosen` is undefined and Send is disabled as before.
