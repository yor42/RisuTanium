// @vitest-environment jsdom
/**
 * The three hosts of the module Low Level Access confirm under the real Studio screen, History panel, restore sheet and
 * history service on the memory doubles: the Ctrl+Z key, the panel's Undo, Redo and Revert buttons and the restore sheet's
 * confirm. A `riskyConfirm` refusal opens the one risky sheet; Cancel changes nothing and says nothing; Turn on runs the
 * action with the path confirmed and pinned to the target the refusal saw. Where no question can open, the refusal shows
 * the module's own text.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0, getFileSrc: async (path: string, use: string) => `blob:${use}:${path}` }))
vi.mock('src/ts/studio/assets/assetFileState', () => ({
    openAssetFileReader: async () => ({ concurrency: 1, stateOf: async () => 'present' }),
}))

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
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { registerShell } from 'src/lib/Nexus/pattern/patternFocus'
import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { RisuModule } from 'src/ts/process/modules'
import { openStudioModuleId, resetOpenModuleIdForTests } from 'src/ts/studio/assets/openModuleForm.svelte'
import { riskyQuestion } from 'src/ts/studio/edit/riskyConfirm.svelte'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { makeCharacter, makeInput, residentModule, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { ReloadGUIPointer } from 'src/ts/stores.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { moduleOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import StudioScreen from './StudioScreen.svelte'

function fixtureDb() {
    const input = makeInput({
        character: makeCharacter({ chaId: 'A' }),
        modules: [residentModule('M1', { name: 'Mod One' }), residentModule('M2', {})],
        enabledModules: ['M1', 'M2'],
    })
    return { ...studioDbOf(input), modules: [...input.modules] }
}

const M1 = moduleOwnerKey('M1')
const CHARACTER = 'character:A'
const LOW = 'moduleLowLevelAccess'
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const moduleTarget = (id: string) => ({ owner: { type: 'module', id }, kind: 'display', from: 'chat' }) as const

// ---------------------------------------------------------------- rigs

function makeAck(clock: FakeClock): SaveAck {
    const deps: SaveAckDeps = {
        getMarkCount: () => 0,
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
let rigClock: FakeClock

function makeRig(): OwnerHistoryService {
    rigClock = createFakeClock()
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: rigClock,
        pageSession: `p${++rigCount}`,
        registerLeaveFlush: () => () => {},
        openModuleId: openStudioModuleId,
        onModuleSlotReplaced: () => ReloadGUIPointer.update((value) => value + 1),
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(rigClock))
    return service
}

// ---------------------------------------------------------------- dom helpers

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountInto(component: Parameters<typeof mount>[0]): HTMLElement {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    const app = mount(component, { target: host, props: {} })
    mounted.push({ app, host })
    flushSync()
    return host
}

async function unmountAll(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
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
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))

async function mountOnModule(id: string, panel = false): Promise<void> {
    openStudio(moduleTarget(id), null)
    mountInto(StudioScreen)
    await settle()
    if (panel) {
        part('studio-history-toggle')?.click()
        await settle()
    }
}

async function click(name: string): Promise<void> {
    part(name)!.click()
    await settle()
}

async function ctrlZ(): Promise<void> {
    part('studio')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key: 'z' }))
    flushSync()
    await settle()
}

async function escape(): Promise<void> {
    part('studio')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))
    flushSync()
    await settle()
}

const live = (): RisuModule => db.db.modules[0] as RisuModule
const flag = (): unknown => (live() as unknown as Record<string, unknown>).lowLevelAccess

// Each step is followed by a pause longer than the typing window, so two edits of the flag are two steps.
function setFlag(service: OwnerHistoryService, value: boolean): void {
    expect(service.editField(M1, LOW, value, { confirmed: [LOW] })).toEqual({ ok: true })
    rigClock.tick(2000)
}

// The module is on and then off again: the newest step is the turn-off, so an undo would turn it on.
async function turnedOffModule(panel: boolean): Promise<OwnerHistoryService> {
    const service = makeRig()
    await mountOnModule('M1', panel)
    await service.whenReady(M1)
    setFlag(service, true)
    setFlag(service, false)
    flushSync()
    return service
}

beforeEach(() => {
    tracker.character.length = 0
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
    vi.unstubAllGlobals()
})

describe('T5-HOST-KEY: Ctrl+Z on a turn-off step', () => {
    test('opens the risky sheet; Cancel says nothing and changes nothing; Turn on turns the flag on', async () => {
        const service = await turnedOffModule(false)
        const steps = service.view(M1).done.length
        await ctrlZ()
        expect(part('studio-risky-confirm')).not.toBeNull()
        expect(part('studio-risky-confirm')!.textContent).toContain('studioModAdvLowLevelAskBody(Mod One)')
        expect(part('studio-risky-confirm-title')!.textContent).toBe('studioModAdvLowLevelAskTitle')
        expect(part('studio-risky-confirm-ok')!.textContent).toBe('studioModAdvLowLevelAskConfirm')
        expect(flag()).toBe(false)
        await click('studio-risky-confirm-cancel')
        expect(part('studio-risky-confirm')).toBeNull()
        expect(studioScreen.notice).toBeNull()
        expect(flag()).toBe(false)
        expect(service.view(M1).done).toHaveLength(steps)
        await ctrlZ()
        expect(part('studio-risky-confirm')).not.toBeNull()
        await click('studio-risky-confirm-ok')
        expect(part('studio-risky-confirm')).toBeNull()
        expect(flag()).toBe(true)
        expect(service.view(M1).done).toHaveLength(steps - 1)
    })
})

describe('T5-HOST-STALE: a step landed while the sheet is open makes Turn on refuse, at each host', () => {
    const nameOf = (): unknown => (live() as unknown as Record<string, unknown>).name

    function expectNothingElseLanded(service: OwnerHistoryService, newest: string, undone: number): void {
        expect(flag()).toBe(false)
        expect(nameOf()).toBe('N')
        expect(service.view(M1).done.at(-1)?.id).toBe(newest)
        expect(service.view(M1).undone).toHaveLength(undone)
    }

    test('Ctrl+Z', async () => {
        const service = await turnedOffModule(false)
        await ctrlZ()
        expect(part('studio-risky-confirm')).not.toBeNull()
        expect(service.editText(M1, 'moduleName', 'N', 'single')).toEqual({ ok: true })
        const newest = service.view(M1).done.at(-1)!.id
        await click('studio-risky-confirm-ok')
        expect(part('studio-risky-confirm')).toBeNull()
        expectNothingElseLanded(service, newest, 0)
    })

    test('the History panel Undo', async () => {
        const service = await turnedOffModule(true)
        await click('studio-history-undo')
        expect(part('studio-risky-confirm')).not.toBeNull()
        expect(service.editText(M1, 'moduleName', 'N', 'single')).toEqual({ ok: true })
        const newest = service.view(M1).done.at(-1)!.id
        await click('studio-risky-confirm-ok')
        expect(part('studio-risky-confirm')).toBeNull()
        expectNothingElseLanded(service, newest, 0)
    })

    test('the History panel Redo', async () => {
        const service = await turnedOffModule(true)
        expect(await service.replay(M1, { kind: 'undo', confirmed: [LOW] })).toMatchObject({ ok: true })
        expect(await service.replay(M1, { kind: 'undo' })).toMatchObject({ ok: true })
        flushSync()
        await click('studio-history-redo')
        expect(part('studio-risky-confirm')).not.toBeNull()
        // A new edit clears the redo stack, so the step the sheet was opened for is gone.
        expect(service.editText(M1, 'moduleName', 'N', 'single')).toEqual({ ok: true })
        const newest = service.view(M1).done.at(-1)!.id
        await click('studio-risky-confirm-ok')
        expect(part('studio-risky-confirm')).toBeNull()
        expect(flag()).toBeUndefined()
        expect(nameOf()).toBe('N')
        expect(service.view(M1).done.at(-1)?.id).toBe(newest)
    })
})

describe('T5-HOST-PANEL: the History panel buttons', () => {
    test('Undo: Cancel leaves the panel message unset and focus on the Undo button, Turn on lands', async () => {
        const service = await turnedOffModule(true)
        const done = service.view(M1).done.length
        const undoButton = part('studio-history-undo')!
        undoButton.focus()
        await click('studio-history-undo')
        expect(part('studio-risky-confirm')).not.toBeNull()
        await click('studio-risky-confirm-cancel')
        expect(part('studio-history-message')).toBeNull()
        expect(flag()).toBe(false)
        expect(service.view(M1).done).toHaveLength(done)
        expect(service.view(M1).undone).toHaveLength(0)
        expect(document.activeElement).toBe(undoButton)
        await click('studio-history-undo')
        await click('studio-risky-confirm-ok')
        expect(flag()).toBe(true)
        expect(service.view(M1).undone).toHaveLength(1)
    })

    test('Redo of a turn-on: refused into the sheet, Turn on lands', async () => {
        const service = await turnedOffModule(true)
        // Undo the turn-off (confirmed), then undo the turn-on (on to off, no ask): the turn-on step is the one to redo.
        expect(await service.replay(M1, { kind: 'undo', confirmed: [LOW] })).toMatchObject({ ok: true })
        expect(await service.replay(M1, { kind: 'undo' })).toMatchObject({ ok: true })
        flushSync()
        expect(flag()).toBeUndefined()
        await click('studio-history-redo')
        expect(part('studio-risky-confirm')).not.toBeNull()
        await click('studio-risky-confirm-cancel')
        expect(part('studio-history-message')).toBeNull()
        expect(flag()).toBeUndefined()
        expect(service.view(M1).done).toHaveLength(0)
        expect(service.view(M1).undone).toHaveLength(2)
        await click('studio-history-redo')
        await click('studio-risky-confirm-ok')
        expect(flag()).toBe(true)
    })

    test('Revert to the turn-on step: Cancel changes nothing, Turn on lands', async () => {
        const service = await turnedOffModule(true)
        const turnOn = service.view(M1).done[0].id
        const revert = parts('studio-history-step').find((row) => row.dataset.stepId === turnOn)!.querySelector<HTMLElement>('[data-part="studio-history-revert"]')!
        revert.click()
        await settle()
        expect(part('studio-risky-confirm')).not.toBeNull()
        await click('studio-risky-confirm-cancel')
        expect(part('studio-history-message')).toBeNull()
        expect(flag()).toBe(false)
        expect(service.view(M1).done).toHaveLength(2)
        expect(service.view(M1).undone).toHaveLength(0)
        revert.click()
        await settle()
        await click('studio-risky-confirm-ok')
        expect(flag()).toBe(true)
    })
})

describe('T5-HOST-RESTORE: the restore sheet confirm', () => {
    async function openedRestore(): Promise<OwnerHistoryService> {
        db.db.modules[0] = { ...live(), lowLevelAccess: true } as RisuModule
        const service = makeRig()
        await mountOnModule('M1', true)
        await service.whenReady(M1)
        expect(service.editField(M1, LOW, false)).toEqual({ ok: true })
        service.closeOpenStep(M1)
        flushSync()
        await click('studio-history-restore-open')
        expect(part('studio-restore-sheet')).not.toBeNull()
        return service
    }

    test('the risky sheet opens over it, no refusal line shows, Cancel leaves both, Turn on restores', async () => {
        await openedRestore()
        await click('studio-restore-confirm')
        expect(part('studio-risky-confirm')).not.toBeNull()
        expect(part('studio-restore-sheet')).not.toBeNull()
        expect(part('studio-restore-refusal')).toBeNull()
        await click('studio-risky-confirm-cancel')
        expect(part('studio-risky-confirm')).toBeNull()
        expect(part('studio-restore-sheet')).not.toBeNull()
        expect(part('studio-restore-refusal')).toBeNull()
        expect(flag()).toBe(false)
        await click('studio-restore-confirm')
        await click('studio-risky-confirm-ok')
        expect(flag()).toBe(true)
        expect(part('studio-restore-sheet')).toBeNull()
    })
})

describe('U-2: a confirmed revert is pinned to the step list the refusal saw', () => {
    test('a step that landed while the sheet was open makes Turn on refuse; the new step stays on top', async () => {
        const service = await turnedOffModule(true)
        const turnOn = service.view(M1).done[0].id
        parts('studio-history-step').find((row) => row.dataset.stepId === turnOn)!.querySelector<HTMLElement>('[data-part="studio-history-revert"]')!.click()
        await settle()
        expect(part('studio-risky-confirm')).not.toBeNull()
        expect(service.editText(M1, 'moduleName', 'N', 'single')).toEqual({ ok: true })
        const newest = service.view(M1).done.at(-1)!.id
        await click('studio-risky-confirm-ok')
        expect(part('studio-risky-confirm')).toBeNull()
        expect(flag()).toBe(false)
        expect((live() as unknown as Record<string, unknown>).name).toBe('N')
        expect(service.view(M1).done.at(-1)?.id).toBe(newest)
    })
})

describe('U-4: the module question sheet keeps the shared frame', () => {
    test('module wording without the character consequence line; a scrim tap cancels; Tab cycles the two buttons', async () => {
        const service = await turnedOffModule(false)
        await ctrlZ()
        const dialog = part('studio-risky-confirm')!
        expect(dialog.getAttribute('role')).toBe('alertdialog')
        expect(dialog.textContent).not.toContain('studioRiskyLowConsequence')
        expect(document.activeElement).toBe(part('studio-risky-confirm-cancel'))
        dialog.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' }))
        expect(document.activeElement).toBe(part('studio-risky-confirm-ok'))
        dialog.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' }))
        expect(document.activeElement).toBe(part('studio-risky-confirm-cancel'))
        dialog.parentElement!.click()
        await settle()
        expect(part('studio-risky-confirm')).toBeNull()
        expect(riskyQuestion()).toBeNull()
        expect(flag()).toBe(false)
        expect(studioScreen.notice).toBeNull()
        expect(service.view(M1).undone).toHaveLength(0)
    })
})

describe('U-6: a refusal with no question to show names Low Level Access of the module', () => {
    test('Ctrl+Z under a shell layer: no question, nothing written, the screen notice has the module text', async () => {
        const service = await turnedOffModule(false)
        const steps = service.view(M1).done.length
        // The shell layer is released on every outcome: a leaked one would block every later question.
        const release = registerShell({})
        try {
            await ctrlZ()
            expect(riskyQuestion()).toBeNull()
            expect(part('studio-risky-confirm')).toBeNull()
            expect(flag()).toBe(false)
            expect(service.view(M1).done).toHaveLength(steps)
            expect(studioScreen.notice).toContain('studioRefusalConfirmLowLevel')
        } finally {
            release()
        }
    })

    test('the restore sheet under a shell layer: its refusal line has the module text and the sheet stays open', async () => {
        db.db.modules[0] = { ...live(), lowLevelAccess: true } as RisuModule
        const service = makeRig()
        await mountOnModule('M1', true)
        await service.whenReady(M1)
        expect(service.editField(M1, LOW, false)).toEqual({ ok: true })
        service.closeOpenStep(M1)
        flushSync()
        await click('studio-history-restore-open')
        const release = registerShell({})
        try {
            await click('studio-restore-confirm')
            expect(part('studio-risky-confirm')).toBeNull()
            expect(part('studio-restore-sheet')).not.toBeNull()
            expect(part('studio-restore-refusal')!.textContent).toContain('studioRefusalConfirmLowLevel')
            expect(flag()).toBe(false)
        } finally {
            release()
        }
    })
})
describe('T5-HOST-BACK: Back, Esc and a selection change close the risky sheet first, as Cancel', () => {
    async function askingOverRestore(): Promise<void> {
        await turnedOffModule(true)
        await click('studio-history-restore-open')
        await ctrlZ()
        expect(part('studio-risky-confirm')).not.toBeNull()
    }

    test('Back closes the risky sheet and leaves the restore sheet', async () => {
        await askingOverRestore()
        dispatchBack()
        await settle()
        expect(part('studio-risky-confirm')).toBeNull()
        expect(part('studio-restore-sheet')).not.toBeNull()
        expect(flag()).toBe(false)
        expect(studioScreen.notice).toBeNull()
    })

    test('Esc closes the risky sheet before the restore sheet', async () => {
        await askingOverRestore()
        await escape()
        expect(part('studio-risky-confirm')).toBeNull()
        expect(part('studio-restore-sheet')).not.toBeNull()
        expect(flag()).toBe(false)
    })

    test('a selection change resolves the ask as Cancel and lands nothing', async () => {
        await askingOverRestore()
        setStudioSelection(CHARACTER, null, null)
        await settle()
        expect(part('studio-risky-confirm')).toBeNull()
        expect(flag()).toBe(false)
    })
})
