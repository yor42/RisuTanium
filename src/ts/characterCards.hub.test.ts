// @vitest-environment happy-dom

/**
 * Contract tests for `getRisuHub` in `src/ts/characterCards.ts`.
 *
 * This function has never had test coverage. It was rewritten to return a
 * discriminated `RisuHubResult` (`ok: true` with cards, or `ok: false` with
 * a `reason`) instead of the old `Promise<hubType[]>`, which collapsed every
 * failure into an empty array before any caller could tell "the hub is
 * empty" apart from "the request failed".
 *
 * `characterCards.ts` pulls in a large transitive dependency graph (the
 * database module, `globalApi.svelte`, Tauri's filesystem and deep-link
 * plugins, the zip/module importers, and more) that has
 * nothing to do with `getRisuHub` itself. Every one of those direct imports
 * is mocked below so this file loads the REAL `characterCards.ts` and
 * exercises the REAL `getRisuHub` against a mocked `fetch`, without any of
 * that machinery running or touching the filesystem/network.
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

vi.mock(import('src/ts/alert'), () => ({
    alertCardExport: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
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

import { getRisuHub, hubURL } from 'src/ts/characterCards'
import { DBState } from 'src/ts/stores.svelte'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests, upstreamAccepted } from 'src/ts/upstreamAgreement'

/** A `hubType`-shaped card, minimal but valid for the tests below. */
function makeCard(id: string) {
    return {
        name: `card-${id}`,
        desc: '',
        download: '',
        id,
        img: '',
        tags: [],
        viewScreen: 'none' as const,
        hasLore: false,
        hasEmotion: false,
        hasAsset: false,
        hot: 0,
        license: '',
        type: 'character',
    }
}

/** A `Response`-shaped mock good enough for getRisuHub's own handling. */
function jsonResponse(status: number, body: unknown): Response {
    return {
        status,
        json: vi.fn(async () => body),
    } as unknown as Response
}

function malformedJsonResponse(status: number): Response {
    return {
        status,
        json: vi.fn(async () => {
            throw new SyntaxError('Unexpected token in JSON')
        }),
    } as unknown as Response
}

let onLineSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    // navigator.onLine defaults to true in happy-dom; make every test's
    // starting point explicit rather than relying on that default.
    onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    // Every case in this file exercises getRisuHub's success/failure shapes
    // on the far side of the consent gate; only the dedicated consent
    // block below overrides this to the unaccepted state.
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    onLineSpy.mockRestore()
    vi.useRealTimers()
    localStorage.clear()
    resetUpstreamAgreementForTests()
})

const arg = { search: '', page: 0, nsfw: false, sort: 'recommended' }

describe('getRisuHub -- success shapes', () => {
    test('200 with a bare array body: ok, cards carried, additionalHTML defaults to empty string', async () => {
        const cards = [makeCard('a'), makeCard('b')]
        vi.mocked(fetch).mockResolvedValue(jsonResponse(200, cards))

        const result = await getRisuHub(arg)

        expect(result).toEqual({ ok: true, cards, additionalHTML: '' })
    })

    test('200 with { cards }: ok, cards carried', async () => {
        const cards = [makeCard('a')]
        vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { cards }))

        const result = await getRisuHub(arg)

        expect(result).toEqual({ ok: true, cards, additionalHTML: '' })
    })

    test('200 with { additionalHTML, cards }: ok, the announcement is carried through', async () => {
        const cards = [makeCard('a')]
        vi.mocked(fetch).mockResolvedValue(
            jsonResponse(200, { cards, additionalHTML: '<p>hello</p>' })
        )

        const result = await getRisuHub(arg)

        expect(result).toEqual({ ok: true, cards, additionalHTML: '<p>hello</p>' })
    })
})

describe('getRisuHub -- blocked creators', () => {
    afterEach(() => {
        DBState.db.blockedRealmCreators = []
    })

    const blockedCard = { ...makeCard('blocked'), creator: 'creator-a' }
    const otherCard = { ...makeCard('other'), creator: 'creator-b' }
    const anonymousCard = makeCard('anonymous')

    test('a bare array body drops cards of blocked creators and keeps the rest', async () => {
        DBState.db.blockedRealmCreators = [{ id: 'creator-a', name: 'A' }]
        vi.mocked(fetch).mockResolvedValue(jsonResponse(200, [blockedCard, otherCard, anonymousCard]))

        const result = await getRisuHub(arg)

        expect(result).toEqual({ ok: true, cards: [otherCard, anonymousCard], additionalHTML: '' })
    })

    test('a { cards } body drops cards of blocked creators and keeps the rest', async () => {
        DBState.db.blockedRealmCreators = [{ id: 'creator-a', name: 'A' }]
        vi.mocked(fetch).mockResolvedValue(
            jsonResponse(200, { cards: [blockedCard, otherCard, anonymousCard], additionalHTML: '<p>hi</p>' })
        )

        const result = await getRisuHub(arg)

        expect(result).toEqual({ ok: true, cards: [otherCard, anonymousCard], additionalHTML: '<p>hi</p>' })
    })
})

describe('getRisuHub -- malformed', () => {
    test('200 with an object that has no cards key: malformed, not a thrown error or undefined cards', async () => {
        vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { somethingElse: true }))

        const result = await getRisuHub(arg)

        expect(result).toEqual({ ok: false, reason: 'malformed' })
    })

    test('200 whose body is not valid JSON: malformed, NOT network', async () => {
        vi.mocked(fetch).mockResolvedValue(malformedJsonResponse(200))

        const result = await getRisuHub(arg)

        expect(result).toEqual({ ok: false, reason: 'malformed' })
    })
})

describe('getRisuHub -- http and network failures', () => {
    test('non-200 status: http, with status carried', async () => {
        vi.mocked(fetch).mockResolvedValue(jsonResponse(404, {}))

        const result = await getRisuHub(arg)

        expect(result).toEqual({ ok: false, reason: 'http', status: 404 })
    })

    test('fetch rejecting: network', async () => {
        vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

        const result = await getRisuHub(arg)

        expect(result).toEqual({ ok: false, reason: 'network' })
    })
})

describe('getRisuHub -- timeout', () => {
    test('a request that never settles resolves to timeout within the bound', async () => {
        vi.useFakeTimers()
        // A fetch that never resolves on its own, but does reject once its
        // AbortSignal fires -- exactly like a real fetch under AbortController.
        vi.mocked(fetch).mockImplementation(
            (_input: RequestInfo | URL, init?: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        const err = new Error('The operation was aborted')
                        err.name = 'AbortError'
                        reject(err)
                    })
                })
        )

        const pending = getRisuHub(arg)
        // Let the promise chain start before advancing timers.
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(8000)

        const result = await pending
        expect(result).toEqual({ ok: false, reason: 'timeout' })
    })

    test('the timeout timer is cleared on the success path -- no leaked timer fires afterward', async () => {
        vi.useFakeTimers()
        vi.mocked(fetch).mockResolvedValue(jsonResponse(200, []))

        const result = await getRisuHub(arg)
        expect(result).toEqual({ ok: true, cards: [], additionalHTML: '' })

        // If the timer were still live, advancing past its 8s bound would be
        // harmless to observe directly (getRisuHub has already returned) --
        // the real guard is that no pending timer throws/rejects and that
        // vi.clearAllTimers()/advancing does not resurrect a second
        // resolution. Assert there are no pending timers left registered at
        // all: a leaked setTimeout would show up here.
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe('getRisuHub -- offline', () => {
    test('navigator.onLine === false: offline, and fetch is never called', async () => {
        onLineSpy.mockReturnValue(false)

        const result = await getRisuHub(arg)

        expect(result).toEqual({ ok: false, reason: 'offline' })
        expect(fetch).not.toHaveBeenCalled()
    })

    test('navigator.onLine === true does not skip handling: a failing fetch still reaches network', async () => {
        onLineSpy.mockReturnValue(true)
        vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

        const result = await getRisuHub(arg)

        expect(result).toEqual({ ok: false, reason: 'network' })
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    test('navigator.onLine === true does not skip handling: a hanging fetch still reaches timeout', async () => {
        vi.useFakeTimers()
        onLineSpy.mockReturnValue(true)
        vi.mocked(fetch).mockImplementation(
            (_input: RequestInfo | URL, init?: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        const err = new Error('The operation was aborted')
                        err.name = 'AbortError'
                        reject(err)
                    })
                })
        )

        const pending = getRisuHub(arg)
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(8000)

        const result = await pending
        expect(result).toEqual({ ok: false, reason: 'timeout' })
        expect(fetch).toHaveBeenCalledTimes(1)
    })
})

describe('getRisuHub -- request shape', () => {
    test('the request targets the hub URL and is aborted via a signal, not left uncancellable', async () => {
        vi.mocked(fetch).mockResolvedValue(jsonResponse(200, []))

        await getRisuHub(arg)

        expect(fetch).toHaveBeenCalledTimes(1)
        const [url, init] = vi.mocked(fetch).mock.calls[0]
        expect(String(url).startsWith(hubURL)).toBe(true)
        expect(init?.signal).toBeInstanceOf(AbortSignal)
    })
})

describe('getRisuHub -- consent', () => {
    beforeEach(() => {
        localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
        resetUpstreamAgreementForTests()
    })

    test('without acceptance: consent, and no request is sent', async () => {
        vi.mocked(fetch).mockResolvedValue(jsonResponse(200, []))

        const result = await getRisuHub(arg)

        expect(result).toEqual({ ok: false, reason: 'consent' })
        expect(fetch).not.toHaveBeenCalled()
    })

    test('consent is checked before offline: an offline, unaccepted caller still sees consent, not offline', async () => {
        onLineSpy.mockReturnValue(false)

        const result = await getRisuHub(arg)

        expect(result).toEqual({ ok: false, reason: 'consent' })
        expect(fetch).not.toHaveBeenCalled()
    })

    // `getRisuHub`'s own fresh `isUpstreamAccepted()` check finding no acceptance makes it call
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

            const result = await getRisuHub(arg)

            expect(result).toEqual({ ok: false, reason: 'consent' })
            expect(get(upstreamAccepted)).toBe(false)
        } finally {
            hold()
        }
    })
})
