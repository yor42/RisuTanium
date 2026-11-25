// @vitest-environment jsdom

/**
 * Unit coverage for `createRealmPreview`: the generation guard, the kept
 * announcement, the consent no-op, acceptance/hideRealm gating and disposal
 * with the owner. The component suites (`MainMenu.hubStates`,
 * `MainMenu.upstreamConsent`) pin the same behaviour through the DOM; this file
 * pins it at the factory seam. `getRisuHub` is mocked with deferred results so
 * resolution order is driven per test.
 */

import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RisuHubResult, hubType } from 'src/ts/characterCards'

//#region module mocks

const hubMock = vi.hoisted(() => {
    const pending: Array<(result: unknown) => void> = []
    const getRisuHub = vi.fn(
        () => new Promise<unknown>((resolve) => { pending.push(resolve) }),
    )
    return { getRisuHub, pending }
})

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: hubMock.getRisuHub,
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({
        db: { hideRealm: false } as unknown as Record<string, unknown>,
    })
    return {
        DBState: state,
    } as unknown as typeof import('src/ts/stores.svelte')
})

//#endregion

import { createRealmPreview, type RealmPreview } from './realmPreview.svelte'
import { DBState } from 'src/ts/stores.svelte'
import { realmBlockListKey } from 'src/ts/realmBlocking'

function makeChara(name: string): hubType {
    return {
        name,
        desc: '',
        download: '',
        id: name,
        img: '',
        tags: [],
        viewScreen: 'none',
        hasLore: false,
        hasEmotion: false,
        hasAsset: false,
        hot: 0,
        license: '',
        type: 'character',
    }
}

function populated(name: string, additionalHTML = ''): RisuHubResult {
    return {
        ok: true, cards: [makeChara(name)], additionalHTML,
        blockedCreatorsKey: realmBlockListKey(DBState.db.blockedRealmCreators ?? []),
    }
}

async function settle() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
}

let accepted = $state(true)
let preview: RealmPreview
let dispose: (() => void) | null = null

function create() {
    dispose = $effect.root(() => {
        preview = createRealmPreview(() => accepted, () => accepted)
    })
    flushSync()
}

// Hiding then unhiding issues a second load through the acceptance effect.
function issueSecondLoad() {
    DBState.db.hideRealm = true
    flushSync()
    DBState.db.hideRealm = false
    flushSync()
}

beforeEach(() => {
    accepted = true
    DBState.db.hideRealm = false
    hubMock.getRisuHub.mockClear()
    hubMock.pending.length = 0
})

afterEach(() => {
    dispose?.()
    dispose = null
})

describe('createRealmPreview', () => {
    test('out of order: the later request wins when the earlier one resolves last', async () => {
        create()
        issueSecondLoad()
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(2)

        hubMock.pending[1](populated('b'))
        await settle()
        hubMock.pending[0](populated('a'))
        await settle()

        expect(preview.status).toBe('populated')
        expect(preview.cards.map((c) => c.name)).toEqual(['b'])
    })

    test('a superseded failure cannot stomp a populated newer result', async () => {
        create()
        issueSecondLoad()

        hubMock.pending[1](populated('b'))
        await settle()
        hubMock.pending[0]({ ok: false, reason: 'network' } satisfies RisuHubResult)
        await settle()

        expect(preview.status).toBe('populated')
    })

    test('a superseded offline result leaves a still-pending newer request pending', async () => {
        create()
        issueSecondLoad()

        hubMock.pending[0]({ ok: false, reason: 'offline' } satisfies RisuHubResult)
        await settle()

        expect(preview.status).toBe('pending')
    })

    test('an empty announcement never replaces a kept one', async () => {
        create()
        hubMock.pending[0](populated('a', '<p>x</p>'))
        await settle()
        expect(preview.announcement).toBe('<p>x</p>')

        void preview.load()
        hubMock.pending[1](populated('a', ''))
        await settle()

        expect(preview.announcement).toBe('<p>x</p>')
    })

    test('a reload after a failure goes back to pending until it resolves', async () => {
        create()
        hubMock.pending[0]({ ok: false, reason: 'network' } satisfies RisuHubResult)
        await settle()
        expect(preview.status).toBe('failed')

        void preview.load()
        flushSync()
        expect(preview.status).toBe('pending')
    })

    test('the consent result writes nothing', async () => {
        create()
        hubMock.pending[0]({ ok: false, reason: 'consent' } satisfies RisuHubResult)
        await settle()

        expect(preview.status).toBe('pending')
        expect(preview.cards).toEqual([])
    })

    test('loading follows acceptance and hideRealm', async () => {
        accepted = false
        create()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        accepted = true
        flushSync()
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
        hubMock.pending[0]({ ok: false, reason: 'offline' } satisfies RisuHubResult)
        await settle()
        expect(preview.status).toBe('offline')

        accepted = false
        flushSync()
        window.dispatchEvent(new Event('online'))
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
    })

    test('hideRealm true gives no load, also from the online listener', async () => {
        DBState.db.hideRealm = true
        create()
        expect(preview.hidden).toBe(true)
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        DBState.db.hideRealm = false
        flushSync()
        hubMock.pending[0]({ ok: false, reason: 'offline' } satisfies RisuHubResult)
        await settle()
        expect(preview.status).toBe('offline')

        DBState.db.hideRealm = true
        flushSync()
        window.dispatchEvent(new Event('online'))
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
    })

    test('an online event reloads from offline when accepted and visible', async () => {
        create()
        hubMock.pending[0]({ ok: false, reason: 'offline' } satisfies RisuHubResult)
        await settle()

        window.dispatchEvent(new Event('online'))
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(2)
    })

    test('disposing the owner removes the online listener', async () => {
        create()
        hubMock.pending[0]({ ok: false, reason: 'offline' } satisfies RisuHubResult)
        await settle()

        const removeSpy = vi.spyOn(window, 'removeEventListener')
        dispose?.()
        dispose = null
        expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function))
        removeSpy.mockRestore()

        window.dispatchEvent(new Event('online'))
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
    })

    test('getInitialList shares the in-flight and populated request, and drops failed/empty results', async () => {
        create()
        const inFlight = preview.getInitialList()
        expect(inFlight).not.toBeNull()

        hubMock.pending[0](populated('shared', '<p>banner</p>'))
        await settle()
        expect(preview.getInitialList()).toBe(inFlight)
        await expect(inFlight).resolves.toEqual(populated('shared', '<p>banner</p>'))

        // A failed reload clears the cached entry so RealmMain retries fresh.
        void preview.load()
        hubMock.pending[1]({ ok: false, reason: 'network' } satisfies RisuHubResult)
        await settle()
        expect(preview.getInitialList()).toBeNull()

        // An empty reload also clears the cached entry.
        void preview.load()
        hubMock.pending[2]({ ok: true, cards: [], additionalHTML: '' } satisfies RisuHubResult)
        await settle()
        expect(preview.getInitialList()).toBeNull()
    })

    test('does not cache cards filtered while the request-start block list was temporarily changed', async () => {
        const blocked = [{ id: 'creator-a', name: 'A' }]
        DBState.db.blockedRealmCreators = blocked
        try {
            create()
            DBState.db.blockedRealmCreators = []
            hubMock.pending[0]({
                ok: true,
                cards: [{ ...makeChara('A'), creator: 'creator-a' }],
                additionalHTML: '',
                blockedCreatorsKey: '[]',
            })
            await settle()
            DBState.db.blockedRealmCreators = blocked

            expect(preview.getInitialList()).toBeNull()
            expect(preview.cards).toEqual([])
        } finally {
            DBState.db.blockedRealmCreators = []
        }
    })

    test('getInitialList invalidates when blockedRealmCreators changes or after 5 minutes', async () => {
        vi.useFakeTimers()
        try {
            vi.setSystemTime(new Date('2026-11-25T00:00:00Z'))
            DBState.db.blockedRealmCreators = []
            create()
            hubMock.pending[0](populated('shared'))
            await settle()
            expect(preview.getInitialList()).not.toBeNull()

            // Changing blocked creators invalidates the cached promise.
            DBState.db.blockedRealmCreators = [{ id: 'c1', name: 'Blocked' }]
            expect(preview.getInitialList()).toBeNull()

            // Reload under the new blocked list, then advance past the 5-minute TTL.
            void preview.load()
            hubMock.pending[1](populated('fresh'))
            await settle()
            expect(preview.getInitialList()).not.toBeNull()

            vi.advanceTimersByTime(5 * 60 * 1000 + 1)
            expect(preview.getInitialList()).toBeNull()
        } finally {
            vi.useRealTimers()
            DBState.db.blockedRealmCreators = []
        }
    })
})
