// @vitest-environment jsdom
// T1-SV (diagnostic): the real owner history service over the S1 paths. An edit lands on the live character, marks it
// and records one coalesced `field` step; undo, redo and the restore point carry it, and the saved record reads back
// equal. The service, the setters, the store double and the save marks are real; the clock is fake.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { COALESCE_MS, type SetPath } from '../historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
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

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const live = (): Record<string, unknown> => (DBState.db.characters as unknown as Record<string, unknown>[])[0]

interface Harness {
    clock: FakeClock
    service: OwnerHistoryService
    store: ReturnType<typeof createMemoryStudioStore>
}

function build(shared?: Map<string, string>): Harness {
    const clock = createFakeClock(1000)
    const store = createMemoryStudioStore({ pageSession: 'p1', ...(shared ? { shared } : {}) })
    const service = createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
    })
    return { clock, service, store }
}

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    DBState.db.characters = [
        { chaId: 'A', name: 'A', desc: 'd0', firstMessage: 'f0', exampleMessage: 'e0', systemPrompt: 's0', alternateGreetings: [], chats: [], chatPage: 0 },
    ] as unknown as typeof DBState.db.characters
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('T1-SV: the service over the S1 paths', () => {
    test('depth_prompt.prompt without a container: the edit creates it, undo empties the prompt, redo restores it, and the record reloads equal', async () => {
        const { service, clock, store } = build()
        await service.whenReady(A)
        expect(service.editText(A, 'depth_prompt.prompt', 'x', 'single')).toEqual({ ok: true })
        expect(live().depth_prompt).toStrictEqual({ depth: 0, prompt: 'x' })
        expect('depth_prompt.prompt' in live()).toBe(false)
        expect(h.marks).toBeGreaterThan(0)
        expect(service.view(A).done.map((step) => step.label)).toEqual([{ kind: 'field', field: 'depth_prompt.prompt' }])
        expect(service.view(A).restore?.fields['depth_prompt.prompt']).toEqual({ before: { had: true, value: '' }, last: { had: true, value: 'x' } })
        expect(service.undo(A).ok).toBe(true)
        expect(live().depth_prompt).toStrictEqual({ depth: 0, prompt: '' })
        expect(service.redo(A).ok).toBe(true)
        expect(live().depth_prompt).toStrictEqual({ depth: 0, prompt: 'x' })
        await clock.advance(5000)
        const reopened = build(store.shared)
        await reopened.service.whenReady(A)
        expect(reopened.service.view(A).done).toEqual(service.view(A).done)
        expect(reopened.service.view(A).restore).toEqual(service.view(A).restore)
    })

    test.each<[SetPath, string, unknown]>([
        ['additionalData.creator', 'cr', { tag: [], creator: 'cr', character_version: '' }],
        ['systemPrompt', 'sp', undefined],
    ])('%s: one edit lands, is marked and undoes', async (path, value, container) => {
        const { service } = build()
        await service.whenReady(A)
        expect(service.editText(A, path, value, 'single')).toEqual({ ok: true })
        if (path === 'systemPrompt') {
            expect(live().systemPrompt).toBe(value)
        } else {
            expect(live().additionalData).toStrictEqual(container)
        }
        expect(h.marks).toBeGreaterThan(0)
        expect(service.view(A).restore?.fields[path]).toBeDefined()
        expect(service.undo(A).ok).toBe(true)
        if (path === 'systemPrompt') {
            expect(live().systemPrompt).toBe('s0')
        } else {
            expect(live().additionalData).toStrictEqual({ tag: [], creator: '', character_version: '' })
        }
    })

    test('two writes within the coalescing window make one step', async () => {
        const { service, clock } = build()
        await service.whenReady(A)
        service.editText(A, 'systemPrompt', 'a', 'typing')
        await clock.advance(COALESCE_MS / 4)
        service.editText(A, 'systemPrompt', 'ab', 'typing')
        expect(service.view(A).done).toHaveLength(1)
        expect(live().systemPrompt).toBe('ab')
    })
})
