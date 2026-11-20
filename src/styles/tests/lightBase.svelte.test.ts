// @vitest-environment jsdom

/**
 * The light base (D1a) and the pack text in the message body (D1b), through the real producers: the built-in packs and the
 * archives `zipPack` builds, the real driver (`startThemePackApply`) with the real judge handler behind a fake worker, the
 * real gate, the real `updateColorScheme` and `updateTextThemeAndCSS`, a mounted `ShellMessage`, and the real token files,
 * Tailwind compile and compiled ShellMessage CSS resolved per element by the cascade model.
 *
 * Regression reproducers (they fail against the stage before the light base and the pack text rules): TD1, TD3, TD4, TD6,
 * TD19. Compatibility guards (they pass before and after): TD2 (no backdrop paint), TD4b (a dark pack keeps the dark base,
 * which kills a light block selector weakened to presence), TD7b, TD11 (no pack).
 */
import { createHash } from 'node:crypto'
import postcss from 'postcss'
import { compile as compileSvelte } from 'svelte/compiler'
import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { cr, parseConcrete } from '../../ts/themePack/colour'
import {
    CascadeModel, appSheetsInOrder, classCandidates, compileRules, normaliseColours, readRepoFile, withPackElement,
    type ModelSheet, type RuleSet,
} from './cascadeModel'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    files: new Map<string, Uint8Array>(),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(), alertRequestData: vi.fn(), alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db), setDatabase: vi.fn(), getCurrentCharacter: () => null,
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(), getFileSrc: vi.fn(), aiLawApplies: () => false,
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(), BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf), sleep: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: h.db },
        selIdState: { selId: 0 },
        HideIconStore: writable(false),
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({ read: async (key: string) => ({ bytes: h.files.get(key) ?? null, version: null }) }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))
vi.mock(import('src/ts/themePack/worker/spawnJudgeWorker'), async () => {
    const { handleJudgeRequest } = await import('src/ts/themePack/worker/judgeHandler')
    class FakeWorker {
        private readonly listeners: Array<(event: Event) => void> = []

        postMessage(message: Parameters<typeof handleJudgeRequest>[0]): void {
            const answer = handleJudgeRequest(message)
            setTimeout(() => {
                for (const listener of this.listeners) listener(new MessageEvent('message', { data: answer }))
            }, 0)
        }

        terminate(): void { }

        addEventListener(type: string, listener: (event: Event) => void): void {
            if (type === 'message') this.listeners.push(listener)
        }
    }
    return { spawnJudgeWorker: () => new FakeWorker() } as unknown as typeof import('src/ts/themePack/worker/spawnJudgeWorker')
})
vi.mock('src/lib/ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatShell/StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ rebuildEpoch: 0, closeEpoch: 0 })
    return { chatSurface, isChatSurfaceInstalled: () => false }
})
vi.mock('src/ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text }))
vi.mock('src/ts/parser/chatML', () => ({}))
vi.mock('src/ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('src/ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true }))
vi.mock('src/ts/translator/translator', () => ({ getLLMCache: async () => null }))
vi.mock('src/ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('src/ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
vi.mock('src/ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/ts/process/messageActions.svelte', () => ({ handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn() }))
vi.mock('src/ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false, dispose: () => {},
}) }))
vi.mock('src/lib/ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatShell/MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatShell/TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('src/ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('src/ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('src/lang', () => ({ language: { noMessage: 'Type something to start the chat.' } }))

import ShellMessage from 'src/lib/ChatShell/ShellMessage.svelte'
import type { Message } from 'src/ts/storage/database.svelte'
import { updateColorScheme, updateTextThemeAndCSS } from '../../ts/gui/colorscheme'
import { ColorSchemeTypeStore, packBaseTone } from '../../ts/gui/surfaceTone'
import { resetPackSheetForTests } from '../../ts/themePack/apply'
import { resetThemePackApplyForTests, startThemePackApply, themePackApplyState } from '../../ts/themePack/activePack.svelte'
import { LIGHT_BASE_JUDGE_PREFIX } from '../../ts/themePack/lightBase'
import { manifestText, zipPack } from '../../ts/themePack/fixtures/packBuilder'
import { BUILTIN_PACKS } from '../../ts/themePack/builtins'
import { declareSurface, installThemePackGate, resetThemePackGateForTests } from '../../ts/themePack/surfaceGate.svelte'

// ---- fixtures

const ATTRIBUTE = 'data-theme-pack-base'
const SHELL_MESSAGE = 'src/lib/ChatShell/ShellMessage.svelte'
const SCHEMES = ['default', 'light', 'nexus'] as const
const TEXT_THEMES = ['standard', 'highcontrast'] as const

const ROOT = (): HTMLElement => document.documentElement
const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()
const colourText = (value: string | undefined): string => normaliseColours(value ?? '', '#000000ff')

let appSheets: ModelSheet[]
let scopeClass = ''
let shellSheet: ModelSheet

beforeAll(async () => {
    appSheets = await appSheetsInOrder(classCandidates(readRepoFile(SHELL_MESSAGE)))
}, 120000)

beforeEach(() => {
    for (const key of Object.keys(h.db)) delete h.db[key]
    Object.assign(h.db, {
        colorSchemeName: 'default', textTheme: 'standard', font: 'default', zoomsize: 100, lineHeight: 1.25, themePacks: [],
    })
    h.files.clear()
    document.documentElement.removeAttribute('style')
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    const custom = document.createElement('style')
    custom.id = 'customcss'
    document.body.appendChild(custom)
    installThemePackGate(() => false)
    declareSurface('chat')
})

let app: ReturnType<typeof ShellMessage> | undefined
let host: HTMLElement | undefined

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    resetThemePackApplyForTests()
    resetPackSheetForTests()
    resetThemePackGateForTests()
    ColorSchemeTypeStore.set('dark')
    document.documentElement.removeAttribute('style')
    document.head.innerHTML = ''
    document.body.innerHTML = ''
})

async function until(done: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt++) {
        flushSync()
        if (done()) return
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    throw new Error(`timed out waiting for ${what}`)
}

/** Applies a built-in pack through the real driver and waits until it is on. */
async function applyBuiltinThroughDriver(id: string): Promise<void> {
    h.db.activeThemePack = id
    startThemePackApply()
    await until(() => themePackApplyState().phase === 'applied', `${id} applied`)
    flushSync()
}

function chatOf(id: string): string {
    const found = BUILTIN_PACKS.find((pack) => pack.id === id)
    if (!found) throw new Error(`no built-in ${id}`)
    return found.chatCss
}

/** Stores an archive the way install does and makes it the active pack through the real driver. */
async function applyArchiveThroughDriver(modes: readonly string[], chat: string): Promise<void> {
    const bytes = zipPack({ 'manifest.json': manifestText({ modes }), 'chat.css': chat })
    const archive = `assets/tp-${createHash('sha256').update(bytes).digest('hex')}.risutheme`
    h.files.set(archive, bytes)
    h.db.themePacks = [{
        v: 1, id: 'archive-pack', name: 'Archive', version: '1.0.0', license: 'MIT', attribution: 'Test author', modes,
        fonts: [], archive, bytes: bytes.length, installedAt: 1,
    }]
    h.db.activeThemePack = 'archive-pack'
    startThemePackApply()
    await until(() => themePackApplyState().phase === 'applied', 'the archive applied')
    flushSync()
}

const packElement = (): HTMLStyleElement | null => document.querySelector<HTMLStyleElement>('style[data-theme-pack]')

function rules(): RuleSet {
    return compileRules(withPackElement([...appSheets, shellSheet], packElement()))
}

/** Puts the user's scheme and text theme on the root the way the app does, then reads the cascade. */
function under(scheme: string, textTheme: string, set: RuleSet): CascadeModel {
    h.db.colorSchemeName = scheme
    h.db.textTheme = textTheme
    document.documentElement.style.cssText = ''
    updateColorScheme()
    updateTextThemeAndCSS()
    return new CascadeModel(set)
}

const RICH = '<p>plain <strong>bold <em>both</em></strong> <em>ital <strong>both2</strong></em> <x-em>xem</x-em> '
    + '<mark risu-mark="quote1">q1</mark> <mark risu-mark="quote2">q2</mark></p>'
    + '<mark risu-mark="blockquote1">bq1</mark><mark risu-mark="blockquote2">bq2</mark>'
    + '<h1>head</h1><p><a href="https://example.invalid/">link</a> <code>inline</code></p>'
    + '<pre><code>block</code></pre><ul><li>item</li></ul>'

const ROLES: Array<[string, string]> = [
    ['body (the empty first message)', ''],
    ['p', 'p'], ['bold', 'p > strong'], ['italic', 'p > em'], ['bold italic', 'strong > em'], ['italic bold', 'em > strong'],
    ['x-em', 'x-em'], ['quote 1', 'mark[risu-mark="quote1"]'], ['quote 2', 'mark[risu-mark="quote2"]'],
    ['blockquote 1', 'mark[risu-mark="blockquote1"]'], ['blockquote 2', 'mark[risu-mark="blockquote2"]'],
    ['h1', 'h1'], ['link', 'a'], ['inline code', 'p code'], ['pre code', 'pre code'], ['list item', 'li'],
]

interface Shown { article: HTMLElement, body: HTMLElement }

/** A real ShellMessage in the chat ancestry (transcript, message list, row), with rich markup after the empty first message. */
async function showMessage(role: 'char' | 'user'): Promise<Shown> {
    host = document.createElement('div')
    host.setAttribute('data-part', 'chat-shell')
    const main = document.createElement('main')
    main.setAttribute('data-part', 'chat-transcript')
    const list = document.createElement('div')
    list.setAttribute('data-part', 'chat-message-list')
    const row = document.createElement('div')
    row.className = 'chat-message-container'
    host.append(main)
    main.append(list)
    list.append(row)
    document.body.appendChild(host)
    const message: Message = { role, data: '', chatId: 'm' }
    app = mount(ShellMessage, { target: row, props: { idx: 0, chatId: 'm', name: 'Ari', message, firstMessage: true } })
    flushSync()
    await tick()
    const article = row.querySelector<HTMLElement>('[data-part="chat-message"]')!
    const body = row.querySelector<HTMLElement>('[data-part="chat-message-body"]')!
    body.insertAdjacentHTML('beforeend', RICH)
    const found = [...body.classList].find((name) => name.startsWith('svelte-'))
    if (found === undefined) throw new Error('the mounted body has no scope class')
    if (found !== scopeClass) {
        scopeClass = found
        shellSheet = {
            name: 'ShellMessage',
            css: compileSvelte(readRepoFile(SHELL_MESSAGE), { filename: SHELL_MESSAGE, css: 'external', cssHash: () => found }).css?.code ?? '',
        }
    }
    return { article, body }
}

function target(shown: Shown, selector: string): Element {
    if (selector === '') return shown.body
    const found = shown.body.querySelector(selector)
    if (found === null) throw new Error(`no ${selector}`)
    return found
}

/** The first ancestor of `el` that paints an opaque background, as `#rrggbbaa`, or null. */
function opaqueBackdrop(model: CascadeModel, el: Element): string | null {
    for (let node = el.parentElement; node !== null; node = node.parentElement) {
        const bg = model.painted(node)['background-color']
        if (bg !== undefined && bg.endsWith('ff') && bg.length === 9) return bg
    }
    return null
}

function contrast(foreground: string, background: string): number {
    const f = parseConcrete(foreground)
    const b = parseConcrete(background)
    if (f === null || b === null) throw new Error(`unparsable ${foreground} on ${background}`)
    return cr(f, b)
}

const messageColour = (model: CascadeModel, shown: Shown): string => model.painted(shown.article).color

// ---- D1a: the light base

describe('TD7b: the light block restores every name the dark base restores, and the judge prefix mirrors it', () => {
    const LIGHT_SELECTOR = ':root:where([data-theme-pack-base="light"])'
    const DARK_SELECTOR = ':root:where([data-theme-pack-base])'

    function declared(css: string, selector: string): Array<[string, string]> {
        const out: Array<[string, string]> = []
        for (const node of postcss.parse(css).nodes) {
            if (node.type !== 'rule' || node.selector.trim() !== selector) continue
            node.walkDecls((d) => { out.push([d.prop, collapse(d.value)]) })
        }
        return out
    }

    test('every dark-base name is declared by the light block, and the light block adds only chat statics', () => {
        // The black backdrop under the pack canvas is the same for every base: it is what the install judge
        // flattens a translucent canvas over, so the light block must leave it alone rather than restate it.
        const PACK_BACKDROP = '--surface-pack-backdrop'
        const baseNames = ['src/styles/nexus-tokens.css', 'src/styles/pattern-tokens.css', 'src/styles/chat-pack-base.css']
            .flatMap((file) => declared(readRepoFile(file), DARK_SELECTOR).map(([name]) => name))
        expect(baseNames).toContain(PACK_BACKDROP)
        const darkNames = baseNames.filter((name) => name !== PACK_BACKDROP)
        expect(darkNames).toHaveLength(29)
        const lightNames = declared(readRepoFile('src/styles/chat-light-base.css'), LIGHT_SELECTOR).map(([name]) => name)
        expect(lightNames).not.toContain(PACK_BACKDROP)
        expect(lightNames.filter((name) => darkNames.includes(name)).sort()).toEqual([...darkNames].sort())
        expect(lightNames).toHaveLength(new Set(lightNames).size)
        expect(lightNames.length - darkNames.length).toBe(26)
    })

    test('the judge prefix is the light block minus the pattern labels, declaration by declaration', () => {
        const fromCss = declared(readRepoFile('src/styles/chat-light-base.css'), LIGHT_SELECTOR).filter(([name]) => !name.startsWith('--pattern-'))
        const fromPrefix = declared(LIGHT_BASE_JUDGE_PREFIX, ':root')
        expect(fromPrefix).toEqual(fromCss)
    })
})

describe('TD4: a light-only built-in applied through the real driver sits on the light base', () => {
    test.each(['builtin:scratch-white', 'builtin:office-sheet', 'builtin:banana-cocoa'])('%s', async (id) => {
        await applyBuiltinThroughDriver(id)
        expect(ROOT().getAttribute(ATTRIBUTE)).toBe('light')
        expect(get(packBaseTone)).toBe('light')
        for (const scheme of SCHEMES) {
            const model = under(scheme, 'standard', compileRules(withPackElement(appSheets, packElement())))
            expect(model.custom(ROOT(), '--nexus-warning-rgb')).toBe('135 88 0')
            expect(colourText(model.custom(ROOT(), '--pattern-on-accent'))).toBe(colourText('#ffffff'))
            expect(model.custom(ROOT(), '--color-surface-bar')).toBeDefined()
        }
    })

    test('the names the pack sets keep the pack values', async () => {
        await applyBuiltinThroughDriver('builtin:scratch-white')
        const own = new Map<string, string>()
        postcss.parse(packElement()!.textContent ?? '').walkRules(':root', (rule) => {
            rule.walkDecls((d) => { if (d.prop.startsWith('--nexus-canvas')) own.set(d.prop, collapse(d.value)) })
        })
        const model = under('light', 'standard', compileRules(withPackElement(appSheets, packElement())))
        for (const [name, value] of own) expect(colourText(model.custom(ROOT(), name)), name).toBe(colourText(value))
    })
})

describe('TD4b: a dark pack keeps the dark base values under every scheme', () => {
    test('Origin Navy: attribute empty, tone dark, the dark reference for names it does not set', async () => {
        await applyBuiltinThroughDriver('builtin:origin-navy')
        expect(ROOT().getAttribute(ATTRIBUTE)).toBe('')
        expect(get(packBaseTone)).toBe('dark')
        for (const scheme of SCHEMES) {
            const model = under(scheme, 'standard', compileRules(withPackElement(appSheets, packElement())))
            expect(model.custom(ROOT(), '--nexus-warning-rgb')).toBe('255 209 102')
            expect(colourText(model.custom(ROOT(), '--pattern-on-accent'))).toBe(colourText('#001018'))
        }
    })
})

describe('TD6: a sparse light archive resolves the statics it omits to the light base', () => {
    const SPARSE = chatOf('builtin:scratch-white')
        .replace(/--chat-speaker-\d:[^;]*;/g, '')
        .replace(/--color-scope-[a-z-]+:[^;]*;/g, '')
        .replace(/--color-hit[a-z-]*:[^;]*;/g, '')
        .replace(/--nexus-warning-rgb:[^;]*;/g, '')
        .replace(/--color-surface-bar:[^;]*;/g, '')
        .replace(/--color-scheme:[^;]*;/g, '')

    test('speakers, scope, hits, the warning channel, the bar and the scheme keyword come from the light base, not the dark values', async () => {
        expect(SPARSE).not.toContain('--chat-speaker-0')
        expect(SPARSE).not.toContain('--color-surface-bar')
        await applyArchiveThroughDriver(['light'], SPARSE)
        expect(ROOT().getAttribute(ATTRIBUTE)).toBe('light')
        const model = under('default', 'standard', compileRules(withPackElement(appSheets, packElement())))
        expect(colourText(model.custom(ROOT(), '--chat-speaker-0'))).toBe(colourText('#7a3b12'))
        expect(colourText(model.custom(ROOT(), '--color-scope-character-text'))).toBe(colourText('#4b2a8a'))
        expect(colourText(model.custom(ROOT(), '--color-hit'))).toBe(colourText('#7a4f00'))
        expect(model.custom(ROOT(), '--nexus-warning-rgb')).toBe('135 88 0')
        expect(model.custom(ROOT(), '--color-scheme')).toBe('light')
        expect(colourText(model.custom(ROOT(), '--color-surface-bar'))).toBe(colourText('#eceef6'))
    })
})

// ---- D1b: the pack text in the message body

describe('TD1: under a light pack every text role in the body is the message colour and readable on the backdrop', () => {
    const CASES = [
        ['builtin:scratch-white', 'default', 'standard', 'char'], ['builtin:scratch-white', 'default', 'highcontrast', 'user'],
        ['builtin:scratch-white', 'light', 'standard', 'user'], ['builtin:office-sheet', 'default', 'standard', 'char'],
        ['builtin:office-sheet', 'default', 'highcontrast', 'char'], ['builtin:office-sheet', 'light', 'highcontrast', 'user'],
    ] as const

    test.each(CASES)('%s, scheme %s, text theme %s, %s message', async (id, scheme, textTheme, role) => {
        await applyBuiltinThroughDriver(id)
        const shown = await showMessage(role)
        const model = under(scheme, textTheme, rules())
        const colour = messageColour(model, shown)
        const backdrop = opaqueBackdrop(model, shown.article)
        expect(backdrop, 'a pack paint behind the message').not.toBeNull()
        expect(contrast(colour, backdrop!)).toBeGreaterThanOrEqual(4.5)
        for (const [label, selector] of ROLES) {
            expect(model.painted(target(shown, selector)).color, label).toBe(colour)
        }
    })

    test('blockquote marks and code blocks paint no fill, and the quote bar keeps the text colour', async () => {
        await applyBuiltinThroughDriver('builtin:scratch-white')
        const shown = await showMessage('char')
        const model = under('default', 'standard', rules())
        for (const selector of ['mark[risu-mark="blockquote1"]', 'mark[risu-mark="blockquote2"]', 'pre']) {
            expect(model.painted(target(shown, selector))['background-color'], selector).toBeUndefined()
        }
        expect(model.painted(target(shown, 'mark[risu-mark="blockquote1"]'))['border-left-color']).toBe(messageColour(model, shown))
    })
})

describe('TD3: the prose colours are the message colour whatever the tone class says', () => {
    test('Scratch White (light base, prose-invert off)', async () => {
        await applyBuiltinThroughDriver('builtin:scratch-white')
        const shown = await showMessage('char')
        expect(shown.body.classList.contains('prose-invert')).toBe(false)
        const model = under('default', 'standard', rules())
        for (const [label, selector] of ROLES) expect(model.painted(target(shown, selector)).color, label).toBe(messageColour(model, shown))
    })

    test('a light archive that fell back to the dark base (tone dark, prose-invert on)', async () => {
        const MID = ':root { --nexus-canvas: #969fae; --color-surface-sheet: #ffffff; --color-surface-toast: #ffffff; --nexus-text: #000000; --nexus-text-secondary: #1a1d24; --nexus-text-muted: #2a2d34; --nexus-ring: #102a60; --nexus-accent-rgb: 16 42 96; --nexus-accent: rgb(var(--nexus-accent-rgb)); --nexus-danger-rgb: 138 0 24; --nexus-danger: rgb(var(--nexus-danger-rgb)); --color-on-accent: #ffffff; --danger: #6a0012; --color-scheme: light; }\n'
        await applyArchiveThroughDriver(['light'], MID)
        expect(ROOT().getAttribute(ATTRIBUTE)).toBe('')
        const shown = await showMessage('char')
        expect(shown.body.classList.contains('prose-invert')).toBe(true)
        const model = under('default', 'standard', rules())
        for (const [label, selector] of ROLES) expect(model.painted(target(shown, selector)).color, label).toBe(messageColour(model, shown))
    })

    test('Origin Navy (dark base, prose-invert on)', async () => {
        await applyBuiltinThroughDriver('builtin:origin-navy')
        const shown = await showMessage('char')
        expect(shown.body.classList.contains('prose-invert')).toBe(true)
        const model = under('light', 'standard', rules())
        for (const [label, selector] of ROLES) expect(model.painted(target(shown, selector)).color, label).toBe(messageColour(model, shown))
    })
})

describe('TD19: the unjudged bubble text tokens never colour the body', () => {
    test('a Scratch White archive that sets near-paper bubble text keeps the body readable', async () => {
        const sheet = `${chatOf('builtin:scratch-white')}\n:root { --color-bubble-char-text: #fdfdfa; --color-bubble-user-text: #fefefe; }\n`
        await applyArchiveThroughDriver(['light'], sheet)
        for (const role of ['char', 'user'] as const) {
            const shown = await showMessage(role)
            const model = under('default', 'standard', rules())
            const colour = model.painted(target(shown, 'p')).color
            expect(colour).toBe(messageColour(model, shown))
            expect(contrast(colour, opaqueBackdrop(model, shown.article)!)).toBeGreaterThanOrEqual(4.5)
            await unmount(app!)
            app = undefined
            host?.remove()
        }
    })
})

describe('TD2: D1 paints no backdrop in the chat ancestry', () => {
    /** The rules the message CSS loads without the pack-text block. */
    function withoutPackText(): RuleSet {
        const kept = postcss.parse(shellSheet.css)
        kept.walkRules((rule) => { if (rule.selector.includes(ATTRIBUTE)) rule.remove() })
        return compileRules(withPackElement([...appSheets, { name: 'ShellMessage', css: kept.toString() }], packElement()))
    }

    test.each(['builtin:scratch-white', 'builtin:office-sheet', 'builtin:banana-cocoa', 'builtin:origin-navy'])('%s: every ancestor background equals the one without the pack-text rules', async (id) => {
        await applyBuiltinThroughDriver(id)
        const shown = await showMessage('char')
        const chain: Element[] = []
        for (let node: Element | null = shown.article; node !== null; node = node.parentElement) chain.push(node)
        expect(chain.length).toBeGreaterThan(5)
        for (const scheme of SCHEMES) {
            const withRules = under(scheme, 'standard', rules())
            const before = chain.map((node) => withRules.painted(node)['background-color'])
            const without = under(scheme, 'standard', withoutPackText())
            const after = chain.map((node) => without.painted(node)['background-color'])
            expect(before).toEqual(after)
        }
    })
})

describe('TD11: without a pack nothing changes', () => {
    test('no attribute, the text theme colours and the tone-bound prose class apply', async () => {
        under('light', 'standard', compileRules(appSheets))
        const light = await showMessage('char')
        const model = under('light', 'standard', rules())
        expect(ROOT().hasAttribute(ATTRIBUTE)).toBe(false)
        expect(model.custom(light.body, '--FontColorStandard')).toBe('#0f172a')
        expect(model.custom(light.body, '--tw-prose-body')).not.toBe('currentColor')
        expect(light.body.classList.contains('prose-invert')).toBe(false)
        const dark = under('default', 'standard', rules())
        expect(dark.custom(light.body, '--FontColorStandard')).toBe('#fafafa')
    })
})
