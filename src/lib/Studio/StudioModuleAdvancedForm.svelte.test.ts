// @vitest-environment jsdom
/**
 * The module 고급 form under the real Studio screen, history service on the memory doubles and a reactive database with the
 * real save-mark hook. Each module is built by its producer: the create-shaped module, a replace import of a `.risum`
 * body, a nameless and a foreign-typed import, and a character converted to a module.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0, getFileSrc: async (path: string, use: string) => `blob:${use}:${path}` }))
vi.mock('src/ts/studio/assets/assetFileState', () => ({
    openAssetFileReader: async () => ({ concurrency: 1, stateOf: async () => 'present' }),
}))
vi.mock('src/ts/alert', () => ({ alertSelect: vi.fn(), alertError: vi.fn() }))

// Filled by `beforeEach`: the fixture's own constants are not defined yet at this point.
const db = $state({ db: {} as ReturnType<typeof fixtureDb> })
const selection = $state({ selId: 0 })
const quickSettings = $state({ open: true })

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
    }
    return {
        ...stores,
        get DBState() { return db },
        get selIdState() { return selection },
        get QuickSettings() { return quickSettings },
    }
})
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('src/ts/process/modules', () => ({ refreshModules: vi.fn() }))
vi.mock('src/ts/process/moduleGuiBump', () => ({ bumpModuleGui: vi.fn() }))
vi.mock('src/ts/process/moduleRefList', () => ({
    moduleRefIdsOf: () => db.db.modules.map((row: { id: string }) => row.id),
    moduleListOf: (ids: string[]) => db.db.modules.filter((row: { id: string }) => ids.includes(row.id)),
}))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { applyModulePlacement } from 'src/ts/process/moduleDuplicates'
import type { RisuModule } from 'src/ts/process/modules'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetOpenModuleIdForTests } from 'src/ts/studio/assets/openModuleForm.svelte'
import { makeCharacter, makeInput, residentModule, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { resetStudioHistoryAccessorForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { moduleOwnerKey } from '../../ts/studio/history/ownerPhase'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import { makeModuleRig, mountInto, part, ResizeObserverStub, settle, unmountAll, type ModuleRig } from './moduleFormRig.test-helpers'
import StudioScreen from './StudioScreen.svelte'

type Obj = Record<string, unknown>

function fixtureDb(modules: RisuModule[] = [residentModule('M1', { name: 'Mod One' })]) {
    const input = makeInput({ character: makeCharacter({ chaId: 'A' }), modules, enabledModules: modules.map((row) => row.id) })
    return { ...studioDbOf(input), modules: [...modules] }
}

const M1 = moduleOwnerKey('M1')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

// ---------------------------------------------------------------- fixtures, each shaped by its producer

// Create: `{name: '', description: '', id}` (the module list's new module).
const createShaped = (): Obj => ({ name: '', description: '', id: 'M1' })

// A `.risum` body placed by the import's own placement under the installed module's id.
function replaceImported(incoming: Obj): Obj {
    const rows = [createShaped()] as unknown as RisuModule[]
    applyModulePlacement(rows, incoming as unknown as RisuModule, { choice: 'replace', targetId: 'M1' })
    return rows[0] as unknown as Obj
}

const nameless = (): Obj => replaceImported(JSON.parse('{"id":"zz","description":"d","lorebook":[],"trigger":[]}') as Obj)
// `convertCharacterToModule` copies an optional `creatorNotes` into `description` and the optional flags into their keys.
const converted = (): Obj => ({ name: 'C', description: undefined, namespace: undefined, hideIcon: undefined, lowLevelAccess: undefined, backgroundEmbedding: '', id: 'M1' })
const FOREIGN_BODY = '{"id":"zz","name":5,"description":"d","namespace":null,"hideIcon":{"x":1},"lowLevelAccess":1,"backgroundEmbedding":0}'
const foreignTyped = (): Obj => replaceImported(JSON.parse(FOREIGN_BODY) as Obj)

// ---------------------------------------------------------------- helpers

const live = (): Obj => db.db.modules[0] as unknown as Obj

async function mountForm(module: Obj, section: 'advanced' | 'html' = 'advanced'): Promise<ModuleRig> {
    db.db = fixtureDb([module as unknown as RisuModule])
    const rig = makeModuleRig()
    openStudio({ owner: { type: 'module', id: 'M1' }, kind: section, from: 'chat' }, null)
    mountInto(StudioScreen)
    await settle()
    await rig.service.whenReady(M1)
    await settle()
    return rig
}

const input = (name: string) => part(name) as HTMLInputElement
const notes = () => Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-field-note"]')).map((note) => note.textContent ?? '')

function typeInto(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
    element.value = text
    element.dispatchEvent(new InputEvent('input', { bubbles: true }))
    flushSync()
}

function blur(element: HTMLElement): void {
    element.dispatchEvent(new Event('blur'))
    flushSync()
}

async function press(name: string): Promise<void> {
    input(name).click()
    await settle()
    await settle()
}

beforeEach(() => {
    tracker.character.length = 0
    tracker.modules = false
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    resetOpenModuleIdForTests()
    db.db = fixtureDb()
    selection.selId = 0
    setStudioEnabled(true)
    setSessionAssetSizeJobForTests({ peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true } satisfies AssetSizeJob)
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    installDbWriteHook(db, { selectedChaId: () => 'A' })
})

afterEach(async () => {
    await unmountAll()
    uninstallDbWriteHook()
    setSessionAssetSizeJobForTests(undefined)
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetOpenModuleIdForTests()
    resetBackHandlersForTests()
    resetToastHostForTests()
    setStudioEnabled(false)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('T5-RISKY: the Low Level Access switch asks before it turns on', () => {
    test('Cancel leaves the flag absent with no step; Turn on writes it and announces; turning off never asks', async () => {
        const rig = await mountForm({ ...createShaped(), name: 'Mod One' })
        await press('studio-module-low-level')
        expect(part('studio-risky-sheet')).not.toBeNull()
        expect(input('studio-module-low-level').checked).toBe(false)
        expect('lowLevelAccess' in live()).toBe(false)
        part('studio-risky-cancel')!.click()
        await settle()
        expect(part('studio-risky-sheet')).toBeNull()
        expect('lowLevelAccess' in live()).toBe(false)
        expect(rig.service.view(M1).done).toHaveLength(0)
        expect(input('studio-module-low-level').checked).toBe(false)
        expect(part('studio-module-announce')!.textContent).toBe('')

        await press('studio-module-low-level')
        part('studio-risky-confirm')!.click()
        await settle()
        expect(live().lowLevelAccess).toBe(true)
        expect(input('studio-module-low-level').checked).toBe(true)
        expect(part('studio-module-announce')!.textContent).toBe('studioModAdvLowLevelOn(Mod One)')
        expect(rig.service.view(M1).done).toHaveLength(1)

        await press('studio-module-low-level')
        expect(part('studio-risky-sheet')).toBeNull()
        expect(live().lowLevelAccess).toBe(false)
        expect(input('studio-module-low-level').checked).toBe(false)
    })
})

describe('T5-NSCOMMIT: the namespace commits on blur or Enter, and only when the draft differs', () => {
    test('typing writes nothing until blur, then one step', async () => {
        const rig = await mountForm(createShaped())
        const field = input('studio-module-namespace')
        typeInto(field, 'ns')
        typeInto(field, 'ns1')
        expect('namespace' in live()).toBe(false)
        blur(field)
        expect(live().namespace).toBe('ns1')
        expect(rig.service.view(M1).done).toHaveLength(1)
    })

    test('Enter commits; Enter while an IME composes does not', async () => {
        const rig = await mountForm(createShaped())
        const field = input('studio-module-namespace')
        typeInto(field, 'ns')
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }))
        expect('namespace' in live()).toBe(false)
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        flushSync()
        expect(live().namespace).toBe('ns')
        expect(rig.service.view(M1).done).toHaveLength(1)
    })

    test.each([
        ['a create-shaped module (no namespace key)', createShaped],
        ['a foreign null namespace', () => ({ ...createShaped(), namespace: null })],
    ])('focus then blur with no typing writes and marks nothing on %s', async (_label, build) => {
        const rig = await mountForm(build())
        const before = db.db.modules[0]
        tracker.modules = false
        const field = input('studio-module-namespace')
        field.dispatchEvent(new Event('focus'))
        blur(field)
        await settle()
        expect(db.db.modules[0]).toBe(before)
        expect(rig.service.view(M1).done).toHaveLength(0)
        expect(tracker.modules).toBe(false)
    })

    test('unmounting flushes a differing draft', async () => {
        const rig = await mountForm(createShaped())
        typeInto(input('studio-module-namespace'), 'late')
        expect('namespace' in live()).toBe(false)
        await unmountAll()
        expect(live().namespace).toBe('late')
        expect(rig.service.view(M1).done).toHaveLength(1)
    })

    test('a landed change that Module Integration lists shows its note, and the note follows the live value', async () => {
        db.db = fixtureDb([{ ...createShaped(), namespace: 'old' } as unknown as RisuModule])
        ;(db.db as unknown as { moduleIntergration: string }).moduleIntergration = 'old, other'
        const rig = makeModuleRig()
        openStudio({ owner: { type: 'module', id: 'M1' }, kind: 'advanced', from: 'chat' }, null)
        mountInto(StudioScreen)
        await settle()
        await rig.service.whenReady(M1)
        const field = input('studio-module-namespace')
        typeInto(field, 'new')
        blur(field)
        expect(part('studio-module-integration-note')!.textContent).toBe('studioModAdvNamespaceIntegrationOff(old,new)')
        typeInto(field, 'other')
        blur(field)
        expect(part('studio-module-integration-note')!.textContent).toBe('studioModAdvNamespaceIntegrationOn(other)')
    })
})

describe('T5-FORM: every control follows the live module', () => {
    test('controls reflect the store, edits land, and a change that does not come from the DOM is shown', async () => {
        const rig = await mountForm({ ...createShaped(), name: 'Mod One', description: 'd1', hideIcon: false })
        expect(input('studio-module-name').value).toBe('Mod One')
        expect((part('studio-module-description') as HTMLTextAreaElement).value).toBe('d1')
        expect(input('studio-module-hide-icon').checked).toBe(false)

        typeInto(input('studio-module-name'), 'Renamed')
        expect(live().name).toBe('Renamed')
        typeInto(part('studio-module-description') as HTMLTextAreaElement, 'd2')
        expect(live().description).toBe('d2')
        await press('studio-module-hide-icon')
        expect(live().hideIcon).toBe(true)
        expect(rig.service.view(M1).done.length).toBeGreaterThanOrEqual(3)

        // Undo through the service, not the DOM: each control shows the undone value.
        expect(rig.service.undo(M1).ok).toBe(true)
        flushSync()
        expect(input('studio-module-hide-icon').checked).toBe(false)
        expect(rig.service.undo(M1).ok).toBe(true)
        flushSync()
        expect((part('studio-module-description') as HTMLTextAreaElement).value).toBe('d1')
        expect(rig.service.undo(M1).ok).toBe(true)
        flushSync()
        expect(input('studio-module-name').value).toBe('Mod One')

        // A second write through the service, after the form's own writes replaced the slot object.
        expect(rig.service.editText(M1, 'moduleName', 'FromService', 'single').ok).toBe(true)
        flushSync()
        expect(input('studio-module-name').value).toBe('FromService')
    })

    test('a refused write puts the live value back into the control and shows the refusal line', async () => {
        const rig = await mountForm({ ...createShaped(), name: 'Mod One' })
        vi.spyOn(rig.service, 'editText').mockReturnValue({ ok: false, reason: 'precondition' })
        vi.spyOn(rig.service, 'editField').mockReturnValue({ ok: false, reason: 'precondition' })
        typeInto(input('studio-module-name'), 'Nope')
        expect(input('studio-module-name').value).toBe('Mod One')
        expect(part('studio-form-refusal')!.textContent).toBe('studioRefusalPrecondition')
        await press('studio-module-hide-icon')
        expect(input('studio-module-hide-icon').checked).toBe(false)
    })
})

describe('T5-FOREIGN-FORM: absent and wrong-typed values are edited, never read-only', () => {
    test('the nameless and converted modules are fully editable and show no foreign note', async () => {
        await mountForm(nameless())
        expect(input('studio-module-name').readOnly).toBe(false)
        expect(input('studio-module-name').value).toBe('')
        expect(notes()).toEqual(['studioModAdvNameEmpty'])
        typeInto(input('studio-module-name'), 'Named')
        expect(live().name).toBe('Named')
        await unmountAll()

        await mountForm(converted())
        expect((part('studio-module-description') as HTMLTextAreaElement).value).toBe('')
        expect((part('studio-module-description') as HTMLTextAreaElement).readOnly).toBe(false)
        expect(notes()).toEqual([])
        typeInto(part('studio-module-description') as HTMLTextAreaElement, 'now text')
        expect(live().description).toBe('now text')
    })

    test('a foreign `.risum` module: the shown reading, the note, the first edit and no sheet for the turn-off', async () => {
        const rig = await mountForm(foreignTyped())
        for (const name of ['studio-module-hide-icon', 'studio-module-low-level']) expect(input(name).disabled).toBe(false)
        expect(input('studio-module-low-level').checked).toBe(true)
        expect(input('studio-module-hide-icon').checked).toBe(true)
        expect(input('studio-module-name').value).toBe('')
        expect(input('studio-module-namespace').value).toBe('')
        expect((part('studio-module-description') as HTMLTextAreaElement).value).toBe('d')
        expect(notes()).toEqual(expect.arrayContaining([
            'studioModAdvValueForeign(5)',
            'studioModAdvValueForeign(null)',
            'studioModAdvValueForeign({"x":1})',
            'studioModAdvValueForeign(1)',
        ]))

        await press('studio-module-low-level')
        expect(part('studio-risky-sheet')).toBeNull()
        expect(live().lowLevelAccess).toBe(false)
        expect(notes()).not.toContain('studioModAdvValueForeign(1)')

        const field = input('studio-module-namespace')
        typeInto(field, 'typed')
        blur(field)
        expect(live().namespace).toBe('typed')
        typeInto(input('studio-module-name'), 'Typed name')
        expect(live().name).toBe('Typed name')
        expect(rig.service.view(M1).done.length).toBeGreaterThanOrEqual(3)
    })
})
