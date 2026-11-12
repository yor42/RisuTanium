// @vitest-environment jsdom
/**
 * Focus listeners that write `$state` while a Svelte block removes the focused field (see the scenarios file for the
 * invariants). The scenarios live in `focusSettle.blockTeardown.scenarios.test-helpers.svelte.ts` and run here under
 * the async scheduler the app ships.
 */
import { registerFocusSettleTeardownSuite } from './focusSettle.blockTeardown.scenarios.test-helpers.svelte'

registerFocusSettleTeardownSuite()
