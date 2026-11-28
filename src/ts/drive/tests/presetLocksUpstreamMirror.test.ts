// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { presetFromWorkingSettings, setPreset, type StoredDatabase } from 'src/ts/storage/database.svelte'
import { lockedGroups } from 'src/ts/storage/presetLocks'
import { setMirrorPresetApplier, upstreamChangeToPreset } from './upstreamPresetMirror'

setMirrorPresetApplier(setPreset)

const FALLBACK = (name: string) => ({ memory: [name], emotion: [], translate: [], otherAx: [], model: [] })

/** What an upstream `.bin` holds: the three upstream flags and no fork-only list. */
function upstreamTree(flags: Record<string, boolean>): StoredDatabase {
    const slots = [0, 1].map(index => presetFromWorkingSettings({ NAIsettings: {}, mainPrompt: `prompt ${index}`, fallbackModels: FALLBACK(`slot ${index}`) } as never, `Preset ${index}`, ''))
    return { NAIsettings: {}, mainPrompt: 'live', fallbackModels: FALLBACK('live'), botPresets: slots, botPresetsId: 0, ...flags } as unknown as StoredDatabase
}

describe('L9 upstream .bin and the fork lock readers (compatibility guard: passes before and after the export warning)', () => {
    test('an upstream database with the three flags reads as locks for their three ids, and no fork-only group', () => {
        const none = upstreamTree({})
        expect(lockedGroups(none)).toEqual([])
        const all = upstreamTree({ doNotChangeSeperateModels: true, doNotChangeFallbackModels: true, disableSeperateParameterChangeOnPresetChange: true })
        expect(lockedGroups(all).map(group => group.id)).toEqual(['auxModels', 'fallbackModels', 'separateParameters'])
        expect('presetFieldLocks' in all).toBe(false)
    })

    test('the fork setPreset the mirror ends an upstream switch with keeps the live fallback under the upstream flag, and takes the slot without it', () => {
        const locked = upstreamTree({ doNotChangeFallbackModels: true })
        upstreamChangeToPreset(locked, 1)
        expect(locked.fallbackModels).toEqual(FALLBACK('live'))

        const unlocked = upstreamTree({})
        upstreamChangeToPreset(unlocked, 1)
        expect(unlocked.fallbackModels).toEqual(FALLBACK('slot 1'))
    })
})
