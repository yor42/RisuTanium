// The reach of a preset owner's carry and the keys the app's other sources define, over a real `$state` database: the
// preset's own text is never another source, whether it is the active preset or not, and the other presets, the
// characters and the loaded chats stay in reach.
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import type { Database } from 'src/ts/storage/database.svelte'
import { appToggleKeys } from '../../toggleBuilder.svelte'
import { readCarryReach } from '../toggleCarryDb'
import { presetNamed, seedPresetDb } from './presetFixture.test-helpers'

const chatOf = (id: string) => ({ id, message: [], note: '', name: '', localLore: [], GLGlobalVariables: { toggle_a: '1' } })
const characterOf = (chaId: string, toggle: string) => ({ chaId, name: `name-${chaId}`, type: 'character', chats: [chatOf(`${chaId}1`)], customModuleToggle: toggle })

let ids: string[]

beforeEach(() => {
    // Active preset 1: the stored text of its slot lags the working setting, which is what the engine reads.
    ids = seedPresetDb([presetNamed('P0', 'p0=Zero\n'), presetNamed('P1', 'stale=Stale\n'), presetNamed('P2', 'p2=Two\n')], 1, 'p1=One\n')
    DBState.db.globalChatVariables = { toggle_a: '1' }
    DBState.db.modules = [{ id: 'M1', name: 'Module One', customModuleToggle: 'm1=One\n' }] as unknown as Database['modules']
    DBState.db.characters = [characterOf('A', 'ca=A\n'), characterOf('B', 'cb=B\n')] as unknown as Database['characters']
})

const othersOf = (presetId: string) => readCarryReach({ kind: 'preset', presetId }).others.map((other) => `${other.id}|${other.name}`)

describe('T8 the carry reach of a preset owner', () => {
    test('an inactive preset leaves its own entry out and keeps the active one, the other presets, modules and characters', () => {
        expect(othersOf(ids[0])).toEqual(['prompt|P1', 'preset:2|P2', 'module:M1|Module One', 'character:A|name-A', 'character:B|name-B'])
    })

    test('the active preset leaves its own entry out', () => {
        expect(othersOf(ids[1])).toEqual(['preset:0|P0', 'preset:2|P2', 'module:M1|Module One', 'character:A|name-A', 'character:B|name-B'])
    })

    test('the places are the global value and the chats of every eligible character', () => {
        const places = readCarryReach({ kind: 'preset', presetId: ids[0] }).places.map(({ ref }) => (ref.kind === 'global' ? 'global' : `${ref.chaId}/${ref.chatId}`))
        expect(places).toEqual(['global', 'A/A1', 'B/B1'])
    })

    test('appToggleKeys leaves the own preset out by id, active or not, and keeps every other source', () => {
        expect([...appToggleKeys({ kind: 'preset', presetId: ids[0] })].sort()).toEqual(['ca', 'cb', 'm1', 'p1', 'p2'])
        expect([...appToggleKeys({ kind: 'preset', presetId: ids[1] })].sort()).toEqual(['ca', 'cb', 'm1', 'p0', 'p2'])
    })
})
