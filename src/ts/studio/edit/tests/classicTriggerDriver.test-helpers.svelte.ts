// Drives the real, unchanged classic trigger editors in jsdom the way a user does, so that the tests compare
// Studio's pure modules with what classic actually writes. The importing test file supplies the module mocks
// (stores, alert, util, triggers) and passes the component to mount; this file imports no component.
import { flushSync, mount, unmount } from 'svelte'
import type { Component } from 'svelte'
import { language } from 'src/lang'
import type { triggerscript } from '../../../process/triggers'

export const wait = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Lets timers and effects that classic schedules (15 to 25 ms) run before a result is read. */
export async function settle(ms = 30): Promise<void> {
    flushSync()
    await wait(ms)
    flushSync()
}

/** A plain copy of a reactive value: key order, `undefined` values and `NaN` survive. */
export function snapshotOf<T>(value: T): T {
    return $state.snapshot(value) as T
}

export interface MountedList<T> {
    target: HTMLElement
    holder: { value: T }
    app: Record<string, unknown>
}

let mounted: MountedList<unknown>[] = []

/**
 * Mounts `component` bound to a reactive holder, the way a caller binds the list, so that classic's writes
 * re-render. `extra` adds plain props (`lowLevelAble`, `idx`).
 */
export function mountBound<T>(component: Component<never>, initial: T, extra: Record<string, unknown> = {}): MountedList<T> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const holder = $state({ value: initial })
    const props = {
        get value() { return holder.value },
        set value(next: T) { holder.value = next },
        ...extra,
    }
    const app = mount(component, { target, props: props as never }) as unknown as Record<string, unknown>
    const entry: MountedList<T> = { target, holder, app }
    mounted.push(entry as MountedList<unknown>)
    flushSync()
    return entry
}

export async function unmountAll(): Promise<void> {
    for (const entry of mounted) {
        await unmount(entry.app as never).catch(() => {})
        entry.target.remove()
    }
    mounted = []
    document.body.replaceChildren()
}

export const buttonsOf = (root: ParentNode = document.body): HTMLButtonElement[] =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button'))

export function buttonByText(text: string, root: ParentNode = document.body): HTMLButtonElement {
    const found = buttonsOf(root).find((button) => button.textContent?.trim() === text)
    if (!found) throw new Error('button not found: ' + text)
    return found
}

export function buttonByLabel(label: string, root: ParentNode = document.body, index = 0): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`))[index]
    if (!found) throw new Error('button not found by label: ' + label + ' #' + index)
    return found
}

//#region V2 effect picker

export type V2EventKind = 'manual' | 'display' | 'request'

/** `[header, event]`: the shape classic's TriggerV2List edits, with the event of the given kind. */
export function v2ListWith(kind: V2EventKind, effect: unknown[] = []): triggerscript[] {
    return [
        { comment: '', type: 'manual', conditions: [], effect: [{ type: 'v2Header', code: '', indent: 0 }] },
        { comment: 'Event', type: kind, conditions: [], effect },
    ] as unknown as triggerscript[]
}

/** Opens the panel on event 1: the first button of a mounted TriggerV2List is its Edit button. */
export async function openV2Panel(): Promise<void> {
    document.body.querySelector<HTMLButtonElement>('button')!.click()
    await settle()
}

/** The trailing add button of the effect pane: the last button whose text is `...`. */
export function effectAddButton(): HTMLButtonElement {
    const dots = buttonsOf().filter((button) => button.textContent?.trim() === '...')
    const last = dots[dots.length - 1]
    if (!last) throw new Error('effect add button not found')
    return last
}

const CATEGORY_BUTTONS = 'div.md\\:flex-col > button'

export const categoryButtons = (): HTMLButtonElement[] =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>(CATEGORY_BUTTONS))

const ownText = (element: Element): string =>
    Array.from(element.childNodes).filter((node) => node.nodeType === 3).map((node) => node.textContent ?? '').join('').trim()

export const categoryLabelOf = (button: HTMLButtonElement): string => ownText(button)

/** The effect type buttons of the open category, in rendered order. */
export const typeButtons = (): HTMLButtonElement[] =>
    buttonsOf().filter((button) =>
        button.classList.contains('w-full') && button.classList.contains('text-left')
        && !button.parentElement?.classList.contains('md:flex-col')
        && button.querySelector(':scope > div') !== null)

export const typeLabelOf = (button: HTMLButtonElement): string => ownText(button.querySelector(':scope > div')!)

/** Double-clicks the add button: two clicks inside 500 ms open the picker. */
export async function openPicker(): Promise<void> {
    effectAddButton().click()
    flushSync()
    if (categoryButtons().length === 0) {
        effectAddButton().click()
        flushSync()
    }
    await settle(10)
    if (categoryButtons().length === 0) throw new Error('picker did not open')
}

export async function chooseCategory(index: number): Promise<void> {
    categoryButtons()[index].click()
    await settle(10)
}

/** Clicks the Save button of the open effect form. */
export async function saveEffectForm(): Promise<void> {
    buttonByText(language.uiCommon.save).click()
    await settle()
}

/** Picks the type button at `typeIndex` of the open category and saves the form without editing it. */
export async function pickAndSave(typeIndex: number): Promise<void> {
    typeButtons()[typeIndex].click()
    await settle(10)
    await saveEffectForm()
}

//#endregion

//#region V1 data rows

/** Opens the TriggerV1Data row: the `endflex` button toggles it. */
export async function openV1Row(): Promise<void> {
    document.body.querySelector<HTMLButtonElement>('button.endflex')!.click()
    await settle()
}

/** Clicks the add button of the conditions (`0`) or effects (`1`) section of an open V1 row. */
export async function clickV1Add(section: 0 | 1): Promise<void> {
    buttonByLabel(language.add, document.body, section).click()
    await settle()
}

/** Chooses `value` in the condition or effect type select at row `index` and fires `change`. */
export async function changeV1Type(kind: 'c' | 'e', index: number, value: string): Promise<void> {
    const select = Array.from(document.body.querySelectorAll<HTMLSelectElement>('select'))
        .find((candidate) => candidate.getAttribute('aria-labelledby')?.endsWith(`-${kind}${index}-type`))
    if (!select) throw new Error('type select not found: ' + kind + index)
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
}

//#endregion

//#region V2 effect rows

/** `[header, event, ...]` for a list of events, each holding the given effects. */
export function v2EventsWith(...events: unknown[][]): triggerscript[] {
    return [
        { comment: '', type: 'manual', conditions: [], effect: [{ type: 'v2Header', code: '', indent: 0 }] },
        ...events.map((effect, i) => ({ comment: 'Event' + (i + 1), type: 'manual', conditions: [], effect })),
    ] as unknown as triggerscript[]
}

/** Mounts a fresh TriggerV2List on the events and opens its panel on the first one. */
export async function mountV2Events(component: Component<never>, ...events: unknown[][]): Promise<MountedList<triggerscript[]>> {
    await unmountAll()
    const list = mountBound(component, v2EventsWith(...events), { lowLevelAble: true })
    await openV2Panel()
    return list
}

/** The effect rows of the open effect pane, in order: `button.break-all` appears only on effect rows. */
export const effectRowButtons = (): HTMLButtonElement[] =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('button.break-all'))

const rowButton = (index: number): HTMLButtonElement => {
    const found = effectRowButtons()[index]
    if (!found) throw new Error('effect row not found: ' + index)
    return found
}

/** The effects of event `eventIndex` (1-based, the header is 0) as a plain snapshot. */
export const effectsOf = (list: MountedList<triggerscript[]>, eventIndex = 1): unknown[] =>
    snapshotOf(list.holder.value[eventIndex].effect) as unknown[]

/** A single click: selects the row. */
export async function selectRow(index: number): Promise<void> {
    rowButton(index).click()
    await settle(10)
}

/** Two clicks inside 500 ms open the type picker above the row. */
export async function openPickerAboveRow(index: number): Promise<void> {
    rowButton(index).click()
    flushSync()
    rowButton(index).click()
    await settle(10)
    if (categoryButtons().length === 0) throw new Error('picker did not open above row ' + index)
}

/** Picks `type` from the category whose English label is `category`. */
export async function pickTypeIn(category: string, type: string): Promise<void> {
    const label = language.triggerCategories[category] || category
    const index = categoryButtons().findIndex((button) => categoryLabelOf(button) === label)
    if (index === -1) throw new Error('category not found: ' + category)
    await chooseCategory(index)
    const wanted = String(language.triggerDesc[type])
    const typeIndex = typeButtons().findIndex((button) => typeLabelOf(button) === wanted)
    if (typeIndex === -1) throw new Error('type not found: ' + type)
    typeButtons()[typeIndex].click()
    await settle(10)
}

const addElseCheckbox = (): HTMLInputElement => {
    const found = document.body.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${language.triggerInputLabels.addElse}"]`)
    if (!found) throw new Error('addElse checkbox not found')
    return found
}

export const addElseChecked = (): boolean => addElseCheckbox().checked

/** Types `text` into the source field of the open If form, the way a user edits it before pressing Save. */
export async function typeIntoIfSource(text: string): Promise<void> {
    const field = document.body.querySelector<HTMLInputElement>('input[type="text"][aria-labelledby*="-source"]')
    if (!field) throw new Error('source field not found')
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settle(10)
}

export async function toggleAddElse(): Promise<void> {
    addElseCheckbox().click()
    await settle(10)
}

/** The last button with this text: the context menu is portalled after the panel, which has its own Edit button. */
function lastButtonByText(text: string): HTMLButtonElement {
    const found = buttonsOf().filter((button) => button.textContent?.trim() === text)
    const last = found[found.length - 1]
    if (!last) throw new Error('button not found: ' + text)
    return last
}

const contextMenuEvent = (): MouseEvent =>
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })

/** Opens the context menu of effect row `index` and clicks the menu entry with this label. */
export async function contextMenuOnRow(index: number, entry: string): Promise<void> {
    rowButton(index).dispatchEvent(contextMenuEvent())
    await settle(10)
    lastButtonByText(entry).click()
    await settle(10)
}

/** Opens the context menu of the trailing add button (no row selected) and clicks the entry. */
export async function contextMenuOnEnd(entry: string): Promise<void> {
    effectAddButton().dispatchEvent(contextMenuEvent())
    await settle(10)
    lastButtonByText(entry).click()
    await settle(10)
}

/** Selects the `n`-th event of the trigger pane (0-based among the events, the header excluded). */
export async function selectEvent(n: number): Promise<void> {
    const items = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button.trigger-item'))
    if (!items[n]) throw new Error('event not found: ' + n)
    items[n].click()
    await settle()
}

/** Presses a key on the window, the way classic's page-wide key handler receives it. */
export async function pressKey(key: string, init: KeyboardEventInit = {}): Promise<void> {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
    await settle(10)
}

/** Selects row `index` and deletes it with the Delete key. */
export async function deleteRowByKey(index: number): Promise<void> {
    await selectRow(index)
    await pressKey('Delete')
}

/** Selects row `index` and presses Alt+ArrowUp or Alt+ArrowDown. */
export async function altArrowOnRow(index: number, direction: 'up' | 'down'): Promise<void> {
    await selectRow(index)
    await pressKey(direction === 'up' ? 'ArrowUp' : 'ArrowDown', { altKey: true })
}

interface DataTransferStub {
    types: string[]
    effectAllowed: string
    dropEffect: string
    setData: (type: string, data: string) => void
    getData: (type: string) => string
    setDragImage: () => void
}

function dataTransferStub(): DataTransferStub {
    const store = new Map<string, string>()
    return {
        get types() { return Array.from(store.keys()) },
        effectAllowed: 'uninitialized',
        dropEffect: 'none',
        setData: (type, data) => { store.set(type, data) },
        getData: (type) => store.get(type) ?? '',
        setDragImage: () => {},
    } as DataTransferStub
}

function dragEvent(type: 'dragstart' | 'drop' | 'dragend', transfer: DataTransferStub): Event {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    return event
}

/** The drag handle of effect row `index`: the draggable child of the row's container. End and Else rows have none. */
export function dragHandleOfRow(index: number): HTMLElement | null {
    return rowButton(index).parentElement?.querySelector<HTMLElement>(':scope > div[draggable]') ?? null
}

/** The drop zone before row `to`, or the end zone when `to` is the number of rows; looked up inside the effect pane. */
export function dropZoneBefore(to: number): HTMLElement {
    const rows = effectRowButtons()
    const zone = to < rows.length
        ? rows[to].parentElement?.previousElementSibling
        : rows[rows.length - 1].parentElement?.nextElementSibling
    if (!(zone instanceof HTMLElement)) throw new Error('drop zone not found: ' + to)
    return zone
}

/**
 * Drags effect row `from` onto the zone before row `to` the way a user does. Classic removes its drag image in a
 * zero-delay timer, so the drag waits before the caller tears the component down.
 */
export async function dragRow(from: number, to: number): Promise<void> {
    const handle = dragHandleOfRow(from)
    if (!handle) throw new Error('row has no drag handle: ' + from)
    const transfer = dataTransferStub()
    handle.dispatchEvent(dragEvent('dragstart', transfer))
    flushSync()
    dropZoneBefore(to).dispatchEvent(dragEvent('drop', transfer))
    flushSync()
    handle.dispatchEvent(dragEvent('dragend', transfer))
    await settle(30)
}

//#endregion
