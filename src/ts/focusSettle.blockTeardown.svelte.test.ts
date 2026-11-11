// @vitest-environment jsdom
/**
 * Focus listeners that write `$state` while a Svelte block removes the focused field (see the scenarios file for the
 * invariants). The scenarios live in `focusSettle.blockTeardown.scenarios.test-helpers.svelte.ts` and also run under
 * the async scheduler in `focusSettle.blockTeardown.asyncOrder.svelte.test.ts`.
 */
import { registerFocusSettleTeardownSuite } from './focusSettle.blockTeardown.scenarios.test-helpers.svelte'

registerFocusSettleTeardownSuite()
