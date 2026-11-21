// @vitest-environment jsdom
/**
 * While a chat theme pack is on and the user has no background of their own, the whole chat shell sits on the pack
 * canvas over opaque black: the transcript backdrop is the canvas flattened over black (DD-242), and the Screenshot
 * export draws the same two layers (#337). A background the user chose (a resolved custom image, the selected card's
 * background HTML or a module background) always shows: the text-screen overlay stays, the card is never hidden, the
 * export draws no canvas, and the pack's own backgrounds on the shell, transcript and message list yield, even with
 * `!important`, through an inline `!important` background on those three parts (MC-2939, MC-3005). Message bubbles and
 * every other part keep the pack's paint. Nothing is persisted.
 *
 * REAL: ChatScreen.svelte, ChatShell.svelte, BackgroundDom.svelte, PlusSheet.svelte, the surface gate, the judge,
 * `buildAppliedText`, `commitPackSheet`, `updateColorScheme`, the token files and the Tailwind output.
 * MODELLED: browser style computation (CascadeModel with importance tiers over the compiled component CSS, with the real
 * `svelte-*` hash read from the mounted element) and the canvas 2D context (a recording source-over fake), so the export
 * tests prove the fill sequence and the composite, not native pixels.
 * MOCKED: the stores and database, the parts and sheets the shell loads (the message list is a stand-in that keeps the
 * props it receives), the parser (it returns its input) and the classic screen (a stand-in that records the props it
 * receives).
 *
 * R rows and B rows marked as reproducers fail on assertions against the stage before the background split. G rows and
 * the rows marked as guards pass before and after. The wallpaper, overlay and card rows that used to assert "hidden under
 * a pack" are inverted on purpose: the user's background wins.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { compile as compileSvelte } from 'svelte/compiler'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { parseConcrete, type Rgba } from '../../ts/themePack/colour'
import {
    CascadeModel, appSheetsInOrder, classCandidates, compileRules, hex8, readRepoFile, withPackElement,
    type ModelSheet,
} from '../../styles/tests/cascadeModel'

const h = vi.hoisted(() => ({
    downloadFile: vi.fn(),
    classicStyles: [] as string[],
    listProps: null as { canvasYield?: boolean } | null,
}))

vi.mock('../../ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    const DBState = $state<{ db: Record<string, unknown> }>({ db: { characters: [] } })
    const selIdState = $state({ selId: 0 })
    const selectedCharID = store(0)
    selectedCharID.subscribe((value) => { selIdState.selId = value })
    const additionalChatMenu = $state<Array<{ id: string, name: string, callback: () => void }>>([])
    const easyPanelStore = $state({ open: false })
    return {
        DBState, selIdState, selectedCharID, additionalChatMenu, easyPanelStore,
        CharEmotion: store({}), sideBarStore: store(false), alertStore: store({ type: 'none', msg: '' }),
        ReloadGUIPointer: store(0), moduleBackgroundEmbedding: store(''), hypaV3ModalOpen: store(false),
        CustomCSSStore: store(''), SafeModeStore: store(false),
    }
})
vi.mock('../../ts/storage/database.svelte', async () => {
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        appVer: '1234.5.67',
        getDatabase: () => DBState.db,
        setDatabase: vi.fn(),
        getCurrentCharacter: () => DBState.db.characters[0],
        getCurrentChat: () => DBState.db.characters[0]?.chats?.[0],
    }
})
vi.mock('../../ts/storage/store/appStore', () => ({ getAppStore: async () => ({ read: async () => ({ bytes: null, version: null }) }) }))
vi.mock('../../ts/gui/systemBars', () => ({ syncSystemBars: vi.fn() }))
vi.mock('../../ts/chatShell/switchTarget.svelte', () => ({ switchTarget: { target: null, phase: 'idle', reason: null }, retrySwitch: vi.fn(), backToPrevious: vi.fn(), abandonPendingSwitch: vi.fn() }))
vi.mock('../../ts/backHandlers', () => ({ registerBackHandler: () => () => undefined, backCloseHandler: () => () => false }))
vi.mock('../../ts/process/index.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return { doingChat: store(false), chatProcessStage: store(0) }
})
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { hidden: false, closeEpoch: 0, heldGui: 0, rebuildEpoch: 0 }, isChatSurfaceInstalled: () => false }))
vi.mock('../../ts/process/moduleEnsure', async () => {
    const { writable: store } = await import('svelte/store')
    return { selectedModulesPending: () => false, moduleRunVersion: store(0) }
})
vi.mock('../../ts/process/chatTreeView', () => ({ treeView: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({
    hasher: (value: string) => value,
    risuChatParser: (value: string) => value,
    ParseMarkdown: async (value: string) => value,
    assetRegex: /{{asset:[^}]+}}/g,
}))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../../lang', () => ({ language: {
    chatShellMessages: 'Messages', chatShellChatOpened: (chat: string) => `Opened ${chat}`,
    chatShellMoreActions: 'More actions', tools: 'Tools', continueResponse: 'Continue', ttsStop: 'Stop speech',
    chatShellStickers: 'Stickers', chatList: 'Chat list', easyPanel: 'Easy panel',
    hypaMemoryV2Modal: 'Hypa V2', hypaMemoryV3Modal: 'Hypa V3', screenshot: 'Screenshot',
    modules: 'Modules', reroll: 'Reroll', chatShellUtility: 'Utility', chatShellTogglesTitle: 'Toggles',
    alerts: { screenshotTaking: 'Taking screenshot', screenshotMerging: 'Merging' },
    screenshotSaved: 'Saved', errors: { screenshotFailed: 'Screenshot failed' },
    screenshotTaskTitle: 'Taking a screenshot', screenshotStepCapture: 'Capture messages', screenshotStepMerge: 'Merge images', screenshotStepSave: 'Save image',
    exportTaskDone: 'Exported', exportTaskFailed: 'Could not export',
} }))
vi.mock('../ChatShell/ShellHeader.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/ShellComposer.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/PersonaSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
// Svelte 5 props are live getters, so a later read of the kept object sees the current value.
vi.mock('../ChatShell/ShellMessageList.svelte', () => ({ default: (_anchor: Comment, props: { canvasYield?: boolean }) => { h.listProps = props; return {} } }))
vi.mock('../ChatShell/ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/ThisChatSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/ChatDeleteConfirm.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/TogglesPanel.svelte', () => ({ default: () => ({}), toggleSummary: () => ({ n: 0, on: 0 }) }))
vi.mock('../ChatShell/SendFailureCard.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/SwitchFrame.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/JumpSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/ReturnChip.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/Scrubber.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/FindBar.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/FindFiltersSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/FindResultsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/chatShell/sendFailure.svelte', () => ({ failureOf: () => null, retrySendFailure: vi.fn(), shellGenerationSource: (closeMenu: () => void) => ({ closeMenu }) }))
vi.mock('../Setting/settingsRoute', () => ({ openSettingsForFix: vi.fn() }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ isComposerBusy: () => false, branchAt: vi.fn(), sendContinue: vi.fn(async () => {}), reroll: vi.fn(async () => {}) }))
vi.mock('../ChatScreens/NotificationsOffNotice.svelte', () => ({ default: () => ({}) }))
// The wallpaper has the real producer's shape (getCustomBackground in util.ts), including its missing-file branch: a value
// whose file is gone resolves to an empty string.
vi.mock('../../ts/util', () => ({
    getCustomBackground: async (value: string) => (value && value !== 'gone' ? 'background: url("blob:wall"); background-size: cover;' : ''),
    getEmotion: () => '',
    findCharacterbyId: vi.fn(),
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
}))
vi.mock('../ChatScreens/DefaultChatScreen.svelte', () => ({
    default: (anchor: Comment, props: { customStyle?: string }) => {
        h.classicStyles.push(props.customStyle ?? '')
        const marker = document.createElement('div')
        marker.setAttribute('data-testid', 'home-stand-in')
        anchor.before(marker)
        return {}
    },
}))
vi.mock('../ChatScreens/ResizeBox.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/TransitionImage.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/media/charImageLookups', () => ({ useCharImageLookups: () => ({ get: vi.fn(), getIf: vi.fn(), dispose: vi.fn() }) }))
vi.mock('../UI/GUI/SideBarArrow.svelte', () => ({ default: () => ({}) }))
vi.mock('../Others/ChatList.svelte', () => ({ default: () => ({}) }))
vi.mock('../Setting/Pages/Module/ModuleChatMenu.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), alertWait: vi.fn(), alertNormal: vi.fn(), showHypaV2Alert: vi.fn(), alertClear: vi.fn(), waitUnreadNotice: vi.fn(async () => {}) }))
vi.mock('../../ts/globalApi.svelte', () => ({
    downloadFile: h.downloadFile,
    getFileSrc: vi.fn(),
    readImage: async () => undefined,
    aiWatermarkingLawApplies: () => false,
}))
vi.mock('../../ts/exportNotice', () => ({ downloadNotice: (message: string) => message }))
vi.mock('../../ts/storage/pageStorageMode', async () => {
    const { writable: store } = await import('svelte/store')
    return { pageStorageModeStore: store({ kind: 'store2' }) }
})
vi.mock('../Utility/utilityGate', async () => {
    const { writable: store } = await import('svelte/store')
    return { utilityVisible: vi.fn(() => false), utilityOpen: store(false) }
})
vi.mock('../../ts/process/tts', () => ({ stopTTS: vi.fn() }))
vi.mock('../../ts/process/ttsModes', () => ({ canChatSpeak: vi.fn(() => false) }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
// The canvas the export merges onto; the rows themselves are drawn by this stand-in.
vi.mock('html-to-image', () => ({
    toCanvas: async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 10
        canvas.height = 10
        return canvas
    },
}))

import { DBState, moduleBackgroundEmbedding, selectedCharID } from '../../ts/stores.svelte'
import { setDatabase } from '../../ts/storage/database.svelte'
import { updateColorScheme } from '../../ts/gui/colorscheme'
import { packBaseTone } from '../../ts/gui/surfaceTone'
import { BUILTIN_PACKS } from '../../ts/themePack/builtins'
import { buildAppliedText, commitPackSheet, resetPackSheetForTests } from '../../ts/themePack/apply'
import { chatCommitInput } from '../../ts/themePack/fixtures/packCommit'
import { judgeAreaSheet } from '../../ts/themePack/index'
import { installThemePackGate, resetThemePackGateForTests, syncThemePackMedia } from '../../ts/themePack/surfaceGate.svelte'
import { setShellEnabled } from '../../ts/chatShell/shellSwitch.svelte'
import PlusSheet from '../ChatShell/PlusSheet.svelte'
import { alertError, alertNormal, alertWait } from '../../ts/alert'
import { resetTaskHostForTests, setTaskClockForTests, taskHostView, taskShown } from '../../ts/alertTask.svelte'

// ---- the fixtures

const SHELL_FILE = 'src/lib/ChatShell/ChatShell.svelte'
const SCREEN_FILE = 'src/lib/ChatScreens/ChatScreen.svelte'
const CARD = '<style>.r337{color:#123456}</style><div style="position:fixed;inset:0;z-index:10;background:#ff0000"></div>'
// The built-in Origin Navy sheet with its canvas made translucent; the judge needs the on-accent text pinned to black
// because the worst case it judges over a translucent canvas is lighter than the opaque one.
const TRANSLUCENT = BUILTIN_PACKS.find((p) => p.id === 'builtin:origin-navy')!.chatCss
    .replace(/--nexus-canvas:\s*#21222c;/, '--nexus-canvas: rgb(33 34 44 / 0.6);\n  --color-on-accent: #000000;')
// A judged sheet that paints the shell and the transcript with `!important`; the transcript fill equals the pack canvas,
// so the contrast the judge checks is the one Origin Navy already passes.
const IMPORTANT_CANVAS = BUILTIN_PACKS.find((p) => p.id === 'builtin:origin-navy')!.chatCss
    + '\n[data-part="chat-shell"] { background-color: #21222c !important; }\n[data-part="chat-transcript"] { background-color: #21222c !important; }'
// jsdom's `style.cssText` keeps only the colour and the border and drops the text shadow, radius and padding, so those
// three options are left off here; they travel in the same inline declaration list as the two that are kept.
const OVERLAY_ON = { textScreenColor: '#ff0000', textBorder: false, textScreenRounded: false, textScreenBorder: '#00ff00' }
const OVERLAY_OFF = { textScreenColor: '', textBorder: false, textScreenRounded: false, textScreenBorder: '' }
const PERSISTED = ['customBackground', 'textScreenColor', 'textBorder', 'textScreenRounded', 'textScreenBorder', 'classicMaxWidth'] as const

let appSheets: ModelSheet[]
let covered = false
const mounted: Array<{ instance: object, target: HTMLElement }> = []

beforeAll(async () => {
    appSheets = await appSheetsInOrder(classCandidates(readRepoFile(SHELL_FILE), readRepoFile(SCREEN_FILE)))
}, 120000)

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
}

beforeEach(() => {
    DBState.db = {
        theme: '',
        colorSchemeName: 'default',
        characters: [{ chaId: 'a', type: 'character', name: 'Seraphina', chatPage: 0, chats: [{ id: 'chat-1', name: 'First', message: [], note: '', localLore: [] }], viewScreen: 'none', inlayViewScreen: false, backgroundHTML: '' }],
        ...OVERLAY_OFF,
        customBackground: '', classicMaxWidth: false, waifuWidth: 100, waifuWidth2: 100,
    } as never
    selectedCharID.set(0)
    moduleBackgroundEmbedding.set('')
    h.classicStyles.length = 0
    h.listProps = null
    h.downloadFile.mockClear()
    resetTaskHostForTests()
    let tick = 0
    setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
    vi.mocked(alertError).mockClear()
    vi.mocked(alertNormal).mockClear()
    vi.mocked(alertWait).mockClear()
    vi.mocked(setDatabase).mockClear()
    document.documentElement.removeAttribute('style')
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    const custom = document.createElement('style')
    custom.id = 'customcss'
    document.body.appendChild(custom)
    covered = false
    installThemePackGate(() => covered)
    setShellEnabled(true)
})

afterEach(async () => {
    vi.restoreAllMocks()
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    resetPackSheetForTests()
    resetThemePackGateForTests()
    document.documentElement.removeAttribute('style')
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    localStorage.clear()
    setShellEnabled(false)
})

interface ChatOptions {
    wallpaper?: boolean
    // A custom background value whose file may be missing; it overrides `wallpaper`.
    customBackground?: string
    overlay?: boolean
    classicMaxWidth?: boolean
    card?: string
    theme?: string
}

function fixtureCharacter() {
    const owner = DBState.db.characters[0]
    if (owner.type !== 'character') throw new Error('the fixture is a single character')
    return owner
}

/** The real ChatScreen with the real ChatShell, on the database the options describe. */
async function mountChat(options: ChatOptions = {}): Promise<HTMLElement> {
    Object.assign(DBState.db, options.overlay ? OVERLAY_ON : OVERLAY_OFF)
    DBState.db.customBackground = options.customBackground ?? (options.wallpaper ? 'wall' : '')
    DBState.db.classicMaxWidth = options.classicMaxWidth === true
    DBState.db.theme = options.theme ?? ''
    fixtureCharacter().backgroundHTML = options.card ?? ''
    const { default: ChatScreen } = await import('./ChatScreen.svelte')
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ instance: mount(ChatScreen, { target }), target })
    flushSync()
    await settle()
    await settle()
    return target
}

const shellOf = (): HTMLElement => document.querySelector<HTMLElement>('[data-part="chat-shell"]')!
const areaOf = (): HTMLElement | null => shellOf()?.parentElement?.parentElement ?? null
const wrapperOf = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-risu-card-background]')
const transcriptOf = (): HTMLElement => document.querySelector<HTMLElement>('[data-part="chat-transcript"]')!
const packElement = (): HTMLStyleElement | null => document.querySelector<HTMLStyleElement>('style[data-theme-pack]')
const styleOf = (element: Element): string => element.getAttribute('style') ?? ''
const squash = (text: string): string => text.replace(/\s+/g, '')

function setScheme(scheme: 'light' | 'default'): void {
    DBState.db.colorSchemeName = scheme
}

function pack(id: string) {
    const found = BUILTIN_PACKS.find((p) => p.id === id)
    if (!found) throw new Error(`no built-in ${id}`)
    return found
}

/** A sheet through the real path: judge, applied text, commit (which syncs the real gate). */
async function commitJudged(css: string): Promise<void> {
    const judged = judgeAreaSheet('chat', css, undefined, 'chat')
    expect(judged.result.ok, JSON.stringify(judged.result)).toBe(true)
    expect(commitPackSheet(chatCommitInput(buildAppliedText(judged, () => '')))).toEqual({ ok: true })
    await settle()
}

const commitBuiltin = (id: string): Promise<void> => commitJudged(pack(id).chatCss)

// ---- the cascade model over the compiled component CSS

/** The scoped hash the mounted element carries; the compiled CSS of a pre-change base has no selector for it. */
function hashOf(element: Element | null): string {
    for (const name of element?.classList ?? []) if (/^svelte-/.test(name)) return name
    return 'svelte-none'
}

function componentCss(file: string, hash: string): string {
    return compileSvelte(readRepoFile(file), { filename: file, css: 'external', cssHash: () => hash }).css?.code ?? ''
}

function modelNow(): CascadeModel {
    document.documentElement.removeAttribute('style')
    updateColorScheme()
    const sheets: ModelSheet[] = [
        ...appSheets,
        { name: 'ChatShell', css: componentCss(SHELL_FILE, hashOf(shellOf())) },
        { name: 'ChatScreen', css: componentCss(SCREEN_FILE, hashOf(areaOf())) },
    ]
    return new CascadeModel(compileRules(withPackElement(sheets, packElement())), { important: true })
}

function rgbaOfHex8(text: string): Rgba {
    const m = /^#([0-9a-f]{6})([0-9a-f]{2})$/.exec(text)
    if (!m) throw new Error(`not a #rrggbbaa colour: ${text}`)
    const c = parseConcrete(`#${m[1]}`)!
    return [c[0], c[1], c[2], parseInt(m[2], 16) / 255]
}

function srcOver(top: Rgba, base: Rgba): Rgba {
    const alpha = top[3] + base[3] * (1 - top[3])
    if (alpha === 0) return [0, 0, 0, 0]
    const mix = (i: number) => (top[i] * top[3] + base[i] * base[3] * (1 - top[3])) / alpha
    return [mix(0), mix(1), mix(2), alpha]
}

const GRADIENT = /^linear-gradient\((#[0-9a-f]{8}), (#[0-9a-f]{8})\)$/

/** What the box paints: its background colour with the one two-stop canvas gradient over it, when there is one. */
function composite(painted: Record<string, string>): Rgba {
    const base = rgbaOfHex8(painted['background-color'] ?? '#00000000')
    const image = painted['background-image']
    if (image === undefined) return base
    const m = GRADIENT.exec(image)
    if (!m) throw new Error(`not a two-stop gradient: ${image}`)
    expect(m[1]).toBe(m[2])
    return srcOver(rgbaOfHex8(m[1]), base)
}

function expectRgba(actual: Rgba, expected: Rgba): void {
    for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], 0)
    expect(actual[3]).toBeCloseTo(expected[3], 2)
}

const rgba = (text: string): Rgba => parseConcrete(text)!

// ---- regression reproducers

describe('R: under a chat pack the shell paints the pack canvas over black', () => {
    test('B8 (guard, R1): with no user background Origin Navy under the light scheme paints one canvas gradient over black, not the scheme white', async () => {
        setScheme('light')
        await mountChat()
        expect(modelNow().custom(document.documentElement, '--nexus-canvas')).toBe('#ffffff')
        await commitBuiltin('builtin:origin-navy')
        const model = modelNow()
        const painted = model.painted(shellOf())
        expect(painted['background-color']).toBe('#000000ff')
        expect(painted['background-image']).toBe('linear-gradient(#21222cff, #21222cff)')
        expect(hex8(composite(painted))).toBe('#21222cff')
    })

    test('B2 (reproducer, was R2): Banana Cocoa keeps the wallpaper overlay, now important, and every extra it carries', async () => {
        setScheme('light')
        await mountChat({ wallpaper: true, overlay: true })
        expect(squash(styleOf(shellOf()))).toContain('background:rgba(255,0,0,0.5)')
        expect(squash(styleOf(shellOf()))).toContain('border:0.3remsolidrgb(0,255,0)')
        await commitBuiltin('builtin:banana-cocoa')
        expect(squash(styleOf(shellOf()))).toContain('background:rgba(255,0,0,0.5)!important')
        expect(squash(styleOf(shellOf()))).toContain('border:0.3remsolidrgb(0,255,0)')
        const painted = modelNow().painted(shellOf())
        expect(painted['background-image']).toBeUndefined()
        expect(hex8(composite(painted))).toBe('#ff000080')
    })

    test('B9 (guard, was R3): with no user background a translucent canvas is painted over black, the backdrop the judge flattens it onto', async () => {
        setScheme('light')
        await mountChat()
        await commitJudged(TRANSLUCENT)
        const actual = composite(modelNow().painted(shellOf()))
        expectRgba(actual, srcOver(rgba('rgb(33 34 44 / 0.6)'), [0, 0, 0, 1]))
        expect(actual[3]).toBe(1)
        expect(Math.abs(actual[0] - srcOver(rgba('rgb(33 34 44 / 0.6)'), [255, 255, 255, 1])[0])).toBeGreaterThan(50)
    })

    test('R3b: a judged pack that sets the scrim colour still gets an opaque black base under its canvas', async () => {
        setScheme('light')
        await mountChat()
        await commitJudged(TRANSLUCENT.replace('--color-on-accent: #000000;', '--color-on-accent: #000000;\n  --color-scrim: #ff0000;'))
        const model = modelNow()
        expect(model.custom(document.documentElement, '--color-scrim')).toBe('#ff0000')
        const painted = model.painted(shellOf())
        expect(painted['background-color']).toBe('#000000ff')
        const actual = composite(painted)
        expectRgba(actual, srcOver(rgba('rgb(33 34 44 / 0.6)'), [0, 0, 0, 1]))
        expect(actual[3]).toBe(1)
    })

    test('R3c: the base name is not one a pack can declare, so the install judge refuses it', () => {
        const judged = judgeAreaSheet('chat', TRANSLUCENT.replace('--color-on-accent: #000000;', '--color-on-accent: #000000;\n  --surface-pack-backdrop: #ff0000;'), undefined, 'chat')
        expect(judged.result.ok).toBe(false)
    })

    test('B1 (reproducer, was R4): a card background is visible, stays mounted, and neither the area nor the shell paints the canvas', async () => {
        setScheme('light')
        await mountChat({ card: CARD })
        expect(wrapperOf()).not.toBeNull()
        await commitBuiltin('builtin:origin-navy')
        const wrapper = wrapperOf()!
        expect(wrapper.querySelector('style')?.textContent).toContain('.r337')
        const model = modelNow()
        expect(model.prop(wrapper, 'opacity')).toBeUndefined()
        expect(model.prop(wrapper, 'visibility')).toBeUndefined()
        expect(squash(styleOf(shellOf()))).toBe('background:none!important;')
        const shell = model.painted(shellOf())
        expect(shell['background-color']).toBeUndefined()
        expect(shell['background-image']).toBeUndefined()
        expect(model.painted(areaOf()!)['background-color']).toBeUndefined()
        expect(document.documentElement.hasAttribute('data-theme-pack-base')).toBe(true)
    })

    test('B3 (reproducer): a module background counts as a user background', async () => {
        setScheme('light')
        moduleBackgroundEmbedding.set('<div class="m2949">m</div>')
        await mountChat()
        await commitBuiltin('builtin:origin-navy')
        const model = modelNow()
        expect(wrapperOf()).not.toBeNull()
        expect(model.prop(wrapperOf()!, 'opacity')).toBeUndefined()
        expect(squash(styleOf(shellOf()))).toBe('background:none!important;')
        expect(model.painted(shellOf())['background-color']).toBeUndefined()
        expect(model.painted(areaOf()!)['background-color']).toBeUndefined()
    })

    test('B4 (reproducer, was R5): a wallpaper keeps the overlay on the shell and leaves the max-width gutters unpainted', async () => {
        setScheme('light')
        await mountChat({ classicMaxWidth: true, wallpaper: true })
        expect(squash(styleOf(shellOf()))).toContain('background:rgba(0,0,0,0.8)')
        await commitBuiltin('builtin:origin-navy')
        expect(squash(styleOf(shellOf()))).toContain('background:rgba(0,0,0,0.8)!important')
        const area = areaOf()!
        expect(area.classList.contains('chat-area')).toBe(true)
        const painted = modelNow().painted(area)
        expect(painted['background-color']).toBeUndefined()
        expect(painted['background-image']).toBeUndefined()
    })

    test('B11 (guard, was R5): with no user background the max-width gutters take the canvas', async () => {
        setScheme('light')
        await mountChat({ classicMaxWidth: true })
        await commitBuiltin('builtin:origin-navy')
        const area = areaOf()!
        expect(area.classList.contains('chat-area')).toBe(true)
        const painted = modelNow().painted(area)
        expect(painted['background-color']).toBe('#000000ff')
        expect(hex8(composite(painted))).toBe('#21222cff')
    })

    test('B5 (reproducer, was R5b): covering the chat keeps the overlay, and it is important again only while the pack shows', async () => {
        await mountChat({ wallpaper: true })
        await commitBuiltin('builtin:origin-navy')
        expect(squash(styleOf(shellOf()))).toContain('background:rgba(0,0,0,0.8)')
        covered = true
        syncThemePackMedia()
        await settle()
        expect(squash(styleOf(shellOf()))).toContain('background:rgba(0,0,0,0.8)')
        expect(styleOf(shellOf())).not.toContain('!important')
        covered = false
        syncThemePackMedia()
        await settle()
        expect(squash(styleOf(shellOf()))).toContain('background:rgba(0,0,0,0.8)!important')
    })
})

// ---- compatibility guards (pass before and after the change)

describe('G: nothing changes without a pack, and nothing is persisted', () => {
    test('G1 (S6): no pack with the wallpaper keeps the overlay on the shell', async () => {
        await mountChat({ wallpaper: true })
        expect(squash(styleOf(shellOf()))).toContain('background:rgba(0,0,0,0.8)')
        expect(hex8(composite(modelNow().painted(shellOf())))).toBe('#000000cc')
    })

    test('G1b (S6): no pack with the overlay options keeps all of them', async () => {
        await mountChat({ wallpaper: true, overlay: true })
        const style = squash(styleOf(shellOf()))
        expect(style).toContain('background:rgba(255,0,0,0.5)')
        expect(style).toContain('border:0.3remsolidrgb(0,255,0)')
    })

    test.each(['light', 'default'] as const)('G2 (S7): no pack and no wallpaper paints nothing (%s)', async (scheme) => {
        setScheme(scheme)
        await mountChat({ card: CARD, classicMaxWidth: true })
        const model = modelNow()
        for (const element of [shellOf(), areaOf()!]) {
            const painted = model.painted(element)
            expect(painted['background-color']).toBeUndefined()
            expect(painted['background-image']).toBeUndefined()
        }
        expect(model.prop(wrapperOf()!, 'opacity')).toBeUndefined()
    })

    test('G3 (S5b): removing the pack returns the overlay and the paint goes', async () => {
        await commitBuiltin('builtin:origin-navy')
        await mountChat({ wallpaper: true })
        expect(document.documentElement.hasAttribute('data-theme-pack-base')).toBe(true)
        expect(commitPackSheet(null)).toEqual({ ok: true })
        await settle()
        expect(squash(styleOf(shellOf()))).toContain('background:rgba(0,0,0,0.8)')
        const painted = modelNow().painted(shellOf())
        expect(painted['background-color']).toBe('#000000cc')
        expect(painted['background-image']).toBeUndefined()
    })

    test('G4 (S5c): a cover turns the pack off and brings the overlay back', async () => {
        await mountChat({ wallpaper: true })
        await commitBuiltin('builtin:origin-navy')
        covered = true
        syncThemePackMedia()
        await settle()
        expect(document.documentElement.hasAttribute('data-theme-pack-base')).toBe(false)
        expect(get(packBaseTone)).toBeNull()
        expect(squash(styleOf(shellOf()))).toContain('background:rgba(0,0,0,0.8)')
        expect(modelNow().painted(shellOf())['background-color']).toBe('#000000cc')
        covered = false
        syncThemePackMedia()
        await settle()
        expect(get(packBaseTone)).not.toBeNull()
    })

    test('G5 (S8): a pack that paints its own transcript keeps that paint on top of the shell', async () => {
        await mountChat()
        await commitBuiltin('builtin:scratch-white')
        const painted = modelNow().painted(transcriptOf())
        expect(painted['background-color']).toBe('#fdfdfaff')
        expect(painted['background-image']).toBeDefined()
    })

    test('G6 (S9): the persisted fields are identical before, during and after a pack, a cover and an unmount', async () => {
        const snapshot = () => JSON.stringify({
            fields: PERSISTED.map((key) => DBState.db[key]),
            background: fixtureCharacter().backgroundHTML,
            embedding: get(moduleBackgroundEmbedding),
        })
        await mountChat({ wallpaper: true, overlay: true, card: CARD, classicMaxWidth: true })
        const before = snapshot()
        await commitBuiltin('builtin:origin-navy')
        expect(snapshot()).toBe(before)
        covered = true
        syncThemePackMedia()
        await settle()
        covered = false
        syncThemePackMedia()
        await settle()
        expect(snapshot()).toBe(before)
        expect(commitPackSheet(null)).toEqual({ ok: true })
        await settle()
        expect(snapshot()).toBe(before)
        for (const { instance, target } of mounted.splice(0)) {
            await unmount(instance as never)
            target.remove()
        }
        expect(snapshot()).toBe(before)
        expect(setDatabase).not.toHaveBeenCalled()
    })

    test('G7 (I7): the waifu theme never turns the pack base on and still hands the classic screen its overlay', async () => {
        await commitBuiltin('builtin:origin-navy')
        await mountChat({ theme: 'waifu', wallpaper: true })
        expect(document.documentElement.hasAttribute('data-theme-pack-base')).toBe(false)
        expect(h.classicStyles).toHaveLength(1)
        expect(squash(h.classicStyles[0])).toContain('background:rgba(0,0,0,0.8)')
        expect(h.classicStyles[0]).toContain('backdrop-filter: blur(4px);')
    })
})

// ---- the Screenshot export

/** A 2D context that keeps one RGBA pixel and applies general source-over, parsing fillStyle the way a canvas does. */
class RecordingContext {
    pixel: Rgba = [0, 0, 0, 0]
    fills: string[] = []
    private current: Rgba = [0, 0, 0, 1]
    private currentText = '#000000'
    get fillStyle(): string { return this.currentText }
    // An unparsable value keeps the previous style, as a canvas does.
    set fillStyle(value: string) {
        const hex = /^#[0-9a-f]{8}$/i.test(value.trim()) ? rgbaOfHex8(value.trim().toLowerCase()) : parseConcrete(value)
        if (hex === null) return
        this.current = hex
        this.currentText = value
    }
    fillRect(): void {
        this.fills.push(this.currentText)
        this.pixel = srcOver(this.current, this.pixel)
    }
    drawImage(): void {}
}

/** The recording canvas and the getComputedStyle bridge to the cascade model, installed before the export runs. */
function installExportWorld(): RecordingContext {
    const context = new RecordingContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => context) as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => 'data:image/png;base64,AAAA')
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((element: Element) => {
        const model = modelNow()
        return {
            backgroundColor: model.painted(element)['background-color'] ?? 'rgba(0, 0, 0, 0)',
            getPropertyValue: (name: string) => model.custom(element, name) ?? '',
        }
    }) as never)
    return context
}

async function exportScreenshot(): Promise<RecordingContext> {
    const context = installExportWorld()
    const row = document.createElement('div')
    row.className = 'risu-chat'
    transcriptOf().appendChild(row)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = $state({ open: true, opener: null, background: [], onclose: () => { props.open = false }, onstickers: vi.fn(), onchatlist: vi.fn(), onmodules: vi.fn() })
    mounted.push({ instance: mount(PlusSheet, { target, props }), target })
    flushSync()
    const item = [...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === 'Screenshot')
    expect(item).toBeDefined()
    item!.click()
    await vi.waitFor(() => expect(h.downloadFile).toHaveBeenCalledTimes(1))
    return context
}

describe('R6: under a pack the exported backdrop is the canvas flattened over black', () => {
    test('B6 (reproducer, was R6a): Banana Cocoa with a wallpaper exports one fill, the overlay, and no canvas', async () => {
        setScheme('light')
        await mountChat({ wallpaper: true })
        await commitBuiltin('builtin:banana-cocoa')
        const context = await exportScreenshot()
        expect(context.fills).toHaveLength(1)
        expect(context.pixel[3]).toBeCloseTo(0.8, 2)
        expectRgba([context.pixel[0], context.pixel[1], context.pixel[2], 0.8], [0, 0, 0, 0.8])
    })

    test('B7 (reproducer): a card background alone exports one transparent fill', async () => {
        setScheme('light')
        await mountChat({ card: CARD })
        await commitBuiltin('builtin:origin-navy')
        const context = await exportScreenshot()
        expect(context.fills).toHaveLength(1)
        expect(context.pixel).toEqual([0, 0, 0, 0])
    })

    test('R6b (S10): Origin Navy under the light scheme exports #21222c', async () => {
        setScheme('light')
        await mountChat()
        await commitBuiltin('builtin:origin-navy')
        const context = await exportScreenshot()
        expectRgba(context.pixel, [...rgba('#21222c').slice(0, 3), 1] as Rgba)
    })

    test('R6c (guard, B12): with no user background a translucent canvas exports as the flatten over black, fully opaque', async () => {
        setScheme('light')
        await mountChat()
        await commitJudged(TRANSLUCENT)
        const context = await exportScreenshot()
        expectRgba(context.pixel, srcOver(rgba('rgb(33 34 44 / 0.6)'), [0, 0, 0, 1]))
    })
})

describe('B: the user background wins over the pack canvas parts', () => {
    test('B13a (guard): a whitespace-only card is not a background, so the canvas paints', async () => {
        setScheme('light')
        await mountChat({ card: '  \n ' })
        await commitBuiltin('builtin:origin-navy')
        const model = modelNow()
        expect(model.painted(areaOf()!)['background-color']).toBe('#000000ff')
        expect(model.painted(shellOf())['background-image']).toBe('linear-gradient(#21222cff, #21222cff)')
    })

    test('B13b (guard): a custom background whose file is gone resolves to nothing, so the canvas paints and the shell has no overlay', async () => {
        setScheme('light')
        await mountChat({ customBackground: 'gone' })
        await commitBuiltin('builtin:origin-navy')
        expect(styleOf(shellOf()).trim()).toBe('')
        expect(modelNow().painted(areaOf()!)['background-color']).toBe('#000000ff')
    })

    test('B14 (guard): another character\'s card is not a background of the selected chat', async () => {
        setScheme('light')
        await mountChat({ card: CARD })
        DBState.db.characters.push({ ...fixtureCharacter(), chaId: 'b', name: 'Other', backgroundHTML: '' })
        selectedCharID.set(1)
        await settle()
        await commitBuiltin('builtin:origin-navy')
        expect(wrapperOf()).toBeNull()
        expect(modelNow().painted(areaOf()!)['background-color']).toBe('#000000ff')
    })

    test('B18 (reproducer): Scratch White with a card background paints no paper over the card', async () => {
        setScheme('light')
        await mountChat({ card: CARD })
        await commitBuiltin('builtin:scratch-white')
        const model = modelNow()
        const transcript = model.painted(transcriptOf())
        expect(transcript['background-color']).toBeUndefined()
        expect(transcript['background-image']).toBeUndefined()
        expect(model.prop(wrapperOf()!, 'opacity')).toBeUndefined()
        expect(model.prop(wrapperOf()!, 'visibility')).toBeUndefined()
        expect(squash(styleOf(shellOf()))).toBe('background:none!important;')
        expect(model.painted(shellOf())['background-color']).toBeUndefined()
        expect(model.painted(shellOf())['background-image']).toBeUndefined()
        expect(document.documentElement.hasAttribute('data-theme-pack-base')).toBe(true)
    })

    test('B19 (reproducer): Scratch White with a wallpaper and overlay shows the overlay and no paper', async () => {
        setScheme('light')
        await mountChat({ wallpaper: true, overlay: true })
        await commitBuiltin('builtin:scratch-white')
        const model = modelNow()
        expect(model.painted(transcriptOf())['background-color']).toBeUndefined()
        expect(model.painted(transcriptOf())['background-image']).toBeUndefined()
        expect(squash(styleOf(shellOf()))).toContain('background:rgba(255,0,0,0.5)!important')
        expect(squash(styleOf(shellOf()))).toContain('border:0.3remsolidrgb(0,255,0)')
        expect(hex8(composite(model.painted(shellOf())))).toBe('#ff000080')
    })

    test('B20 (reproducer): a pack that paints the shell and the transcript with !important still yields to the wallpaper', async () => {
        setScheme('light')
        await mountChat({ wallpaper: true })
        await commitJudged(IMPORTANT_CANVAS)
        const model = modelNow()
        expect(model.painted(transcriptOf())['background-color']).toBeUndefined()
        expect(hex8(composite(model.painted(shellOf())))).toBe('#000000cc')
    })

    test('B21 (reproducer): the same pack exports one fill, the overlay, with no canvas', async () => {
        setScheme('light')
        await mountChat({ wallpaper: true })
        await commitJudged(IMPORTANT_CANVAS)
        const context = await exportScreenshot()
        expect(context.fills).toHaveLength(1)
        expect(context.pixel[3]).toBeCloseTo(0.8, 2)
        expectRgba([context.pixel[0], context.pixel[1], context.pixel[2], 0.8], [0, 0, 0, 0.8])
    })

    test('B22 (reproducer): the transcript override follows the pack and never erases what the scroll holds write', async () => {
        setScheme('light')
        await mountChat({ card: CARD })
        await commitBuiltin('builtin:origin-navy')
        expect(squash(styleOf(transcriptOf()))).toContain('background-color:transparent!important;background-image:none!important')
        transcriptOf().style.setProperty('overflow-anchor', 'none')
        expect(commitPackSheet(null)).toEqual({ ok: true })
        await settle()
        expect(styleOf(transcriptOf())).not.toContain('background')
        expect(squash(styleOf(transcriptOf()))).toContain('overflow-anchor:none')
        await commitBuiltin('builtin:origin-navy')
        expect(squash(styleOf(transcriptOf()))).toContain('background-color:transparent!important;background-image:none!important')
        expect(squash(styleOf(transcriptOf()))).toContain('overflow-anchor:none')
    })

    test('B23 (reproducer): the message list is told to yield exactly while the user background and a pack are both on', async () => {
        setScheme('light')
        await mountChat({ card: CARD })
        await commitBuiltin('builtin:origin-navy')
        expect(h.listProps?.canvasYield).toBe(true)
        expect(commitPackSheet(null)).toEqual({ ok: true })
        await settle()
        expect(h.listProps?.canvasYield).toBe(false)
    })

    test('B24a (guard, passes before and after): with no pack a card background leaves the shell and the transcript without inline style', async () => {
        await mountChat({ card: CARD })
        expect(styleOf(shellOf())).toBe('')
        expect(transcriptOf().hasAttribute('style')).toBe(false)
    })

    test('B24b (guard, passes before and after): with no pack a wallpaper adds no important declaration', async () => {
        await mountChat({ wallpaper: true })
        expect(styleOf(shellOf())).not.toContain('!important')
    })
})

describe('G8: without a pack the export is unchanged', () => {
    test('G8a (S10): no wallpaper exports one transparent fill', async () => {
        setScheme('light')
        await mountChat()
        // The scheme canvas is non-empty without a pack, so a canvas fill that ignored the pack would paint it.
        installExportWorld()
        expect(getComputedStyle(shellOf()).getPropertyValue('--nexus-canvas').trim()).not.toBe('')
        vi.restoreAllMocks()
        const context = await exportScreenshot()
        expect(context.fills).toHaveLength(1)
        expect(context.pixel).toEqual([0, 0, 0, 0])
    })

    test('G8b (S10): the wallpaper exports the overlay colour in one fill', async () => {
        setScheme('light')
        await mountChat({ wallpaper: true })
        const context = await exportScreenshot()
        expect(context.fills).toHaveLength(1)
        expect(context.pixel[3]).toBeCloseTo(0.8, 2)
        expectRgba([context.pixel[0], context.pixel[1], context.pixel[2], 0.8], [0, 0, 0, 0.8])
    })
})

// ---- the task card (S6b): the Screenshot runs on one card through the shared seam

/** Starts the Screenshot item with the recording world installed; `withRow: false` leaves no rendered row. */
async function startScreenshot(withRow = true): Promise<void> {
    setScheme('light')
    await mountChat()
    installExportWorld()
    if (withRow) {
        const row = document.createElement('div')
        row.className = 'risu-chat'
        transcriptOf().appendChild(row)
    }
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = $state({ open: true, opener: null, background: [], onclose: () => { props.open = false }, onstickers: vi.fn(), onchatlist: vi.fn(), onmodules: vi.fn() })
    mounted.push({ instance: mount(PlusSheet, { target, props }), target })
    flushSync()
    const item = [...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === 'Screenshot')
    expect(item).toBeDefined()
    item!.click()
}

/** The Android save picker as `downloadFile` runs it: the hook wraps only the picker, and a null path resolves false. */
function androidPicker(path: string | null, inPicker: Array<{ title: string | undefined, shown: boolean }>): void {
    h.downloadFile.mockImplementationOnce(async (_name: string, _data: Uint8Array, options?: { aroundPicker?: <T>(open: () => Promise<T>) => Promise<T> }) => {
        const openPicker = async (): Promise<string | null> => {
            inPicker.push({ title: taskHostView()?.title, shown: taskShown() })
            return path
        }
        const picked = options?.aroundPicker ? await options.aroundPicker(openPicker) : await openPicker()
        return picked !== null
    })
}

describe('AD: the PlusSheet Screenshot on the task card', () => {
    test('AD1: it runs on one card without Cancel and ends done; no wait and no legacy notice', async () => {
        const seen: Array<{ title: string | undefined, cancel: boolean | undefined, steps: string[] | undefined }> = []
        h.downloadFile.mockImplementationOnce(async () => {
            const view = taskHostView()
            seen.push({ title: view?.title, cancel: view?.cancelOffered, steps: view?.steps.map((step) => step.label) })
            return true
        })
        await startScreenshot()
        await vi.waitFor(() => expect(taskHostView()?.result?.headline).toBe('Exported'))

        expect(seen).toEqual([{ title: 'Taking a screenshot', cancel: false, steps: ['Capture messages', 'Merge images', 'Save image'] }])
        expect(alertWait).not.toHaveBeenCalled()
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('AD2a: a dismissed picker result (false) ends silently with no card and no saved notice', async () => {
        h.downloadFile.mockResolvedValueOnce(false)
        await startScreenshot()
        await vi.waitFor(() => expect(h.downloadFile).toHaveBeenCalledTimes(1))
        await settle()

        expect(taskHostView()).toBeNull()
        expect(alertNormal).not.toHaveBeenCalled()
        expect(alertError).not.toHaveBeenCalled()
    })

    test('AD2b: no rendered rows keeps today\'s error notice and opens no card (compatibility guard: passes before and after)', async () => {
        await startScreenshot(false)
        await vi.waitFor(() => expect(alertError).toHaveBeenCalledWith('Screenshot failed'))

        expect(taskHostView()).toBeNull()
        expect(h.downloadFile).not.toHaveBeenCalled()
    })

    test('AD4: on the Android picker no card is up while it is open, and a saved file posts the legacy notice', async () => {
        const inPicker: Array<{ title: string | undefined, shown: boolean }> = []
        androidPicker('/picked/chat.png', inPicker)
        await startScreenshot()
        await vi.waitFor(() => expect(alertNormal).toHaveBeenCalledWith('Saved'))

        expect(inPicker).toEqual([{ title: undefined, shown: false }])
        expect(alertNormal).toHaveBeenCalledTimes(1)
        expect(taskHostView()).toBeNull()
        expect(alertWait).not.toHaveBeenCalled()
    })
})
