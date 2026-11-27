// @vitest-environment jsdom
/**
 * The group form over the real owner service and the real group adapter: rows, the six talk buttons, the active check,
 * Remove, Add through the picker, the read-only members section of a group whose arrays disagree, archived and missing
 * members, and the focus rules. The picker, the restore of an archived candidate and the cold-store module are
 * replaced; everything between the form and the arrays is real.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { flushStudioFields } from 'src/ts/studio/fieldFlush'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { groupOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests } from 'src/ts/studio/history/studioHistoryService.svelte'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import {
    GROUP_ID,
    archivedStub,
    arraysOf,
    corrupt,
    insertOutsideStudio,
    liveGroup,
    loadedCharacter,
    makeGroup,
    member,
    putWorld,
    sixths,
} from 'src/ts/studio/history/tests/group.test-helpers'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import StudioGroupForm from './StudioGroupForm.svelte'

const h = vi.hoisted(() => ({
    marks: 0,
    pickers: [] as ((value: string | null) => void)[],
    restores: [] as { chaId: string; settle: (value: unknown) => void }[],
    formatUpdates: [] as number[],
    errors: [] as string[],
    coldCalls: [] as string[],
}))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
// Reactive like the app's own store; the getters keep the factory clear of the hoisting.
const reactiveDb = $state({ db: { characters: [], modules: [] } })
const reactiveSelection = $state({ selId: 0 })

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return reactiveDb },
        get selIdState() { return reactiveSelection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})
vi.mock('src/ts/alert', () => ({
    alertSelectChar: () => new Promise<string | null>((resolve) => { h.pickers.push(resolve) }),
    alertError: (message: string) => { h.errors.push(message) },
}))
vi.mock('src/ts/process/coldCharacterAccess', () => ({
    restoreArchivedForWrite: (chaId: string) => new Promise((resolve) => { h.restores.push({ chaId, settle: resolve }) }),
}))
vi.mock('src/ts/characters', () => ({ characterFormatUpdate: (index: number) => { h.formatUpdates.push(index) } }))
vi.mock('src/ts/process/coldCharacterRestore', () => ({ restoreColdCharacter: async () => { h.coldCalls.push('restore'); return null } }))
vi.mock('src/ts/process/coldMemberRestore', () => ({ restoreColdCharacterByChaId: async (chaId: string) => { h.coldCalls.push(`member:${chaId}`); return false } }))

const G = groupOwnerKey(GROUP_ID)
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const mounted: ReturnType<typeof mount>[] = []
const hosts: HTMLElement[] = []
let service: OwnerHistoryService
let sessions = 0

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const rowsInDom = () => Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-group-member"]'))
const rowOf = (chaId: string) => rowsInDom().find((row) => row.dataset.chaId === chaId) as HTMLElement
const within = <T extends HTMLElement>(row: HTMLElement, name: string) => row.querySelector<T>(`[data-part="${name}"]`) as T
const talkButtons = (chaId: string) => Array.from(rowOf(chaId).querySelectorAll<HTMLButtonElement>('[data-part="studio-group-talk"]'))
const settle = async () => { for (let turn = 0; turn < 6; turn++) { await Promise.resolve(); await tick(); flushSync() } }

async function mountForm(world: readonly unknown[] = [makeGroup(), loadedCharacter('A'), loadedCharacter('B'), loadedCharacter('C'), loadedCharacter('X')]): Promise<void> {
    putWorld(world)
    sessions += 1
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: `p${sessions}`,
        getVisitId: () => studioScreen.visitId,
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    await service.whenReady(G)
    const target = document.createElement('div')
    document.body.appendChild(target)
    hosts.push(target)
    mounted.push(mount(StudioGroupForm, { target, props: { chaId: GROUP_ID } }))
    await settle()
}

beforeEach(() => {
    h.marks = 0
    h.pickers.length = 0
    h.restores.length = 0
    h.formatUpdates.length = 0
    h.errors.length = 0
    h.coldCalls.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.open = true
    studioScreen.visitId = 'v1'
    studioScreen.chaId = GROUP_ID
})

afterEach(async () => {
    while (mounted.length > 0) await unmount(mounted.pop() as ReturnType<typeof mount>)
    for (const element of hosts.splice(0)) element.remove()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    DBState.db.characters = []
})

const START = {
    characters: ['A', 'B', 'C'],
    talks: [sixths(1), sixths(2), sixths(3)],
    active: [true, false, true],
}

describe('T30: the form lists the group', () => {
    test('rows, name, talk buttons, active check, Remove, Add and the order check', async () => {
        await mountForm()
        expect(part('studio-group-form')).not.toBeNull()
        expect(part('studio-character-form')).toBeNull()
        expect(part('studio-detail-readonly')).toBeNull()
        expect(part('studio-chip')).toBeNull()
        expect(part('studio-form-name') as HTMLInputElement).toHaveProperty('value', 'Group')
        expect(document.querySelector('ul[role="list"]')).not.toBeNull()
        expect(rowsInDom().map((row) => row.dataset.chaId)).toEqual(['A', 'B', 'C'])
        expect(within(rowOf('B'), 'studio-group-member-name').textContent).toBe('Name B')
        const buttons = talkButtons('B')
        expect(buttons).toHaveLength(6)
        expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([1, 2, 3, 4, 5, 6].map((n) => language.groupTalkLevel(n)))
        // B holds 2/6: only level 2 is pressed. A holds 1/6.
        expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false', 'false', 'false'])
        expect(talkButtons('A')[0].getAttribute('aria-pressed')).toBe('true')
        expect(within<HTMLInputElement>(rowOf('A'), 'studio-group-member-active').checked).toBe(true)
        expect(within<HTMLInputElement>(rowOf('B'), 'studio-group-member-active').checked).toBe(false)
        expect(within(rowOf('A'), 'studio-group-member-remove').getAttribute('aria-label')).toContain(language.remove)
        expect(part('studio-group-add')?.textContent).toContain(language.addCharacter)
        expect(document.body.textContent).toContain(language.orderByOrder)
        expect(part('studio-group-members-mismatch')).toBeNull()
    })

    test('each talk button writes level n of 6 as one step', async () => {
        await mountForm()
        for (const level of [1, 2, 3, 4, 5, 6]) {
            talkButtons('B')[level - 1].click()
            await settle()
            expect(liveGroup().characterTalks[1]).toBe((1 / 6) * level)
            expect(talkButtons('B')[level - 1].getAttribute('aria-pressed')).toBe('true')
        }
        expect(arraysOf().characters).toEqual(START.characters)
        expect(h.marks).toBeGreaterThan(0)
    })

    test('a tap on the level a member already holds is not a refusal and writes nothing', async () => {
        await mountForm()
        const before = h.marks
        talkButtons('B')[1].click()
        await settle()
        expect(part('studio-form-refusal')).toBeNull()
        expect(h.marks).toBe(before)
        expect(service.view(G).done).toHaveLength(0)
    })

    test('the active check writes the member and undo returns it', async () => {
        await mountForm()
        within<HTMLInputElement>(rowOf('B'), 'studio-group-member-active').click()
        await settle()
        expect(arraysOf().active).toEqual([true, true, true])
        expect(service.view(G).done).toHaveLength(1)
        expect(service.undo(G).ok).toBe(true)
        await settle()
        expect(arraysOf().active).toEqual(START.active)
    })

    test('the order check writes orderByOrder and undo of the first edit removes the key', async () => {
        await mountForm()
        const box = part('studio-group-order-by-order') as HTMLInputElement
        expect(box.checked).toBe(false)
        box.click()
        await settle()
        expect(liveGroup().orderByOrder).toBe(true)
        expect(service.undo(G).ok).toBe(true)
        await settle()
        expect('orderByOrder' in liveGroup()).toBe(false)
    })

    test('the name input writes through the history', async () => {
        await mountForm()
        const input = part('studio-form-name') as HTMLInputElement
        input.focus()
        input.value = 'Renamed'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.blur()
        await settle()
        expect(liveGroup().name).toBe('Renamed')
        expect(service.view(G).done.length).toBeGreaterThan(0)
    })

    test('an emptied name goes back to what it was and says why', async () => {
        await mountForm()
        const input = part('studio-form-name') as HTMLInputElement
        input.focus()
        input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.blur()
        await settle()
        expect(liveGroup().name).toBe('Group')
        expect(input.value).toBe('Group')
        expect(part('studio-field-note')?.textContent).toBe(language.studioFormNameEmpty)
    })

    test('a composition still held when the page hides is written once', async () => {
        await mountForm()
        const input = part('studio-form-name') as HTMLInputElement
        input.focus()
        input.dispatchEvent(new Event('compositionstart', { bubbles: true }))
        input.value = 'Composed'
        input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
        await settle()
        expect(liveGroup().name).toBe('Group')
        flushStudioFields('hide')
        await settle()
        expect(liveGroup().name).toBe('Composed')
    })
})

describe('T30: Remove and focus', () => {
    test('Remove writes all three arrays and focus moves to the next row', async () => {
        await mountForm()
        within(rowOf('B'), 'studio-group-member-remove').click()
        await settle()
        expect(arraysOf()).toEqual({ characters: ['A', 'C'], talks: [sixths(1), sixths(3)], active: [true, true] })
        expect(service.view(G).done).toHaveLength(1)
        expect(document.activeElement).toBe(rowOf('C'))
    })

    test('Remove of the last row moves focus to the Add button', async () => {
        await mountForm()
        within(rowOf('C'), 'studio-group-member-remove').click()
        await settle()
        expect(arraysOf().characters).toEqual(['A', 'B'])
        expect(document.activeElement).toBe(part('studio-group-add'))
    })

    test('Undo of a Remove brings the member back with its own values', async () => {
        await mountForm()
        within(rowOf('B'), 'studio-group-member-remove').click()
        await settle()
        expect(service.undo(G).ok).toBe(true)
        await settle()
        expect(arraysOf()).toEqual(START)
        expect(rowsInDom().map((row) => row.dataset.chaId)).toEqual(['A', 'B', 'C'])
    })
})

describe('T7: Add', () => {
    test('the picked character joins with classic\'s defaults, the chat is untouched, focus goes to the new row', async () => {
        await mountForm()
        const chatBefore = JSON.stringify(liveGroup().chats)
        part('studio-group-add')?.click()
        await settle()
        expect(h.pickers).toHaveLength(1)
        h.pickers[0]('X')
        await settle()
        expect(arraysOf()).toEqual({ characters: ['A', 'B', 'C', 'X'], talks: [...START.talks, (1 / 6) * 4], active: [...START.active, true] })
        expect(JSON.stringify(liveGroup().chats)).toBe(chatBefore)
        expect(service.view(G).done).toHaveLength(1)
        expect(document.activeElement).toBe(rowOf('X'))
        expect(h.errors).toEqual([])
    })

    test('a cancelled picker writes nothing', async () => {
        await mountForm()
        part('studio-group-add')?.click()
        await settle()
        h.pickers[0](null)
        await settle()
        expect(arraysOf()).toEqual(START)
        expect(service.view(G).done).toHaveLength(0)
    })
})

describe('T8: a duplicate Add', () => {
    test('a member already in the group is refused with the classic alert', async () => {
        await mountForm()
        part('studio-group-add')?.click()
        await settle()
        h.pickers[0]('B')
        await settle()
        expect(h.errors).toEqual([language.errors.alreadyCharInGroup])
        expect(arraysOf()).toEqual(START)
        expect(service.view(G).done).toHaveLength(0)
        expect(h.marks).toBe(0)
    })

    test('a member added elsewhere while the picker was open is re-read live and refused', async () => {
        await mountForm()
        part('studio-group-add')?.click()
        await settle()
        insertOutsideStudio(3, member('X', sixths(4), true))
        h.pickers[0]('X')
        await settle()
        expect(h.errors).toEqual([language.errors.alreadyCharInGroup])
        expect(arraysOf().characters).toEqual(['A', 'B', 'C', 'X'])
        expect(service.view(G).done).toHaveLength(0)
    })
})

describe('T20: Add of an archived candidate', () => {
    const world = () => [makeGroup(), loadedCharacter('A'), loadedCharacter('B'), loadedCharacter('C'), archivedStub('S')]

    async function pickArchived(): Promise<void> {
        await mountForm(world())
        part('studio-group-add')?.click()
        await settle()
        h.pickers[0]('S')
        await settle()
        expect(h.restores).toHaveLength(1)
    }

    test('restored: the format update runs, then the member is written, no chat message', async () => {
        await pickArchived()
        const chatBefore = JSON.stringify(liveGroup().chats)
        h.restores[0].settle({ status: 'ready', index: 4, character: {} })
        await settle()
        expect(h.formatUpdates).toEqual([4])
        expect(arraysOf().characters).toEqual(['A', 'B', 'C', 'S'])
        expect(JSON.stringify(liveGroup().chats)).toBe(chatBefore)
    })

    test('gone: nothing is written', async () => {
        await pickArchived()
        h.restores[0].settle({ status: 'gone' })
        await settle()
        expect(h.formatUpdates).toEqual([])
        expect(arraysOf()).toEqual(START)
        expect(service.view(G).done).toHaveLength(0)
    })

    test('refused: the member is still added, with no format update and no greeting', async () => {
        await pickArchived()
        const chatBefore = JSON.stringify(liveGroup().chats)
        h.restores[0].settle({ status: 'refused', reason: 'x' })
        await settle()
        expect(h.formatUpdates).toEqual([])
        expect(arraysOf().characters).toEqual(['A', 'B', 'C', 'S'])
        expect(JSON.stringify(liveGroup().chats)).toBe(chatBefore)
    })
})

describe('T21: the Add continuation obeys the visit and the group', () => {
    async function openPicker(): Promise<void> {
        await mountForm()
        part('studio-group-add')?.click()
        await settle()
        expect(h.pickers).toHaveLength(1)
    }

    test('Studio closed while the picker was open: no write', async () => {
        await openPicker()
        studioScreen.open = false
        h.pickers[0]('X')
        await settle()
        expect(arraysOf()).toEqual(START)
        expect(service.view(G).done).toHaveLength(0)
    })

    test('a new visit began while the picker was open: no write', async () => {
        await openPicker()
        studioScreen.visitId = 'v2'
        h.pickers[0]('X')
        await settle()
        expect(arraysOf()).toEqual(START)
        expect(h.marks).toBe(0)
    })

    test('another group was selected while the picker was open: no write', async () => {
        await openPicker()
        studioScreen.chaId = 'other-group'
        h.pickers[0]('X')
        await settle()
        expect(arraysOf()).toEqual(START)
        expect(h.marks).toBe(0)
    })

    test('the selection moved to another character while the picker was open: no write', async () => {
        await openPicker()
        selIdState.selId = 1
        h.pickers[0]('X')
        await settle()
        expect(arraysOf()).toEqual(START)
        expect(h.marks).toBe(0)
    })

    test('the group left the database while the picker was open: no write', async () => {
        await openPicker()
        const group = liveGroup()
        DBState.db.characters = DBState.db.characters.filter((row) => row.chaId !== GROUP_ID)
        h.pickers[0]('X')
        await settle()
        expect(group.characters).toEqual(START.characters)
        expect(h.marks).toBe(0)
    })

    test('the visit ended during the restore of an archived candidate: no format update after, no write', async () => {
        await mountForm([makeGroup(), loadedCharacter('A'), loadedCharacter('B'), loadedCharacter('C'), archivedStub('S')])
        part('studio-group-add')?.click()
        await settle()
        h.pickers[0]('S')
        await settle()
        studioScreen.visitId = 'v2'
        h.restores[0].settle({ status: 'ready', index: 4, character: {} })
        await settle()
        expect(h.formatUpdates).toEqual([])
        expect(arraysOf()).toEqual(START)
    })
})

describe('A8: a group whose arrays disagree', () => {
    test('the members are read-only with a note; the name and the order check stay editable', async () => {
        await mountForm()
        corrupt('characterTalks', [sixths(1), sixths(2)])
        await settle()
        expect(part('studio-group-members-mismatch')?.textContent).toBe(language.studioGroupMembersMismatch)
        expect(rowsInDom()).toHaveLength(0)
        expect((part('studio-group-add') as HTMLButtonElement).disabled).toBe(true)
        const before = arraysOf()
        part('studio-group-add')?.click()
        await settle()
        expect(h.pickers).toHaveLength(0)
        const input = part('studio-form-name') as HTMLInputElement
        input.focus()
        input.value = 'Still editable'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.blur()
        ;(part('studio-group-order-by-order') as HTMLInputElement).click()
        await settle()
        expect(liveGroup().name).toBe('Still editable')
        expect(liveGroup().orderByOrder).toBe(true)
        expect(arraysOf()).toEqual(before)
    })

    test('a non-array member list reads the same way', async () => {
        await mountForm()
        corrupt('characterActive', 'not an array')
        await settle()
        expect(part('studio-group-members-mismatch')).not.toBeNull()
        expect((part('studio-group-add') as HTMLButtonElement).disabled).toBe(true)
    })
})

describe('T18: a missing member', () => {
    test('is listed with the missing tag; Remove, undo and redo work', async () => {
        await mountForm([makeGroup([member('A', sixths(1)), member('Z', sixths(2), false)]), loadedCharacter('A')])
        const row = rowOf('Z')
        expect(row.dataset.tag).toBe('missing')
        expect(within(row, 'studio-group-member-tag').textContent).toBe(language.studioGroupMemberMissing)
        within(row, 'studio-group-member-remove').click()
        await settle()
        expect(arraysOf().characters).toEqual(['A'])
        expect(service.undo(G).ok).toBe(true)
        expect(arraysOf().characters).toEqual(['A', 'Z'])
        expect(service.redo(G).ok).toBe(true)
        expect(arraysOf().characters).toEqual(['A'])
    })
})

describe('T19: an archived member', () => {
    test('shows the stub name and the archived tag; talk, active and Remove work; nothing is restored or dropped', async () => {
        await mountForm([makeGroup([member('A', sixths(1)), member('S', sixths(2), true)]), loadedCharacter('A'), archivedStub('S')])
        const row = rowOf('S')
        expect(row.dataset.tag).toBe('archived')
        expect(within(row, 'studio-group-member-name').textContent).toBe('Name S')
        expect(within(row, 'studio-group-member-tag').textContent).toBe(language.studioGroupMemberArchived)
        talkButtons('S')[4].click()
        await settle()
        within<HTMLInputElement>(rowOf('S'), 'studio-group-member-active').click()
        await settle()
        expect(liveGroup().characterTalks[1]).toBe((1 / 6) * 5)
        expect(liveGroup().characterActive[1]).toBe(false)
        expect(DBState.db.characters.some((candidate) => candidate.chaId === 'S')).toBe(true)
        within(rowOf('S'), 'studio-group-member-remove').click()
        await settle()
        expect(arraysOf().characters).toEqual(['A'])
        // Removing the member from the group never touches the archived character itself.
        expect(DBState.db.characters.some((candidate) => candidate.chaId === 'S')).toBe(true)
        expect(h.restores).toEqual([])
        expect(h.coldCalls).toEqual([])
    })
})
