// @vitest-environment jsdom
// Compatibility guard (passes on the base and after the field registry): the bytes the real history service and the
// real model write through the memory store for one edit on every registered field, an undo, a restore point and
// a greeting add and delete. The golden fixture was produced by the real writer before the registry existed; any
// change of a stored step, label, op or restore value changes it. Clock, page session, visit id and the store's
// write ids are all injected, so the bytes do not depend on other tests.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, SAVE_DEBOUNCE_MS } from '../ownerPhase'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'

const h = vi.hoisted(() => ({ marks: 0 }))

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

const GOLDEN_PATH = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'storeBytes.golden.json')

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

const A = characterOwnerKey('A')
const chatA = chatOwnerKey('A', 'c1')
const M1 = moduleOwnerKey('M1')

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    DBState.db.characters = [
        {
            chaId: 'A',
            name: 'A',
            desc: 'd0',
            firstMessage: 'f0',
            exampleMessage: 'e0',
            customModuleToggle: 't0',
            alternateGreetings: ['g0', 'g1', 'g2'],
            chats: [{ id: 'c1', note: 'n0', fmIndex: 2 }],
            chatPage: 0,
        },
    ] as unknown as typeof DBState.db.characters
    DBState.db.modules = [
        { id: 'M1', name: 'M1', customModuleToggle: 'a=A', assets: [] },
    ] as unknown as typeof DBState.db.modules
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

function build(): { service: OwnerHistoryService; entries: () => [string, string][]; advance: (ms: number) => Promise<void> } {
    const clock = createFakeClock(1000)
    const store = createMemoryStudioStore({ pageSession: 'p1' })
    const service = createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
    })
    return {
        service,
        advance: (ms) => clock.advance(ms),
        entries: () => [...store.shared.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    }
}

describe('T-C1: the stored bytes of every registered field edit match the golden', () => {
    test('one edit per path, an undo, a restore point and a greeting add and delete', async () => {
        const { service, entries, advance } = build()

        await service.whenReady(A)
        expect(service.editText(A, 'desc', 'd1', 'single')).toEqual({ ok: true })
        await advance(10)
        expect(service.editText(A, 'firstMessage', 'f1', 'single')).toEqual({ ok: true })
        await advance(10)
        expect(service.editText(A, 'exampleMessage', 'e1', 'single')).toEqual({ ok: true })
        await advance(10)
        expect(service.editText(A, 'customModuleToggle', 't1', 'single')).toEqual({ ok: true })
        await advance(10)
        expect(service.editField(A, 'hideChatIcon', true)).toEqual({ ok: true })
        await advance(10)
        expect(service.editField(A, 'risutanium_render_when_complete', true)).toEqual({ ok: true })
        await advance(10)
        expect(service.greetingAdd(A).ok).toBe(true)
        await advance(10)
        expect(service.greetingDelete(A, 0).ok).toBe(true)
        await advance(10)
        expect(service.undo(A).ok).toBe(true)
        await advance(SAVE_DEBOUNCE_MS)

        await service.whenReady(chatA)
        expect(service.editText(chatA, 'note', 'n1', 'single')).toEqual({ ok: true })
        await advance(SAVE_DEBOUNCE_MS)

        await service.whenReady(M1)
        expect(service.editText(M1, 'customModuleToggle', 'a=B', 'single')).toEqual({ ok: true })
        await advance(SAVE_DEBOUNCE_MS)

        const actual = entries()
        expect(actual.length).toBeGreaterThan(3)
        if (process.env.RISU_WRITE_STORE_GOLDEN === '1') {
            writeFileSync(GOLDEN_PATH, JSON.stringify(actual, null, 2) + '\n')
        }
        expect(actual).toEqual(JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')))
    })
})
