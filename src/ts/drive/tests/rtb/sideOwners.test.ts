import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import { PLUGIN_SAFE_STORE, SAFE_PLUGIN_LS_PREFIX, UI_PREFS_KEYS, type ForageStoreConfig } from 'src/ts/drive/rtb/sideStoreConfig'
import { applySideAction, readSideStore, type SideBackends, type SideBodyReader } from 'src/ts/drive/rtb/sideStores'
import { encodeSideLine } from 'src/ts/drive/rtb/sideLines'
import { RTB_SIDE_TAGS } from 'src/ts/drive/rtb/sideTags'
import type { SideRecord } from 'src/ts/drive/rtb/rtbWriter'

const forageHost = vi.hoisted(() => {
    const stores = new Map<string, Map<string, unknown>>()
    const calls: object[] = []
    function make(options: { name: string, storeName?: string }): Record<string, unknown> {
        const id = `${options.name}/${options.storeName ?? 'keyvaluepairs'}`
        let data = stores.get(id)
        if (data === undefined) {
            data = new Map<string, unknown>()
            stores.set(id, data)
        }
        const map = data
        return {
            ready: async (): Promise<void> => {},
            keys: async (): Promise<string[]> => [...map.keys()],
            getItem: async (key: string): Promise<unknown> => (map.has(key) ? map.get(key) : null),
            setItem: async (key: string, value: unknown): Promise<unknown> => {
                map.set(key, value)
                return value
            },
            removeItem: async (key: string): Promise<void> => {
                map.delete(key)
            },
            clear: async (): Promise<void> => {
                map.clear()
            },
            iterate: async (visit: (value: unknown, key: string, n: number) => unknown): Promise<void> => {
                let n = 1
                for (const [key, value] of map) {
                    visit(value, key, n++)
                }
            },
        }
    }
    return { stores, calls, make }
})

vi.mock('localforage', () => ({
    default: {
        createInstance: (options: { name: string, storeName?: string }) => {
            forageHost.calls.push(options)
            return forageHost.make(options)
        },
    },
}))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: {} },
    selIdState: { selId: -1 },
    MobileGUI: writable(false),
}))

const backends: SideBackends = {
    forage: (config: ForageStoreConfig) => forageHost.make(config) as unknown as LocalForage,
    local: () => localStorage,
}

async function records(id: 'side.plugin-safe' | 'side.plugin-safe-ls'): Promise<SideRecord[]> {
    const input = await readSideStore(id, backends)
    if ('unreadable' in input) {
        throw new Error('unreadable')
    }
    const out: SideRecord[] = []
    for await (const record of input.records) {
        out.push(record)
    }
    return out
}

function bodyOf(key: string, value: unknown): SideBodyReader {
    const bytes = encodeSideLine(key, value, RTB_SIDE_TAGS)
    return async (sink) => {
        await sink(bytes)
        return { ok: true }
    }
}

beforeEach(() => {
    // The owner module holds its instance's map from first import, so the maps are emptied, not dropped.
    for (const data of forageHost.stores.values()) {
        data.clear()
    }
    localStorage.clear()
})

describe('the real plugin storage against the adapters (T14, guard)', () => {
    test('the owner creates its store from the shared config object', async () => {
        await import('src/ts/plugins/pluginSafeClass')
        expect(forageHost.calls).toContain(PLUGIN_SAFE_STORE)
    })

    test('values the owner writes are read by the adapter, and restored values are read by the owner', async () => {
        const { SafeLocalPluginStorage, SafeLocalStorage } = await import('src/ts/plugins/pluginSafeClass')
        const store = new SafeLocalPluginStorage()
        await store.setItem('k', { a: undefined, n: 1 })
        expect(await records('side.plugin-safe')).toStrictEqual([{ key: `${SAFE_PLUGIN_LS_PREFIX}k`, value: { a: undefined, n: 1 } }])

        const result = await applySideAction({ kind: 'restore', id: 'side.plugin-safe', row: { id: 'side.plugin-safe', v: 1, required: false, prefix: 's/plugin-safe/', entries: 1, bytes: 0, meta: null } }, bodyOf(`${SAFE_PLUGIN_LS_PREFIX}other`, 'restored'), backends)
        expect(result).toMatchObject({ status: 'ok', written: 1 })
        expect(await store.getItem('other')).toBe('restored')
        expect(await store.getItem('k')).toBeNull()

        const ls = new SafeLocalStorage()
        ls.setItem('x', 'one')
        expect(await records('side.plugin-safe-ls')).toEqual([{ key: 'x', value: 'one' }])
        await applySideAction({ kind: 'restore', id: 'side.plugin-safe-ls', row: { id: 'side.plugin-safe-ls', v: 1, required: false, prefix: 's/plugin-safe-ls/', entries: 1, bytes: 0, meta: null } }, bodyOf('y', 'two'), backends)
        expect(ls.getItem('y')).toBe('two')
        expect(ls.getItem('x')).toBeNull()
    })
})

describe('the ui-prefs owners write allowlisted keys (T15, guard)', () => {
    function written(): string[] {
        const keys: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key !== null) {
                keys.push(key)
            }
        }
        return keys
    }

    test('each write function writes exactly its key, and the key is in the allowlist', async () => {
        const haptics = await import('src/ts/chatShell/haptics')
        const uiSounds = await import('src/ts/uiSound/uiSoundPrefs')
        const device = await import('src/ts/chatShell/deviceSettings')
        const slots = await import('src/ts/chatShell/actionSlots')
        const motion = await import('src/ts/chatShell/motionPrefs.svelte')
        const favourites = await import('src/ts/chatShell/toggleFavourites')
        const grid = await import('src/lib/Others/gridMemory')
        const rail = await import('src/lib/SideBars/railMemory')
        const shell = await import('src/ts/chatShell/shellSwitch.svelte')
        const studio = await import('src/ts/studio/studioSwitch.svelte')
        const settings = await import('src/ts/settingsShell/settingsShellSwitch.svelte')
        const writes: [string, () => void][] = [
            ['risuChatShell.haptics', () => haptics.writeHaptics(true)],
            ['risutanium.uiSounds', () => uiSounds.writeUiSounds(false)],
            ['risuChatShell.enterMode', () => device.writeEnterMode('send')],
            ['risuChatShell.chatSort', () => device.writeChatSort('manual')],
            ['risuChatShell.actionSlots', () => slots.writeSlots({ order: ['copy', 'edit'], pinned: ['edit'] })],
            ['risuChatShell.reducedMotion', () => motion.setReducedMotion('on')],
            ['risuChatShell.reduceCardEffects', () => motion.setReduceCardEffects(true)],
            ['risuChatShell.toggleFavourites', () => favourites.changeFavourites({ type: 'add', ref: { s: 'a', k: 'b' } }, [])],
            ['risutanium.grid.sort', () => grid.saveGridSort('name')],
            ['risutanium.library.tab', () => grid.saveLibraryTab(1)],
            ['risutanium.rail.openFolders', () => rail.saveOpenFolders(['f'], new Set(['f']))],
            ['risutanium.rail.scroll', () => rail.saveScroll({ key: 'k', offset: 1, px: 2 })],
            ['risuChatShell.enabled', () => shell.setShellEnabled(true)],
            ['risuStudio.enabled', () => studio.setStudioEnabled(true)],
            ['risuSettings.enabled', () => settings.setSettingsShellEnabled(true)],
        ]
        for (const [key, write] of writes) {
            localStorage.clear()
            write()
            expect(written(), key).toEqual([key])
            expect(UI_PREFS_KEYS).toContain(key)
        }
    })
})
