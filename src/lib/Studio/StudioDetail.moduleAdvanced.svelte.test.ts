// @vitest-environment jsdom
/**
 * What the Studio detail mounts for a module's 고급 and 배경 HTML kinds: the form on the kind (also while the html kind has no
 * item), the read-only view of a shared id that reads only its own slot, and the stub that gets no form. The history service
 * is the real one on the memory doubles, over a reactive database with the real save-mark hook.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0, getFileSrc: async (path: string, use: string) => `blob:${use}:${path}` }))
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
import { resetOpenModuleIdForTests } from 'src/ts/studio/assets/openModuleForm.svelte'
import { makeCharacter, makeInput, residentModule, studioDbOf, stubModule } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
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

async function mountKind(modules: RisuModule[], kind: 'advanced' | 'html', rig: boolean = true): Promise<ModuleRig | null> {
    db.db = fixtureDb(modules)
    const made = rig ? makeModuleRig() : null
    openStudio({ owner: { type: 'module', id: modules[0].id }, kind, from: 'chat' }, null)
    mountInto(StudioScreen)
    await settle()
    if (made) await made.service.whenReady(moduleOwnerKey(modules[0].id))
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

describe('T5-SHARED: a shared id shows the given slot read-only', () => {
    const shared = () => [residentModule('M1', { name: 'First', description: 'a' }), residentModule('M1', { name: 'Second', description: 'b' })]

    test.each(['advanced', 'html'] as const)('%s: values shown, the refusal line shown, nothing writable', async (kind) => {
        const modules = shared()
        modules[0] = { ...modules[0], backgroundEmbedding: '<p>first</p>', lowLevelAccess: true }
        await mountKind(modules, kind)
        expect(part(kind === 'advanced' ? 'studio-module-advanced-form' : 'studio-module-html-form')).not.toBeNull()
        expect(part('studio-module-shared')!.textContent).toBe('studioRefusalModuleSharedId')
        if (kind === 'advanced') {
            expect(part('studio-module-shared-name')!.textContent).toBe('First')
            expect(part('studio-module-shared-description')!.textContent).toBe('a')
            expect((part('studio-module-low-level') as HTMLInputElement | null)).toBeNull()
            expect(part('studio-module-name')).toBeNull()
            const boxes = Array.from(part('studio-module-advanced-form')!.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))
            expect(boxes).toHaveLength(2)
            expect(boxes.every((box) => box.disabled)).toBe(true)
        } else {
            expect(part('studio-module-shared-background')!.textContent).toBe('<p>first</p>')
            expect(part('studio-module-background')).toBeNull()
        }
        expect(part('studio-detail-readonly')).toBeNull()
    })

    test('a slot that no longer holds the id shows no values, never the other holder\'s', async () => {
        db.db = fixtureDb(shared())
        mountInto(StudioModuleAdvancedForm, { section: 'advanced', moduleId: 'M1', slotIndex: 0, readOnlyShared: true })
        await settle()
        expect(part('studio-module-shared-name')!.textContent).toBe('First')
        db.db.modules[0] = residentModule('X', { name: 'Other' })
        flushSync()
        expect(part('studio-module-advanced-form')).toBeNull()
        expect(text()).not.toContain('Second')
        expect(text()).not.toContain('Other')
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
