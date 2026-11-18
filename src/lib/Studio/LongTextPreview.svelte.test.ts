// @vitest-environment jsdom
/**
 * The CBS preview pane and sheet against the real engine (parser, sandbox, sanitiser) loaded the way the app loads it,
 * through the lazy service. Only storage, stores and platform edges are stand-ins (the harness of
 * `previewSandbox.svelte.test.ts`).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, Database, character } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({
    processScriptFull: vi.fn((): never => { throw new Error('processScriptFull must not run in a preview') }),
    mark: vi.fn(),
    layers: [] as { isOpen: () => boolean; close: () => void }[],
}))

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: 0 },
    ReloadGUIPointer: writable(0),
    HideIconStore: writable(false),
    moduleBackgroundEmbedding: writable(''),
    CurrentTriggerIdStore: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
    alertClear: vi.fn(),
    alertModuleSelect: vi.fn(async () => -1),
    alertStore: writable({ type: '', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    readImage: vi.fn(async () => undefined),
    aiWatermarkingLawApplies: vi.fn(() => false),
    getFileSrc: vi.fn(async () => ''),
    AppendableBuffer: class {},
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    saveAsset: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false }) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })),
}))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))

// The persona helpers are the real implementations; the rest of `util` is a light stand-in.
vi.mock(import('src/ts/util'), async () => {
    const real = await vi.importActual<typeof import('src/ts/util')>('src/ts/util')
    return {
        checkPersonaBinded: real.checkPersonaBinded,
        getUserName: real.getUserName,
        getPersonaPrompt: real.getPersonaPrompt,
        getUserIcon: real.getUserIcon,
        livePersona: real.livePersona,
        pickHashRand: real.pickHashRand,
        replaceAsync: real.replaceAsync,
        findCharacterbyId: () => ({ name: 'Unknown Character' }),
        parseKeyValue: (template: string) => {
            if (!template) return []
            const kv: [string, string][] = []
            for (const line of template.split('\n')) {
                const [key, value] = line.split('=')
                if (key && value) kv.push([key, value])
            }
            return kv
        },
        sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
        selectSingleFile: vi.fn(),
        asBuffer: vi.fn(() => new Uint8Array()),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'placeholder', name: 'Placeholder Model', shortName: 'Placeholder', internalID: 'placeholder', format: 0, provider: 0, tokenizer: 0 })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const { get } = await import('svelte/store')
    const state = stores.DBState as unknown as { db: { characters?: { chats: unknown[]; chatPage: number }[] } }
    const getCurrentCharacter = () => state.db.characters?.[get(stores.selectedCharID)]
    return {
        appVer: '1234.5.67',
        defaultSdDataFunc: () => [],
        getDatabase: vi.fn(() => state.db),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(() => {
            const char = getCurrentCharacter()
            return char?.chats?.[char.chatPage]
        }),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/media'), () => ({ compressImage: vi.fn(async (v: unknown) => v) }) as unknown as typeof import('src/ts/media'))
vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async () => new Uint8Array()), encodeRPack: vi.fn(async () => new Uint8Array()),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))
vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(), convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))
vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(), importCharacterProcess: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

// A run that reaches the script pipeline throws; `calls` stays 0 for every preview.
vi.mock(import('src/ts/process/scripts'), () => ({
    processScript: h.processScriptFull,
    processScriptFull: h.processScriptFull,
    resetScriptCache: vi.fn(),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/storage/characterSaveMarks'), async (importOriginal) => ({
    ...(await importOriginal()),
    markCharacterForSave: h.mark,
}))

// The suite-wide setup stubs KaTeX out; the real renderer keeps the parser's own pass honest.
vi.mock('katex', async () => await vi.importActual<typeof import('katex')>('katex'))

// The sheet registers a Back layer; the test reads it instead of reaching the whole back-handler chain.
vi.mock('src/ts/studio/studioBack.svelte', () => ({
    registerStudioBackLayer: (layer: { isOpen: () => boolean; close: () => void }) => { h.layers.push(layer) },
}))

vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { createBlankChar } from 'src/ts/characters'
import { loadPreviewEngine, setPreviewEngineForTests, type PreviewEngine } from 'src/ts/studio/longText/previewEngineService'
import LongTextPreview, { type PreviewSourceInput, type PreviewValues } from './LongTextPreview.svelte'

const state = DBState as unknown as { db: Database }

function installDb(extra: Record<string, unknown> = {}): void {
    state.db = {
        characters: [],
        modules: [],
        templateDefaultVariables: '',
        personas: [],
        selectedPersona: 0,
        enabledModules: [] as string[],
        moduleIntergration: '',
        globalChatVariables: {} as Record<string, string>,
        username: 'Uma',
        hideAllImages: false,
        ...extra,
    } as unknown as Database
    selectedCharID.set(0)
}

function liveCharacter(): character {
    const live = createBlankChar()
    live.name = 'Live'
    live.desc = 'S'
    return live
}

function chatOf(over: Partial<Chat> = {}): Chat {
    return { id: 'src-chat', name: '', note: '', localLore: [], message: [], ...over }
}

const sourceOf = (chat: Chat | null = null, globals: Record<string, string> = {}): (() => PreviewSourceInput) => () => ({ owner: liveCharacter(), chat, globals })

let mounted: ReturnType<typeof mount>[] = []
let hosts: HTMLElement[] = []

type Props = {
    variant: 'sheet' | 'pane'
    kind: 'desc' | 'greeting' | 'note'
    text: string
    composing: boolean
    active: boolean
    lowPower: boolean
    previewSource: () => PreviewSourceInput
    values: PreviewValues
    onvalues: (next: PreviewValues) => void
    run?: PreviewEngine['runPreview']
    onclose?: (refocus: boolean) => void
}

function mountPreview(over: Partial<Props> = {}): { host: HTMLElement, props: Props } {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const props: Props = $state({
        variant: 'pane',
        kind: 'desc',
        text: '',
        composing: false,
        active: true,
        lowPower: false,
        previewSource: sourceOf(),
        values: { char: '', chat: {}, toggles: {} },
        onvalues: (next: PreviewValues) => { props.values = next },
        ...over,
    })
    const app = mount(LongTextPreview, { target: host, props })
    mounted.push(app)
    hosts.push(host)
    flushSync()
    return { host, props }
}

async function microtasks(): Promise<void> {
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve()
    flushSync()
}

async function advance(ms: number): Promise<void> {
    vi.advanceTimersByTime(ms)
    await microtasks()
}

// The first run: the engine loads, then the pause passes.
async function firstRun(): Promise<void> {
    await microtasks()
    await advance(400)
}

const part = (host: HTMLElement, name: string): HTMLElement | null => host.querySelector<HTMLElement>(`[data-part="${name}"]`)
const outputOf = (host: HTMLElement): HTMLElement => part(host, 'lt-preview-output') as HTMLElement
const outText = (host: HTMLElement): string => (outputOf(host).textContent ?? '').trim()
const rowInput = (host: HTMLElement, key: string): HTMLInputElement => host.querySelector(`[data-part="lt-preview-row"][data-key="${key}"] input`) as HTMLInputElement
const snapshot = (): unknown => structuredClone(state.db)

function setInput(input: HTMLInputElement, value: string): void {
    input.value = value
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    flushSync()
}

// The real engine is imported once with real timers, so a later load resolves in microtasks under fake timers.
beforeEach(async () => {
    h.processScriptFull.mockClear()
    h.mark.mockClear()
    h.layers.length = 0
    installDb({ characters: [liveCharacter()] })
    setPreviewEngineForTests(() => import('src/ts/studio/longText/previewEngine'))
    await loadPreviewEngine()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(async () => {
    for (const app of mounted.splice(0)) await unmount(app)
    for (const host of hosts.splice(0)) host.remove()
    setPreviewEngineForTests(null)
    vi.useRealTimers()
})

// What the preview DOM must never contain, whatever the text said.
function assertSanitised(host: HTMLElement): void {
    const output = outputOf(host)
    expect(output.querySelector('img')).toBeNull()
    expect(output.querySelectorAll('[id], [class], [style], [src], [srcset], [href]')).toHaveLength(0)
    expect(output.querySelector('strong')?.textContent).toBe('hi')
}

const MIXED = '**hi** {{char}} <img src="https://x.invalid/a.png" id="i" class="c" style="color:red">'

describe('E2-C2 the output is the sanitised preview HTML only', () => {
    test('markup stays, the sample name is filled, no media, id, class or style survives, the media count is shown', async () => {
        const { host } = mountPreview({ text: MIXED, values: { char: 'Alice', chat: {}, toggles: {} } })
        await firstRun()
        assertSanitised(host)
        expect(outputOf(host).textContent).toContain('Alice')
        expect(part(host, 'lt-preview-media')?.textContent).toBe('sbMediaHidden(1)')
    })

    test('the raw view shows the parsed text with the tag as text', async () => {
        const { host } = mountPreview({ text: MIXED, values: { char: 'Alice', chat: {}, toggles: {} } })
        await firstRun()
        ;(part(host, 'lt-preview-raw-toggle') as HTMLButtonElement).click()
        flushSync()
        const raw = part(host, 'lt-preview-raw') as HTMLElement
        expect(raw.tagName).toBe('PRE')
        expect(raw.textContent).toContain('<img')
        expect(part(host, 'lt-preview-output')).toBeNull()
    })

    test('MC-239 an identity sanitiser makes the same assertions fail', async () => {
        const engine = await loadPreviewEngine()
        setPreviewEngineForTests({ ...engine, previewHtml: (text: string) => ({ html: text, mediaRemoved: 0 }) })
        const { host } = mountPreview({ text: MIXED, values: { char: 'Alice', chat: {}, toggles: {} } })
        await firstRun()
        expect(() => assertSanitised(host)).toThrow()
    })
})

describe('E2-C3 a preview writes nothing outside itself', () => {
    test('a setvar is listed with its before and after, and the database, saves and scripts are untouched', async () => {
        const before = snapshot()
        const { host } = mountPreview({ text: '{{setvar::hp::5}}{{getvar::hp}}' })
        await firstRun()
        expect(part(host, 'lt-preview-writes')?.textContent).toContain('sbWrites(1)')
        const item = part(host, 'lt-preview-write') as HTMLElement
        expect(item.textContent).toContain('hp')
        expect(item.textContent).toContain('5')
        expect(snapshot()).toEqual(before)
        expect(h.mark).not.toHaveBeenCalled()
        expect(h.processScriptFull).not.toHaveBeenCalled()
    })
})

describe('E2-C4 the values rows, Copy and the user line', () => {
    const TEXT = '{{char}} {{getvar::hp}} {{getglobalvar::toggle_a}}'

    test('rows for the char, the chat variable and the toggle; an edit re-runs after 400 ms; emptying a row deletes its key', async () => {
        const { host, props } = mountPreview({ text: TEXT })
        await firstRun()
        expect(outText(host)).toBe('Live null null')
        expect(part(host, 'lt-preview-char')).not.toBeNull()
        expect(rowInput(host, 'hp')).not.toBeNull()
        expect(rowInput(host, 'toggle_a')).not.toBeNull()
        setInput(rowInput(host, 'hp'), '9')
        await advance(399)
        expect(outText(host)).toBe('Live null null')
        await advance(1)
        expect(outText(host)).toBe('Live 9 null')
        setInput(rowInput(host, 'hp'), '')
        expect(props.values.chat).toEqual({})
        setInput(part(host, 'lt-preview-char') as HTMLInputElement, 'Zed')
        await advance(400)
        expect(outputOf(host).textContent).toContain('Zed')
    })

    test('Copy fills the rows from the chat and the shared toggles without writing them', async () => {
        const chat = chatOf({ scriptstate: { $hp: '1' }, GLGlobalVariables: {} })
        const before = snapshot()
        const { host } = mountPreview({ text: TEXT, previewSource: sourceOf(chat, { toggle_a: '1' }) })
        await firstRun()
        ;(part(host, 'lt-preview-copy') as HTMLButtonElement).click()
        flushSync()
        expect(rowInput(host, 'hp').value).toBe('1')
        expect(rowInput(host, 'toggle_a').value).toBe('1')
        await advance(400)
        expect(outText(host)).toBe('Live 1 1')
        expect(chat.scriptstate).toEqual({ $hp: '1' })
        expect(snapshot()).toEqual(before)
    })

    test('Copy keeps the values the author already typed and adds the chat values beside them', async () => {
        const chat = chatOf({ scriptstate: { $hp: '1' }, GLGlobalVariables: {} })
        const { host, props } = mountPreview({ text: TEXT, previewSource: sourceOf(chat), values: { char: '', chat: { typed: 'T' }, toggles: {} } })
        await firstRun()
        ;(part(host, 'lt-preview-copy') as HTMLButtonElement).click()
        flushSync()
        expect(props.values.chat).toEqual({ typed: 'T', hp: '1' })
    })

    test('with no chat Copy is disabled and says why', async () => {
        const { host } = mountPreview({ text: TEXT })
        await firstRun()
        expect((part(host, 'lt-preview-copy') as HTMLButtonElement).disabled).toBe(true)
        expect(part(host, 'lt-preview-copy-reason')?.textContent).toBe('sbCopyNoChat')
    })

    test('the user line shows the source chat\'s bound persona, with the note that it is not changed here', async () => {
        installDb({
            characters: [liveCharacter()],
            personas: [
                { id: 'p0', name: 'Uma', personaPrompt: 'P0', icon: '', note: '' },
                { id: 'p1', name: 'Pat', personaPrompt: 'PP', icon: '', note: '' },
            ],
        })
        const { host } = mountPreview({ text: '{{user}}', previewSource: sourceOf(chatOf({ bindedPersona: 'p1' })) })
        await firstRun()
        const line = part(host, 'lt-preview-user') as HTMLElement
        expect(line.textContent).toContain('Pat')
        expect(line.textContent).toContain('sbUserFrom')
        expect(outText(host)).toBe('Pat')
    })
})

describe('E2-C5 the cadence', () => {
    function spyRun(): { run: PreviewEngine['runPreview']; calls: () => number } {
        let engine: PreviewEngine | null = null
        void loadPreviewEngine().then((loaded) => { engine = loaded })
        const calls = vi.fn()
        const run: PreviewEngine['runPreview'] = (text, kind, source, values) => {
            calls()
            if (!engine) throw new Error('engine not loaded')
            return engine.runPreview(text, kind, source, values)
        }
        return { run, calls: () => calls.mock.calls.length }
    }

    test('no run while composing; one 400 ms after the composition ends; the output stays until then', async () => {
        const spy = spyRun()
        const { host, props } = mountPreview({ text: 'a {{char}}', run: spy.run })
        await firstRun()
        expect(spy.calls()).toBe(1)
        const shown = outputOf(host).innerHTML
        props.composing = true
        flushSync()
        props.text = 'b {{char}}'
        flushSync()
        await advance(3000)
        expect(spy.calls()).toBe(1)
        expect(outputOf(host).innerHTML).toBe(shown)
        props.composing = false
        flushSync()
        await advance(399)
        expect(spy.calls()).toBe(1)
        await advance(1)
        expect(spy.calls()).toBe(2)
        expect(outputOf(host).textContent).toContain('b')
    })

    test('in low power nothing runs on a pause, and each Refresh runs once', async () => {
        const spy = spyRun()
        const { host, props } = mountPreview({ text: 'a', lowPower: true, run: spy.run })
        await microtasks()
        await advance(3000)
        props.text = 'ab'
        flushSync()
        await advance(3000)
        expect(spy.calls()).toBe(0)
        ;(part(host, 'lt-preview-refresh') as HTMLButtonElement).click()
        await microtasks()
        expect(spy.calls()).toBe(1)
        ;(part(host, 'lt-preview-refresh') as HTMLButtonElement).click()
        await microtasks()
        expect(spy.calls()).toBe(2)
    })

    test('an inactive pane (a hidden tab) never runs; it runs once it becomes active', async () => {
        const spy = spyRun()
        const { props } = mountPreview({ text: 'a', active: false, run: spy.run })
        await microtasks()
        await advance(3000)
        expect(spy.calls()).toBe(0)
        props.active = true
        flushSync()
        await microtasks()
        await advance(400)
        expect(spy.calls()).toBe(1)
    })

    test('an inactive pane does not even load the engine; it loads once when it becomes active', async () => {
        const real = await loadPreviewEngine()
        const loader = vi.fn(async () => real)
        setPreviewEngineForTests(loader)
        const { host, props } = mountPreview({ text: 'a', active: false })
        await microtasks()
        await advance(3000)
        expect(loader).not.toHaveBeenCalled()
        expect(part(host, 'lt-preview-values')).toBeNull()
        props.active = true
        flushSync()
        await microtasks()
        expect(loader).toHaveBeenCalledTimes(1)
        expect(part(host, 'lt-preview-values')).not.toBeNull()
    })

    test('the Refresh button exists in low power only', async () => {
        const normal = mountPreview({ text: 'a', lowPower: false })
        await firstRun()
        expect(part(normal.host, 'lt-preview-values')).not.toBeNull()
        expect(part(normal.host, 'lt-preview-refresh')).toBeNull()
        const low = mountPreview({ text: 'a', lowPower: true })
        await microtasks()
        expect(part(low.host, 'lt-preview-refresh')).not.toBeNull()
    })
})

describe('the notes and the failure states', () => {
    test('a varying text shows the varies note; a text with none does not', async () => {
        const varying = mountPreview({ text: '{{random::a::b}}' })
        await firstRun()
        expect(part(varying.host, 'lt-preview-varies')?.textContent).toBe('sbVaries')
        const steady = mountPreview({ text: 'plain' })
        await firstRun()
        expect(part(steady.host, 'lt-preview-varies')).toBeNull()
    })

    test('a run that fails shows the error and no output', async () => {
        const { host } = mountPreview({ text: 'a', run: () => ({ ok: false }) })
        await firstRun()
        expect(part(host, 'lt-preview-error')?.textContent).toBe('sbError')
        expect(part(host, 'lt-preview-output')).toBeNull()
    })

    test('an owner that is gone shows the error and no output', async () => {
        const { host } = mountPreview({ text: 'a', previewSource: () => ({ owner: null, chat: null, globals: {} }) })
        await firstRun()
        expect(part(host, 'lt-preview-error')?.textContent).toBe('sbError')
        expect(part(host, 'lt-preview-output')).toBeNull()
    })

    test('E2-C7 a rejected engine load shows the error, renders no output and no user value', async () => {
        setPreviewEngineForTests(() => Promise.reject(new Error('load failed')))
        const { host } = mountPreview({ text: '{{user}} <b>x</b>' })
        await firstRun()
        await advance(3000)
        expect(part(host, 'lt-preview-error')?.textContent).toBe('sbError')
        expect(part(host, 'lt-preview-output')).toBeNull()
        expect(part(host, 'lt-preview-user')).toBeNull()
        expect(host.innerHTML).not.toContain('<b>x</b>')
    })
})

describe('E2-C1 the sheet', () => {
    test('a dialog titled Preview with a close button; Esc closes with a refocus; the Back layer reads open until it closes', async () => {
        const closed: boolean[] = []
        const { host } = mountPreview({ variant: 'sheet', text: 'hi', onclose: (refocus) => { closed.push(refocus) } })
        await firstRun()
        const dialog = part(host, 'lt-preview-sheet') as HTMLElement
        expect(dialog.getAttribute('role')).toBe('dialog')
        expect(dialog.getAttribute('aria-modal')).toBe('true')
        expect(document.getElementById(dialog.getAttribute('aria-labelledby') as string)?.textContent).toBe('ltPreview')
        expect(part(host, 'lt-preview-close')?.getAttribute('aria-label')).toBe('sbClose')
        expect(h.layers).toHaveLength(1)
        expect(h.layers[0].isOpen()).toBe(true)
        const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        dialog.dispatchEvent(esc)
        expect(esc.defaultPrevented).toBe(true)
        expect(closed).toEqual([true])
        expect(h.layers[0].isOpen()).toBe(false)
    })

    test('Back closes without a refocus and flips the layer', async () => {
        const closed: boolean[] = []
        mountPreview({ variant: 'sheet', text: 'hi', onclose: (refocus) => { closed.push(refocus) } })
        await microtasks()
        h.layers[0].close()
        expect(closed).toEqual([false])
        expect(h.layers[0].isOpen()).toBe(false)
    })
})
