// @vitest-environment happy-dom
import 'src/ts/tests/asyncScheduler.test-helpers'

/**
 * `RecentStrip.svelte` under Svelte's async scheduler: the focus-survival scenarios of
 * `RecentStrip.svelte.test.ts` run again with the async scheduler on (the helper import above is first), where
 * the block update runs before an `$effect.pre`, so the focused avatar must be captured while the list is
 * computed. Regression reproducers for that ordering; the same scenarios stay green under the shipped scheduler.
 *
 * MOCKED: as in `RecentStrip.svelte.test.ts`, the avatar thumbnail lookup and `DBState`.
 */
import { vi } from 'vitest'
import type { Database } from '../../../ts/storage/database.svelte'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})

import { registerRecentStripFocusSuite } from './RecentStrip.scenarios.test-helpers.svelte'

registerRecentStripFocusSuite()
