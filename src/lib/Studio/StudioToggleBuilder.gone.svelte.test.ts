// @vitest-environment jsdom
/**
 * The toggle builder's unmount flush: held text is written before the open step closes, so the held write and the next edit stay two undo steps.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))

interface LiveCharacter {
    chaId: string
    type: string
    name: string
    license?: string
    customModuleToggle?: string
    desc?: string
    chats: { id: string, note: string }[]
    chatPage: number
}

const db = $state({ db: { characters: [] as LiveCharacter[], globalChatVariables: undefined as Record<string, string> | undefined } })
const selection = $state({ selId: 0 })

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
    }
})
vi.mock('src/ts/alertPrompts', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/alertPrompts')>()), pageCovered: () => false }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const withArguments = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const own: Record<string, unknown> = {}
    for (const key of [
        'studioTgDeleted', 'studioTgMoved', 'studioTgOptionN', 'studioTgSummarySelect', 'studioTgSummaryGroup', 'studioTgUnreadableCount', 'studioTgLineN',
        'studioTgCarryAskKey', 'studioTgCarryAskOptions', 'studioTgCarryAskKind', 'studioTgCarryAskDrop', 'studioTgCarryAskUnclear',
        'studioTgCarryAskOptionsLate', 'studioTgCarryAskOptionsLateRenamed', 'studioTgCarryOverwrite', 'studioTgCarryShared', 'studioTgCarryOldStays',
        'studioTgUsesRename', 'studioTgUsesWillChange', 'studioTgUsesSkipped', 'studioTgUsesAlsoUpdate', 'studioTgUsesKeyBlocked',
        'studioTgUsesNotLoaded', 'studioTgUsesSharedId', 'studioTgUsesMore', 'studioTgUpdated', 'studioTgUpdateUndoChanged',
    ]) own[key] = withArguments(key)
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})
// The uses list names places through the asset merge module, whose import graph reaches the image pipeline; the builder
// rows asserted here never depend on it, so this file stubs it (the uses list has its own test).
vi.mock('src/ts/studio/assets/mergeCommit', () => ({ jumpTargetOf: () => null, placeLabelOf: (_kind: string, path: string) => path }))
// The uses list is a component of its own with its own test; the builder mounts it lazily, and this stand-in shows what
// the builder passed it.
vi.mock('./StudioToggleUses.svelte', () => ({
    default: (anchor: Comment, props: { builder: { usesRenames: readonly { from: string, to: string }[] }, target: { kind: string }, chaId: string }) => {
        const element = document.createElement('div')
        element.dataset.part = 'studio-toggle-uses'
        element.textContent = `${props.builder.usesRenames.map((rename) => `${rename.from}>${rename.to}`).join(',')}|${props.target.kind}|${props.chaId}`
        anchor.before(element)
    },
}))
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import type { ToastHost } from 'src/ts/toast/toastHost.svelte'
import { compositionStart, composeText } from '../../ts/ime/tests/imeEventSequence'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { resetToggleCarrySessionForTests } from '../../ts/studio/toggleCarryPending'
import StudioToggleBuilder from './StudioToggleBuilder.svelte'

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

interface Rig {
    clock: FakeClock
    service: OwnerHistoryService
}

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

function makeRig(): Rig {
    const clock = createFakeClock()
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return { clock, service }
}

let mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []

function mountBuilder(props: { host?: ToastHost } = {}): void {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioToggleBuilder, { target: host, props: { target: { kind: 'character', chaId: 'A' }, ...props } }), host })
    flushSync()
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

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const rowsOf = () => parts('studio-toggle-row')
const field = (name: string) => part(name) as HTMLInputElement
const text = () => db.db.characters[0].customModuleToggle ?? ''
const steps = (rig: Rig) => rig.service.view(A).done.length

function type(input: HTMLInputElement, value: string): void {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function setText(value: string | undefined, extra: Partial<LiveCharacter> = {}): void {
    db.db.characters = [{ chaId: 'A', type: 'character', name: 'Alice', customModuleToggle: value, chats: [], chatPage: 0, ...extra }]
}

function keydown(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    flushSync()
    return event
}

// jsdom has no layout: the builder's measured width is whatever the test sets, reported once when it is observed.
let fakeWidth = 0
class FakeResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void { this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve(): void {}
    disconnect(): void {}
}

beforeEach(() => {
    fakeWidth = 0
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => fakeWidth })
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selection.selId = 0
    studioScreen.chaId = 'A'
    studioScreen.visitId = 'v1'
    studioScreen.open = true
})

afterEach(async () => {
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
    await unmountAll()
    localStorage.clear()
    resetToggleCarrySessionForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
})
describe('T9-DEFER-STEP: the editor writes its held text before it closes the step', () => {
    // Compatibility guard (passes before and after): the held label of row a lands in row a, never in the row opened next,
    // and the next row's edit is a step of its own.
    test('a composition held when another row opens, then a label edit there, are two steps', async () => {
        fakeWidth = 1200
        setText('a=A\nb=B\n')
        const rig = makeRig()
        mountBuilder()
        await settle()
        rowsOf()[0].click()
        flushSync()
        const label = field('studio-toggle-label')
        compositionStart(label)
        composeText(label, '하')
        rowsOf()[1].click()
        await settle()
        type(field('studio-toggle-label'), 'B2')
        await settle()
        expect(text()).toBe('a=하\nb=B2\n')
        expect(steps(rig)).toBe(2)
    })
})
