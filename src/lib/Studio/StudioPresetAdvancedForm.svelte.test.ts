// @vitest-environment jsdom
/**
 * The preset advanced form over the real history service on the memory doubles, the real preset adapter and the real
 * `changeToPreset`: what each section shows for the preset's own settings, the notes, the writes of every control
 * kind, and where focus goes after an undo (including into a collapsed section).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0, selection: { selId: 0 }, quick: { open: true } }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
    readImage: () => Promise.resolve(undefined),
    saveAsset: vi.fn(),
    downloadFile: vi.fn(),
    aiWatermarkingLawApplies: () => false,
}))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: {} as unknown })
    return {
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
        CharConfigSubMenu: writable(0),
        SettingsMenuIndex: writable(-1),
        botMakerMode: writable(false),
        sideBarStore: writable(false),
        frozenSaveKeysStore: writable([]),
        selectedCharID: writable(0),
        clearCharEmotionCache: vi.fn(),
        DBState: state,
        get selIdState() { return h.selection },
        get QuickSettings() { return h.quick },
    }
})
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('src/ts/alertPrompts', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/alertPrompts')>()), pageCovered: () => false }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const withArguments = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const own: Record<string, unknown> = {}
    for (const key of ['ltProblemCount', 'ltProblemsShowAll', 'ltProblemLine', 'ltProblemFix', 'cbsUnclosed', 'cbsStrayBlockClose', 'cbsNotABlock', 'ltMacroMatches']) own[key] = withArguments(key)
    own.ltMacroRows = new Proxy({}, { get: (_target, id) => typeof id === 'string' ? `row:${id}` : undefined })
    own.errors = { jsonSchemaSyntaxError: 'SyntaxError Found', jsonSchemaUnsupportedType: 'Unsupported Type Detected' }
    own.help = new Proxy({}, { get: (_target, id) => typeof id === 'string' ? `help:${id}` : undefined })
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

import { DBState } from 'src/ts/stores.svelte'
import { changeToPreset } from 'src/ts/storage/database.svelte'
import { defaultAutoSuggestPrompt } from 'src/ts/storage/defaultPrompts'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { presetOwnerKey } from 'src/ts/studio/edit/presetTarget'
import { keylessPreset, presetNamed, seedPresetDb } from 'src/ts/studio/edit/tests/presetFixture.test-helpers'
import { placeFocusAfterHistory } from 'src/ts/studio/historyFocus'
import { createMacroIndex } from 'src/ts/studio/longText/macroIndex'
import { setMacroIndexForTests } from 'src/ts/studio/longText/macroIndexService'
import { readOwnerFields } from 'src/ts/studio/ownerFields'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioPresetAdvancedForm from './StudioPresetAdvancedForm.svelte'

const dbBag = (): Record<string, unknown> => DBState.db as unknown as Record<string, unknown>
const slotBag = (index: number): Record<string, unknown> => DBState.db.botPresets[index] as unknown as Record<string, unknown>

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

let service: OwnerHistoryService
let ids: string[]
let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function makeService(): void {
    const clock = createFakeClock()
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
}

async function mountPreset(index: number): Promise<void> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = mount(StudioPresetAdvancedForm, { target: host, props: { presetId: ids[index] } })
    mounted.push({ app, host })
    flushSync()
    await settle()
}

async function unmountAll(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
}

function seed(presets = [presetNamed('A', 'a=A'), presetNamed('B', 'b=B')], active = 0): void {
    ids = seedPresetDb(presets, active, 'a=A')
    dbBag().showUnrecommended = false
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const field = (path: string) => part(`studio-preset-${path}`)
const section = (name: string) => document.querySelector<HTMLElement>(`[data-part="studio-preset-section"][data-section="${name}"]`)
const sectionToggle = (name: string) => section(name)?.querySelector<HTMLButtonElement>('[data-part="studio-preset-section-toggle"]') ?? null

function typeIn(element: HTMLTextAreaElement | HTMLInputElement, value: string): void {
    element.value = value
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    flushSync()
}

function toggle(element: HTMLInputElement): void {
    element.checked = !element.checked
    element.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
}

beforeEach(() => {
    h.marks = 0
    resetStudioScreenForTests()
    studioScreen.visitId = 'v1'
    studioScreen.open = true
    localStorage.clear()
    seed()
    makeService()
    setMacroIndexForTests(createMacroIndex([{ name: 'char', aliases: [], summary: 'char', usage: null, docOnly: false, internalOnly: false, blockSyntax: false, deprecated: null }]))
})

afterEach(async () => {
    setMacroIndexForTests(null)
    await unmountAll()
    resetStudioHistoryAccessorForTests()
    resetStudioScreenForTests()
})

describe('S4a-T12: what the form shows for the preset\'s own settings', () => {
    test('the not-in-chat line shows for an inactive preset only, with the session banner', async () => {
        await mountPreset(1)
        expect(part('studio-preset-not-in-chat')?.textContent).toBe('studioPresetNotInChat')
        expect(part('studio-form-banner')?.textContent).toBe('studioBannerPresetSession')
        await unmountAll()
        await mountPreset(0)
        expect(part('studio-preset-not-in-chat')).toBeNull()
    })

    test('the no-template prompts show only without a prompt template, and the template note with one', async () => {
        const withTemplate = keylessPreset('T')
        seed([presetNamed('A', 'a'), withTemplate, presetNamed('N', 'n')], 0)
        makeService()
        await mountPreset(1)
        expect(Array.isArray(slotBag(1).promptTemplate)).toBe(true)
        expect(part('studio-preset-uses-template')?.textContent).toBe('studioPresetUsesTemplate')
        expect(part('studio-preset-edit-template')).not.toBeNull()
        expect(field('presetMainPrompt')).toBeNull()
        expect(field('presetJailbreak')).toBeNull()
        // The prompt options show whatever the template.
        expect(field('presetSendName')).not.toBeNull()
        await unmountAll()
        await mountPreset(2)
        expect(part('studio-preset-uses-template')).toBeNull()
        expect(field('presetMainPrompt')).not.toBeNull()
        expect(field('presetGlobalNote')).not.toBeNull()
        expect(field('presetPromptPreprocess')).not.toBeNull()
    })

    test('the schema fields show only while schema is on, and the chain-of-thought switch follows the unrecommended setting', async () => {
        await mountPreset(1)
        expect(field('presetJsonSchema')).toBeNull()
        expect(field('presetExtractJson')).toBeNull()
        expect(field('presetCustomChainOfThought')).toBeNull()
        toggle(field('presetJsonSchemaEnabled') as HTMLInputElement)
        await settle()
        expect(field('presetJsonSchema')).not.toBeNull()
        expect(field('presetExtractJson')).not.toBeNull()
        dbBag().showUnrecommended = true
        flushSync()
        expect(field('presetCustomChainOfThought')).not.toBeNull()
    })

    test('the chain-of-thought switch stays shown for the visit once it was on, after the setting goes off', async () => {
        dbBag().showUnrecommended = true
        await mountPreset(1)
        toggle(field('presetCustomChainOfThought') as HTMLInputElement)
        await settle()
        dbBag().showUnrecommended = false
        flushSync()
        expect(field('presetCustomChainOfThought')).not.toBeNull()
    })

    test('the section frame, the connections row and the provider line show; the Model section has no preset field', async () => {
        await mountPreset(1)
        for (const name of ['nameIcon', 'model', 'prompt', 'promptOptions', 'fallback', 'other']) {
            expect(section(name), name).not.toBeNull()
        }
        expect(part('settings-connections-link')?.textContent).toBe('connectionsManageLink')
        expect(part('studio-preset-provider-classic')?.textContent).toBe('studioPresetProviderClassic')
        expect(part('studio-preset-toggles-row')?.textContent).toBe('studioPresetTogglesRow(customPromptTemplateToggle,1)')
    })
})

describe('S4a-T13: the fallback-kept note', () => {
    test('shown for an inactive preset with the switch on, not for the active one and not with the switch off', async () => {
        dbBag().doNotChangeFallbackModels = true
        await mountPreset(1)
        expect(part('studio-preset-fallback-kept')?.textContent).toBe('studioPresetFallbackKept')
        await unmountAll()
        await mountPreset(0)
        expect(part('studio-preset-fallback-kept')).toBeNull()
        await unmountAll()
        dbBag().doNotChangeFallbackModels = false
        await mountPreset(1)
        expect(part('studio-preset-fallback-kept')).toBeNull()
    })
})

describe('S4a-T15: enum controls', () => {
    test('an imported unknown value is an extra disabled option, and picking an offered one writes and replaces it', async () => {
        slotBag(1).groupOtherBotRole = 'bot'
        await mountPreset(1)
        const select = field('presetGroupOtherBotRole') as HTMLSelectElement
        const unknown = [...select.options].find((option) => option.value === 'bot')
        expect(unknown?.disabled).toBe(true)
        expect(unknown?.textContent).toBe('studioPresetUnknownValue(bot)')
        expect([...select.options].filter((option) => !option.disabled).map((option) => option.value)).toEqual(['user', 'system', 'assistant'])
        select.value = 'system'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(slotBag(1).groupOtherBotRole).toBe('system')
        expect(service.undo(presetOwnerKey(ids[1]))).toEqual({ ok: true })
        expect(slotBag(1).groupOtherBotRole).toBe('bot')
    })

    test('a value the port does not offer is refused and the control goes back', async () => {
        await mountPreset(1)
        const select = field('presetSystemRoleReplacement') as HTMLSelectElement
        select.append(Object.assign(document.createElement('option'), { value: 'system', textContent: 'System' }))
        select.value = 'system'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(slotBag(1).systemRoleReplacement).toBeUndefined()
        expect(select.value).toBe('user')
    })
})

describe('S4a-T18: model-dependent rows, notes and help', () => {
    test('use instruction prompt shows only for a preset whose own model is OpenRouter', async () => {
        dbBag().aiModel = 'gpt-4o'
        slotBag(1).aiModel = 'openrouter/auto'
        await mountPreset(1)
        expect(field('presetUseInstructPrompt')).not.toBeNull()
        await unmountAll()
        await mountPreset(0)
        expect(field('presetUseInstructPrompt')).toBeNull()
        await unmountAll()
        // The reverse: the active preset is OpenRouter, the inactive one is not.
        dbBag().aiModel = 'openrouter/auto'
        slotBag(1).aiModel = 'gpt-4o'
        await mountPreset(0)
        expect(field('presetUseInstructPrompt')).not.toBeNull()
        await unmountAll()
        await mountPreset(1)
        expect(field('presetUseInstructPrompt')).toBeNull()
    })

    test('the dynamic output and the auto suggest prefix say they are not used; the clean switch names its models', async () => {
        await mountPreset(1)
        expect(document.querySelectorAll('[data-part="studio-preset-not-used"]')).toHaveLength(2)
        expect(part('studio-preset-auto-suggest-clean-models')?.textContent).toBe('studioPresetAutoSuggestCleanModels')
        for (const key of ['AutoAdjustSchema', 'Messages', 'Memory', 'ResponseTiming', 'OutputPrompt', 'ShowTypingEffect', 'Request']) {
            expect(field(`presetDynamic${key}`), key).not.toBeNull()
        }
        expect(field('presetAutoSuggestPrefix')).not.toBeNull()
        expect(field('presetAutoSuggestClean')).not.toBeNull()
    })

    test('every classic help key of the section opens its own disclosure', async () => {
        dbBag().showUnrecommended = true
        slotBag(1).jsonSchemaEnabled = true
        await mountPreset(1)
        const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-part="studio-preset-help"]')]
        expect(buttons.length).toBeGreaterThanOrEqual(17)
        for (const button of buttons) {
            expect(button.getAttribute('aria-expanded')).toBe('false')
            button.click()
            flushSync()
            expect(button.getAttribute('aria-expanded')).toBe('true')
            const text = document.getElementById(button.getAttribute('aria-controls') ?? '')
            expect(text?.textContent).toMatch(/^help:/)
        }
    })
})

describe('S4a-T20: the not-set display', () => {
    test('an inactive preset that keeps the working value shows the not-set note; off-by-absence rows and the name show none', async () => {
        const keyless = presetNamed('K', 'k')
        delete (keyless as unknown as Record<string, unknown>).mainPrompt
        keyless.name = ''
        seed([presetNamed('A', 'a'), keyless], 0)
        makeService()
        await mountPreset(1)
        const noteUnder = (path: string) => document.querySelector(`[data-path="${path}"] [data-part="studio-preset-not-set"]`)
        expect(noteUnder('presetMainPrompt')?.textContent).toBe('studioPresetNotSet')
        expect(noteUnder('presetTrimStartNewChat')).toBeNull()
        expect(noteUnder('presetDynamicMemory')).toBeNull()
        expect(noteUnder('presetName')).toBeNull()
        expect((field('presetName') as HTMLInputElement).value).toBe('')
        expect((field('presetTrimStartNewChat') as HTMLInputElement).checked).toBe(false)
        expect((field('presetDynamicMemory') as HTMLInputElement).checked).toBe(false)
    })

    test('the active preset shows no note even when its working main prompt is gone', async () => {
        delete dbBag().mainPrompt
        await mountPreset(0)
        expect(part('studio-preset-not-set')).toBeNull()
        expect((field('presetMainPrompt') as HTMLTextAreaElement).value).toBe('')
    })
})

describe('the controls write through the service', () => {
    test('a switch edits the live copy as one step, the name goes to the slot and the schema hint follows the text', async () => {
        await mountPreset(1)
        toggle(field('presetSendChatAsSystem') as HTMLInputElement)
        expect((slotBag(1).promptSettings as Record<string, unknown>).sendChatAsSystem).toBe(true)
        expect(dbBag().promptSettings).toBeUndefined()
        typeIn(field('presetName') as HTMLInputElement, 'Renamed')
        expect(slotBag(1).name).toBe('Renamed')
        expect(service.view(presetOwnerKey(ids[1])).done).toHaveLength(2)
        toggle(field('presetJsonSchemaEnabled') as HTMLInputElement)
        await settle()
        typeIn(field('presetJsonSchema') as HTMLTextAreaElement, 'interface Out {\n  broken\n}')
        await settle()
        expect(slotBag(1).jsonSchema).toBe('interface Out {\n  broken\n}')
        expect(part('studio-preset-schema-hint')?.textContent).toBe('studioPresetSchemaInvalid(SyntaxError Found)')
        typeIn(field('presetJsonSchema') as HTMLTextAreaElement, 'interface Out {\n  a: {{x}}\n}')
        await settle()
        expect(part('studio-preset-schema-hint')?.textContent).toBe('studioPresetSchemaMacros')
        typeIn(field('presetJsonSchema') as HTMLTextAreaElement, '{"type":"object"}')
        await settle()
        expect(part('studio-preset-schema-hint')).toBeNull()
    })

    test('a switch to the preset shows the value the Studio edit wrote', async () => {
        await mountPreset(1)
        toggle(field('presetOutputImageModal') as HTMLInputElement)
        changeToPreset(1)
        flushSync()
        expect(dbBag().outputImageModal).toBe(true)
        expect(part('studio-preset-not-in-chat')).toBeNull()
        expect((field('presetOutputImageModal') as HTMLInputElement).checked).toBe(true)
    })

    test('a preset that is deleted while the form is mounted leaves nothing to show', async () => {
        await mountPreset(1)
        DBState.db.botPresets.splice(1, 1)
        flushSync()
        expect(part('studio-preset-advanced-form')).toBeNull()
    })

    test('the section collapse is kept for the preset on this device and read again by a new form', async () => {
        await mountPreset(1)
        sectionToggle('other')!.click()
        flushSync()
        expect(sectionToggle('other')!.getAttribute('aria-expanded')).toBe('false')
        expect(field('presetModuleIntegration')).toBeNull()
        await unmountAll()
        await mountPreset(1)
        expect(sectionToggle('other')!.getAttribute('aria-expanded')).toBe('false')
        expect(sectionToggle('nameIcon')!.getAttribute('aria-expanded')).toBe('true')
    })
})

describe('S4a-T19: focus after undo', () => {
    async function undoWithFocus(): Promise<void> {
        const key = presetOwnerKey(ids[1])
        const before = readOwnerFields(key)
        expect(service.undo(key)).toEqual({ ok: true })
        await placeFocusAfterHistory(before, readOwnerFields(key), () => document.body, () => null)
    }

    test('two undos land on the changed fields, the Prompt options section opened first when it was collapsed', async () => {
        slotBag(1).jsonSchemaEnabled = true
        await mountPreset(1)
        const key = presetOwnerKey(ids[1])
        expect(service.editText(key, 'presetJsonSchema', '{"a":1}', 'single')).toEqual({ ok: true })
        expect(service.editText(key, 'presetGroupOtherBotRole', 'system', 'single')).toEqual({ ok: true })
        await settle()
        await undoWithFocus()
        expect(document.activeElement).toBe(field('presetGroupOtherBotRole'))
        await undoWithFocus()
        expect(document.activeElement).toBe(field('presetJsonSchema'))
        // Collapse the section, redo, and undo again: the section is revealed for the focus and its stored state is kept.
        sectionToggle('promptOptions')!.click()
        flushSync()
        expect(field('presetJsonSchema')).toBeNull()
        expect(service.redo(key)).toEqual({ ok: true })
        await settle()
        await undoWithFocus()
        expect(sectionToggle('promptOptions')!.getAttribute('aria-expanded')).toBe('true')
        expect(document.activeElement).toBe(field('presetJsonSchema'))
        expect(localStorage.getItem(`risuStudio.presetSections.${ids[1]}`)).toBe('["promptOptions"]')
    })
})

describe('S4a-F1: classic placeholders on the two fields that carry them', () => {
    test('the auto suggest prompt shows the default prompt and the inner format its template; other long fields have none', async () => {
        await mountPreset(0)
        expect((field('presetAutoSuggestPrompt') as HTMLTextAreaElement).placeholder).toBe(defaultAutoSuggestPrompt)
        expect((field('presetGroupTemplate') as HTMLTextAreaElement).placeholder).toBe("<{{char}}'s Message>\n{{slot}}\n</{{char}}'s Message>")
        const plain = field('presetMainPrompt') as HTMLTextAreaElement
        expect(plain.hasAttribute('placeholder')).toBe(false)
    })
})