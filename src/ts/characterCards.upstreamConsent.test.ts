// @vitest-environment happy-dom

/**
 * Contract tests for the Realm request functions in `src/ts/characterCards.ts`
 * that are not behind a user action: `getRealmInfo` and `handlePendingRealmLink`
 * (MC-086, MC-087 #3). Without acceptance of the upstream-services agreement,
 * neither of them sends a request. `getRealmInfo` strips its `?realm=`
 * argument from the URL synchronously, before any network call, so the
 * parameter never lingers regardless of what happens afterward.
 *
 * `downloadRisuHub` (MC-086) IS behind a user action, so it asks first
 * instead: on decline it sends nothing, whatever `forceRedirect` says.
 *
 * The module-mock set below is copied, unchanged in shape, from
 * `characterCards.hub.test.ts`, the existing precedent for loading the real
 * `characterCards.ts` behind a mocked `fetch`.
 */

import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks -- everything characterCards.ts imports directly,
// other than svelte/store, uuid, src/lang and type-only imports, none of
// which do anything observable at import time.

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

const alertErrorMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/alert'), () => ({
    alertCardExport: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: alertErrorMock,
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => null),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => {}),
    characterFormatUpdate: vi.fn((c: unknown) => c),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    BlankWriter: class {},
    LocalWriter: class {},
    VirtualWriter: class {},
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(async () => {}),
    forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    loadAsset: vi.fn(async () => new Uint8Array()),
    openURL: vi.fn(),
    readImage: vi.fn(async (d: unknown) => d),
    saveAsset: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Record<string, unknown> },
    SettingsMenuIndex: writable(0),
    ShowRealmFrameStore: writable(false),
    alertStore: writable({ type: 'none', msg: '' }),
    selectedCharID: writable(-1),
    settingsOpen: writable(false),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('src/ts/pngChunk'))

vi.mock(import('src/ts/process/processzip'), () => ({
    CharXImporter: class {},
    CharXWriter: class {},
}) as unknown as typeof import('src/ts/process/processzip'))

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async () => new Uint8Array()),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

//#endregion

import { downloadRisuHub, getRealmInfo, handlePendingRealmLink } from 'src/ts/characterCards'
import { DBState, alertStore } from 'src/ts/stores.svelte'
import {
    UPSTREAM_AGREEMENT_ACCEPT,
    UPSTREAM_AGREEMENT_DECLINE,
    UPSTREAM_AGREEMENT_KEY,
    resetUpstreamAgreementForTests,
    upstreamAccepted,
} from 'src/ts/upstreamAgreement'

function jsonResponse(status: number, body: unknown): Response {
    return {
        status,
        json: vi.fn(async () => body),
        text: vi.fn(async () => JSON.stringify(body)),
    } as unknown as Response
}

/** Bounded, real-time poll: a hanging or never-posted prompt must fail with a
 * message naming what was expected, not hang the file or pass by accident. */
async function waitFor(predicate: () => boolean, description: string): Promise<void> {
    const deadline = Date.now() + 300
    while (Date.now() < deadline) {
        if (predicate()) return
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${description}`)
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    alertErrorMock.mockClear()
    alertStore.set({ type: 'none', msg: '' })
    history.replaceState(null, '', '/')
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    localStorage.clear()
    resetUpstreamAgreementForTests()
    history.replaceState(null, '', '/')
})

describe('getRealmInfo, called directly, without acceptance', () => {
    beforeEach(() => {
        history.pushState(null, '', '/?realm=some-path')
    })

    test('the ?realm= strip happens synchronously, before any await, and uses replaceState', async () => {
        vi.mocked(fetch).mockResolvedValue(jsonResponse(200, null))
        const replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})

        const pending = getRealmInfo('some-path')

        expect(replaceStateSpy).toHaveBeenCalledTimes(1)

        await pending
    })

    test('does not fetch, and resolves to \'consent\'', async () => {
        vi.mocked(fetch).mockResolvedValue(jsonResponse(200, null))

        const result = await getRealmInfo('some-path')

        expect(result).toBe('consent')
        expect(fetch).not.toHaveBeenCalled()
    })

    // `getRealmInfo`'s own fresh `isUpstreamAccepted()` check finding no acceptance makes it call
    // `publishUpstreamAccepted()` (`src/ts/upstreamAgreement.ts`), correcting `upstreamAccepted`
    // to agree with that read. A subscriber attached before the key is removed keeps the store's
    // cached value at `true` across the removal, since nothing dispatches a `storage` event for a
    // same-tab `removeItem` -- exactly the staleness that check is meant to resolve.
    test('a stale-true store is corrected to false once a call finds no acceptance on a fresh read', async () => {
        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        resetUpstreamAgreementForTests()
        // Kept open for the whole test: dropping to zero subscribers and calling `get()` again
        // would itself trigger a fresh re-read through the store's own start function, which is
        // exactly the staleness this test means to hold open long enough to observe.
        const hold = upstreamAccepted.subscribe(() => {})
        try {
            localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
            expect(get(upstreamAccepted)).toBe(true)
            vi.mocked(fetch).mockResolvedValue(jsonResponse(200, null))

            const result = await getRealmInfo('some-path')

            expect(result).toBe('consent')
            expect(get(upstreamAccepted)).toBe(false)
        } finally {
            hold()
        }
    })
})

describe('handlePendingRealmLink', () => {
    beforeEach(() => {
        history.pushState(null, '', '/?realm=some-path')
    })

    test('is exported as a callable function', () => {
        expect(typeof handlePendingRealmLink).toBe('function')
    })

    test('after getRealmInfo records a pending path, it posts one prompt; Decline fetches nothing and clears the pending path, so a second call posts nothing', async () => {
        expect(typeof handlePendingRealmLink).toBe('function')

        vi.mocked(fetch).mockResolvedValue(jsonResponse(200, null))
        await getRealmInfo('some-path')
        vi.mocked(fetch).mockClear()

        const pending = handlePendingRealmLink()
        await waitFor(() => get(alertStore).type === 'tos', 'handlePendingRealmLink to post the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        await pending

        expect(fetch).not.toHaveBeenCalled()

        let secondPromptSeen = false
        const unsubscribe = alertStore.subscribe((v) => {
            if (v.type === 'tos') secondPromptSeen = true
        })
        await handlePendingRealmLink()
        unsubscribe()
        expect(secondPromptSeen).toBe(false)
        expect(fetch).not.toHaveBeenCalled()
    })

    test('after getRealmInfo records a pending path, Accept runs the info request for that path', async () => {
        expect(typeof handlePendingRealmLink).toBe('function')

        vi.mocked(fetch).mockResolvedValue(jsonResponse(200, null))
        await getRealmInfo('some-path')
        vi.mocked(fetch).mockClear()

        const pending = handlePendingRealmLink()
        await waitFor(() => get(alertStore).type === 'tos', 'handlePendingRealmLink to post the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT })
        await pending

        expect(fetch).toHaveBeenCalledTimes(1)
        const [url] = vi.mocked(fetch).mock.calls[0]
        expect(String(url)).toContain('some-path')
    })

    test('with nothing pending, it posts no prompt and fetches nothing', async () => {
        expect(typeof handlePendingRealmLink).toBe('function')

        let posted = false
        const unsubscribe = alertStore.subscribe((v) => {
            if (v.type === 'tos') posted = true
        })
        await handlePendingRealmLink()
        unsubscribe()

        expect(posted).toBe(false)
        expect(fetch).not.toHaveBeenCalled()
    })
})

describe('downloadRisuHub, on Decline', () => {
    // Guard: the agreement is asked before forceRedirect is even consulted, so this holds for
    // both forms of the call.
    test('without forceRedirect: sends nothing', async () => {
        const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

        const pending = downloadRisuHub('some-id')
        await waitFor(() => get(alertStore).type === 'tos', 'downloadRisuHub to post the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        await pending

        expect(fetch).not.toHaveBeenCalled()
        expect(windowOpenSpy).not.toHaveBeenCalled()
    })

    test('with forceRedirect: sends nothing either', async () => {
        const pending = downloadRisuHub('some-id', { forceRedirect: true })
        // Whether this settles or rejects is not itself part of what this test checks; attach a
        // handler so an unanswered prompt's timeout below is the only failure this test can surface.
        pending.catch(() => {})
        await waitFor(() => get(alertStore).type === 'tos', 'downloadRisuHub to post the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        await pending

        expect(fetch).not.toHaveBeenCalled()
    })

    // Guard: without a creator in hand, the realm info lookup that resolves it is a network
    // request too, so it must wait for the answer to the agreement prompt.
    test('without a creator: the creator lookup is not sent while the prompt is open', async () => {
        const pending = downloadRisuHub('some-id')
        await waitFor(() => get(alertStore).type === 'tos', 'downloadRisuHub to post the agreement prompt')

        expect(fetch).not.toHaveBeenCalled()

        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        await pending
        expect(fetch).not.toHaveBeenCalled()
    })
})

describe('downloadRisuHub, on Accept, without a creator from the caller', () => {
    const downloadUrl = 'https://realm.risuai.net/api/v1/download/dynamic/some-id?cors=true'

    afterEach(() => {
        DBState.db.blockedRealmCreators = []
    })

    async function acceptPrompt(pending: Promise<unknown>): Promise<void> {
        await waitFor(() => get(alertStore).type === 'tos', 'downloadRisuHub to post the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT })
        await pending
    }

    // A creator that the info lookup resolves and that is not blocked leaves the download
    // to proceed; the download request is the second request, after the info request.
    test('an unblocked creator resolved from the realm info proceeds to the download request', async () => {
        DBState.db.blockedRealmCreators = [{ id: 'creator-a', name: 'A' }]
        vi.mocked(fetch)
            .mockResolvedValueOnce(jsonResponse(200, { creator: 'creator-b' }))
            .mockResolvedValueOnce(jsonResponse(500, 'download refused'))

        await acceptPrompt(downloadRisuHub('some-id'))

        expect(fetch).toHaveBeenCalledTimes(2)
        expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('/hub/info/some-id')
        expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe(downloadUrl)
        // The download response is consumed: a refusal reaches the user.
        expect(alertErrorMock).toHaveBeenCalledWith(JSON.stringify('download refused'))
    })

    test('realm info without a creator field proceeds to the download request', async () => {
        vi.mocked(fetch)
            .mockResolvedValueOnce(jsonResponse(200, {}))
            .mockResolvedValueOnce(jsonResponse(500, 'download refused'))

        await acceptPrompt(downloadRisuHub('some-id'))

        expect(fetch).toHaveBeenCalledTimes(2)
        expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe(downloadUrl)
        expect(alertErrorMock).toHaveBeenCalledWith(JSON.stringify('download refused'))
    })

    test('a failed realm info request shows the error and sends no download request', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(500, 'info unavailable'))

        await acceptPrompt(downloadRisuHub('some-id'))

        expect(fetch).toHaveBeenCalledTimes(1)
        expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('/hub/info/some-id')
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(String(alertErrorMock.mock.calls[0][0])).toContain('info unavailable')
    })
})

describe('downloadRisuHub, on Accept, with a blocked creator', () => {
    afterEach(() => {
        DBState.db.blockedRealmCreators = []
    })

    test('a creator passed by the caller that is blocked sends nothing', async () => {
        DBState.db.blockedRealmCreators = [{ id: 'creator-a', name: 'A' }]

        const pending = downloadRisuHub('some-id', { creator: 'creator-a' })
        await waitFor(() => get(alertStore).type === 'tos', 'downloadRisuHub to post the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT })
        await pending

        expect(fetch).not.toHaveBeenCalled()
    })

    test('a creator resolved from the realm info that is blocked stops after the info request', async () => {
        DBState.db.blockedRealmCreators = [{ id: 'creator-a', name: 'A' }]
        vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { creator: 'creator-a' }))

        const pending = downloadRisuHub('some-id')
        await waitFor(() => get(alertStore).type === 'tos', 'downloadRisuHub to post the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT })
        await pending

        expect(fetch).toHaveBeenCalledTimes(1)
        expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('/hub/info/some-id')
    })
})
