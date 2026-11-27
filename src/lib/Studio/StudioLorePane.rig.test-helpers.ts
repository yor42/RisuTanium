// The rig of the lorebook pane suites: the real history service on the memory doubles over a reactive database, the pane
// mounted for a character host (or a module host), and the DOM helpers they share. Each suite declares its own mocks of the
// page store, the save-mark counter and the alert layer, because a mock is per file.
import { flushSync, mount, unmount } from 'svelte'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { openStudioListRow, resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { loreItemIdOf } from 'src/ts/studio/ownerModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { clone, golden, makeCharacter, row } from '../../ts/studio/history/tests/objService.test-helpers'
import type { SaveAck } from '../../ts/studio/edit/saveAck.svelte'
import { resetToastHostForTests } from '../../ts/toast/toastHost.svelte'
import { setWindowGeometryForTests, allRowsGeometry } from '../../ts/windowing/windowHost.svelte'
import StudioLorePane from './StudioLorePane.svelte'

export type Row = Record<string, unknown>
export { row }

export const A = characterOwnerKey('A')
// The Studio selection key of the character owner (the folder expansion store is keyed by it).
export const STUDIO_KEY = 'character:A'

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const stubAck = { display: 'saved', canRetry: () => false, retry: () => false, noteEdit: () => {}, dispose: () => {} } as unknown as SaveAck

/** A classic folder row (`addLorebookFolder` output from the golden) under a readable key and name. */
export function folderRow(key: string, comment: string, extra: Row = {}): Row {
    return { ...clone(golden.blank.globalLore[1]), key, comment, ...extra }
}

export let service: OwnerHistoryService
export const marks = { count: 0 }

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

export function setupRig(): void {
    marks.count = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { marks.count += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    localStorage.clear()
    setWindowGeometryForTests(allRowsGeometry())
}

export async function teardownRig(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    resetStudioHistoryAccessorForTests()
    resetToastHostForTests()
    setWindowGeometryForTests(undefined)
    DBState.db = { characters: [] } as unknown as typeof DBState.db
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    localStorage.clear()
}

/** The character host's service and database: rows go to `globalLore`, with the one chat `c1` holding `localLore`. */
export async function startCharacter(globalLore: unknown[], options: { localLore?: unknown; bulk?: boolean; useExperimental?: boolean; chatReady?: boolean } = {}): Promise<OwnerHistoryService> {
    DBState.db = {
        characters: [makeCharacter({ globalLore, chats: [{ id: 'c1', note: '', fmIndex: -1, localLore: (options.localLore ?? []) as unknown[] }] })],
        bulkEnabling: options.bulk ?? false,
        useExperimental: options.useExperimental ?? false,
        loreBookDepth: 5,
        loreBookToken: 800,
    } as unknown as typeof DBState.db
    service = createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(stubAck)
    await service.whenReady(A)
    // A test of the form's own chat activation leaves the chat owner unused, so the form has to start it.
    if (options.chatReady !== false) await service.whenReady(chatOwnerKey('A', 'c1'))
    return service
}

export function mountInto(component: Parameters<typeof mount>[0], props: Record<string, unknown>): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = mount(component, { target: host, props })
    mounted.push({ app, host })
    flushSync()
    return host
}

/**
 * The pane, mounted the way StudioDetail mounts it: `itemId` is read from the Studio selection on every use (a getter), so
 * a selection writer reaches the pane through its prop. A test may override any prop, including `itemId`.
 */
export async function mountPane(overrides: Record<string, unknown> = {}): Promise<HTMLElement> {
    const props: Record<string, unknown> = { ownerType: 'character', ownerId: 'A', chaId: 'A', moduleId: null, moduleSlotIndex: null, moduleShared: false, ...overrides }
    if (!('itemId' in overrides)) Object.defineProperty(props, 'itemId', { enumerable: true, get: () => studioScreen.selectedItemId })
    const host = mountInto(StudioLorePane, props)
    await settle()
    return host
}

export function unmountLast(): Promise<void> {
    const entry = mounted.pop()
    if (entry === undefined) return Promise.resolve()
    return Promise.resolve(unmount(entry.app)).then(() => entry.host.remove())
}

// Svelte's tick() (the window host's reveal waits on it) resolves on a frame or a timer under the async mode, so a real wait sits between the two drains.
export async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await new Promise<void>((resolve) => setTimeout(resolve, 40))
    await drainMicrotasks()
    flushSync()
}

export const part = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
export const parts = (name: string): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
export const rowOf = (key: string): HTMLElement | null => Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-lore-row"]')).find((element) => element.dataset.rowKey === key) ?? null
export const inRow = (key: string, name: string): HTMLElement | null => rowOf(key)?.querySelector<HTMLElement>(`[data-part="${name}"]`) ?? null
export const rowLabels = (): string[] => parts('studio-lore-row').map((element) => element.querySelector('span.truncate')?.textContent?.trim() ?? element.textContent?.trim() ?? '')

export const lore = (): Row[] => (DBState.db.characters as unknown as { globalLore: Row[] }[])[0].globalLore
export const comments = (): unknown[] => lore().map((entry) => entry.comment)
export const doneCount = (): number => service.view(A).done.length

export async function click(element: HTMLElement | null): Promise<void> {
    if (element === null) throw new Error('no element to click')
    element.click()
    flushSync()
    await settle()
}

export async function openMenuOf(key: string): Promise<void> {
    await click(inRow(key, 'studio-lore-row-menu'))
}

export async function choose(name: string): Promise<void> {
    await click(part(name))
}

export function key(element: HTMLElement, init: KeyboardEventInit): void {
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    flushSync()
}

/** The classic outside write: a direct splice on the live list, as the classic editor makes it. */
export function outsideRemove(index: number): void {
    lore().splice(index, 1)
    flushSync()
}

/** A user open of the entry at `index` from the pane's own list (the reveal id is the item id). */
export async function openEntry(index: number): Promise<void> {
    openStudioListRow({ ownerKey: STUDIO_KEY, kind: 'lore' }, STUDIO_KEY, loreItemIdOf('A', index))
    await settle()
}

export const field = <T extends HTMLElement = HTMLInputElement>(name: string): T => {
    const found = part(name)
    if (found === null) throw new Error(`no element with data-part ${name}`)
    return found as T
}

/** An IME composition in progress: the input holds `value`, with nothing committed yet. */
export function compose(input: HTMLInputElement, value: string): void {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    input.value = value
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: value, inputType: 'insertCompositionText' }))
    flushSync()
}

/** A plain (non-composing) edit of a text or number input. */
export function typeInto(input: HTMLInputElement, value: string): void {
    input.value = value
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
    flushSync()
}

export function changeTo(input: HTMLInputElement | HTMLSelectElement, value: string): void {
    input.value = value
    input.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
}

export function focusedPart(): string | null {
    const active = document.activeElement
    return active instanceof HTMLElement ? (active.dataset.part ?? null) : null
}

export function focusedRowKey(): string | null {
    const active = document.activeElement
    return active instanceof HTMLElement ? (active.closest<HTMLElement>('[data-part="studio-lore-row"]')?.dataset.rowKey ?? null) : null
}
