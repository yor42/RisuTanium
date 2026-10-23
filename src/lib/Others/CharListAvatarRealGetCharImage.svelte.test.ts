// @vitest-environment happy-dom

/**
 * `CharListAvatar.svelte` through the REAL `getCharImage` and the REAL thumbnail module: an abandoned
 * lookup must not read the full-size file and must not leave a style in the avatar's style cache.
 * `CharListAvatar.svelte.test.ts` replaces `getCharImage` entirely, so it cannot show either defect.
 *
 * MOCKED: `localforage` (inert), `src/ts/globalApi.svelte` (`getFileSrc` is a counting spy),
 * `src/ts/storage/database.svelte`, `src/ts/platform`, `@tauri-apps/plugin-fs` and `src/ts/stores.svelte`
 * (a thin reactive stand-in), the same set as `getCharImageThumb.svelte.test.ts`. The thumbnail store and
 * generator are injected through the module's test hooks.
 *
 * Test labels: the first two tests are reproducers, red against the base where an aborted lookup still
 * reaches `getFileSrc` and still stores the full-size style; the third is a guard.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from 'src/ts/platform'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const { getFileSrcSpy } = vi.hoisted(() => ({
    getFileSrcSpy: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
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
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => DBState.db),
        getCurrentCharacter: vi.fn(() => DBState.db.characters?.[0]),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/platform'), () => ({
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

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { hideAllImages: false } as unknown as Database })
    return {
        DBState: state,
        selectedCharID: { subscribe: () => () => {} },
        MobileGUIStack: { subscribe: () => () => {} },
        CharEmotion: { subscribe: () => () => {} },
        OpenRealmStore: { subscribe: () => () => {} },
        selIdState: { state: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

import CharListAvatar, { resetCharListAvatarCacheForTest } from './CharListAvatar.svelte'
import { __avatarThumbTestHooks, getAvatarThumbSrc } from 'src/ts/media/avatarThumb'

type Release = (result: { src: string } | null) => void

let started: string[] = []
let releases = new Map<string, Release>()
let mounted: { app: Record<string, unknown>; target: HTMLElement } | null = null

beforeEach(() => {
    resetCharListAvatarCacheForTest()
    __avatarThumbTestHooks.reset()
    __avatarThumbTestHooks.setReadbackCheck(() => true)
    __avatarThumbTestHooks.setStore({
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
        iterate: async () => {},
    })
    __avatarThumbTestHooks.setLimits({ concurrency: 1 })
    started = []
    releases = new Map()
    __avatarThumbTestHooks.setGenerator((loc) => new Promise((resolve) => {
        started.push(loc)
        releases.set(loc, resolve)
    }))
    getFileSrcSpy.mockClear()
})

afterEach(async () => {
    await unmountAvatar()
    __avatarThumbTestHooks.reset()
})

function mountAvatar(src: string): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = { app: mount(CharListAvatar, { target, props: { src } as never }) as Record<string, unknown>, target }
    flushSync()
    return target
}

async function unmountAvatar(): Promise<void> {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
        mounted = null
    }
}

async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve()
        flushSync()
    }
}

const styleOf = (el: Element): string => el.getAttribute('style') ?? ''

describe('CharListAvatar over the real getCharImage and thumbnail module', () => {
    // The only slot is held by a running task, so the avatar's task is queued; the generator returns null,
    // which on the base sends the gone avatar's lookup on to the full-size read and the style cache.
    test('an avatar that goes away while its thumbnail is queued neither generates, nor reads the full-size file, nor leaves a style', async () => {
        const holder = getAvatarThumbSrc('assets/hold.png')
        await settle()
        expect(started).toEqual(['assets/hold.png'])

        mountAvatar('assets/a.png')
        await settle()
        await unmountAvatar()

        releases.get('assets/hold.png')!({ src: 'src-hold' })
        await holder
        await settle()
        expect(started).toEqual(['assets/hold.png'])
        expect(getFileSrcSpy).not.toHaveBeenCalled()

        const again = mountAvatar('assets/a.png')
        expect(styleOf(again.querySelector('.ico')!)).toBe('')
        await settle()
        expect(started).toEqual(['assets/hold.png', 'assets/a.png'])
    })

    // The task is already running when the avatar goes away, so it finishes; its null result must not
    // lead the abandoned lookup to the full-size read.
    test('an avatar that goes away while its thumbnail is generated does not read the full-size file, and a new avatar asks again', async () => {
        mountAvatar('assets/a.png')
        await settle()
        expect(started).toEqual(['assets/a.png'])
        await unmountAvatar()

        releases.get('assets/a.png')!(null)
        await settle()
        expect(getFileSrcSpy).not.toHaveBeenCalled()

        const again = mountAvatar('assets/a.png')
        expect(styleOf(again.querySelector('.ico')!)).toBe('')
        await settle()
        expect(started).toEqual(['assets/a.png', 'assets/a.png'])
    })

    // GUARD (green on the base too): a live avatar still gets the full-size style when the thumbnail is null.
    test('a live avatar whose thumbnail came back null still paints the full-size style', async () => {
        const target = mountAvatar('assets/a.png')
        await settle()
        releases.get('assets/a.png')!(null)
        await settle()
        expect(getFileSrcSpy).toHaveBeenCalledWith('assets/a.png')
        expect(styleOf(target.querySelector('.ico')!)).toContain('data:mock-image;loc=assets/a.png')
    })
})
