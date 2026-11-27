// @vitest-environment jsdom
/**
 * The character 배경 HTML kind inside the Studio screen: the form on the kind (also while the field is blank), its typing
 * steps and save marks, Undo and Redo with the focus the header Undo leaves, a stored non-text value, a live character
 * replaced from outside, the strict preview of crafted markup and the kind's missing classic link. The history service is
 * the real one on the memory doubles; the preview is the real engine loaded through its lazy service.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    marks: 0,
    processScriptFull: vi.fn((): never => { throw new Error('processScriptFull must not run in a preview') }),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    readImage: vi.fn(async () => undefined),
    aiWatermarkingLawApplies: vi.fn(() => false),
    getFileSrc: vi.fn(async () => ''),
    AppendableBuffer: class {},
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    saveAsset: vi.fn(async () => ''),
}))

// The stand-ins below are the harness of LongTextPreview.svelte.test.ts: the real preview engine runs, and only storage,
// platform and script-pipeline edges are doubles.
vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })),
}))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('src/ts/util', async () => {
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
        parseKeyValue: () => [],
        sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
        selectSingleFile: vi.fn(),
        asBuffer: vi.fn(() => new Uint8Array()),
    }
})
vi.mock('src/ts/model/modellist', () => ({
    getModelInfo: vi.fn(() => ({ id: 'placeholder', name: 'Placeholder Model', shortName: 'Placeholder', internalID: 'placeholder', format: 0, provider: 0, tokenizer: 0 })),
}))
vi.mock('src/ts/media', () => ({ compressImage: vi.fn(async (v: unknown) => v) }))
vi.mock('src/ts/rpack/rpack_js', () => ({ decodeRPack: vi.fn(async () => new Uint8Array()), encodeRPack: vi.fn(async () => new Uint8Array()) }))
vi.mock('src/ts/interchangeability', () => ({ convertCharacterToModule: vi.fn(), convertModuleToCharacter: vi.fn() }))
vi.mock('src/ts/characterCards', () => ({ exportCharacterCard: vi.fn(), importCharacterProcess: vi.fn() }))
vi.mock('src/ts/process/lorebook.svelte', () => ({ convertExternalLorebook: vi.fn((v: unknown) => v) }))
// A run that reaches the script pipeline throws; a preview never does.
vi.mock('src/ts/process/scripts', () => ({
    processScript: h.processScriptFull,
    processScriptFull: h.processScriptFull,
    resetScriptCache: vi.fn(),
}))
vi.mock('katex', async () => await vi.importActual<typeof import('katex')>('katex'))

const db = $state({ db: fixtureDb() })
const selection = $state({ selId: 0 })
const quickSettings = $state({ open: true })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const stores = {
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
        CharConfigSubMenu: writable(0),
        SettingsMenuIndex: writable(-1),
        botMakerMode: writable(false),
        sideBarStore: writable(false),
        frozenSaveKeysStore: writable([]),
        selectedCharID: writable(0),
        HideIconStore: writable(false),
        moduleBackgroundEmbedding: writable(''),
        CurrentTriggerIdStore: writable(null),
    }
    return {
        ...stores,
        get DBState() { return db },
        get selIdState() { return selection },
        get QuickSettings() { return quickSettings },
    }
})
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('src/ts/alert', async () => {
    const { writable } = await import('svelte/store')
    return {
        alertError: vi.fn(),
        alertInput: vi.fn(async () => ''),
        alertNormal: vi.fn(),
        alertSelect: vi.fn(async () => ''),
        alertConfirm: vi.fn(async () => true),
        alertClear: vi.fn(),
        alertModuleSelect: vi.fn(async () => -1),
        alertStore: writable({ type: '', msg: '' }),
        alertWait: vi.fn(),
    }
})
vi.mock('src/ts/process/moduleRefList', () => ({ moduleListOf: () => [], moduleRefIdsOf: () => [] }))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { classicDestinationOf } from 'src/ts/studio/classicLinks.svelte'
import { loadPreviewEngine, setPreviewEngineForTests } from 'src/ts/studio/longText/previewEngineService'
import { resetOpenModuleIdForTests } from 'src/ts/studio/assets/openModuleForm.svelte'
import { makeCharacter, makeChat, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { allRowsGeometry, setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioScreen from './StudioScreen.svelte'

function fixtureDb(patch: Record<string, unknown> = {}) {
    const base = studioDbOf(makeInput({ character: makeCharacter({ chaId: 'A' }) }))
    const character = { ...base.characters[0], desc: 'd0', chats: [makeChat({ id: 'c1', name: 'First chat' })], ...patch }
    return { ...base, characters: [character] }
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const kindTarget = (kind: string) => ({ owner: { type: 'character', id: 'A' }, kind, from: 'chat' }) as const
const htmlTarget = kindTarget('html')

function makeAck(clock: FakeClock): SaveAck {
    const deps: SaveAckDeps = {
        getMarkCount: () => h.marks,
        getCommittedMarkCount: () => 0,
        afterNextCommit: () => {},
        requestSaveNow: () => {},
        getPeerSaveCount: () => 0,
        onStopped: () => () => {},
        isStopped: () => false,
        subscribeFailure: () => () => {},
        currentFailure: () => null,
        frozenKeys: () => new Set<string>(),
        isCharacterUnsavable: () => false,
        onPassStart: () => () => {},
        visible: () => true,
        onVisibilityChange: () => () => {},
        clock,
    }
    return createSaveAck(deps)
}

let rigCount = 0
function makeRig(): OwnerHistoryService {
    const clock = createFakeClock()
    const service = createOwnerHistoryService({ store: createMemoryStudioStore({}), claim: createClaimDouble(), clock, pageSession: `h${++rigCount}`, registerLeaveFlush: () => () => {} })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return service
}

const mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountScreen(): void {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioScreen, { target: host }), host })
    flushSync()
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
}

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
        this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve(): void {}
    disconnect(): void {}
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const area = () => part('studio-char-background') as HTMLTextAreaElement
const live = () => db.db.characters[0] as unknown as Record<string, unknown>
const detailText = () => part('studio-detail-body')?.textContent ?? ''

function typeInto(element: HTMLTextAreaElement, text: string): void {
    element.value = text
    element.dispatchEvent(new InputEvent('input', { bubbles: true }))
    flushSync()
}

async function press(name: string): Promise<HTMLElement> {
    const button = part(name) as HTMLButtonElement
    button.focus()
    button.click()
    flushSync()
    await settle()
    await settle()
    return button
}

async function open(patch: Record<string, unknown> = {}, target: typeof htmlTarget = htmlTarget, waitReady = true): Promise<OwnerHistoryService> {
    db.db = fixtureDb(patch)
    const service = makeRig()
    openStudio(target, null)
    mountScreen()
    if (waitReady) {
        await settle()
        await service.whenReady(A)
        await settle()
    }
    return service
}

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    db.db = fixtureDb()
    selection.selId = 0
    setStudioEnabled(true)
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    setWindowGeometryForTests(allRowsGeometry())
})

afterEach(async () => {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    setPreviewEngineForTests(null)
    resetStudioHistoryAccessorForTests()
    resetOpenModuleIdForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    resetToastHostForTests()
    setStudioEnabled(false)
    setWindowGeometryForTests(undefined)
    vi.unstubAllGlobals()
})

describe('T1: the character 배경 HTML kind has its form', () => {
    test('a blank field mounts the form with its parts, hint and status chip, and no item text, read-only note or empty-kind line', async () => {
        await open({ backgroundHTML: '' })
        expect(part('studio-char-html-form')).not.toBeNull()
        expect(area()).not.toBeNull()
        expect(part('studio-field-help')).not.toBeNull()
        expect(part('studio-chip')).not.toBeNull()
        expect(detailText()).toContain('studioCharHtmlHint')
        expect(detailText()).not.toContain('studioEmptyKind')
        expect(part('studio-detail-text')).toBeNull()
        expect(part('studio-detail-truncated')).toBeNull()
        expect(part('studio-detail-readonly')).toBeNull()
    })

    test('two inputs inside the coalescing window are one step with one mark per landed write, and the form stays the same element from blank to text and back', async () => {
        const service = await open({ backgroundHTML: '' })
        const form = part('studio-char-html-form')
        typeInto(area(), '<div>')
        typeInto(area(), '<div>x</div>')
        expect(live().backgroundHTML).toBe('<div>x</div>')
        expect(service.view(A).done).toHaveLength(1)
        expect(service.view(A).done[0].label).toEqual({ kind: 'field', field: 'backgroundHTML' })
        expect(h.marks).toBe(2)
        await settle()
        expect(part('studio-char-html-form')).toBe(form)
        expect(part('studio-detail-item')).toBeNull()
        expect(part('studio-detail-text')).toBeNull()
        typeInto(area(), '')
        await settle()
        expect(part('studio-char-html-form')).toBe(form)
        expect(detailText()).not.toContain('studioEmptyKind')
        expect(live().backgroundHTML).toBe('')
    })

    test('Undo and Redo of the header restore the text, and Undo leaves focus on the field', async () => {
        const service = await open({ backgroundHTML: 'h0' })
        ;(part('studio-history-toggle') as HTMLElement).click()
        await settle()
        expect(service.editText(A, 'backgroundHTML', 'h1', 'single').ok).toBe(true)
        service.closeOpenStep(A)
        flushSync()
        expect(area().value).toBe('h1')
        await press('studio-history-undo')
        expect(live().backgroundHTML).toBe('h0')
        expect(area().value).toBe('h0')
        expect(document.activeElement).toBe(area())
        await press('studio-history-redo')
        expect(live().backgroundHTML).toBe('h1')
        expect(area().value).toBe('h1')
    })

    test('a key-absent character shows the blank form, the first edit creates the key and Undo deletes it', async () => {
        const service = await open({})
        expect('backgroundHTML' in live()).toBe(false)
        typeInto(area(), 'x')
        expect(live().backgroundHTML).toBe('x')
        service.closeOpenStep(A)
        expect(service.undo(A).ok).toBe(true)
        expect('backgroundHTML' in live()).toBe(false)
    })

    test('a stored number shows an empty field with the foreign note, the first edit writes a string and Undo puts the number back', async () => {
        const service = await open({ backgroundHTML: 7 })
        expect(area().value).toBe('')
        expect(detailText()).toContain('studioModAdvValueForeign(7)')
        typeInto(area(), 'bg')
        expect(live().backgroundHTML).toBe('bg')
        expect(detailText()).not.toContain('studioModAdvValueForeign(7)')
        service.closeOpenStep(A)
        expect(service.undo(A).ok).toBe(true)
        expect(live().backgroundHTML).toBe(7)
    })

    test('the field is read-only while the history is loading', async () => {
        await open({ backgroundHTML: 'h0' }, htmlTarget, false)
        expect(area().readOnly).toBe(true)
        expect(part('studio-char-html-form')?.getAttribute('aria-busy')).toBe('true')
    })

    test('a character object assigned from outside shows its text while the field is not focused', async () => {
        await open({ backgroundHTML: 'h0' })
        expect(area().value).toBe('h0')
        db.db.characters[0] = { ...db.db.characters[0], backgroundHTML: 'from outside' }
        await settle()
        expect(area().value).toBe('from outside')
    })
})

describe('T11: crafted markup in 배경 HTML never becomes elements', () => {
    const CRAFTED = '<img src=x onerror="window.__sc1Probe=1"><script>window.__sc1Probe=2</script>"><svg onload="window.__sc1Probe=3">'
    const MARKUP = 'img, script, svg, iframe'
    const FORM_MARKUP = 'img, script, iframe, [onload], [onerror]'

    async function openPreview(): Promise<HTMLElement | null> {
        const button = part('studio-lt-preview')
        expect(button).not.toBeNull()
        button!.click()
        flushSync()
        let output: HTMLElement | null = null
        for (let turn = 0; turn < 80 && output === null; turn += 1) {
            await new Promise((resolve) => setTimeout(resolve, 50))
            flushSync()
            output = part('studio-lt-preview-output')
        }
        return output
    }

    test('the field holds the raw text, and the preview shows sanitized output only', async () => {
        setPreviewEngineForTests(() => import('src/ts/studio/longText/previewEngine'))
        await loadPreviewEngine()
        await open({ backgroundHTML: CRAFTED })
        const form = part('studio-char-html-form')!
        expect(area().value).toBe(CRAFTED)
        // The form's own icons are svg elements; crafted markup would show as an element that carries its handler.
        expect(form.querySelector(FORM_MARKUP)).toBeNull()
        const output = await openPreview()
        expect(output).not.toBeNull()
        expect(output!.querySelector(MARKUP)).toBeNull()
        expect(output!.querySelectorAll('[style]')).toHaveLength(0)
        for (const element of Array.from(output!.querySelectorAll('*'))) {
            for (const name of element.getAttributeNames()) expect(name.startsWith('on')).toBe(false)
        }
        expect(form.querySelector(FORM_MARKUP)).toBeNull()
        expect((window as unknown as { __sc1Probe?: number }).__sc1Probe).toBeUndefined()
        expect(area().value).toBe(CRAFTED)
        expect(h.processScriptFull).not.toHaveBeenCalled()
    })

    test('MC-239 an identity sanitiser makes the preview assertions fail', async () => {
        setPreviewEngineForTests(() => import('src/ts/studio/longText/previewEngine'))
        const engine = await loadPreviewEngine()
        setPreviewEngineForTests({ ...engine, previewHtml: (text: string) => ({ html: text, mediaRemoved: 0 }) })
        await open({ backgroundHTML: '<img src=x><svg></svg>' })
        const output = await openPreview()
        expect(output).not.toBeNull()
        expect(() => expect(output!.querySelector(MARKUP)).toBeNull()).toThrow()
    })
})

describe('T12: no classic link on the character 배경 HTML kind', () => {
    test('the kind has no link in the detail, and the destination is null', async () => {
        await open({ backgroundHTML: 'h0' })
        expect(part('studio-detail-classic')).toBeNull()
        expect(classicDestinationOf('character', 'html')).toBeNull()
    })

    test.each(['basic', 'display', 'advanced'])('the %s kind keeps its link', async (kind) => {
        await open({}, kindTarget(kind) as unknown as typeof htmlTarget)
        expect(part('studio-detail-classic')).not.toBeNull()
    })
})
