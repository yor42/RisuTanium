// @vitest-environment jsdom
import 'src/ts/tests/asyncScheduler.test-helpers'

/**
 * `ToastHost.svelte` under Svelte's async scheduler: the focus suite of `ToastHost.svelte.test.ts` runs again with
 * the async scheduler on (the helper import above is first), where the block update runs before an `$effect.pre`,
 * so the focus inside the stack must be captured when the host's version is read. Regression reproducers for that
 * ordering; the same scenarios stay green under the shipped scheduler.
 *
 * The host is a real `createToastHost` on a fake clock.
 */
import { vi } from 'vitest'

vi.mock('../../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../../ts/alertBack', () => ({ closeDialogForBack: () => { } }))

import { installToastHarness, registerToastHostFocusSuite } from './ToastHost.scenarios.test-helpers.svelte'

installToastHarness()
registerToastHostFocusSuite()
