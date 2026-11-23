// @vitest-environment jsdom

/**
 * `RegexList.svelte` and `TriggerV1List.svelte` with a large script list: only the rows near the
 * view are in the page, and a drag-reorder still writes the dragged script to its new place in the
 * whole list. Mounts the REAL lists; `sortablejs` is a recorder whose `onEnd` the test calls after
 * moving the DOM row the way a drag does. "regression reproducer:" titles fail against the lists
 * that mounted every row.
 */
import { flushSync, mount, unmount } from 'svelte'
import type { Component } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

interface Recorded {
    el: HTMLElement
    options: { onEnd: (evt: { item: Element }) => Promise<void>, draggable?: string }
    destroyed: boolean
    destroy: () => void
}

const sortables = vi.hoisted(() => ({ created: [] as unknown[] }))

vi.mock('sortablejs', () => ({
    default: {
        create: (el: HTMLElement, options: unknown) => {
            const entry = { el, options, destroyed: false, destroy() { entry.destroyed = true } }
            sortables.created.push(entry)
            return entry
        },
    },
}))

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = { alertConfirm: vi.fn(async () => true), alertStore: writable({ type: 'none', msg: '' }) }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state, selectedCharID: writable(0), ReloadGUIPointer: writable(0), selIdState: { selId: -1 } } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
    sortableOptions: { delay: 300, delayOnTouchOnly: true, filter: '.no-sort', onMove: () => true },
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/scripts'), () => ({
    exportRegex: vi.fn(),
    importRegex: vi.fn(),
}) as unknown as typeof import('src/ts/process/scripts'))

import { setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'
import RegexList from './RegexList.svelte'
import TriggerV1List from './TriggerV1List.svelte'

const ROWS = 300
let frames: (() => void)[] = []
function runFrames(): void {
    const pending = frames
    frames = []
    for (const frame of pending) frame()
    flushSync()
}

interface Script { comment: string }
let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function mountList(component: Component<never>, value: Script[]): Promise<{ target: HTMLElement, holder: { value: Script[] } }> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    // Bound the way a caller binds it: the list sits behind a getter and setter pair.
    const holder = $state({ value })
    const app = mount(component, { target, props: {
        get value() { return holder.value },
        set value(next: Script[]) { holder.value = next },
    } as never }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await Promise.resolve()
    flushSync()
    runFrames()
    return { target, holder }
}

const lastSortable = () => sortables.created[sortables.created.length - 1] as Recorded

beforeEach(() => {
    frames = []
    sortables.created.length = 0
    setWindowGeometryForTests({
        rectOf: () => ({ top: 0, height: 600 }),
        viewport: () => 600,
        scrollBy: () => {},
        schedule: (callback) => {
            frames.push(callback)
            return () => { frames = frames.filter((frame) => frame !== callback) }
        },
    })
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    setWindowGeometryForTests(undefined)
    document.body.innerHTML = ''
})

const regexes = (): Script[] => Array.from({ length: ROWS }, (_, i) => ({ comment: `x${i}`, in: '', out: '', type: 'editinput' }))
const triggers = (): Script[] => Array.from({ length: ROWS }, (_, i) => ({ comment: `x${i}`, type: 'start', conditions: [], effect: [] }) as Script)

const cases: Array<[string, Component<never>, () => Script[], string]> = [
    ['regex list', RegexList as unknown as Component<never>, regexes, 'data-risu-idx'],
    ['V1 trigger list', TriggerV1List as unknown as Component<never>, triggers, 'data-risu-idx2'],
]

describe.each(cases)('the windowed %s', (_name, component, make, attr) => {
    test('regression reproducer: 300 scripts mount only the rows near the view', async () => {
        const { target } = await mountList(component, make())
        const count = target.querySelectorAll(`[${attr}]`).length
        expect(count).toBeGreaterThan(0)
        expect(count).toBeLessThan(60)
    })

    test('regression reproducer: a drag-reorder of a mounted row moves that script in the whole list', async () => {
        const { holder } = await mountList(component, make())
        const sortable = lastSortable()
        expect(sortable.options.draggable).toBe('[data-window-key]')
        const wrappers = Array.from(sortable.el.children).filter((c) => c.hasAttribute('data-window-key'))
        // Row 0 is dropped after row 2.
        wrappers[2].after(wrappers[0])
        await sortable.options.onEnd({ item: wrappers[0] })
        flushSync()
        const comments = holder.value.map((s) => s.comment)
        expect(comments.length).toBe(ROWS)
        expect(comments.slice(0, 4)).toEqual(['x1', 'x2', 'x0', 'x3'])
        expect(new Set(comments).size).toBe(ROWS)
    })
})
