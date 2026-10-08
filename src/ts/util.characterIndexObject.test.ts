// @vitest-environment node

/**
 * `getCharacterIndexObject` maps each character's id to its index in the list,
 * and is read by id by the sidebar. An id that Object.prototype also names
 * (`__proto__`, `constructor`) is an ordinary key: it maps to its index when a
 * character holds it, and reads `undefined` when none does.
 *
 * Drives the real `getCharacterIndexObject` of `./util` over a mocked database.
 *
 * Title labels: (R) marks a reproducer that fails against an index object that
 * is a plain `{}`; (G) marks a guard that passes with or without the change.
 */
import { describe, test, expect, vi, beforeAll } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from './storage/database.svelte'

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(),
}))

vi.mock('@tauri-apps/api/path', () => ({
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })),
}))

vi.mock('src/lib/UI/PopupList.svelte', () => ({
    default: class {},
}))

vi.mock(import('./platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('./platform'))

vi.mock(import('./characters'), () => ({
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}) as unknown as typeof import('./characters'))

vi.mock(import('./stores.svelte'), () => {
    const state = { db: {} as unknown as Database }
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('./stores.svelte')
})

vi.mock(import('./storage/database.svelte'), async () => {
    const stores = await import('./stores.svelte')
    const state = stores.DBState as unknown as { db: Database }
    return {
        getDatabase: vi.fn(() => state.db),
    } as unknown as typeof import('./storage/database.svelte')
})

let DBState: { db: Database }
let util: typeof import('./util')

beforeAll(async () => {
    DBState = (await import('./stores.svelte')).DBState as unknown as { db: Database }
    util = await import('./util')
})

function install(ids: string[]): void {
    DBState.db = { characters: ids.map((chaId) => ({ chaId, name: chaId })) } as unknown as Database
}

describe('getCharacterIndexObject', () => {
    test('(R) a character with the id __proto__ maps to its index, as an own property', () => {
        install(['a', '__proto__', 'b'])

        const index = util.getCharacterIndexObject()

        expect(Object.hasOwn(index, '__proto__')).toBe(true)
        expect(index['__proto__']).toBe(1)
        expect(index['a']).toBe(0)
        expect(index['b']).toBe(2)
    })

    test('(G) ids that Object.prototype also names map to their indices', () => {
        install(['constructor', 'toString', 'a'])

        const index = util.getCharacterIndexObject()

        expect(index['constructor']).toBe(0)
        expect(index['toString']).toBe(1)
        expect(index['a']).toBe(2)
    })

    test('(G) an id no character holds reads undefined', () => {
        install(['a'])

        expect(util.getCharacterIndexObject()['missing']).toBeUndefined()
    })

    test('(R) an id no character holds reads undefined even when Object.prototype names it', () => {
        install(['a'])

        const index = util.getCharacterIndexObject()

        expect(index['__proto__']).toBeUndefined()
        expect(index['constructor']).toBeUndefined()
    })
})
