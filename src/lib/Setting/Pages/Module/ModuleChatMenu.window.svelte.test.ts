// @vitest-environment jsdom

/**
 * `ModuleChatMenu.svelte` (the chat's module picker) with a large library: only the rows near the
 * dialog's view are in the page, the search still reaches every module, and a far row's toggle
 * acts on its own module.
 *
 * Mounts the REAL component over a real `$state` database with the window host's test geometry
 * (a 600 px band). "regression reproducer:" titles fail against the picker that mounted every row.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
        SettingsMenuIndex: writable(0),
        settingsOpen: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState } from 'src/ts/stores.svelte'
import { setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'
import ModuleChatMenu from './ModuleChatMenu.svelte'

const ROWS = 300

let frames: (() => void)[] = []

function runFrames(): void {
    const pending = frames
    frames = []
    for (const frame of pending) frame()
    flushSync()
}

function installDb(count: number): void {
    DBState.db = {
        modules: Array.from({ length: count }, (_, i) => ({ name: `m${i}`, description: '', id: `id-${i}` }) as RisuModule),
        enabledModules: [],
        characters: [{ modules: [], chatPage: 0, chats: [{ modules: [] }] }],
    } as unknown as Database
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

async function mountMenu(props: Record<string, unknown> = {}): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModuleChatMenu, { target, props }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await Promise.resolve()
    flushSync()
    runFrames()
    return target
}

const rows = (target: HTMLElement) => Array.from(target.querySelectorAll('div.pl-3.py-3')) as HTMLElement[]
const rowNames = (target: HTMLElement) => rows(target).map((r) => r.querySelector('span')?.textContent?.trim())

async function search(target: HTMLElement, text: string): Promise<void> {
    const input = target.querySelector('input') as HTMLInputElement
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    await Promise.resolve()
    flushSync()
    runFrames()
}

beforeEach(() => {
    frames = []
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

describe('the windowed chat module picker', () => {
    test('regression reproducer: a library of 300 modules mounts only the rows near the view', async () => {
        installDb(ROWS)
        const target = await mountMenu()
        const names = rowNames(target)
        expect(names[0]).toBe('m0')
        expect(names.length).toBeGreaterThan(0)
        expect(names.length).toBeLessThan(60)
    })

    test('regression reproducer: the search reaches a far module and its toggle acts on that module', async () => {
        installDb(ROWS)
        const target = await mountMenu()
        expect(rowNames(target)).not.toContain('m250')
        await search(target, 'm250')
        expect(rowNames(target)).toEqual(['m250'])
        const buttons = rows(target)[0].querySelectorAll('button')
        ;(buttons[buttons.length - 1] as HTMLButtonElement).click()
        flushSync()
        expect(DBState.db.characters[0].chats[0].modules).toEqual(['id-250'])
    })

    test('regression reproducer: in alert mode a far module is picked by its own id', async () => {
        installDb(ROWS)
        const close = vi.fn()
        const target = await mountMenu({ alertMode: true, close })
        expect(rowNames(target)).not.toContain('m199')
        await search(target, 'm199')
        rows(target)[0].querySelector('button')!.click()
        expect(close).toHaveBeenCalledWith('id-199')
    })
})
