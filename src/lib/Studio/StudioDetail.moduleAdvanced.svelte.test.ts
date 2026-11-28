// @vitest-environment jsdom
/**
 * What the Studio detail mounts for a module's 고급 and 배경 HTML kinds: the form on the kind (also while the html kind has no
 * item), the read-only view of a shared id that reads only its own slot, and the stub that gets no form. The history service
 * is the real one on the memory doubles, over a reactive database with the real save-mark hook.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0, saveAsset: vi.fn(), getFileSrc: async (path: string, use: string) => `blob:${use}:${path}` }))
// lorebookRepairNeed reads the module body alone; the loader's migration it sits beside pulls in the whole database layer.
vi.mock('src/ts/characters', () => ({ updateLorebooks: (book: unknown) => book }))
vi.mock('src/ts/studio/assets/assetFileState', () => ({
    openAssetFileReader: async () => ({ concurrency: 1, stateOf: async () => 'present' }),
}))
vi.mock('src/ts/alert', () => ({ alertSelect: vi.fn(), alertError: vi.fn() }))
const loader = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('src/ts/process/moduleLoader', () => ({ loadModuleStubsOf: loader.load, loadModule: vi.fn() }))

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
// The list page reaches the import, export and MCP code, which this suite does not exercise; it has its own suite.
vi.mock('./StudioModuleList.svelte', () => ({ default: () => {} }))
vi.mock('src/ts/process/modules', () => ({ refreshModules: vi.fn() }))
vi.mock('src/ts/process/moduleGuiBump', () => ({ bumpModuleGui: vi.fn() }))
vi.mock('src/ts/process/moduleRefList', () => ({
    moduleRefIdsOf: () => db.db.modules.map((row: { id: string }) => row.id),
    moduleListOf: (ids: string[]) => db.db.modules.filter((row: { id: string }) => ids.includes(row.id)),
}))
// The re-id helper's module reaches the conversion code, which this suite does not exercise.
vi.mock('src/ts/interchangeability', () => ({ convertModuleToCharacter: vi.fn() }))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import type { RisuModule } from 'src/ts/process/modules'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioModuleLoadsForTests } from 'src/ts/studio/assets/moduleStubLoad.svelte'
import { openStudioModuleId, resetOpenModuleIdForTests } from 'src/ts/studio/assets/openModuleForm.svelte'
import { makeCharacter, makeInput, residentModule, studioDbOf, stubModule } from 'src/ts/studio/studioFixtures.test-helpers'
import { closeStudio, openStudio, resetStudioScreenForTests, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { resetStudioHistoryAccessorForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { characterOwnerKey, moduleOwnerKey } from '../../ts/studio/history/ownerPhase'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import { makeModuleRig, mountInto, part, ResizeObserverStub, settle, unmountAll, type ModuleRig } from './moduleFormRig.test-helpers'
import StudioModuleAdvancedForm from './StudioModuleAdvancedForm.svelte'
import StudioScreen from './StudioScreen.svelte'

type Obj = Record<string, unknown>

function fixtureDb(modules: RisuModule[] = [residentModule('M1', { name: 'Mod One' })]) {
    const input = makeInput({ character: makeCharacter({ chaId: 'A' }), modules, enabledModules: modules.map((row) => row.id) })
    return { ...studioDbOf(input), modules: [...modules] }
}

const M1 = moduleOwnerKey('M1')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const live = (): Obj => db.db.modules[0] as unknown as Obj


async function mountKind(modules: RisuModule[], kind: 'advanced' | 'html', rig: boolean = true, ownerId: string = modules[0].id, historyId: string = ownerId.split('#')[0]): Promise<ModuleRig | null> {
    db.db = fixtureDb(modules)
    const made = rig ? makeModuleRig() : null
    openStudio({ owner: { type: 'module', id: ownerId }, kind, from: 'chat' }, null)
    mountInto(StudioScreen)
    await settle()
    if (made) await made.service.whenReady(moduleOwnerKey(historyId))
    await settle()
    return made
}

function typeInto(element: HTMLTextAreaElement | HTMLInputElement, text: string): void {
    element.value = text
    element.dispatchEvent(new InputEvent('input', { bubbles: true }))
    flushSync()
}

const input = (name: string) => part(name) as HTMLInputElement
const text = () => document.body.textContent ?? ''
const detailText = () => part('studio-detail-body')?.textContent ?? ''

beforeEach(() => {
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    resetStudioModuleLoadsForTests()
    resetOpenModuleIdForTests()
    loader.load.mockReset()
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
    vi.unstubAllGlobals()
})

describe('T5-HTML: the module 배경 HTML kind has its form', () => {
    test('an empty embedding mounts the form with no empty-kind note, no item text and no read-only note; typing writes typing steps and the form stays', async () => {
        const rig = await mountKind([{ ...residentModule('M1', { name: 'Mod One' }) } as RisuModule], 'html')
        const form = part('studio-module-html-form')
        expect(form).not.toBeNull()
        expect(detailText()).not.toContain('studioEmptyKind')
        expect(part('studio-detail-text')).toBeNull()
        expect(part('studio-detail-readonly')).toBeNull()
        const area = part('studio-module-background') as HTMLTextAreaElement
        typeInto(area, '<div>')
        typeInto(area, '<div>x</div>')
        expect(live().backgroundEmbedding).toBe('<div>x</div>')
        expect(rig!.service.view(M1).done).toHaveLength(1)
        expect(rig!.service.view(M1).done[0].label).toEqual({ kind: 'field', field: 'backgroundEmbedding' })
        await settle()
        expect(part('studio-module-html-form')).toBe(form)
        expect(part('studio-detail-item')).not.toBeNull()
        expect(part('studio-detail-text')).toBeNull()
    })

    test('backgroundEmbedding: 0 shows an empty field with the foreign note, and typing writes a string', async () => {
        await mountKind([{ ...residentModule('M1', { name: 'Mod One' }), backgroundEmbedding: 0 } as unknown as RisuModule], 'html')
        const area = part('studio-module-background') as HTMLTextAreaElement
        expect(area.value).toBe('')
        expect(text()).toContain('studioModAdvValueForeign(0)')
        typeInto(area, 'bg')
        expect(live().backgroundEmbedding).toBe('bg')
        expect(text()).not.toContain('studioModAdvValueForeign(0)')
    })

    test('the 고급 kind of a module mounts its form and none of the read-only fallbacks', async () => {
        await mountKind([residentModule('M1', { name: 'Mod One' })], 'advanced')
        expect(part('studio-module-advanced-form')).not.toBeNull()
        expect(part('studio-detail-readonly')).toBeNull()
        expect(part('studio-detail-text')).toBeNull()
    })
})

describe('T3-SHARED: the first holder of a shared id is editable on the advanced and html kinds', () => {
    const shared = () => [residentModule('M1', { name: 'First', description: 'a' }), residentModule('M1', { name: 'Second', description: 'b' })]

    // Regression reproducer: the shared id used to publish null and show the read-only view.
    test('html: the form is editable, typing lands on slot 0 only, and undo and redo run under module:M1', async () => {
        const rig = await mountKind(shared(), 'html')
        const second = JSON.stringify(db.db.modules[1])
        expect(part('studio-module-shared-copy')).toBeNull()
        expect(part('studio-module-shared-background')).toBeNull()
        typeInto(part('studio-module-background') as HTMLTextAreaElement, '<p>x</p>')
        expect(live().backgroundEmbedding).toBe('<p>x</p>')
        expect(JSON.stringify(db.db.modules[1])).toBe(second)
        expect(rig!.service.view(M1).done).toHaveLength(1)
        expect(openStudioModuleId()).toBe('M1')
        rig!.service.undo(M1)
        expect('backgroundEmbedding' in live() && live().backgroundEmbedding).toBeFalsy()
        expect(JSON.stringify(db.db.modules[1])).toBe(second)
        rig!.service.redo(M1)
        expect(live().backgroundEmbedding).toBe('<p>x</p>')
    })

    test('advanced: the name field is editable and a held composition lands on slot 0 only', async () => {
        const rig = await mountKind(shared(), 'advanced')
        const second = JSON.stringify(db.db.modules[1])
        expect(part('studio-module-shared-copy')).toBeNull()
        const field = input('studio-module-name')
        field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        field.value = 'First 하'
        field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
        flushSync()
        window.dispatchEvent(new Event('pagehide'))
        flushSync()
        expect(live().name).toBe('First 하')
        expect(JSON.stringify(db.db.modules[1])).toBe(second)
        expect(rig!.service.view(M1).done).toHaveLength(1)
    })
})

describe('T4-SHARED: a later copy is read-only and offers its own id', () => {
    const shared = () => [residentModule('M1', { name: 'First', description: 'a' }), residentModule('M1', { name: 'Second', description: 'b' })]

    // Compatibility guard on the read-only part (passes before and after); the banner button is the reproducer.
    test.each(['advanced', 'html'] as const)('%s: the given slot is shown read-only, the banner shows the note, the button and the help, and nothing is published', async (kind) => {
        const modules = shared()
        modules[1] = { ...modules[1], backgroundEmbedding: '<p>second</p>', lowLevelAccess: true }
        await mountKind(modules, kind, true, 'M1#1')
        expect(part(kind === 'advanced' ? 'studio-module-advanced-form' : 'studio-module-html-form')).not.toBeNull()
        expect(part('studio-module-shared-copy')!.textContent).toBe('studioModuleSharedIdCopy')
        expect(part('studio-module-own-id')!.textContent?.trim()).toBe('studioModuleOwnId')
        expect(part('studio-module-own-id-help')!.textContent).toBe('studioModuleOwnIdHelp')
        expect(openStudioModuleId()).toBeNull()
        if (kind === 'advanced') {
            expect(part('studio-module-shared-name')!.textContent).toBe('Second')
            expect(part('studio-module-shared-description')!.textContent).toBe('b')
            expect(part('studio-module-low-level')).toBeNull()
            expect(part('studio-module-name')).toBeNull()
            const boxes = Array.from(part('studio-module-advanced-form')!.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))
            expect(boxes.every((box) => box.disabled)).toBe(true)
        } else {
            expect(part('studio-module-shared-background')!.textContent).toBe('<p>second</p>')
            expect(part('studio-module-background')).toBeNull()
        }
        expect(part('studio-detail-readonly')).toBeNull()
    })

    test('the first holder shows no banner and no button', async () => {
        await mountKind(shared(), 'advanced')
        expect(part('studio-module-shared-copy')).toBeNull()
        expect(part('studio-module-own-id')).toBeNull()
        expect(part('studio-module-own-id-help')).toBeNull()
    })

    test('a slot that no longer holds the id shows no values, never the other holder\'s', async () => {
        db.db = fixtureDb(shared())
        mountInto(StudioModuleAdvancedForm, { section: 'advanced', moduleId: 'M1', slotIndex: 0, readOnlyCopy: true })
        await settle()
        expect(part('studio-module-shared-name')!.textContent).toBe('First')
        db.db.modules[0] = residentModule('X', { name: 'Other' })
        flushSync()
        expect(part('studio-module-advanced-form')).toBeNull()
        expect(text()).not.toContain('Second')
        expect(text()).not.toContain('Other')
    })
})

describe('T7: Give this copy its own ID', () => {
    // Regression reproducer: the button did not exist.
    test('the tap gives slot 1 a fresh id, keeps every other field, follows the selection to module:<new> on the same kind, and records nothing', async () => {
        const modules = [residentModule('M1', { name: 'First' }), { ...residentModule('M1', { name: 'Second', namespace: 'ns' }), backgroundEmbedding: '<i>b</i>' } as RisuModule]
        const rig = await mountKind(modules, 'advanced', true, 'M1#1')
        const first = db.db.modules[0]
        const before = JSON.parse(JSON.stringify(db.db.modules[1]))
        part('studio-module-own-id')!.click()
        // The helper loads on the first tap, so the write lands after the click returns.
        await vi.waitFor(() => expect(db.db.modules[1].id).not.toBe('M1'))
        flushSync()
        await settle()
        await settle()
        const fresh = db.db.modules[1].id
        expect(fresh).not.toBe('M1')
        expect(fresh).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        expect({ ...db.db.modules[1], id: 'M1' }).toEqual(before)
        expect(db.db.modules[0]).toBe(first)
        expect(studioScreen.selectedOwnerKey).toBe(moduleOwnerKey(fresh))
        expect(studioScreen.selectedKind).toBe('advanced')
        expect(studioScreen.notice).toBeNull()
        expect(part('studio-module-shared-copy')).toBeNull()
        expect(part('studio-module-name')).not.toBeNull()
        expect(openStudioModuleId()).toBe(fresh)
        expect(rig!.service.view(moduleOwnerKey(fresh)).done).toHaveLength(0)
        expect(rig!.service.view(M1).done).toHaveLength(0)
    })

    test('a row that left the list before the tap refuses: no row changes and no id is minted', async () => {
        const modules = [residentModule('M1', { name: 'First' }), residentModule('M1', { name: 'Second' })]
        await mountKind(modules, 'advanced', true, 'M1#1')
        const button = part('studio-module-own-id')!
        // The row leaves the list before the tap reaches the helper.
        db.db.modules = [db.db.modules[0]]
        const snapshot = JSON.stringify(db.db.modules)
        button.click()
        await vi.dynamicImportSettled()
        await settle()
        expect(JSON.stringify(db.db.modules)).toBe(snapshot)
        expect(db.db.modules.map((row) => row.id)).toEqual(['M1'])
    })

    // Regression reproducer: the row was read after the helper loaded, so the key `module:M1#1` named the next copy.
    test('the tapped copy removed during the helper load changes no row: the copy that took its slot keeps its id and the selection stays', async () => {
        const modules = [residentModule('M1', { name: 'A' }), residentModule('M1', { name: 'B' }), residentModule('M1', { name: 'C' })]
        await mountKind(modules, 'advanced', true, 'M1#1')
        const keyShown = studioScreen.selectedOwnerKey
        part('studio-module-own-id')!.click()
        // The list changes after the tap and before the helper chunk resolves.
        db.db.modules = [db.db.modules[0], db.db.modules[2]]
        const snapshot = JSON.stringify(db.db.modules)
        await vi.dynamicImportSettled()
        await settle()
        await settle()
        expect(JSON.stringify(db.db.modules)).toBe(snapshot)
        expect(db.db.modules.map((row) => row.id)).toEqual(['M1', 'M1'])
        expect(studioScreen.selectedOwnerKey).toBe(keyShown)
    })

    // Guard: a selection that moved during the load makes the tap do nothing.
    test('the selection moving to another later copy during the helper load changes no row', async () => {
        const modules = [residentModule('M1', { name: 'A' }), residentModule('M1', { name: 'B' }), residentModule('M1', { name: 'C' })]
        await mountKind(modules, 'advanced', true, 'M1#1')
        part('studio-module-own-id')!.click()
        setStudioSelection(moduleOwnerKey('M1#2'), 'advanced', null)
        const snapshot = JSON.stringify(db.db.modules)
        await vi.dynamicImportSettled()
        await settle()
        await settle()
        expect(JSON.stringify(db.db.modules)).toBe(snapshot)
        expect(db.db.modules.map((row) => row.id)).toEqual(['M1', 'M1', 'M1'])
        expect(studioScreen.selectedOwnerKey).toBe(moduleOwnerKey('M1#2'))
    })
})

describe('T8: the first holder changing under an open selection', () => {
    const pair = () => [residentModule('M1', { name: 'First' }), residentModule('M1', { name: 'Second' })]

    // Compatibility guard: the pre-change first holder was read-only, so no held text could land on another row.
    test('T8a: slot 0 removed from outside while a name composition is held clears the selection, drops the draft, and leaves the new first holder as it was', async () => {
        const rig = await mountKind(pair(), 'advanced')
        const other = db.db.modules[1]
        const otherBefore = JSON.stringify(other)
        const field = input('studio-module-name')
        field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        field.value = 'Held 하'
        field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
        flushSync()
        db.db.modules.splice(0, 1)
        db.db.modules = db.db.modules
        await settle()
        await settle()
        expect(db.db.modules).toHaveLength(1)
        expect(db.db.modules[0]).toBe(other)
        expect(JSON.stringify(other)).toBe(otherBefore)
        expect(rig!.service.view(M1).done).toHaveLength(0)
        expect(studioScreen.selectedOwnerKey).toBeNull()
        expect(studioScreen.notice).toBe('studioRefusalModuleGone')
    })

    test('T8b: moving from the later copy to the first holder and back keeps the selection, shows no notice, and publishes M1 only on the first holder', async () => {
        await mountKind(pair(), 'advanced', true, 'M1#1')
        expect(openStudioModuleId()).toBeNull()
        setStudioSelection('module:M1', 'advanced', null)
        await settle()
        expect(studioScreen.selectedOwnerKey).toBe('module:M1')
        expect(studioScreen.notice).toBeNull()
        expect(openStudioModuleId()).toBe('M1')
        expect(part('studio-module-name')).not.toBeNull()
        setStudioSelection('module:M1#1', 'advanced', null)
        await settle()
        expect(studioScreen.selectedOwnerKey).toBe('module:M1#1')
        expect(studioScreen.notice).toBeNull()
        expect(openStudioModuleId()).toBeNull()
        expect(part('studio-module-shared-copy')).not.toBeNull()
    })

    test('T8c: moving between the first holders of two shared ids keeps the selection and shows no notice', async () => {
        const modules = [residentModule('M1', { name: 'A1' }), residentModule('M1', { name: 'A2' }), residentModule('M2', { name: 'B1' }), residentModule('M2', { name: 'B2' })]
        await mountKind(modules, 'advanced')
        expect(openStudioModuleId()).toBe('M1')
        setStudioSelection('module:M2', 'advanced', null)
        await settle()
        await settle()
        expect(studioScreen.selectedOwnerKey).toBe('module:M2')
        expect(studioScreen.notice).toBeNull()
        expect(openStudioModuleId()).toBe('M2')
        expect(part('studio-module-name')).not.toBeNull()
    })

    test('T8d: an unshared module stays selected when an earlier unrelated row is removed', async () => {
        const modules = [residentModule('M0', { name: 'Zero' }), residentModule('M1', { name: 'One' })]
        await mountKind(modules, 'advanced', true, 'M1')
        db.db.modules.splice(0, 1)
        db.db.modules = db.db.modules
        await settle()
        await settle()
        expect(studioScreen.selectedOwnerKey).toBe('module:M1')
        expect(studioScreen.notice).toBeNull()
        expect(openStudioModuleId()).toBe('M1')
    })
})

describe('T5-STUB: a module that is not loaded gets no form', () => {
    test('T9-STUB-LINK: a refused load leaves the not-loaded line and the link to the module list', async () => {
        loader.load.mockResolvedValue({ kind: 'refused' })
        db.db = fixtureDb([stubModule('S1')])
        makeModuleRig()
        openStudio({ owner: { type: 'module', id: 'S1' }, kind: 'advanced', from: 'chat' }, null)
        mountInto(StudioScreen)
        await settle()
        await settle()
        expect(part('studio-module-advanced-form')).toBeNull()
        expect(part('studio-module-html-form')).toBeNull()
        expect(part('studio-detail-notloaded')).not.toBeNull()
        expect(part('studio-detail-classic')).toBeNull()
        expect(part('studio-module-show-in-list')!.textContent?.trim()).toBe('studioShowInModuleList')
    })
})

const twoModules = () => [residentModule('M1', { name: 'Mod One' }), residentModule('M2', { name: 'Mod Two' })]

describe('T9-GONE-DELETE: a module that an outside removal takes away clears the form and drops what it held', () => {
    // Regression reproducer: the form's unmount flush used to write M1 plus the draft over the slot that now holds M2.
    test('a namespace draft that was typed and not committed is dropped, no other module changes, the notice says the module is gone', async () => {
        const rig = await mountKind(twoModules(), 'advanced')
        const other = db.db.modules[1]
        const otherBefore = JSON.stringify(other)
        typeInto(input('studio-module-namespace'), 'draft')
        expect('namespace' in live()).toBe(false)

        // The removal an import Undo makes: the row leaves the list and the list is reassigned.
        db.db.modules.splice(0, 1)
        db.db.modules = db.db.modules
        await settle()
        await settle()

        expect(db.db.modules).toHaveLength(1)
        expect(db.db.modules[0]).toBe(other)
        expect(JSON.stringify(other)).toBe(otherBefore)
        expect(rig!.service.view(M1).done).toHaveLength(0)
        expect(studioScreen.selectedOwnerKey).toBeNull()
        expect(studioScreen.notice).toBe('studioRefusalModuleGone')
        expect(part('studio-module-advanced-form')).toBeNull()
    })

    // Regression reproducer: the form's unmount flush used to write the held name composition over the slot that now holds M2.
    test('T9-GONE-DELETE-NAME: a name composition that is still held is dropped, the next module keeps its slot and content, no step is recorded for M1', async () => {
        const rig = await mountKind(twoModules(), 'advanced')
        const other = db.db.modules[1]
        const otherBefore = JSON.stringify(other)
        const field = input('studio-module-name')
        field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        field.value = 'Mod 하'
        field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
        flushSync()
        expect(live().name).toBe('Mod One')

        db.db.modules.splice(0, 1)
        db.db.modules = db.db.modules
        await settle()
        await settle()

        expect(db.db.modules).toHaveLength(1)
        expect(db.db.modules[0]).toBe(other)
        expect(JSON.stringify(other)).toBe(otherBefore)
        expect((other as { name: string }).name).toBe('Mod Two')
        expect(rig!.service.view(M1).done).toHaveLength(0)
        expect(studioScreen.selectedOwnerKey).toBeNull()
        expect(studioScreen.notice).toBe('studioRefusalModuleGone')
    })

    // Regression reproducer: a removal that reassigns a filtered list used to record a step into the detached array.
    test('T9-GONE-DELETE-FILTER: a removal by a filtered reassignment records no step and leaves the next module as it was', async () => {
        const rig = await mountKind(twoModules(), 'advanced')
        const other = db.db.modules[1]
        const otherBefore = JSON.stringify(other)
        typeInto(input('studio-module-namespace'), 'draft')

        db.db.modules = db.db.modules.filter((row) => row.id !== 'M1')
        await settle()
        await settle()

        expect(rig!.service.view(M1).done).toHaveLength(0)
        expect(db.db.modules).toHaveLength(1)
        expect(db.db.modules[0]).toBe(other)
        expect(JSON.stringify(other)).toBe(otherBefore)
        expect(studioScreen.notice).toBe('studioRefusalModuleGone')
    })
})

describe('T9-LEAVE-FLUSH and T9-HIDE-FLUSH: a deliberate leave or a page hide keeps the held namespace', () => {
    // Compatibility guard (passes before and after): the final state only. It is one of the two guards of the form's registration.
    test('T9-LEAVE-FLUSH: choosing another owner leaves the draft on M1 as one step', async () => {
        const rig = await mountKind(twoModules(), 'advanced')
        typeInto(input('studio-module-namespace'), 'draft')
        expect('namespace' in live()).toBe(false)
        setStudioSelection(characterOwnerKey('A'), 'toggles', null)
        await settle()
        await settle()
        expect(live().namespace).toBe('draft')
        expect(rig!.service.view(M1).done).toHaveLength(1)
    })

    // Regression reproducer: the form was not registered, so a page hide wrote nothing.
    test('T9-HIDE-FLUSH: a page hide writes the draft as one step while the form stays', async () => {
        const rig = await mountKind(twoModules(), 'advanced')
        typeInto(input('studio-module-namespace'), 'draft')
        expect('namespace' in live()).toBe(false)
        window.dispatchEvent(new Event('pagehide'))
        flushSync()
        expect(live().namespace).toBe('draft')
        expect(rig!.service.view(M1).done).toHaveLength(1)
        expect(part('studio-module-advanced-form')).not.toBeNull()
    })
})

describe('T9-NAME-FLUSH: a name composition that is still held is written by the form\'s registered flush', () => {
    // T9-NAME-HIDE is a regression reproducer (the form was not registered, so a page hide wrote nothing). T9-NAME-LEAVE and
    // T9-NAME-CLOSE are compatibility guards that pass before and after; each fails when the registered closure no longer
    // flushes the name gate, because no other path writes the held composition before the form is gone.
    function holdNameComposition(text: string): void {
        const field = input('studio-module-name')
        field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        field.value = text
        field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
        flushSync()
    }

    test('T9-NAME-LEAVE: choosing another owner writes the held composition as one step', async () => {
        const rig = await mountKind(twoModules(), 'advanced')
        holdNameComposition('Mod 하')
        expect(live().name).toBe('Mod One')
        setStudioSelection(characterOwnerKey('A'), 'toggles', null)
        await settle()
        await settle()
        expect(live().name).toBe('Mod 하')
        expect(rig!.service.view(M1).done).toHaveLength(1)
    })

    test('T9-NAME-HIDE: a page hide writes the held composition while the form stays', async () => {
        const rig = await mountKind(twoModules(), 'advanced')
        holdNameComposition('Mod 하')
        expect(live().name).toBe('Mod One')
        window.dispatchEvent(new Event('pagehide'))
        flushSync()
        expect(live().name).toBe('Mod 하')
        expect(rig!.service.view(M1).done).toHaveLength(1)
        expect(part('studio-module-advanced-form')).not.toBeNull()
    })

    test('T9-NAME-CLOSE: closing the Studio writes the held composition', async () => {
        const rig = await mountKind(twoModules(), 'advanced')
        holdNameComposition('Mod 하')
        expect(live().name).toBe('Mod One')
        closeStudio()
        await settle()
        await settle()
        expect(live().name).toBe('Mod 하')
        expect(rig!.service.view(M1).done).toHaveLength(1)
    })
})

describe('T9-SHOW-IN-LIST: a loaded module links to its row in the module list', () => {
    // Regression reproducer: the button did not exist. The held draft is written by the selection change that opens the list.
    test('the button writes the held namespace draft as one step before the selection becomes the list page', async () => {
        const rig = await mountKind(twoModules(), 'advanced')
        expect(part('studio-module-show-in-list')!.textContent?.trim()).toBe('studioShowInModuleList')
        expect(part('studio-detail-classic')!.textContent?.trim()).toBe('studioOpenClassic')
        typeInto(input('studio-module-namespace'), 'draft')
        expect('namespace' in live()).toBe(false)
        part('studio-module-show-in-list')!.click()
        flushSync()
        expect(studioScreen.selectedOwnerKey).toBe('list:modules')
        expect(studioScreen.revealListRow).toBe(JSON.stringify(['m', 'M1', 0]))
        await settle()
        expect(live().namespace).toBe('draft')
        expect(rig!.service.view(M1).done).toHaveLength(1)
        expect(part('studio-module-advanced-form')).toBeNull()
    })
})

describe('T14a: the first holder of an id that is another row\'s owner id', () => {
    // Rows [X, X, "X#1"]: the third row is the first holder of the raw id "X#1" although its owner id is "X#1#2".
    test('the "X#1" row is editable: its raw id is published and a held name lands on its slot only', async () => {
        const modules = [residentModule('X', { name: 'A' }), residentModule('X', { name: 'B' }), residentModule('X#1', { name: 'C' })]
        const rig = await mountKind(modules, 'advanced', true, 'X#1#2', 'X#1')
        const others = [JSON.stringify(db.db.modules[0]), JSON.stringify(db.db.modules[1])]
        expect(part('studio-module-shared-copy')).toBeNull()
        expect(openStudioModuleId()).toBe('X#1')
        const field = input('studio-module-name')
        field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        field.value = 'C 하'
        field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
        flushSync()
        window.dispatchEvent(new Event('pagehide'))
        flushSync()
        expect((db.db.modules[2] as unknown as Obj).name).toBe('C 하')
        expect([JSON.stringify(db.db.modules[0]), JSON.stringify(db.db.modules[1])]).toEqual(others)
        expect(rig!.service.view(moduleOwnerKey('X#1')).done).toHaveLength(1)
    })
})

describe('T3-LORE: the lorebook pane of a shared id', () => {
    const entry = (comment: string) => ({ key: 'k', secondkey: '', insertorder: 1, comment, content: 'c', mode: 'normal', alwaysActive: false, selective: false })
    const lorebookModules = () => [
        { ...residentModule('M1', { name: 'First' }), lorebook: [entry('First entry')] } as unknown as RisuModule,
        { ...residentModule('M1', { name: 'Second' }), lorebook: [entry('Second entry')] } as unknown as RisuModule,
    ]
    const toggle = () => document.querySelector<HTMLButtonElement>('[data-part="studio-lore-row-toggle"]')

    // Regression reproducer: the first holder's lore pane used to be read-only for a shared id.
    test('the first holder: the pane is editable and a row toggle lands on slot 0 only', async () => {
        const rig = await mountKind(lorebookModules(), 'advanced')
        setStudioSelection('module:M1', 'lore', null)
        await settle()
        await rig!.service.whenReady(M1)
        await vi.waitFor(() => expect(toggle()?.disabled).toBe(false))
        toggle()!.click()
        flushSync()
        await settle()
        expect((db.db.modules[0] as unknown as { lorebook: { alwaysActive: boolean }[] }).lorebook[0].alwaysActive).toBe(true)
        expect((db.db.modules[1] as unknown as { lorebook: { alwaysActive: boolean }[] }).lorebook[0].alwaysActive).toBe(false)
        expect(rig!.service.view(M1).done).toHaveLength(1)
    })

    // Compatibility guard (passes before and after): a later copy's pane is read-only.
    test('a later copy: the pane shows its own entry, its toggle is disabled and the banner shows', async () => {
        await mountKind(lorebookModules(), 'advanced', true, 'M1#1')
        setStudioSelection('module:M1#1', 'lore', null)
        await settle()
        await settle()
        expect(text()).toContain('Second entry')
        expect(toggle()?.disabled).toBe(true)
        expect(part('studio-module-shared-copy')).not.toBeNull()
    })
})