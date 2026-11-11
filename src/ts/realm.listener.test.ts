/**
 * Loading `src/ts/realm.ts` has no side effect on the page: it registers no window listener, because nothing in
 * the module reads one. The Realm frame's messages are heard only by `RealmFrame.svelte`, which removes its own
 * listener when it is destroyed.
 *
 * The module is imported dynamically after the spy is installed, with its six imports replaced by stubs, so the
 * registration of a module-level listener would be recorded. Titles beginning "regression reproducer:" fail
 * against a `realm.ts` that registers a `message` listener at load.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    preflightCardExport: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/drive/exportPreflight'), () => ({
    refuseExport: vi.fn(),
}) as unknown as typeof import('src/ts/drive/exportPreflight'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    VirtualWriter: class {},
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertStore: { set: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    asBuffer: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

//#endregion

afterEach(() => {
    vi.restoreAllMocks()
})

describe('realm.ts: loading the module', () => {
    test('regression reproducer: registers no window message listener', async () => {
        const addListener = vi.spyOn(window, 'addEventListener')

        const loaded = await import('src/ts/realm')

        expect(typeof loaded.shareRealmCardData).toBe('function')
        const types = addListener.mock.calls.map((call) => call[0])
        expect(types).not.toContain('message')
    })
})
