// The database side of the carry applier over a real `$state` root and the real save marks, with no write hook
// installed: every mark asserted here comes from the port's own `mark`. Fixtures are built as the producers build them
// (stub characters with the cold-storage pointer, trashed characters with `trashTime`, a loadout from `saveCurrentLoadout`).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'

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
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from 'src/ts/storage/moduleStub'
import { COLD_POINTER_HEADER } from 'src/ts/storage/store2/codec/stub'
import { toggleVarKey } from 'src/ts/chatShell/togglePanel'
import { applyLoadout, saveCurrentLoadout } from 'src/ts/loadout'
import { createCarryDbPort, readCarryReach } from '../toggleCarryDb'
import { applyCarry, planCarryWrites, undoCarry, type PlaceRef } from '../../toggleCarryApply'
import type { CarryItem } from '../../toggleCarry'

type Entries = Record<string, string>

const chatOf = (id: string, entries?: Entries) => ({ id, message: [], note: '', name: '', localLore: [], GLGlobalVariables: entries })
const pointerChat = (id: string, entries: Entries) => ({
    ...chatOf(id, entries),
    message: [{ role: 'char', data: `${COLD_POINTER_HEADER}unit`, time: 0 }],
})
const characterOf = (chaId: string, chats: unknown[], extra: Record<string, unknown> = {}) => ({ chaId, name: `name-${chaId}`, type: 'character', chats, ...extra })

const GLOBAL: PlaceRef = { kind: 'global' }
const chatRef = (chaId: string, chatId: string): PlaceRef => ({ kind: 'chat', chaId, chatId })
const rename: CarryItem = { kind: 'rename', from: 'a', to: 'b' }

let tracker: toSaveType
let scheduled: (string | undefined)[]

function seed(): void {
    DBState.db = {
        globalChatVariables: { toggle_a: '1' },
        botPresets: [{ name: 'Preset 0', customPromptTemplateToggle: 'stale=Stale\n' }, { name: 'Preset 1', customPromptTemplateToggle: 'p1=One\n' }],
        botPresetsId: 0,
        customPromptTemplateToggle: 'working=Working\n',
        personas: [],
        selectedPersona: 0,
        enabledModules: [],
        loadouts: [],
        modules: [
            { id: 'M1', name: 'Module One', customModuleToggle: 'm1=One\n' },
            { id: 'M2', name: 'Module Two', customModuleToggle: 'm2=Two\n' },
            { id: 'MS', name: 'Stub', [MODULE_STUB_KEY]: MODULE_STUB_VALUE },
        ],
        characters: [
            characterOf('A', [
                chatOf('a1', { toggle_a: '2' }),
                chatOf('a2'),
                pointerChat('ap', { toggle_a: '9' }),
                { ...chatOf('', { toggle_a: '8' }) },
                chatOf('dup', { toggle_a: '7' }),
                chatOf('dup', { toggle_a: '6' }),
            ], { customModuleToggle: 'own=Own\n' }),
            characterOf('B', [chatOf('b1', { toggle_a: '3' })], { customModuleToggle: 'bchar=B\n' }),
            characterOf('T', [chatOf('t1', { toggle_a: '4' })], { trashTime: 5, customModuleToggle: 'tchar=T\n' }),
            characterOf('S', [chatOf('s1', { toggle_a: '5' })], { coldstorage: 'unit-s', customModuleToggle: 'schar=S\n' }),
            characterOf('B', [chatOf('b9', { toggle_a: '3' })]),
        ],
    } as unknown as Database
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    scheduled = []
    installCharacterSaveMarks({ tracker, schedule: (kind) => { scheduled.push(kind) } })
}

const chatsOf = (chaId: string): ReturnType<typeof chatOf>[] => (DBState.db.characters.find((slot) => slot.chaId === chaId)!.chats) as unknown as ReturnType<typeof chatOf>[]
const refsOf = (places: readonly { ref: PlaceRef }[]): string[] => places.map(({ ref }) => (ref.kind === 'global' ? 'global' : `${ref.chaId}/${ref.chatId}`))

beforeEach(seed)
afterEach(resetCharacterSaveMarksForTest)

describe('the stored-value name', () => {
    test('the applier\'s key prefix equals the engine\'s', () => {
        expect(toggleVarKey('zz')).toBe('toggle_zz')
        const plan = planCarryWrites([{ kind: 'rename', from: 'a', to: 'zz' }], { places: [{ ref: GLOBAL, entries: { toggle_a: '1' } }], others: [] })
        expect(plan.writes[0].varKey).toBe(toggleVarKey('zz'))
    })
})

describe('readCarryReach places (A-S)', () => {
    test('a character owner reaches the global value and its own eligible chats only', () => {
        const reach = readCarryReach({ kind: 'character', chaId: 'A' })
        expect(refsOf(reach.places)).toEqual(['global', 'A/a1', 'A/a2'])
        expect(reach.places[1].entries).toEqual({ toggle_a: '2' })
        expect(reach.places[2].entries).toBeUndefined()
    })

    test('a module owner reaches the chats of every loaded character, not stubs, the trash, pointers or id-less and shared ids', () => {
        const reach = readCarryReach({ kind: 'module', moduleId: 'M1' })
        expect(refsOf(reach.places)).toEqual(['global', 'A/a1', 'A/a2', 'B/b1'])
    })

    test('a trashed owner and a stub owner reach the global value only', () => {
        expect(refsOf(readCarryReach({ kind: 'character', chaId: 'T' }).places)).toEqual(['global'])
        expect(refsOf(readCarryReach({ kind: 'character', chaId: 'S' }).places)).toEqual(['global'])
    })

    test('a carry for a character owner changes no other character\'s chat and no trashed or stub character', () => {
        const items = [rename]
        const plan = planCarryWrites(items, readCarryReach({ kind: 'character', chaId: 'A' }))
        expect(applyCarry(plan, plan.signature, createCarryDbPort()).ok).toBe(true)
        expect(chatsOf('A')[0].GLGlobalVariables).toEqual({ toggle_a: '2', toggle_b: '2' })
        expect(DBState.db.globalChatVariables).toEqual({ toggle_a: '1', toggle_b: '1' })
        for (const chaId of ['B', 'T', 'S']) {
            expect(chatsOf(chaId)[0].GLGlobalVariables).toEqual(chaId === 'B' ? { toggle_a: '3' } : chaId === 'T' ? { toggle_a: '4' } : { toggle_a: '5' })
        }
    })

    test('a module owner carry writes every eligible chat and leaves the trash, stubs, pointers and shared ids alone', () => {
        const plan = planCarryWrites([rename], readCarryReach({ kind: 'module', moduleId: 'M1' }))
        expect(applyCarry(plan, plan.signature, createCarryDbPort()).ok).toBe(true)
        expect(chatsOf('B')[0].GLGlobalVariables).toEqual({ toggle_a: '3', toggle_b: '3' })
        expect(chatsOf('T')[0].GLGlobalVariables).toEqual({ toggle_a: '4' })
        expect(chatsOf('S')[0].GLGlobalVariables).toEqual({ toggle_a: '5' })
        expect(chatsOf('A')[2].GLGlobalVariables).toEqual({ toggle_a: '9' })
        expect(chatsOf('A')[4].GLGlobalVariables).toEqual({ toggle_a: '7' })
        expect(chatsOf('B').length).toBe(1)
    })
})

describe('readCarryReach others (A-W)', () => {
    test('a character owner names presets (working copy first), modules, trashed characters, never its own source or stubs', () => {
        const others = readCarryReach({ kind: 'character', chaId: 'A' }).others
        expect(others.map((source) => source.id)).toEqual(['prompt', 'preset:1', 'module:M1', 'module:M2', 'character:B', 'character:T'])
        expect(others[0].text).toBe('working=Working\n')
        expect(others[0].name).toBe('Preset 0')
    })

    test('a module owner leaves out its own module and names every character', () => {
        const others = readCarryReach({ kind: 'module', moduleId: 'M1' }).others
        expect(others.map((source) => source.id)).toEqual(['prompt', 'preset:1', 'module:M2', 'character:A', 'character:B', 'character:T'])
    })

    test('a trashed character defining the written key is named in Shared', () => {
        const trashed = DBState.db.characters[2]
        if (trashed.type === 'group') {
            throw new Error('setup')
        }
        trashed.customModuleToggle = 'b=Back\n'
        const plan = planCarryWrites([rename], readCarryReach({ kind: 'character', chaId: 'A' }))
        expect(plan.notice.shared).toEqual([{ key: 'b', sources: ['name-T'] }])
    })
})

describe('the port', () => {
    test('reads, writes and deletes in the global value and in a chat resolved by id', () => {
        const port = createCarryDbPort()
        expect(port.read(GLOBAL, 'toggle_a')).toBe('1')
        expect(port.read(chatRef('A', 'a1'), 'toggle_a')).toBe('2')
        port.write(chatRef('A', 'a2'), 'toggle_a', '5')
        expect(chatsOf('A')[1].GLGlobalVariables).toEqual({ toggle_a: '5' })
        port.write(chatRef('A', 'a2'), 'toggle_a', undefined)
        expect(port.read(chatRef('A', 'a2'), 'toggle_a')).toBeUndefined()
        port.write(GLOBAL, 'toggle_z', '1')
        port.write(GLOBAL, 'toggle_z', undefined)
        expect(DBState.db.globalChatVariables).toEqual({ toggle_a: '1' })
    })

    test.each([
        ['a trashed character', chatRef('T', 't1')],
        ['a stub character', chatRef('S', 's1')],
        ['a pointer chat', chatRef('A', 'ap')],
        ['a shared chat id', chatRef('A', 'dup')],
        ['an unknown chat', chatRef('A', 'nope')],
        ['an unknown character', chatRef('Z', 'z1')],
    ])('%s reads gone and a write throws', (_name, ref) => {
        const port = createCarryDbPort()
        expect(port.read(ref, 'toggle_a')).toBe('gone')
        expect(() => port.write(ref, 'toggle_a', '1')).toThrow()
    })

    test('a second character slot with the same chaId is never reached', () => {
        expect(createCarryDbPort().read(chatRef('B', 'b9'), 'toggle_a')).toBe('gone')
    })
})

describe('chats are resolved by id at write time (A-Y)', () => {
    function planned() {
        const plan = planCarryWrites([rename], readCarryReach({ kind: 'module', moduleId: 'M1' }))
        return plan
    }

    test('(a) slots swapped after the plan: the values land in the planned chats', () => {
        const plan = planned()
        const characters = DBState.db.characters
        const [first, second] = [characters[0], characters[1]]
        characters[0] = second
        characters[1] = first
        expect(applyCarry(plan, plan.signature, createCarryDbPort()).ok).toBe(true)
        expect(chatsOf('A')[0].GLGlobalVariables).toEqual({ toggle_a: '2', toggle_b: '2' })
        expect(chatsOf('B')[0].GLGlobalVariables).toEqual({ toggle_a: '3', toggle_b: '3' })
    })

    test('(b) a chat replaced by a same-id copy: the value lands in the copy', () => {
        const plan = planned()
        const copy = { ...chatOf('a1', { toggle_a: '2' }) }
        DBState.db.characters[0].chats[0] = copy as unknown as (typeof DBState.db.characters)[number]['chats'][number]
        expect(applyCarry(plan, plan.signature, createCarryDbPort()).ok).toBe(true)
        expect(chatsOf('A')[0].GLGlobalVariables).toEqual({ toggle_a: '2', toggle_b: '2' })
        expect(copy.GLGlobalVariables).toEqual({ toggle_a: '2' })
    })

    test('(c) a planned chat removed: the carry fails, every place is byte-identical and nothing is marked', () => {
        delete DBState.db.globalChatVariables.toggle_a
        const plan = planCarryWrites([rename], readCarryReach({ kind: 'character', chaId: 'A' }))
        const before = JSON.stringify(DBState.db.characters)
        DBState.db.characters[0].chats.splice(0, 1)
        const mid = JSON.stringify(DBState.db.characters)
        expect(applyCarry(plan, plan.signature, createCarryDbPort())).toEqual({ ok: false, reason: 'failed' })
        expect(JSON.stringify(DBState.db.characters)).toBe(mid)
        expect(before).not.toBe(mid)
        expect(tracker.character).toEqual([])
        expect(scheduled).toEqual([])
    })

    test('(d) the character stubbed or trashed after the plan: the carry fails and the earlier global write is put back', () => {
        const plan = planned()
        DBState.db.characters[1].trashTime = 7
        expect(applyCarry(plan, plan.signature, createCarryDbPort())).toEqual({ ok: false, reason: 'failed' })
        expect(DBState.db.globalChatVariables).toEqual({ toggle_a: '1' })
        expect(chatsOf('A')[0].GLGlobalVariables).toEqual({ toggle_a: '2' })
        DBState.db.characters[1].trashTime = undefined
        DBState.db.characters[1].coldstorage = 'unit-b'
        expect(applyCarry(plan, plan.signature, createCarryDbPort())).toEqual({ ok: false, reason: 'failed' })
        expect(DBState.db.globalChatVariables).toEqual({ toggle_a: '1' })
    })
})

describe('save marks without the write hook (A-M)', () => {
    test('every touched character is marked once, the global value schedules, untouched characters are absent', () => {
        const plan = planCarryWrites([rename], readCarryReach({ kind: 'module', moduleId: 'M1' }))
        const result = applyCarry(plan, plan.signature, createCarryDbPort())
        expect(result.ok).toBe(true)
        expect([...tracker.character].sort()).toEqual(['A', 'B'])
        expect(scheduled.length).toBeGreaterThan(0)
        expect(scheduled.every((kind) => kind === 'judged')).toBe(true)
    })

    test('a global-only carry schedules a judged save and marks no character', () => {
        for (const slot of DBState.db.characters) {
            for (const chat of slot.chats) {
                chat.GLGlobalVariables = undefined
            }
        }
        const plan = planCarryWrites([rename], readCarryReach({ kind: 'module', moduleId: 'M1' }))
        expect(applyCarry(plan, plan.signature, createCarryDbPort()).ok).toBe(true)
        expect(tracker.character).toEqual([])
        expect(scheduled).toEqual(['judged'])
    })

    test('undo marks the same places', () => {
        const plan = planCarryWrites([rename], readCarryReach({ kind: 'module', moduleId: 'M1' }))
        const result = applyCarry(plan, plan.signature, createCarryDbPort())
        if (!result.ok) {
            throw new Error('setup')
        }
        tracker.character.length = 0
        scheduled.length = 0
        expect(undoCarry(result.journal, createCarryDbPort())).toEqual({ ok: true })
        expect([...tracker.character].sort()).toEqual(['A', 'B'])
        expect(scheduled.length).toBeGreaterThan(0)
        expect(DBState.db.globalChatVariables).toEqual({ toggle_a: '1' })
        expect(chatsOf('B')[0].GLGlobalVariables).toEqual({ toggle_a: '3' })
    })

    test('undo is refused when a chat was stubbed after the carry, and nothing is written', () => {
        const plan = planCarryWrites([rename], readCarryReach({ kind: 'module', moduleId: 'M1' }))
        const result = applyCarry(plan, plan.signature, createCarryDbPort())
        if (!result.ok) {
            throw new Error('setup')
        }
        DBState.db.characters[1].coldstorage = 'unit-b'
        expect(undoCarry(result.journal, createCarryDbPort())).toEqual({ ok: false, reason: 'changed' })
        expect(DBState.db.globalChatVariables).toEqual({ toggle_a: '1', toggle_b: '1' })
    })

    test('a stub early in the journal refuses the undo before anything is restored or marked', () => {
        const plan = planCarryWrites([rename], readCarryReach({ kind: 'module', moduleId: 'M1' }))
        const result = applyCarry(plan, plan.signature, createCarryDbPort())
        if (!result.ok) {
            throw new Error('setup')
        }
        DBState.db.characters[0].coldstorage = 'unit-a'
        tracker.character.length = 0
        scheduled.length = 0
        expect(undoCarry(result.journal, createCarryDbPort())).toEqual({ ok: false, reason: 'changed' })
        expect(chatsOf('B')[0].GLGlobalVariables).toEqual({ toggle_a: '3', toggle_b: '3' })
        expect(tracker.character).toEqual([])
        expect(scheduled).toEqual([])
    })
})

describe('what a carry never touches (A-R)', () => {
    test('stubs, pointer chats and a loadout applied with the real producer are deep-equal after the carry and its undo', () => {
        DBState.db.globalChatVariables = { toggle_a: '1' }
        saveCurrentLoadout('Saved')
        applyLoadout(DBState.db.loadouts[0], ['modules', 'globalVariables'])
        const snapshot = JSON.stringify({ loadouts: DBState.db.loadouts, stub: DBState.db.characters[3], pointer: chatsOf('A')[2] })

        const plan = planCarryWrites([rename], readCarryReach({ kind: 'module', moduleId: 'M1' }))
        const result = applyCarry(plan, plan.signature, createCarryDbPort())
        if (!result.ok) {
            throw new Error('setup')
        }
        const current = () => JSON.stringify({ loadouts: DBState.db.loadouts, stub: DBState.db.characters[3], pointer: chatsOf('A')[2] })
        expect(current()).toBe(snapshot)
        expect(undoCarry(result.journal, createCarryDbPort())).toEqual({ ok: true })
        expect(current()).toBe(snapshot)
        expect(DBState.db.loadouts[0].globalVariables).toEqual({ toggle_a: '1' })
    })
})
