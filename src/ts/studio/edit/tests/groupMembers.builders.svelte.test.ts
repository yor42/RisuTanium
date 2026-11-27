// @vitest-environment jsdom
// The member builders read the live list when the service calls them (after every picker or restore await) and find the
// member by its chaId; they never restore an archived character or touch a chat.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import type { LiveReader } from 'src/ts/studio/history/historyModel'
import {
    GROUP_ID,
    arraysOf,
    archivedStub,
    corrupt,
    insertOutsideStudio,
    liveGroup,
    loadedCharacter,
    makeGroup,
    member,
    putWorld,
    removeOutsideStudio,
    sixths,
} from 'src/ts/studio/history/tests/group.test-helpers'
import { DEFAULT_MEMBER_TALK, buildAddMember, buildRemoveMember, buildSetActive, buildSetTalk } from '../groupMembers'
import { groupAdapter } from '../groupTarget'

const h = vi.hoisted(() => ({ marks: 0, restores: [] as string[] }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})
// A builder that restored, loaded or dropped an archived member would reach one of these.
vi.mock('src/ts/process/coldCharacterAccess', () => ({ restoreArchivedForWrite: async (chaId: string) => { h.restores.push(`access:${chaId}`); return { status: 'gone' } } }))
vi.mock('src/ts/process/coldCharacterRestore', () => ({ restoreColdCharacter: async () => { h.restores.push('restore'); return null } }))
vi.mock('src/ts/process/coldMemberRestore', () => ({ restoreColdCharacterByChaId: async (chaId: string) => { h.restores.push(`member:${chaId}`); return false } }))

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

function live(): LiveReader {
    const resolved = groupAdapter.resolve(GROUP_ID)
    if (!resolved.ok) {
        throw new Error('expected the group to resolve')
    }
    return resolved.target.reader
}

beforeEach(() => {
    h.marks = 0
    h.restores.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = GROUP_ID
    putWorld([makeGroup(), loadedCharacter('A'), loadedCharacter('B'), loadedCharacter('C'), loadedCharacter('X')])
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    DBState.db.characters = []
})

describe('T8: add re-reads the live list when the service calls the builder', () => {
    test('a candidate that is not a member builds one insert at the end with classic\'s defaults', () => {
        const built = buildAddMember('X', 'Name X')('s1', live())
        expect(built).toEqual({
            ok: true,
            label: { kind: 'obj', list: 'members', action: 'add', name: 'Name X' },
            drafts: [{ op: 'objInsert', list: 'members', index: 3, entry: { chaId: 'X', talk: DEFAULT_MEMBER_TALK, active: true } }],
            coalesceKey: null,
        })
        expect(DEFAULT_MEMBER_TALK).toBeCloseTo(4 / 6, 12)
    })

    test('a candidate that already is a member is refused precondition', () => {
        expect(buildAddMember('B', 'Name B')('s1', live())).toEqual({ ok: false, reason: 'precondition' })
    })

    test('a stale continuation: the member was added elsewhere after the picker opened', () => {
        const continuation = buildAddMember('X', 'Name X')
        insertOutsideStudio(3, member('X', sixths(1)))
        expect(continuation('s1', live())).toEqual({ ok: false, reason: 'precondition' })
    })

    test('the index is the live length at call time, not at build time', () => {
        const continuation = buildAddMember('X', 'Name X')
        insertOutsideStudio(3, member('Y', sixths(1)))
        const built = continuation('s1', live())
        expect(built.ok && built.drafts[0]).toMatchObject({ op: 'objInsert', index: 4 })
    })

    test('an unreadable list and an empty id are refused precondition', () => {
        expect(buildAddMember('', null)('s1', live())).toEqual({ ok: false, reason: 'precondition' })
        liveGroup().characterTalks.pop()
        expect(buildAddMember('X', null)('s1', live())).toEqual({ ok: false, reason: 'precondition' })
        const noList: LiveReader = { field: () => ({ had: false }), greetings: () => null, fmIndex: () => null }
        expect(buildAddMember('X', null)('s1', noList)).toEqual({ ok: false, reason: 'precondition' })
    })
})

describe('remove and set find the member by chaId at call time', () => {
    test('the index follows the member after an outside removal', () => {
        const remove = buildRemoveMember('C', 'Name C')
        removeOutsideStudio(0)
        const built = remove('s1', live())
        expect(built.ok && built.drafts).toEqual([{ op: 'objRemove', list: 'members', index: 1 }])
        expect(built.ok && built.label).toEqual({ kind: 'obj', list: 'members', action: 'delete', name: 'Name C', count: 1 })
    })

    test('an absent member is refused precondition for remove and for both sets', () => {
        removeOutsideStudio(1)
        expect(buildRemoveMember('B', null)('s1', live())).toEqual({ ok: false, reason: 'precondition' })
        expect(buildSetTalk('B', null, 0.5)('s1', live())).toEqual({ ok: false, reason: 'precondition' })
        expect(buildSetActive('B', null, true)('s1', live())).toEqual({ ok: false, reason: 'precondition' })
    })

    test('a set to the value the member already has is unchanged', () => {
        expect(buildSetTalk('B', null, sixths(2))('s1', live())).toEqual({ ok: false, reason: 'unchanged' })
        expect(buildSetActive('B', null, false)('s1', live())).toEqual({ ok: false, reason: 'unchanged' })
    })

    test('a set builds one objSet of the member\'s own index with a merge key per member and field', () => {
        const talk = buildSetTalk('B', 'Name B', sixths(5))('s1', live())
        expect(talk).toEqual({
            ok: true,
            label: { kind: 'obj', list: 'members', action: 'edit', name: 'Name B', field: 'talk' },
            drafts: [{ op: 'objSet', list: 'members', index: 1, field: 'talk', after: { had: true, value: sixths(5) } }],
            coalesceKey: 'members:B:talk',
        })
        const active = buildSetActive('B', 'Name B', true)('s1', live())
        expect(active.ok && active.coalesceKey).toBe('members:B:active')
    })
})

describe('T16: a foreign duplicate chaId is not guessed', () => {
    test('add, remove and set refuse when the chaId occurs twice', () => {
        putWorld([makeGroup([member('A', sixths(1)), member('B', sixths(2)), member('A', sixths(3))]), loadedCharacter('A')])
        const before = arraysOf()
        expect(buildAddMember('A', null)('s1', live())).toEqual({ ok: false, reason: 'precondition' })
        expect(buildRemoveMember('A', null)('s1', live())).toEqual({ ok: false, reason: 'precondition' })
        expect(buildSetTalk('A', null, 0.5)('s1', live())).toEqual({ ok: false, reason: 'precondition' })
        expect(buildSetActive('A', null, false)('s1', live())).toEqual({ ok: false, reason: 'precondition' })
        expect(buildRemoveMember('B', null)('s1', live()).ok).toBe(true)
        expect(arraysOf()).toEqual(before)
    })
})

describe('T18 and T19: missing and archived members', () => {
    test('a member with no character row builds remove and set like any other', () => {
        putWorld([makeGroup([member('A', sixths(1)), member('GONE', sixths(2), false)]), loadedCharacter('A')])
        expect(buildRemoveMember('GONE', null)('s1', live()).ok).toBe(true)
        expect(buildSetTalk('GONE', null, sixths(4))('s1', live()).ok).toBe(true)
        expect(buildSetActive('GONE', null, true)('s1', live()).ok).toBe(true)
    })

    test('an archived member builds remove and sets and no builder restores, loads or drops anything', () => {
        putWorld([makeGroup([member('A', sixths(1)), member('S', sixths(2), false)]), loadedCharacter('A'), archivedStub('S')])
        expect(buildRemoveMember('S', null)('s1', live()).ok).toBe(true)
        expect(buildSetTalk('S', null, sixths(4))('s1', live()).ok).toBe(true)
        expect(buildSetActive('S', null, true)('s1', live()).ok).toBe(true)
        expect(h.restores).toEqual([])
        expect((DBState.db.characters as unknown as { chaId: string }[]).map((row) => row.chaId)).toEqual([GROUP_ID, 'A', 'S'])
        expect(arraysOf().characters).toEqual(['A', 'S'])
    })
})

describe('T20: adding an archived candidate (builder side)', () => {
    test('the builder adds the stub\'s chaId without restoring it and without any chat message', () => {
        putWorld([makeGroup(), loadedCharacter('A'), archivedStub('Q')])
        const before = JSON.stringify(liveGroup().chats)
        const built = buildAddMember('Q', 'Name Q')('s1', live())
        expect(built.ok && built.drafts).toEqual([{ op: 'objInsert', list: 'members', index: 3, entry: { chaId: 'Q', talk: DEFAULT_MEMBER_TALK, active: true } }])
        expect(h.restores).toEqual([])
        expect(JSON.stringify(liveGroup().chats)).toBe(before)
    })
})

describe('an unreadable list never builds a member op', () => {
    test.each([
        ['non-array talks', () => corrupt('characterTalks', 'x')],
        ['unequal lengths', () => liveGroup().characterActive.push(false)],
    ])('%s', (_title, damage) => {
        damage()
        for (const built of [buildRemoveMember('A', null), buildSetTalk('A', null, 0.5), buildSetActive('A', null, false), buildAddMember('X', null)]) {
            expect(built('s1', live())).toEqual({ ok: false, reason: 'precondition' })
        }
    })
})
