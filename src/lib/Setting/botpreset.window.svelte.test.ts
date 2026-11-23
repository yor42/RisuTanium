// @vitest-environment jsdom

/**
 * The preset list with 500 presets: only the rows near the view are in the page, a drag still moves a preset to a
 * position whose row is not mounted before the drag, and a tick in select mode is kept by preset id. Mounts the REAL
 * list over a `$state` database; layout is faked the way the other window tests do. "regression reproducer:" titles
 * fail against the list that mounted every row.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import 'src/ts/polyfill'
import type { Database } from 'src/ts/storage/database.svelte'

const downloadPresetBundle = vi.hoisted(() => vi.fn(async (_ids: readonly string[]) => {}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        openPresetList: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/storage/database.svelte', async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => DBState.db),
        changeToPreset: vi.fn(),
        copyPreset: vi.fn(),
        downloadPreset: vi.fn(),
        importPreset: vi.fn(),
    }
})

vi.mock('src/ts/storage/presetBundleFlow', () => ({ downloadPresetBundle }))
vi.mock('src/ts/alert', () => ({
    alertCardExport: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
}))
vi.mock('src/ts/characterCards', () => ({ openRealmUpload: vi.fn() }))
vi.mock('src/ts/process/templates/templates', () => ({ prebuiltPresets: {} }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

import { language } from 'src/lang'
import { RISU_PRESET_DRAG_TYPE } from 'src/ts/dragTypes'
import { DBState } from 'src/ts/stores.svelte'
import { setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'
import BotPreset from './botpreset.svelte'

const COUNT = 500
let frames: (() => void)[] = []
const mounted: Array<{ app: ReturnType<typeof mount>, target: HTMLElement }> = []

function runFrames(): void {
    const pending = frames
    frames = []
    for (const frame of pending) frame()
    flushSync()
}

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await Promise.resolve()
        runFrames()
    }
}

function installDb(): void {
    DBState.db = {
        botPresets: Array.from({ length: COUNT }, (_, i) => ({ name: `P${i}`, id: `p${i}` })),
        botPresetsId: 0,
        showPromptComparison: false,
    } as unknown as Database
}

async function mountList(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ app: mount(BotPreset, { target, props: { close: vi.fn() } }), target })
    await settle()
    return target
}

const wrappers = (target: HTMLElement) => Array.from(target.querySelectorAll<HTMLElement>('[data-window-key]'))
const rowButtons = (target: HTMLElement) => Array.from(target.querySelectorAll<HTMLButtonElement>('button[draggable]'))

beforeEach(() => {
    frames = []
    installDb()
    vi.clearAllMocks()
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
    for (const m of mounted.splice(0)) {
        await unmount(m.app)
        m.target.remove()
    }
    setWindowGeometryForTests(undefined)
    document.body.innerHTML = ''
})

function dragEvent(type: string, data: { dragged?: string }): Event {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
        value: {
            types: [RISU_PRESET_DRAG_TYPE], effectAllowed: '', dropEffect: '',
            setData: vi.fn(), setDragImage: vi.fn(), getData: () => data.dragged ?? '0',
        },
    })
    return event
}

describe('the windowed preset list', () => {
    test('regression reproducer: 500 presets mount only the rows near the view', async () => {
        const target = await mountList()
        const mountedRows = wrappers(target)
        expect(mountedRows.length).toBeGreaterThan(0)
        expect(mountedRows.length).toBeLessThan(60)
        expect(rowButtons(target).length).toBe(mountedRows.length)
        expect(mountedRows[0].getAttribute('aria-setsize')).toBe(String(COUNT))
    })

    test('regression reproducer: a drag to a position far below the mounted rows lands there in the whole list', async () => {
        const target = await mountList()
        const first = target.querySelector<HTMLButtonElement>('button[draggable="true"]')!
        first.dispatchEvent(dragEvent('dragstart', {}))
        await settle()
        // The drag keeps every row in the page, so a separator far below the first screen takes the drop.
        expect(wrappers(target).length).toBe(COUNT)
        const separator = wrappers(target)[450].querySelector<HTMLElement>('div[role="listitem"]')!
        separator.dispatchEvent(dragEvent('dragover', {}))
        flushSync()
        separator.dispatchEvent(dragEvent('drop', { dragged: '0' }))
        first.dispatchEvent(dragEvent('dragend', {}))
        await settle()
        const names = DBState.db.botPresets.map((preset) => preset.name)
        expect(names.length).toBe(COUNT)
        expect(names[449]).toBe('P0')
        expect(names[0]).toBe('P1')
        expect(new Set(names).size).toBe(COUNT)
        // The pins end with the drag: the window is small again.
        expect(wrappers(target).length).toBeLessThan(60)
        // The drag image element is removed on a timer; let it run before the page is torn down.
        await new Promise((resolve) => setTimeout(resolve, 5))
    })

    test('a tick in select mode is kept by preset id and sent to the export', async () => {
        const target = await mountList()
        target.querySelector<HTMLButtonElement>(`button[aria-label="${language.presetBundleSelect}"]`)!.click()
        flushSync()
        const rows = rowButtons(target)
        rows[2].click()
        flushSync()
        expect(rows[2].getAttribute('aria-pressed')).toBe('true')
        const exportButton = Array.from(target.querySelectorAll<HTMLButtonElement>('[data-select-bar] button')).at(-1)!
        exportButton.click()
        await vi.waitFor(() => expect(downloadPresetBundle).toHaveBeenCalledWith(['p2']))
    })
})
