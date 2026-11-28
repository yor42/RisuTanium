// @vitest-environment jsdom
/**
 * The preset locks panel over a real `$state` database and the real `setLocked` / `isLocked`: five rows in registry
 * order, a toggle writes through `setLocked` (legacy flag for the three upstream groups, `presetFieldLocks` for the
 * others, unknown and non-string members kept), and the panel reads the state back from the database, so a flag written
 * elsewhere shows at once. MOCKED: the stores module only.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/stores.svelte', () => {
    const state = $state({ db: {} as unknown })
    return { DBState: state }
})

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { LOCK_GROUPS } from 'src/ts/storage/presetLocks'
import PresetLocksPanel from './PresetLocksPanel.svelte'

const dbBag = (): Record<string, unknown> => DBState.db as unknown as Record<string, unknown>

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement } | null = null

function mountPanel(): void {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted = { app: mount(PresetLocksPanel, { target: host }), host }
    flushSync()
}

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-part="settings-preset-lock-switch"]')]
const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-part="settings-preset-lock-switch"][data-lock="${id}"]`)
const boxOf = (id: string) => rowOf(id)?.querySelector<HTMLInputElement>('input[type="checkbox"]') as HTMLInputElement

function flip(box: HTMLInputElement): void {
    box.click()
    flushSync()
}

beforeEach(() => {
    DBState.db = {} as never
})

afterEach(async () => {
    if (mounted) {
        await unmount(mounted.app)
        mounted.host.remove()
        mounted = null
    }
})

describe('PresetLocksPanel', () => {
    test('renders one row per lock group in registry order, all off on an empty database, with the title', () => {
        mountPanel()
        expect(rows().map((row) => row.dataset.lock)).toEqual(LOCK_GROUPS.map((group) => group.id))
        expect(rows()).toHaveLength(5)
        expect(rows().every((row) => row.querySelector<HTMLInputElement>('input')?.checked === false)).toBe(true)
        expect(document.querySelector('[data-part="settings-preset-locks-panel"]')?.textContent).toContain(language.presetLockTitle)
    })

    test('toggling a legacy group writes its flag and nothing in the list', () => {
        mountPanel()
        flip(boxOf('auxModels'))
        expect(dbBag().doNotChangeSeperateModels).toBe(true)
        flip(boxOf('fallbackModels'))
        expect(dbBag().doNotChangeFallbackModels).toBe(true)
        flip(boxOf('separateParameters'))
        expect(dbBag().disableSeperateParameterChangeOnPresetChange).toBe(true)
        expect(dbBag().presetFieldLocks).toBeUndefined()
        flip(boxOf('auxModels'))
        expect(dbBag().doNotChangeSeperateModels).toBe(false)
    })

    test('toggling a new group writes presetFieldLocks in registry order and leaves the flags alone', () => {
        mountPanel()
        flip(boxOf('reasoning'))
        flip(boxOf('sampling'))
        expect(dbBag().presetFieldLocks).toEqual(['sampling', 'reasoning'])
        expect(dbBag().doNotChangeSeperateModels).toBeUndefined()
        flip(boxOf('reasoning'))
        expect(dbBag().presetFieldLocks).toEqual(['sampling'])
    })

    test('unknown and non-string members of the list are kept through a toggle on and off', () => {
        dbBag().presetFieldLocks = ['futureGroup', 7, { a: 1 }, 'sampling']
        mountPanel()
        expect(boxOf('sampling').checked).toBe(true)
        flip(boxOf('reasoning'))
        expect(dbBag().presetFieldLocks).toEqual(['sampling', 'reasoning', 'futureGroup', 7, { a: 1 }])
        flip(boxOf('sampling'))
        flip(boxOf('reasoning'))
        expect(dbBag().presetFieldLocks).toEqual(['futureGroup', 7, { a: 1 }])
    })

    test('a flag or list written in the database directly shows in the row, and a row toggle shows in the database (same state both ways)', () => {
        mountPanel()
        dbBag().doNotChangeFallbackModels = true
        flushSync()
        expect(boxOf('fallbackModels').checked).toBe(true)
        dbBag().doNotChangeFallbackModels = false
        flushSync()
        expect(boxOf('fallbackModels').checked).toBe(false)
        dbBag().presetFieldLocks = ['reasoning']
        flushSync()
        expect(boxOf('reasoning').checked).toBe(true)
        expect(boxOf('sampling').checked).toBe(false)
        flip(boxOf('fallbackModels'))
        expect(dbBag().doNotChangeFallbackModels).toBe(true)
    })
})
