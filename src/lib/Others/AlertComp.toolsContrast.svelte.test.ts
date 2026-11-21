// @vitest-environment happy-dom

/**
 * The text of the tool dialogs of `AlertComp.svelte` against the colour painted under it, in every colour scheme.
 *
 * Drives the REAL `AlertComp.svelte` and the cascade model over the component's own classes and the pattern sheets
 * (`pattern-dialog.css`, `pattern-alert.css`, `pattern-alert-tools.css`), the way `AlertComp.shell.svelte.test.ts` does
 * for the headline. The text is composited over the row or panel under it, which is composited over the dialog surface.
 * The module mocks copy that suite.
 *
 * Every test here is a new-markup guard: it names parts that do not exist before the redesign. A part painted in a
 * colour that does not read fails it.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import 'src/ts/polyfill'

//#region module mocks (see file header)

const { getFetchLogsSpy, getFetchDataSpy, aiLawAppliesSpy } = vi.hoisted(() => ({
    getFetchLogsSpy: vi.fn(() => [] as unknown[]),
    getFetchDataSpy: vi.fn(() => ({}) as unknown),
    aiLawAppliesSpy: vi.fn(() => false),
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
            },
            getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
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
            getFetchLogs: getFetchLogsSpy,
            getFetchData: getFetchDataSpy,
            aiLawApplies: aiLawAppliesSpy,
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        getDatabase: vi.fn((_options?: { snapshot?: boolean }) => DBState.db),
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

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        MobileGUIStack: writable([]),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }),
        MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 },
        SettingsMenuIndex: writable(0),
        ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false),
        botMakerMode: writable(false),
        DynamicGUI: writable(false),
        sideBarClosing: writable(false),
        sideBarStore: writable({ tab: 0 }),
        PlaygroundStore: writable({ open: false }),
        QuickSettings: writable([]),
        additionalHamburgerMenu: writable([]),
        CharConfigSubMenu: writable(0),
        MobileGUI: writable(false),
        hypaV3ModalOpen: writable(false),
        ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false),
        alertGenerationInfoStore: writable(null),
        CustomCSSStore: { subscribe: vi.fn(), set: vi.fn() },
        SafeModeStore: { subscribe: vi.fn(), set: vi.fn() },
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock(import('../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        changeChar: vi.fn(),
    }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

vi.mock(import('../../ts/sourcemap'), () => ({
    translateStackTrace: vi.fn(async (stackTrace: string) => ({ didTranslate: false, stackTrace })),
}) as unknown as typeof import('../../ts/sourcemap'))

vi.mock(import('src/ts/gui/branches'), () => ({
    getChatBranches: vi.fn(() => []),
}) as unknown as typeof import('src/ts/gui/branches'))

vi.mock(import('src/ts/tokenizer'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        tokenize: vi.fn(async () => 7),
    }
})

//#endregion

import { tickFake } from '../../ts/tests/svelteTick.test-helpers'
import { language } from 'src/lang'
import { alertStore, DBState } from '../../ts/stores.svelte'
import { askPrompt, resetAlertPromptsForTests } from '../../ts/alertPrompts'
import {
    alertAddCharacter,
    alertCardExport,
    alertChatOptions,
    alertRequestData,
    alertRequestLogs,
    alertSelectChar,
    showHypaV2Alert,
} from '../../ts/alert'
import { getChatBranches } from 'src/ts/gui/branches'
import { colorSchemeList, updateColorScheme } from '../../ts/gui/colorscheme'
import { cr, parseConcrete, toHex, type Rgba } from '../../ts/themePack/colour'
import { CascadeModel, classCandidates, compileAppStyles, compileRules, compositeHex, readRepoFile, type RuleSet } from '../../styles/tests/cascadeModel'
import AlertComp from './AlertComp.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountAlertComp(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertComp, { target, props: {} }))
    return target
}

async function settle(): Promise<void> {
    flushSync()
    await tickFake()
    flushSync()
    await Promise.resolve()
}

function arrangeDatabase(): void {
    DBState.db = {
        characters: [
            { name: 'Alice', chaId: 'cha-a', type: 'character', image: '', chats: [], chatPage: 0 },
            { name: 'Bob', chaId: 'cha-b', type: 'character', image: '', chats: [], chatPage: 0 },
        ],
        modules: [],
        enabledModules: [],
        botPresets: [],
        botPresetsId: 0,
    } as unknown as Database
}

const rgbOf = (value: string | undefined): Rgba => {
    if (value === undefined) throw new Error('no painted colour')
    const c = parseConcrete(value.startsWith('#') ? value.slice(0, 7) : value)
    if (c === null) throw new Error(`unreadable colour ${value}`)
    return c
}

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.useRealTimers()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
    vi.clearAllMocks()
    getFetchLogsSpy.mockReset()
    getFetchLogsSpy.mockReturnValue([])
    getFetchDataSpy.mockReset()
    getFetchDataSpy.mockReturnValue({})
    aiLawAppliesSpy.mockReset()
    aiLawAppliesSpy.mockReturnValue(false)
})

describe('the choosers: text against the colour painted under it', () => {
    let rules: RuleSet

    beforeAll(async () => {
        rules = compileRules([
            await compileAppStyles(classCandidates(readRepoFile('src/lib/Others/AlertComp.svelte'))),
            { name: 'pattern-dialog', css: readRepoFile('src/lib/Nexus/pattern/pattern-dialog.css') },
            { name: 'pattern-alert', css: readRepoFile('src/lib/Nexus/pattern/pattern-alert.css') },
            { name: 'pattern-alert-tools', css: readRepoFile('src/lib/Nexus/pattern/pattern-alert-tools.css') },
        ])
    }, 120000)

    const TEXT_RATIO = 4.5
    const GLYPH_RATIO = 3

    /** The colour a part paints text in, composited over `under`, which is already opaque. */
    const textOver = (colour: string | undefined, under: string): Rgba => rgbOf(compositeHex(colour ?? '', under))

    async function openChooser(produce: () => Promise<unknown>, scheme: string): Promise<HTMLElement> {
        vi.useFakeTimers()
        arrangeDatabase()
        ;(DBState.db as unknown as Record<string, unknown>).colorSchemeName = scheme
        const target = mountAlertComp()
        await settle()
        void produce()
        await settle()
        document.documentElement.removeAttribute('style')
        updateColorScheme()
        flushSync()
        return target
    }

    test.each(colorSchemeList)('%s: the row title and description read at 4.5:1 on their rows, and the chevron at 3:1', async (scheme) => {
        const target = await openChooser(() => alertAddCharacter(), scheme)
        const m = new CascadeModel(rules)
        const box = target.querySelector<HTMLElement>('[data-part="pattern-dialog"][data-alert-box]')!
        const surface = toHex(rgbOf(m.painted(box)['background-color']))

        const rows = Array.from(target.querySelectorAll<HTMLElement>('[data-part="pattern-alert-row"]'))
        expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) {
            const rowTint = m.painted(row)['background-color']
            expect(rowTint, 'a row paints its raised surface').toBeDefined()
            const under = compositeHex(rowTint, surface)
            for (const part of ['pattern-alert-row-title', 'pattern-alert-row-desc']) {
                const el = row.querySelector<HTMLElement>(`[data-part="${part}"]`)
                if (el === null) continue
                const colour = m.painted(el).color
                expect(cr(textOver(colour, under), rgbOf(under)), `${scheme} ${part}: ${colour} on ${under}`).toBeGreaterThanOrEqual(TEXT_RATIO)
            }
            const chevron = row.querySelector<HTMLElement>('[aria-hidden="true"]')!
            const glyph = m.painted(chevron).color
            expect(cr(textOver(glyph, under), rgbOf(under)), `${scheme} chevron: ${glyph} on ${under}`).toBeGreaterThanOrEqual(GLYPH_RATIO)
        }
    })

    test.each(colorSchemeList)('%s: the chatOptions row titles read at 4.5:1', async (scheme) => {
        const target = await openChooser(() => alertChatOptions(), scheme)
        const m = new CascadeModel(rules)
        const box = target.querySelector<HTMLElement>('[data-part="pattern-dialog"][data-alert-box]')!
        const surface = toHex(rgbOf(m.painted(box)['background-color']))

        const titles = Array.from(target.querySelectorAll<HTMLElement>('[data-part="pattern-alert-row-title"]'))
        expect(titles).toHaveLength(2)
        for (const title of titles) {
            const row = title.closest<HTMLElement>('[data-part="pattern-alert-row"]')!
            const under = compositeHex(m.painted(row)['background-color'], surface)
            const colour = m.painted(title).color
            expect(cr(textOver(colour, under), rgbOf(under)), `${scheme}: ${colour} on ${under}`).toBeGreaterThanOrEqual(TEXT_RATIO)
        }
    })

    test.each(colorSchemeList)('%s: the avatar caption reads at 4.5:1 on the plain surface', async (scheme) => {
        const target = await openChooser(() => alertSelectChar(), scheme)
        const m = new CascadeModel(rules)
        const box = target.querySelector<HTMLElement>('[data-part="pattern-dialog"][data-alert-box]')!
        const surface = toHex(rgbOf(m.painted(box)['background-color']))

        const captions = Array.from(target.querySelectorAll<HTMLElement>('[data-part="pattern-alert-char-name"]'))
        expect(captions).toHaveLength(2)
        for (const caption of captions) {
            expect(m.painted(caption.closest<HTMLElement>('[data-part="pattern-alert-chars"]')!)['background-color'], 'no layer under the grid').toBeUndefined()
            const colour = m.painted(caption).color
            expect(cr(textOver(colour, surface), rgbOf(surface)), `${scheme}: ${colour} on ${surface}`).toBeGreaterThanOrEqual(TEXT_RATIO)
        }
    })
})

describe('the data viewers: text against the colour painted under it', () => {
    let rules: RuleSet

    // The global highlight sheet is compiled too, so a colour of it that leaks into the dialog shows up in the cascade.
    beforeAll(async () => {
        rules = compileRules([
            await compileAppStyles(classCandidates(readRepoFile('src/lib/Others/AlertComp.svelte'))),
            { name: 'pattern-dialog', css: readRepoFile('src/lib/Nexus/pattern/pattern-dialog.css') },
            { name: 'pattern-alert', css: readRepoFile('src/lib/Nexus/pattern/pattern-alert.css') },
            { name: 'pattern-alert-tools', css: readRepoFile('src/lib/Nexus/pattern/pattern-alert-tools.css') },
            { name: 'atom-one-dark', css: readRepoFile('node_modules/highlight.js/styles/atom-one-dark.min.css') },
        ])
    }, 120000)

    const TEXT_RATIO = 4.5
    const SEGMENT_RATIO = 3
    // The comment is not JSON, but the highlighter marks it; every token class the sheet does not name must read quietly too.
    const JSON_BODY = '{"a":"b","n":1,"t":true} // note'
    const LOGS = [
        { url: 'https://a.invalid/v1/one', body: JSON_BODY, header: '{"h":"1"}', response: '{"r":1}', success: true, status: 200, date: '10:41' },
        { url: 'https://a.invalid/v1/two', body: '{"b":2}', header: '{"h":"2"}', response: '{"r":2}', success: false, status: 500, date: '10:42' },
    ]

    function arrangeViewer(): void {
        DBState.db = {
            characters: [{
                name: 'Alice',
                chaId: 'cha-a',
                type: 'character',
                image: '',
                chatPage: 0,
                chats: [{
                    message: [{ role: 'char', data: 'Generated text', chatId: 'chat-id-1', saying: 'Alice', time: 0, promptInfo: undefined }],
                    hypaV2Data: { chunks: [{ text: 'chunk one' }], mainChunks: [{ text: 'summary one' }, { text: 'summary two' }] },
                }],
                additionalAssets: [],
            }],
            modules: [],
            enabledModules: [],
            botPresets: [],
            botPresetsId: 0,
            hotkeys: [],
        } as unknown as Database
    }

    async function openViewer(produce: () => unknown, scheme: string): Promise<HTMLElement> {
        vi.useFakeTimers()
        arrangeViewer()
        getFetchDataSpy.mockReturnValue({ url: 'https://x.invalid/v1', body: JSON_BODY, response: JSON_BODY })
        getFetchLogsSpy.mockReturnValue(LOGS)
        ;(DBState.db as unknown as Record<string, unknown>).colorSchemeName = scheme
        const target = mountAlertComp()
        await settle()
        void produce()
        await settle()
        document.documentElement.removeAttribute('style')
        updateColorScheme()
        flushSync()
        return target
    }

    const requestData = (scheme: string): Promise<HTMLElement> =>
        openViewer(() => alertRequestData({ genInfo: { inputTokens: 1, outputTokens: 1, maxContext: 10, model: 'm', generationId: 'g' }, idx: 0 } as never), scheme)

    async function pick(target: HTMLElement, label: string): Promise<void> {
        const tab = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
        if (!tab) throw new Error(`no button ${label}`)
        tab.click()
        await settle()
        document.documentElement.removeAttribute('style')
        updateColorScheme()
        flushSync()
    }

    const dialogOf = (target: HTMLElement): HTMLElement => target.querySelector<HTMLElement>('[data-part="pattern-dialog"][data-alert-box]')!

    /** The opaque colour painted under `el`: every background between the dialog and the element, composited in order. */
    function paintedUnder(m: CascadeModel, target: HTMLElement, el: Element): string {
        const box = dialogOf(target)
        let under = toHex(rgbOf(m.painted(box)['background-color']))
        const chain: Element[] = []
        for (let node: Element | null = el; node !== null && node !== box; node = node.parentElement) chain.unshift(node)
        for (const node of chain) {
            const bg = m.painted(node)['background-color']
            if (bg !== undefined) under = compositeHex(bg, under)
        }
        return under
    }

    function expectReadable(m: CascadeModel, target: HTMLElement, el: Element, ratio: number, label: string): void {
        const under = paintedUnder(m, target, el)
        const colour = m.painted(el).color
        expect(colour, `${label} paints a colour`).toBeDefined()
        expect(cr(textOver(colour, under), rgbOf(under)), `${label}: ${colour} on ${under}`).toBeGreaterThanOrEqual(ratio)
    }

    const textOver = (colour: string | undefined, under: string): Rgba => rgbOf(compositeHex(colour ?? '', under))

    test.each(colorSchemeList)('%s: the head close icon and the tab labels, selected and not, read at 4.5:1', async (scheme) => {
        const target = await requestData(scheme)
        const m = new CascadeModel(rules)

        expectReadable(m, target, target.querySelector('[data-part="pattern-alert-close"]')!, TEXT_RATIO, `${scheme} close`)
        const tabs = Array.from(target.querySelectorAll('[data-part="pattern-alert-tab"]'))
        expect(tabs).toHaveLength(4)
        expect(tabs.map((t) => t.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])
        tabs.forEach((tab, i) => expectReadable(m, target, tab, TEXT_RATIO, `${scheme} tab ${i}`))
    })

    test.each(colorSchemeList)('%s: the facts, the legend, the hint and the disclaimer read at 4.5:1; the meter reads at 3:1', async (scheme) => {
        aiLawAppliesSpy.mockReturnValue(true)
        const target = await requestData(scheme)
        const m = new CascadeModel(rules)

        for (const part of ['pattern-alert-note', 'pattern-warn-detail']) {
            const el = target.querySelector(`[data-part="${part}"]`)
            expect(el, `${part} is shown`).not.toBeNull()
            expectReadable(m, target, el!, TEXT_RATIO, `${scheme} ${part}`)
        }
        const legend = target.querySelector('[data-part="pattern-alert-legend"]')!
        for (const el of Array.from(legend.querySelectorAll('li, li > span:not([aria-hidden])'))) {
            expectReadable(m, target, el, TEXT_RATIO, `${scheme} legend ${el.tagName}`)
        }

        const meter = target.querySelector('[data-part="pattern-alert-meter"]')!
        const track = paintedUnder(m, target, meter)
        const fill = target.querySelector('[data-part="pattern-alert-meter-input"]')!
        const fillColour = compositeHex(m.painted(fill)['background-color'], track)
        expect(cr(rgbOf(fillColour), rgbOf(track)), `${scheme} meter fill ${fillColour} on track ${track}`).toBeGreaterThanOrEqual(SEGMENT_RATIO)

        await pick(target, language.metaData)
        const facts = target.querySelector('dl[data-part="pattern-alert-facts"]')!
        for (const el of Array.from(facts.querySelectorAll('dt, dd'))) {
            expectReadable(m, target, el, TEXT_RATIO, `${scheme} fact ${el.tagName}`)
        }
    })

    test.each(colorSchemeList)('%s: inside the code panel a key reads in the text colour and a value in the secondary colour, both at 4.5:1', async (scheme) => {
        const target = await requestData(scheme)
        await pick(target, language.log)
        const m = new CascadeModel(rules)

        const panels = Array.from(target.querySelectorAll('[data-part="pattern-alert-code"]'))
        const body = panels[1]
        expectReadable(m, target, body, TEXT_RATIO, `${scheme} panel`)
        const colourOf = (selector: string): string => {
            const el = body.querySelector(selector)
            expect(el, `${selector} is highlighted`).not.toBeNull()
            expectReadable(m, target, el!, TEXT_RATIO, `${scheme} ${selector}`)
            return toHex(rgbOf(m.painted(el!).color))
        }
        const key = colourOf('.hljs-attr')
        const values = ['.hljs-string', '.hljs-number', '.hljs-literal', '.hljs-punctuation', '.hljs-comment'].map(colourOf)
        expect(key, 'a key is the panel text colour').toBe(toHex(rgbOf(m.painted(body).color)))
        expect(new Set(values).size, 'values and punctuation share one colour').toBe(1)
        expect(values[0], 'a value is quieter than a key').not.toBe(key)
    })

    test.each(colorSchemeList)('%s: a request log row reads at 4.5:1 with its status, url and date', async (scheme) => {
        const target = await openViewer(() => alertRequestLogs(), scheme)
        await pick(target, language.expandAll)
        const m = new CascadeModel(rules)

        for (const part of ['pattern-alert-log-status', 'pattern-alert-log-url', 'pattern-alert-log-date', 'pattern-alert-code', 'pattern-alert-code-label']) {
            const els = Array.from(target.querySelectorAll(`[data-part="${part}"]`))
            expect(els.length, `${part} is shown`).toBeGreaterThan(0)
            els.forEach((el) => expectReadable(m, target, el, TEXT_RATIO, `${scheme} ${part}`))
        }
    })

    test.each(colorSchemeList)('%s: hypaV2 tabs and summary labels, active and not, read at 4.5:1', async (scheme) => {
        const target = await openViewer(() => showHypaV2Alert(), scheme)
        const m = new CascadeModel(rules)
        Array.from(target.querySelectorAll('[data-part="pattern-alert-tab"]')).forEach((tab, i) => expectReadable(m, target, tab, TEXT_RATIO, `${scheme} tab ${i}`))

        await pick(target, language.alertComp.summarized)
        const labels = Array.from(target.querySelectorAll('[data-part="pattern-alert-chunk-label"]'))
        expect(labels).toHaveLength(2)
        labels.forEach((label, i) => expectReadable(m, target, label, TEXT_RATIO, `${scheme} chunk label ${i}`))
    })
})

describe('the export dialog and the two prompts: text against the colour painted under it', () => {
    let rules: RuleSet

    beforeAll(async () => {
        rules = compileRules([
            await compileAppStyles(classCandidates(readRepoFile('src/lib/Others/AlertComp.svelte'))),
            await compileAppStyles(classCandidates(readRepoFile('src/lib/Others/PeerConflicts.svelte'))),
            await compileAppStyles(classCandidates(readRepoFile('src/lib/Others/ParkedReplyPrompt.svelte'))),
            { name: 'pattern-dialog', css: readRepoFile('src/lib/Nexus/pattern/pattern-dialog.css') },
            { name: 'pattern-alert', css: readRepoFile('src/lib/Nexus/pattern/pattern-alert.css') },
            { name: 'pattern-alert-tools', css: readRepoFile('src/lib/Nexus/pattern/pattern-alert-tools.css') },
        ])
    }, 120000)

    const TEXT_RATIO = 4.5
    const GLYPH_RATIO = 3
    const PEER_ROWS = [
        { id: 'a', label: 'Setting: zoomsize', choices: ['mine', 'theirs', 'both'], preselect: 'both', note: 'restore note' },
        { id: 'c', label: 'Ann was deleted there', choices: ['mine', 'theirs'], preselect: 'mine', note: null },
    ]

    async function open(produce: () => unknown, scheme: string): Promise<HTMLElement> {
        vi.useFakeTimers()
        arrangeDatabase()
        ;(DBState.db as unknown as Record<string, unknown>).colorSchemeName = scheme
        const target = mountAlertComp()
        await settle()
        void produce()
        await settle()
        document.documentElement.removeAttribute('style')
        updateColorScheme()
        flushSync()
        return target
    }

    const textOver = (colour: string | undefined, under: string): Rgba => rgbOf(compositeHex(colour ?? '', under))

    /** The opaque colour painted under `el`: every background between the dialog and the element, composited in order. */
    function paintedUnder(m: CascadeModel, target: HTMLElement, el: Element): string {
        const box = target.querySelector<HTMLElement>('[data-part="pattern-dialog"][data-alert-box]')!
        let under = toHex(rgbOf(m.painted(box)['background-color']))
        const chain: Element[] = []
        for (let node: Element | null = el; node !== null && node !== box; node = node.parentElement) chain.unshift(node)
        for (const node of chain) {
            const bg = m.painted(node)['background-color']
            if (bg !== undefined) under = compositeHex(bg, under)
        }
        return under
    }

    function expectReadable(m: CascadeModel, target: HTMLElement, el: Element, ratio: number, label: string): void {
        const under = paintedUnder(m, target, el)
        const colour = m.painted(el).color
        expect(colour, `${label} paints a colour`).toBeDefined()
        expect(cr(textOver(colour, under), rgbOf(under)), `${label}: ${colour} on ${under}`).toBeGreaterThanOrEqual(ratio)
    }

    const exportAs = (scheme: string): Promise<HTMLElement> => open(() => alertCardExport(''), scheme)

    async function press(target: HTMLElement, label: string): Promise<void> {
        const button = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
        if (!button) throw new Error(`no button ${label}`)
        button.click()
        await settle()
        document.documentElement.removeAttribute('style')
        updateColorScheme()
        flushSync()
    }

    test.each(colorSchemeList)('%s: the tile labels and the warning line read at 4.5:1 and the warning mark at 3:1 on its fill', async (scheme) => {
        const target = await exportAs(scheme)
        await press(target, 'Character Card V2')
        const m = new CascadeModel(rules)

        const tiles = Array.from(target.querySelectorAll('[data-part="pattern-alert-tile"]'))
        expect(tiles.map((t) => t.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
        tiles.forEach((tile, i) => expectReadable(m, target, tile, TEXT_RATIO, `${scheme} tile ${i}`))
        for (const part of ['pattern-alert-field-label', 'pattern-alert-note', 'pattern-alert-warning']) {
            const el = target.querySelector(`[data-part="${part}"]`)
            expect(el, `${part} is shown`).not.toBeNull()
            expectReadable(m, target, el!, TEXT_RATIO, `${scheme} ${part}`)
        }
        const mark = target.querySelector('[data-part="pattern-alert-warning-mark"]')!
        const fill = compositeHex(m.painted(mark)['background-color'], paintedUnder(m, target, mark.parentElement!))
        const glyph = compositeHex(m.painted(mark).color, fill)
        expect(cr(rgbOf(glyph), rgbOf(fill)), `${scheme} mark glyph ${glyph} on ${fill}`).toBeGreaterThanOrEqual(GLYPH_RATIO)
    })

    test.each(colorSchemeList)('%s: the confirm label reads at 4.5:1 on its fill, in the export footer and in both prompts', async (scheme) => {
        const exported = await exportAs(scheme)
        const m = new CascadeModel(rules)
        const confirmOf = (target: HTMLElement): HTMLElement => target.querySelector<HTMLElement>('[data-part="pattern-warn-actions"] .pattern-button[data-variant="confirm"]')!
        const check = (target: HTMLElement, label: string): void => {
            const button = confirmOf(target)
            expect(button, `${label} has a confirm button`).not.toBeNull()
            const fill = compositeHex(m.painted(button)['background-color'], paintedUnder(m, target, button.parentElement!))
            const text = compositeHex(m.painted(button).color, fill)
            expect(cr(rgbOf(text), rgbOf(fill)), `${scheme} ${label}: ${text} on ${fill}`).toBeGreaterThanOrEqual(TEXT_RATIO)
        }
        check(exported, 'export')
        for (const t of mountedTargets.splice(0)) t.remove()
        for (const instance of mountedInstances.splice(0)) await unmount(instance as never).catch(() => {})
        alertStore.set({ type: 'none', msg: '' } as never)
        resetAlertPromptsForTests()

        const parked = await open(() => askPrompt({ type: 'parkedReply', msg: language.parkedReplyTitle, parkedReply: { name: 'Alice', text: 'The reply text' } }), scheme)
        check(parked, 'parkedReply')
    })

    test.each(colorSchemeList)('%s: the peerConflicts title, bulk label, legends, choices and note read at 4.5:1 on the raised fieldset', async (scheme) => {
        const target = await open(() => askPrompt({ type: 'peerConflicts', msg: 'Conflicts', peerConflicts: PEER_ROWS } as never), scheme)
        const m = new CascadeModel(rules)

        expectReadable(m, target, target.querySelector('[data-part="pattern-alert-title"]')!, TEXT_RATIO, `${scheme} title`)
        expectReadable(m, target, target.querySelector('[data-part="pattern-alert-bulk"] > span')!, TEXT_RATIO, `${scheme} bulk label`)
        expectReadable(m, target, target.querySelector('[data-part="pattern-alert-conflict"] > legend')!, TEXT_RATIO, `${scheme} legend`)
        const choices = Array.from(target.querySelectorAll('[data-part="pattern-alert-choice"]'))
        expect(choices).toHaveLength(5)
        choices.forEach((choice, i) => expectReadable(m, target, choice, TEXT_RATIO, `${scheme} choice ${i}`))
        expectReadable(m, target, target.querySelector('[data-part="pattern-alert-note"]')!, TEXT_RATIO, `${scheme} note`)
    })

    test.each(colorSchemeList)('%s: the parked reply title, body, panel text and status read at 4.5:1', async (scheme) => {
        const target = await open(() => askPrompt({ type: 'parkedReply', msg: language.parkedReplyTitle, parkedReply: { name: 'Alice', text: 'The reply text' } }), scheme)
        const m = new CascadeModel(rules)

        for (const selector of ['[data-part="pattern-alert-title"]', '[data-part="pattern-alert-text"]', '[data-part="pattern-alert-reply"]', '[data-part="pattern-alert-reply-tools"] > span']) {
            const el = target.querySelector(selector)
            expect(el, `${selector} is shown`).not.toBeNull()
            expectReadable(m, target, el!, TEXT_RATIO, `${scheme} ${selector}`)
        }
    })
})

describe('the branch tree: the preview text, the lines, the node edge and the focus ring against the surface', () => {
    let rules: RuleSet

    beforeAll(async () => {
        rules = compileRules([
            await compileAppStyles(classCandidates(readRepoFile('src/lib/Others/AlertComp.svelte'))),
            { name: 'pattern-dialog', css: readRepoFile('src/lib/Nexus/pattern/pattern-dialog.css') },
            { name: 'pattern-alert', css: readRepoFile('src/lib/Nexus/pattern/pattern-alert.css') },
            { name: 'pattern-alert-tools', css: readRepoFile('src/lib/Nexus/pattern/pattern-alert-tools.css') },
        ])
    }, 120000)

    const TEXT_RATIO = 4.5
    const NON_TEXT_RATIO = 3
    // One of each link kind: a straight run, a branch, and its elbow.
    const NODES = [
        { x: 0, y: 0, chatId: 0, connectX: -1, connectY: -1, multiChild: false, content: '' },
        { x: 0, y: 1, chatId: 0, connectX: 0, connectY: 0, multiChild: false, content: '' },
        { x: 0, y: 2, chatId: 0, connectX: 0, connectY: 1, multiChild: true, content: '' },
        { x: 1, y: 2, chatId: 1, connectX: 0, connectY: 1, multiChild: true, content: '' },
    ]

    async function openTree(scheme: string): Promise<HTMLElement> {
        vi.useFakeTimers()
        arrangeDatabase()
        const owner = DBState.db.characters[0] as unknown as Record<string, unknown>
        owner.firstMessage = 'Hello'
        owner.alternateGreetings = []
        owner.chats = [
            { message: [{ role: 'user', data: 'one' }, { role: 'char', data: 'two' }] },
            { message: [{ role: 'user', data: 'other' }, { role: 'char', data: 'branch text' }] },
        ]
        ;(DBState.db as unknown as Record<string, unknown>).colorSchemeName = scheme
        vi.mocked(getChatBranches).mockReturnValue(NODES as never)
        const target = mountAlertComp()
        await settle()
        alertStore.set({ type: 'branches', msg: '' } as never)
        await settle()
        document.documentElement.removeAttribute('style')
        updateColorScheme()
        flushSync()
        return target
    }

    afterEach(() => {
        vi.mocked(getChatBranches).mockReturnValue([])
    })

    const surfaceOf = (m: CascadeModel, target: HTMLElement): string =>
        toHex(rgbOf(m.painted(target.querySelector<HTMLElement>('[data-part="pattern-dialog"][data-alert-box]')!)['background-color']))
    const against = (colour: string | undefined, surface: string): number => {
        expect(colour, 'a painted colour').toBeDefined()
        return cr(rgbOf(compositeHex(colour ?? '', surface)), rgbOf(surface))
    }

    test.each(colorSchemeList)('%s: the preview text reads at 4.5:1 on its raised panel', async (scheme) => {
        const target = await openTree(scheme)
        target.querySelector('[data-part="pattern-alert-tree-node"]')!.dispatchEvent(new MouseEvent('mouseenter'))
        await settle()
        document.documentElement.removeAttribute('style')
        updateColorScheme()
        flushSync()
        const m = new CascadeModel(rules)
        const preview = target.querySelector<HTMLElement>('[data-part="pattern-alert-tree-preview"]')!
        const surface = surfaceOf(m, target)
        const panel = compositeHex(m.painted(preview)['background-color'], surface)
        const colour = m.painted(preview).color
        expect(cr(rgbOf(compositeHex(colour, panel)), rgbOf(panel)), `${scheme}: ${colour} on ${panel}`).toBeGreaterThanOrEqual(TEXT_RATIO)
    })

    test.each(colorSchemeList)('%s: the straight and the branch lines and the node edge read at 3:1 against the surface', async (scheme) => {
        const target = await openTree(scheme)
        const m = new CascadeModel(rules)
        const surface = surfaceOf(m, target)

        const links = Array.from(target.querySelectorAll<HTMLElement>('[data-part="pattern-alert-tree-link"]'))
        expect(new Set(links.map((l) => l.getAttribute('data-kind')))).toEqual(new Set(['line', 'branch']))
        for (const link of links) {
            const painted = m.painted(link)
            const colour = painted['border-left-color'] ?? painted['border-top-color']
            expect(against(colour, surface), `${scheme} ${link.getAttribute('data-kind')} ${link.getAttribute('data-axis')}: ${colour} on ${surface}`).toBeGreaterThanOrEqual(NON_TEXT_RATIO)
        }
        const node = target.querySelector<HTMLElement>('[data-part="pattern-alert-tree-node"]')!
        const edge = m.painted(node)['border-top-color']
        expect(against(edge, surface), `${scheme} node edge: ${edge} on ${surface}`).toBeGreaterThanOrEqual(NON_TEXT_RATIO)
    })

    test.each(colorSchemeList)('%s: the focus ring of a node reads at 3:1 against the surface', async (scheme) => {
        const target = await openTree(scheme)
        const node = target.querySelector<HTMLElement>('[data-part="pattern-alert-tree-node"]')!
        const m = new CascadeModel(rules, { focused: node })
        const surface = surfaceOf(m, target)

        const ring = m.painted(node)['outline-color']
        expect(against(ring, surface), `${scheme} ring: ${ring} on ${surface}`).toBeGreaterThanOrEqual(NON_TEXT_RATIO)
    })
})
