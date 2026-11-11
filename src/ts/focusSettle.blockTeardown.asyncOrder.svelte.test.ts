// @vitest-environment jsdom
import 'src/ts/tests/asyncScheduler.test-helpers'

/**
 * The block-teardown focus scenarios of `focusSettle.blockTeardown.svelte.test.ts` run again with Svelte's async
 * scheduler on (the helper import above is first). There a removal caused by a write outside an effect is deferred
 * to the batch commit, so only an effect-driven removal still runs on the block effect's stack: the positive control
 * (D1) uses that trigger, and the direct trigger stays a compatibility guard. The same scenarios stay green under
 * the shipped scheduler.
 */
import { registerFocusSettleTeardownSuite } from './focusSettle.blockTeardown.scenarios.test-helpers.svelte'

registerFocusSettleTeardownSuite()
