// @vitest-environment happy-dom

/**
 * The alert shell of `AlertComp.svelte`: every alert type renders inside the pattern's layer, scrim and dialog, with
 * the severity edge and mark, a role, and ids that its labelled/described references resolve to.
 *
 * Drives the REAL `AlertComp.svelte` over a real `writable` standing in for `alertStore` and the real alert functions.
 * The module mocks copy `AlertComp.focusBox.svelte.test.ts`: none of it is exercised here, the component needs it to mount.
 *
 * Tests whose title starts with `guard:` pass with or without the restyle: they pin answers that must be preserved.
 * Every other test fails while the behaviour it names is missing.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import 'src/ts/polyfill'

//#region module mocks (see file header)

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
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
            aiLawApplies: vi.fn(() => false),
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

//#endregion

import { tickFake } from '../../ts/tests/svelteTick.test-helpers'
import { language } from 'src/lang'
import { alertStore, DBState } from '../../ts/stores.svelte'
import { ANSWER_GUARD_MS, resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { alertConfirm, alertGenerationInfoStore, type alertData } from '../../ts/alert'
import { colorSchemeList, updateColorScheme } from '../../ts/gui/colorscheme'
import { cr, parseConcrete, toHex, type Rgba } from '../../ts/themePack/colour'
import { CascadeModel, classCandidates, compileAppStyles, compileRules, compositeHex, readRepoFile, type RuleSet } from '../../styles/tests/cascadeModel'
import AlertComp from './AlertComp.svelte'

type Severity = 'notice' | 'caution' | 'confirm' | 'danger'
type Role = 'alertdialog' | 'dialog'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []
const originalMatchMedia = window.matchMedia

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

async function show(value: alertData): Promise<void> {
    alertStore.set(value as never)
    await settle()
}

function arrangeDatabase(): void {
    DBState.db = {
        characters: [{
            name: 'Alice',
            chats: [{ message: [], hypaV2Data: { chunks: [], mainChunks: [] } }],
            chatPage: 0,
        }],
        modules: [],
        enabledModules: [],
        botPresets: [],
        botPresetsId: 0,
    } as unknown as Database
    alertGenerationInfoStore.set({
        genInfo: { inputTokens: 1, outputTokens: 1, maxContext: 10, model: 'm', generationId: 'g' },
        idx: 0,
    } as never)
}

/** Stubs the viewport query; the returned function fires a change to `matches`. */
function stubViewport(matches: boolean): (next: boolean) => void {
    const listeners = new Set<(event: MediaQueryListEvent) => void>()
    window.matchMedia = ((media: string) => ({
        matches,
        media,
        onchange: null,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    return (next) => {
        for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent)
        flushSync()
    }
}

function buttonNamed(target: HTMLElement, name: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === name)
    if (!found) throw new Error(`no button named "${name}" is mounted`)
    return found
}

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    window.matchMedia = originalMatchMedia
    vi.useRealTimers()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
    vi.clearAllMocks()
})

/** Every alert type of the shared box, shaped the way its caller posts it, with the severity and role the shell gives it. */
const SHARED_BOX: Array<[alertData['type'], alertData, Severity, Role]> = [
    ['error', { type: 'error', msg: 'A failure' }, 'danger', 'alertdialog'],
    ['ask', { type: 'ask', msg: 'Proceed?' }, 'confirm', 'alertdialog'],
    ['select', { type: 'select', msg: 'One||Two' }, 'confirm', 'alertdialog'],
    ['input', { type: 'input', msg: 'Name?', datalist: [], defaultValue: '' }, 'confirm', 'alertdialog'],
    ['selectChar', { type: 'selectChar', msg: '' }, 'confirm', 'dialog'],
    ['addchar', { type: 'addchar', msg: '' }, 'confirm', 'dialog'],
    ['chatOptions', { type: 'chatOptions', msg: '' }, 'confirm', 'dialog'],
    ['normal', { type: 'normal', msg: 'A notice' }, 'notice', 'dialog'],
    ['markdown', { type: 'markdown', msg: 'Some **text**' }, 'notice', 'dialog'],
    ['requestdata', { type: 'requestdata', msg: '' }, 'notice', 'dialog'],
    ['hypaV2', { type: 'hypaV2', msg: '' }, 'notice', 'dialog'],
    ['requestlogs', { type: 'requestlogs', msg: '' }, 'notice', 'dialog'],
    ['branches', { type: 'branches', msg: '' }, 'notice', 'dialog'],
    ['cardexport', { type: 'cardexport', msg: '', submsg: '' }, 'confirm', 'dialog'],
    ['tos', { type: 'tos', msg: 'tos' }, 'caution', 'alertdialog'],
    ['staleAccountNotice', { type: 'staleAccountNotice', msg: 'stale' }, 'caution', 'alertdialog'],
    ['peerConflicts', { type: 'peerConflicts', msg: 'Conflicts', peerConflicts: [] }, 'caution', 'dialog'],
    ['parkedReply', { type: 'parkedReply', msg: 'A reply', parkedReply: { name: 'Alice', text: 'text' } }, 'caution', 'dialog'],
    ['updateOffer', { type: 'updateOffer', msg: '', cancelAnswer: 'later', updateOffer: { currentVersion: '0.1.0', version: '0.2.0', notes: 'Notes' } }, 'confirm', 'dialog'],
    ['wait', { type: 'wait', msg: 'Loading...' }, 'notice', 'dialog'],
    ['wait2', { type: 'wait2', msg: 'Stopped' }, 'notice', 'dialog'],
    ['progress', { type: 'progress', msg: 'Saving', submsg: '10' }, 'notice', 'dialog'],
] as Array<[alertData['type'], alertData, Severity, Role]>

function dialogOf(target: HTMLElement): HTMLElement {
    const dialog = target.querySelector<HTMLElement>('[data-part="pattern-dialog"][data-alert-box]')
    if (!dialog) throw new Error('no pattern dialog carries the alert box')
    return dialog
}

describe('AlertComp.svelte: the shared box is the pattern dialog', () => {
    test.each(SHARED_BOX)('a %s alert renders a labelled modal dialog with its role', async (_type, alert, _severity, role) => {
        arrangeDatabase()
        const target = mountAlertComp()
        await show(alert)

        const dialog = dialogOf(target)
        const layer = dialog.closest('[data-part="pattern-layer"]')
        expect.soft(layer, 'the dialog sits in a pattern layer').not.toBeNull()
        expect.soft(layer?.querySelector('[data-part="pattern-scrim"]'), 'the layer carries a scrim').not.toBeNull()
        expect.soft(dialog.getAttribute('tabindex'), 'the box stays focusable by script, not by Tab').toBe('-1')
        expect.soft(dialog.getAttribute('role')).toBe(role)
        expect.soft(dialog.getAttribute('aria-modal')).toBe('true')
        const labelledBy = dialog.getAttribute('aria-labelledby') ?? ''
        expect.soft(labelledBy, 'the dialog names itself').not.toBe('')
        expect.soft(document.getElementById(labelledBy), 'the labelled element exists').not.toBeNull()
        const describedBy = dialog.getAttribute('aria-describedby')
        if (describedBy !== null) {
            expect.soft(document.getElementById(describedBy), 'the described element exists').not.toBeNull()
        }
    })

    test.each(SHARED_BOX)('a %s alert has the severity the map gives it', async (_type, alert, severity) => {
        arrangeDatabase()
        const target = mountAlertComp()
        await show(alert)

        const root = dialogOf(target).querySelector('[data-part="pattern-warn-root"]')
        expect(root?.getAttribute('data-pattern-severity')).toBe(severity)
        expect(root?.querySelector('[data-part="pattern-warn-mark"] svg'), 'the mark is drawn').not.toBeNull()
    })

    test('the type headings stay the headline of their alert', async () => {
        arrangeDatabase()
        const target = mountAlertComp()
        await show({ type: 'error', msg: 'A failure' })
        expect(target.querySelector('h2[data-part="pattern-warn-headline"]')?.textContent).toBe(language.error)

        await show({ type: 'ask', msg: 'Proceed?' })
        expect(target.querySelector('h2[data-part="pattern-warn-headline"]')?.textContent).toBe(language.confirm)
    })

    test('the shared shell paints with theme tokens only: no palette utility class', async () => {
        arrangeDatabase()
        const palette = /^(?:[a-z-]+:)*(?:text|bg|border|ring|from|to|via|fill|stroke)-(?:gray|red|green|blue|stone|amber|yellow|cyan|purple|slate|zinc|neutral|orange|white|black)(?:-\d+)?(?:\/\d+)?$/
        const found: string[] = []
        for (const [type, alert] of SHARED_BOX) {
            resetAlertPromptsForTests()
            alertStore.set({ type: 'none', msg: '' } as never)
            const target = mountAlertComp()
            await show(alert)
            for (const el of Array.from(target.querySelectorAll('*'))) {
                for (const token of Array.from(el.classList)) {
                    if (palette.test(token)) found.push(`${type}: ${token}`)
                }
            }
            await unmount(mountedInstances.pop() as never)
            target.remove()
        }
        expect(found).toEqual([])
    })

    test('the tool dialogs sit in the wide variant and the messages do not', async () => {
        arrangeDatabase()
        const wide: string[] = []
        for (const [type, alert] of SHARED_BOX) {
            resetAlertPromptsForTests()
            alertStore.set({ type: 'none', msg: '' } as never)
            const target = mountAlertComp()
            await show(alert)
            if (dialogOf(target).getAttribute('data-alert-size') === 'wide') wide.push(type)
            await unmount(mountedInstances.pop() as never)
            target.remove()
        }
        expect(wide.sort()).toEqual(['addchar', 'branches', 'cardexport', 'chatOptions', 'hypaV2', 'markdown', 'parkedReply', 'peerConflicts', 'requestdata', 'requestlogs', 'selectChar', 'updateOffer'])
    })

    test('an update offer is named by its heading and described by the version list, the only element with the message id', async () => {
        arrangeDatabase()
        const target = mountAlertComp()
        await show({ type: 'updateOffer', msg: '', cancelAnswer: 'later', updateOffer: { currentVersion: '0.1.0', version: '0.2.0', notes: 'Notes' } })

        const dialog = dialogOf(target)
        expect(target.querySelector('h2[data-part="pattern-warn-headline"]')?.textContent).toBe(language.updateAvailableTitle)
        const describedBy = dialog.getAttribute('aria-describedby') ?? ''
        expect(describedBy).not.toBe('')
        const described = document.getElementById(describedBy)
        expect(described?.tagName).toBe('DL')
        expect(described?.textContent).toContain('0.2.0')
        expect(target.querySelectorAll(`[id="${describedBy}"]`)).toHaveLength(1)
        const region = target.querySelector('[role="region"]')
        expect(document.getElementById(region?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(language.updateReleaseNotes)
    })

    test('the card export, branches and request log wrappers carry the pattern layer and keep their close names', async () => {
        arrangeDatabase()
        const target = mountAlertComp()
        for (const alert of [
            { type: 'cardexport', msg: '', submsg: 'module' },
            { type: 'branches', msg: '' },
            { type: 'requestlogs', msg: '' },
        ] as alertData[]) {
            await show(alert)
            const layer = target.querySelector('[data-part="pattern-layer"]')
            expect.soft(layer, `${alert.type} has a layer`).not.toBeNull()
            expect.soft(layer?.querySelector('[data-part="pattern-scrim"]'), `${alert.type} has a scrim`).not.toBeNull()
            expect.soft(target.querySelector('[data-alert-box]'), `${alert.type} keeps its alert box`).not.toBeNull()
            expect.soft(target.querySelector(`button[aria-label="${language.uiCommon.close}"]`), `${alert.type} keeps its named close`).not.toBeNull()
        }
    })
})

describe('AlertComp.svelte: the layout follows the viewport', () => {
    test('a viewport of 640 px or less gives a bottom sheet, a wider one the centred dialog', async () => {
        arrangeDatabase()
        stubViewport(true)
        const phone = mountAlertComp()
        await show({ type: 'normal', msg: 'A notice' })
        expect(phone.querySelector('[data-part="pattern-layer"]')?.getAttribute('data-layout')).toBe('phone')
        await unmount(mountedInstances.pop() as never)
        phone.remove()

        stubViewport(false)
        const wide = mountAlertComp()
        await show({ type: 'normal', msg: 'A notice' })
        expect(wide.querySelector('[data-part="pattern-layer"]')?.getAttribute('data-layout')).toBe('wide')
    })

    test('a viewport change while the alert is up moves the layout', async () => {
        arrangeDatabase()
        const fire = stubViewport(false)
        const target = mountAlertComp()
        await show({ type: 'normal', msg: 'A notice' })
        fire(true)
        await settle()
        expect(target.querySelector('[data-part="pattern-layer"]')?.getAttribute('data-layout')).toBe('phone')
    })
})

describe('AlertComp.svelte: the confirm buttons', () => {
    test('No comes first and is neutral, Yes comes second with the confirm fill', async () => {
        vi.useFakeTimers()
        arrangeDatabase()
        const target = mountAlertComp()
        void alertConfirm('Proceed?')
        await settle()

        const buttons = Array.from(target.querySelectorAll<HTMLButtonElement>('[data-part="pattern-warn-actions"] button'))
        expect(buttons.map((b) => b.textContent?.trim())).toEqual([language.alertComp.no, language.alertComp.yes])
        expect(buttons.map((b) => b.getAttribute('data-variant'))).toEqual([null, 'confirm'])
    })

    test('guard: Yes answers yes and No answers no', async () => {
        vi.useFakeTimers()
        arrangeDatabase()
        const target = mountAlertComp()
        const first = alertConfirm('Proceed?')
        await settle()
        await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS)
        buttonNamed(target, language.alertComp.yes).click()
        await vi.advanceTimersByTimeAsync(0)
        expect(await first).toBe(true)

        const second = alertConfirm('Proceed?')
        await settle()
        await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS)
        buttonNamed(target, language.alertComp.no).click()
        await vi.advanceTimersByTimeAsync(0)
        expect(await second).toBe(false)
    })
})

describe('AlertComp.svelte: waits and progress', () => {
    test('a wait shows the sweep and no number', async () => {
        arrangeDatabase()
        const target = mountAlertComp()
        await show({ type: 'wait', msg: 'Loading...' })

        expect(target.querySelector('[data-part="pattern-alert-bar-sweep"]'), 'the sweep').not.toBeNull()
        expect(target.querySelector('[role="progressbar"]'), 'a wait has no determinate bar').toBeNull()
        expect(target.textContent, 'no percent').not.toMatch(/\d\s*%/)
    })

    test('progress is a progressbar that reports its percent, and keeps its percent line', async () => {
        arrangeDatabase()
        const target = mountAlertComp()
        await show({ type: 'progress', msg: 'Saving', submsg: '42' })

        const bar = target.querySelector('[role="progressbar"]')
        expect(bar?.getAttribute('aria-valuenow')).toBe('42')
        expect(bar?.getAttribute('aria-valuemin')).toBe('0')
        expect(bar?.getAttribute('aria-valuemax')).toBe('100')
        expect(target.textContent).toContain('42%')
    })

    test('the sweep and the bar are not read as content: the wait text is the label', async () => {
        arrangeDatabase()
        const target = mountAlertComp()
        await show({ type: 'wait', msg: 'Loading...' })
        const dialog = dialogOf(target)
        expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toContain('Loading...')
    })
})

describe('AlertComp.svelte: the headline and the body against the severity tint', () => {
    let rules: RuleSet

    beforeAll(async () => {
        rules = compileRules([
            await compileAppStyles(classCandidates(readRepoFile('src/lib/Others/AlertComp.svelte'))),
            { name: 'pattern-dialog', css: readRepoFile('src/lib/Nexus/pattern/pattern-dialog.css') },
            { name: 'pattern-alert', css: readRepoFile('src/lib/Nexus/pattern/pattern-alert.css') },
        ])
    }, 120000)

    const rgbOf = (value: string | undefined): Rgba => {
        if (value === undefined) throw new Error('no painted colour')
        const c = parseConcrete(value.startsWith('#') ? value.slice(0, 7) : value)
        if (c === null) throw new Error(`unreadable colour ${value}`)
        return c
    }

    // The headline is 15 px at weight 600, which is not large text (18.66 px bold or 24 px), so 4.5:1 applies.
    const HEADLINE_RATIO = 4.5
    const BY_SEVERITY: Array<[Severity, alertData]> = [
        ['danger', { type: 'error', msg: 'A failure' }],
        ['confirm', { type: 'ask', msg: 'Proceed?' }],
        ['notice', { type: 'normal', msg: 'A notice' }],
        ['caution', { type: 'tos', msg: 'tos' }],
    ]

    test.each(colorSchemeList)('%s: the headline text reads at 4.5:1 on its tint over the surface, and the body sits on the plain surface', async (name) => {
        arrangeDatabase()
        for (const [severity, alert] of BY_SEVERITY) {
            resetAlertPromptsForTests()
            alertStore.set({ type: 'none', msg: '' } as never)
            const target = mountAlertComp()
            await show(alert)
            ;(DBState.db as unknown as Record<string, unknown>).colorSchemeName = name
            document.documentElement.removeAttribute('style')
            updateColorScheme()
            flushSync()

            const m = new CascadeModel(rules)
            const box = dialogOf(target)
            const head = box.querySelector<HTMLElement>('[data-part="pattern-alert-head"]')!
            const body = box.querySelector<HTMLElement>('[data-part="pattern-alert-body"]')!
            const root = box.querySelector<HTMLElement>('[data-part="pattern-warn-root"]')!
            const plain = toHex(rgbOf(m.painted(box)['background-color']))
            const tint = m.painted(head)['background-color']
            expect(tint, `${severity}: the head paints a tint`).toBeDefined()
            const underHead = compositeHex(tint, plain)
            const text = m.painted(root).color
            expect(cr(rgbOf(text), rgbOf(underHead)), `${name} ${severity}: text ${text} on ${underHead}`).toBeGreaterThanOrEqual(HEADLINE_RATIO)
            expect(m.painted(body)['background-color'], `${name} ${severity}: no layer under the body`).toBeUndefined()
            expect(m.painted(root)['background-color'], `${name} ${severity}: no layer under the root`).toBeUndefined()
            await unmount(mountedInstances.pop() as never)
            target.remove()
        }
    })
})