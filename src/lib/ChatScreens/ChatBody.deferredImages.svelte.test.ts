// @vitest-environment jsdom

/**
 * Mounts the real `ChatBody.svelte` with the real `trimMarkdown` (DOMPurify under jsdom), the real size cache and the
 * real deferred-image loader. Only `ParseMarkdown` is a held double, the stored size comes from a mocked stat, and the
 * image markup has the shape `parseAdditionalAssets` produces. A large asset image of an Android chat body keeps its
 * real `src` back until the app-wide queue grants it, and shows the same box as a pending image meanwhile.
 *
 * Labels: G = guard (passes before and after the change); the other rows fail on the base or under their mutant.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import { clearChatBodyRenderCache } from './chatBodyRenderCache'
import ChatBodyBoundRootHarness from './ChatBodyBoundRootHarness.svelte'

//#region module mocks

interface Held {
    resolve: (value: string) => void
}

const h = vi.hoisted(() => ({
    parses: [] as Held[],
    transport: { android: true, sizes: {} as Record<string, number> },
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: {} as Record<string, unknown> })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
    }
})

vi.mock('src/ts/parser/parser.svelte', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/parser/parser.svelte')>()
    return {
        ...actual,
        ParseMarkdown: vi.fn(() => new Promise<string>((resolve) => { h.parses.push({ resolve }) })),
    }
})

vi.mock('src/ts/translator/translator', () => ({
    getLLMCache: async () => null,
    waitForTranslatorModules: async () => {},
    translateHTML: vi.fn(() => new Promise<string>(() => {})),
}))

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
    alertWait: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', async () => {
    const stores = await import('src/ts/stores.svelte')
    type CharShape = { chats?: unknown[], chatPage?: number }
    const db = () => (stores.DBState as unknown as { db: Record<string, unknown> }).db
    const getCurrentCharacter = () => (db().characters as CharShape[] | undefined)?.[0]
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats?.[char.chatPage ?? 0]
    }
    return { appVer: '1234.5.67', getDatabase: db, getCurrentCharacter, getCurrentChat }
})

vi.mock('src/ts/process/modules', () => ({
    getModuleAssets: () => [],
    getModuleRegexScripts: () => [],
    moduleUpdate: () => {},
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: async (path: string) => 'http://asset.localhost/' + path,
    setUsingSw: vi.fn(),
    readImage: vi.fn(),
}))

vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => ({
    ...(await importOriginal()),
    isAndroidTransport: () => h.transport.android,
    statStoredSize: async (key: string) => h.transport.sizes[key] ?? 0,
}))

vi.mock('src/ts/process/files/inlays', () => ({ getInlayRender: vi.fn(async () => null) }))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { addMetadataToElement, trimMarkdown } from 'src/ts/parser/parser.svelte'
import {
    DEFERRED_IMAGE_PLACEHOLDER_SRC, DEFERRED_IMAGE_SRC_ATTRIBUTE, androidAssetSizeVerdict, rememberWholeReadUrl, resetAssetUrlGateForTest,
} from 'src/ts/storage/assetUrlGate'
import { resetDeferredImagesForTest } from './deferredAssetImages'
import ChatBody from './ChatBody.svelte'

const MIB = 1024 * 1024
const URL_OF = (key: string) => 'http://asset.localhost/' + key

/** Reports every observed element as inside the margin, one microtask after `observe`. */
class AutoObserver {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(element: Element) {
        queueMicrotask(() => this.callback([{ target: element, isIntersecting: true }] as never, this as never))
    }
    unobserve() {}
    disconnect() {}
}
Object.defineProperty(AutoObserver.prototype, 'scrollMargin', { get: () => '' })

const mounted: Array<{ target: HTMLElement, instance: Record<string, unknown> }> = []

function setDb(over: Record<string, unknown> = {}) {
    DBState.db = {
        translatorType: 'google',
        translator: 'ko',
        translatorInputLanguage: 'en',
        aiModel: 'gpt',
        autoTranslate: false,
        autoTranslateCachedOnly: false,
        translateBeforeHTMLFormatting: false,
        legacyTranslation: false,
        showTranslationLoading: false,
        newImageHandlingBeta: false,
        hideAllImages: false,
        characters: [{
            chaId: 'a', type: 'character', chatPage: 0, modules: [], customscript: [],
            chats: [{ id: 'cA', modules: [], message: [] }],
        }],
        modules: [],
        enabledModules: [],
        moduleIntergration: '',
        personas: [],
        ...over,
    } as never
}

/** Seeds like production: the size through the real probe, the URL through the registry `getFileSrc` fills. */
async function seed(key: string, mib: number) {
    h.transport.sizes[key] = mib * MIB
    await androidAssetSizeVerdict(key)
    rememberWholeReadUrl(URL_OF(key), key)
}

/** The markup `parseAdditionalAssets` returns for an asset image. */
const assetImage = (key: string) => `<img src="${URL_OF(key)}" alt="${key}" style="max-width:100%; "/>`

function baseProps(target: HTMLElement | null | undefined) {
    const props: Record<string, unknown> = {
        character: 'char',
        idx: 0,
        msgDisplay: 'FIRST',
        role: 'char',
        translated: false,
        translating: false,
        retranslate: false,
        renderRevision: 0,
        modelShortName: '',
    }
    if (target !== undefined) {
        props.bodyRoot = target
    }
    return props
}

function mountBody(withRoot = true) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(ChatBody, { target, props: baseProps(withRoot ? target : undefined) as never }) as Record<string, unknown>
    flushSync()
    mounted.push({ target, instance })
    return { target, unmountBody: () => unmount(instance) }
}

async function flushAll() {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await tick()
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    flushSync()
}

async function answerParse(index: number, text: string) {
    h.parses[index].resolve(text)
    await flushAll()
}

const imgs = (target: HTMLElement) => Array.from(target.querySelectorAll('img'))
const realOf = (target: HTMLElement) => imgs(target).filter((img) => img.getAttribute('src')?.startsWith('http:'))
const loadAll = async (target: HTMLElement) => {
    const loading = realOf(target)
    for (const img of loading) {
        img.dispatchEvent(new Event('load'))
    }
    await flushAll()
}

beforeEach(() => {
    h.parses.length = 0
    h.transport.android = true
    h.transport.sizes = {}
    clearChatBodyRenderCache()
    resetAssetUrlGateForTest()
    resetDeferredImagesForTest()
    vi.stubGlobal('IntersectionObserver', AutoObserver)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    setDb()
})

afterEach(async () => {
    for (const row of mounted.splice(0)) {
        await unmount(row.instance).catch(() => {})
        row.target.remove()
    }
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

const KEYS = ['one', 'two', 'three', 'four']

describe('four 60 MiB images in one message', () => {
    test('T4: one image has its real source, the rest wait, and each load admits the next', async () => {
        for (const key of KEYS) {
            await seed(key, 60)
        }
        const body = mountBody()
        await answerParse(0, KEYS.map(assetImage).join(''))

        expect(imgs(body.target)).toHaveLength(4)
        expect(realOf(body.target)).toHaveLength(1)
        for (const img of imgs(body.target).filter((i) => !realOf(body.target).includes(i))) {
            expect(img.getAttribute('src')).toBe(DEFERRED_IMAGE_PLACEHOLDER_SRC)
            expect(img.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)).toBe(true)
            expect(img.getAttribute('alt')).not.toBeNull()
        }

        for (let step = 1; step <= 3; step++) {
            await loadAll(body.target)
            expect(realOf(body.target)).toHaveLength(step + 1)
        }
        expect(body.target.querySelector(`[${DEFERRED_IMAGE_SRC_ATTRIBUTE}]`)).toBeNull()
    })

    test('T5: with the Beta image handling no image is marked noimage and all four show', async () => {
        setDb({ newImageHandlingBeta: true })
        for (const key of KEYS) {
            await seed(key, 60)
        }
        const body = mountBody()
        await answerParse(0, KEYS.map(assetImage).join(''))

        expect(realOf(body.target)).toHaveLength(1)
        expect(body.target.querySelector('[noimage]')).toBeNull()
        for (let step = 1; step <= 3; step++) {
            await loadAll(body.target)
            expect(body.target.querySelector('[noimage]')).toBeNull()
        }
        expect(realOf(body.target)).toHaveLength(4)
    })

    test('T6 G: off Android the body is the plain sanitized markup', async () => {
        h.transport.android = false
        for (const key of KEYS) {
            await seed(key, 60)
            rememberWholeReadUrl(URL_OF(key), key)
        }
        const markup = KEYS.map(assetImage).join('')
        const body = mountBody()
        await answerParse(0, markup)

        expect(body.target.innerHTML.replaceAll('<!---->', '')).toBe(addMetadataToElement(trimMarkdown(markup), ''))
        expect(realOf(body.target)).toHaveLength(4)
    })

    test('T7 G: images of 6 MiB all get their real source at once', async () => {
        for (const key of KEYS) {
            await seed(key, 6)
        }
        const body = mountBody()
        await answerParse(0, KEYS.map(assetImage).join(''))

        expect(realOf(body.target)).toHaveLength(4)
        expect(body.target.querySelector(`[${DEFERRED_IMAGE_SRC_ATTRIBUTE}]`)).toBeNull()
    })
})

describe('the sanitizer', () => {
    test('T8 G: another caller of trimMarkdown keeps every source', async () => {
        for (const key of KEYS) {
            await seed(key, 60)
        }
        const out = trimMarkdown(KEYS.map(assetImage).join(''))

        for (const key of KEYS) {
            expect(out).toContain(`src="${URL_OF(key)}"`)
        }
        expect(out).not.toContain(DEFERRED_IMAGE_SRC_ATTRIBUTE)
        expect(trimMarkdown(assetImage('one'), { deferLargeAssetImages: true })).toContain(DEFERRED_IMAGE_SRC_ATTRIBUTE)
    })

    test('T9: an author\'s own deferred attribute is dropped and never promoted', async () => {
        const authored = '<img data-risu-deferred-src="http://asset.localhost/x" alt=x>'
        expect(trimMarkdown(authored, { deferLargeAssetImages: true })).not.toContain(DEFERRED_IMAGE_SRC_ATTRIBUTE)

        const body = mountBody()
        await answerParse(0, authored)

        const img = body.target.querySelector('img')
        expect(img?.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)).toBe(false)
        expect(img?.hasAttribute('src')).toBe(false)
    })
})

describe('the wrapper binds after the markup is shown', () => {
    const SOURCE_PROPS = baseProps(undefined)

    /** A first body without a wrapper records the render cache; the next mount of the same row then shows the cached markup. */
    async function recordCache() {
        await seed('one', 60)
        const first = mountBody(false)
        await answerParse(0, assetImage('one'))
        expect(realOf(first.target)).toHaveLength(1)
        await first.unmountBody()
    }

    test('T16: a body mounted with a null wrapper promotes its cached image once the wrapper is set', async () => {
        await recordCache()
        const target = document.createElement('div')
        document.body.appendChild(target)
        const props = $state({ ...SOURCE_PROPS, bodyRoot: null as HTMLElement | null })
        const instance = mount(ChatBody, { target, props: props as never }) as Record<string, unknown>
        mounted.push({ target, instance })
        flushSync()

        const img = target.querySelector('img')
        expect(img?.getAttribute('src')).toBe(DEFERRED_IMAGE_PLACEHOLDER_SRC)

        props.bodyRoot = target
        await flushAll()
        expect(target.querySelector('img')?.getAttribute('src')).toBe(URL_OF('one'))
        expect(target.querySelector('img')?.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)).toBe(false)
    })

    test('T16a: the same through a real bind:this wrapper', async () => {
        await recordCache()
        const target = document.createElement('div')
        document.body.appendChild(target)
        const instance = mount(ChatBodyBoundRootHarness, { target, props: { bodyProps: SOURCE_PROPS as never } }) as Record<string, unknown>
        mounted.push({ target, instance })
        flushSync()
        await flushAll()

        expect(target.querySelector('img')?.getAttribute('src')).toBe(URL_OF('one'))
        expect(target.querySelector('img')?.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)).toBe(false)
    })

    test('T17 G: a body mounted without a wrapper prop never defers', async () => {
        await seed('one', 60)
        const body = mountBody(false)
        await answerParse(0, assetImage('one'))

        expect(body.target.querySelector('img')?.getAttribute('src')).toBe(URL_OF('one'))
        expect(body.target.querySelector(`[${DEFERRED_IMAGE_SRC_ATTRIBUTE}]`)).toBeNull()
    })
})
