// @vitest-environment happy-dom

/**
 * Tests for AV-4 (`Agents/Reports/16-av4-list-avatar-thumbnails-plan.md`,
 * §4, T9/T9g/T10): `getCharImage`'s `'thumb'`/`'thumbcss'` wiring in
 * `src/ts/characters.ts`.
 *
 * T9 is RED against the pre-AV-4 source: `characters.ts` had no `'thumb'`/
 * `'thumbcss'` case at all (only `'plain'`/`'css'`/`'contain'`/`'lgcss'`),
 * so calling `getCharImage(loc, 'thumb')` fell through to the final `else`
 * branch and returned a `'contain'`-style CSS string, never the raw
 * `'plain'`-style value T9 asserts on. T9g and T10 are guards: both already
 * hold against the pre-AV-4 source too, since `'thumb'`/`'thumbcss'` never
 * existed as a case to wire a thumbnail path into in the first place, so the
 * thumbnail path (this file's `getAvatarThumbSrc` spy) was never reachable
 * from any of them either.
 *
 * MOCKED: `localforage` (inert), `src/ts/globalApi.svelte` (`getFileSrc` is
 * a counting spy), `src/ts/storage/database.svelte` (`getDatabase` returns
 * the same `DBState.db` the tests set directly), `src/ts/platform` (forces
 * the plain-HTTP branch), `@tauri-apps/plugin-fs` (inert; unreachable with
 * `isTauri: false`), `src/ts/stores.svelte` (a thin reactive stand-in, same
 * shape as the AV-1/AV-2 suites' own mock) and, unlike those two suites,
 * `src/ts/media/avatarThumb`'s `getAvatarThumbSrc` (a spy), because these
 * tests are about `getCharImage`'s WIRING to that module, not the module's
 * own generation behaviour (covered by `avatarThumb.test.ts`). `isThumbEligible`
 * is NOT mocked here: T9g exercises the real predicate (also covered
 * directly in `avatarThumb.test.ts`), so a regression in the real
 * eligibility check fails this suite too.
 *
 * NOT mocked: `src/ts/characters` (real; `getCharImage` is exactly the
 * function under test).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from './storage/database.svelte'
import type { RisuEnvironmentLabel } from './platform'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const { getFileSrcSpy, getAvatarThumbSrcSpy } = vi.hoisted(() => ({
    getFileSrcSpy: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
    getAvatarThumbSrcSpy: vi.fn(async (_loc: string) => null as string | null),
}))

vi.mock(
    import('./globalApi.svelte'),
    () =>
        ({
            getFileSrc: getFileSrcSpy,
            checkCharOrder: vi.fn(),
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(),
            readImage: vi.fn(),
            globalFetch: vi.fn(),
            aiWatermarkingLawApplies: vi.fn(() => false),
            changeChatTo: vi.fn(),
            hubURL: '',
            usingSw: false,
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
            aiLawApplies: vi.fn(() => false),
        }) as unknown as typeof import('./globalApi.svelte'),
)

vi.mock(import('./storage/database.svelte'), async () => {
    const { DBState } = await import('./stores.svelte')
    return {
        getDatabase: vi.fn((options?: { snapshot?: boolean }) => DBState.db),
        getCurrentCharacter: vi.fn(() => DBState.db.characters?.[0]),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('./storage/database.svelte')
})

vi.mock(import('./platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'),
    getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn((): RisuEnvironmentLabel => 'web'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('./stores.svelte'), () => {
    const state = $state({ db: { hideAllImages: false } as unknown as Database })
    return {
        DBState: state,
        selectedCharID: { subscribe: () => () => {} },
        MobileGUIStack: { subscribe: () => () => {} },
        CharEmotion: { subscribe: () => () => {} },
        OpenRealmStore: { subscribe: () => () => {} },
        selIdState: { state: -1 },
    } as unknown as typeof import('./stores.svelte')
})

// The seam under test: only `getAvatarThumbSrc` (the generation entry point)
// is replaced. `isThumbEligible` is left as the real implementation via
// `importOriginal`, so T9g exercises the actual path predicate, not a copy
// of its logic.
vi.mock(import('./media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: getAvatarThumbSrcSpy,
    } as unknown as typeof import('./media/avatarThumb')
})

//#endregion

import { getCharImage } from './characters'
import { DBState } from './stores.svelte'

beforeEach(() => {
    DBState.db = { hideAllImages: false } as unknown as Database
    getFileSrcSpy.mockClear()
    getAvatarThumbSrcSpy.mockClear()
    getAvatarThumbSrcSpy.mockResolvedValue(null)
})

describe("T9 (RED): getCharImage's 'thumb'/'thumbcss' types", () => {
    test("'thumb' wraps a resolved thumbnail exactly like 'plain'", async () => {
        getAvatarThumbSrcSpy.mockResolvedValueOnce('data:image/webp;base64,thumb')
        const result = await getCharImage('assets/a.png', 'thumb')
        expect(result).toBe('data:image/webp;base64,thumb')
        expect(getAvatarThumbSrcSpy).toHaveBeenCalledWith('assets/a.png')
        // A non-null thumbnail short-circuits the getFileSrc fallback.
        expect(getFileSrcSpy).not.toHaveBeenCalled()
    })

    test("'thumbcss' wraps a resolved thumbnail exactly like 'css'", async () => {
        getAvatarThumbSrcSpy.mockResolvedValueOnce('data:image/webp;base64,thumb')
        const result = await getCharImage('assets/a.png', 'thumbcss')
        expect(result).toBe('background: url("data:image/webp;base64,thumb");background-size: cover;')
        expect(getFileSrcSpy).not.toHaveBeenCalled()
    })

    test("'thumb': a null thumbnail falls back to getFileSrc, wrapped exactly like 'plain'", async () => {
        getAvatarThumbSrcSpy.mockResolvedValueOnce(null)
        const result = await getCharImage('assets/a.png', 'thumb')
        expect(result).toBe('data:mock-image;loc=assets/a.png')
        expect(getFileSrcSpy).toHaveBeenCalledWith('assets/a.png')
    })

    test("'thumbcss': a null thumbnail falls back to getFileSrc, wrapped exactly like 'css'", async () => {
        getAvatarThumbSrcSpy.mockResolvedValueOnce(null)
        const result = await getCharImage('assets/a.png', 'thumbcss')
        expect(result).toBe('background: url("data:mock-image;loc=assets/a.png");background-size: cover;')
    })

    test("'thumb' + hideAllImages -> '/none.webp', exactly like 'plain', without ever calling the thumbnail path", async () => {
        DBState.db.hideAllImages = true
        const result = await getCharImage('assets/a.png', 'thumb')
        expect(result).toBe('/none.webp')
        expect(getAvatarThumbSrcSpy).not.toHaveBeenCalled()
        expect(getFileSrcSpy).not.toHaveBeenCalled()
    })

    test("'thumbcss' + empty loc -> '', exactly like 'css', without ever calling the thumbnail path", async () => {
        const result = await getCharImage('', 'thumbcss')
        expect(result).toBe('')
        expect(getAvatarThumbSrcSpy).not.toHaveBeenCalled()
        expect(getFileSrcSpy).not.toHaveBeenCalled()
    })

    test("'thumb' + empty loc -> null, exactly like 'plain'", async () => {
        const result = await getCharImage('', 'thumb')
        expect(result).toBeNull()
        expect(getAvatarThumbSrcSpy).not.toHaveBeenCalled()
    })
})

describe('T9g (guard): the thumbnail path is never reached when ineligible', () => {
    // Pure guards: only whether the thumbnail path (`getAvatarThumbSrc`) gets
    // called is asserted here, not the exact wrapped-string format -- that
    // format is T9's own concern (RED), and folding it in here would make
    // these fail against the pre-AV-4 `getCharImage` for a reason unrelated
    // to eligibility (the pre-AV-4 `getCharImage` has no 'thumb'/'thumbcss'
    // case at all, so it wraps through the final `else` branch regardless of
    // eligibility).
    test('a loc not under assets/ never calls the thumbnail path, and falls straight to getFileSrc', async () => {
        await getCharImage('other/b.png', 'thumbcss')
        expect(getAvatarThumbSrcSpy).not.toHaveBeenCalled()
        expect(getFileSrcSpy).toHaveBeenCalledWith('other/b.png')
    })
})

describe('T10 (guard): existing types never call the thumbnail path', () => {
    test.each(['plain', 'css', 'lgcss', 'contain'] as const)('%s never calls getAvatarThumbSrc', async (type) => {
        const result = await getCharImage('assets/a.png', type)
        expect(getAvatarThumbSrcSpy).not.toHaveBeenCalled()
        expect(getFileSrcSpy).toHaveBeenCalledWith('assets/a.png')
        expect(typeof result === 'string' || result === null).toBe(true)
    })
})
