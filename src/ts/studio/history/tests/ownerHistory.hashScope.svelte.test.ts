// @vitest-environment jsdom
// Through the service, the cache remembers only the
// card that is open. Units of first-message text the service hashes, per visit and per action.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey, type OwnerKey } from '../ownerPhase'
import { COALESCE_MS } from '../historyModel'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'

const h = vi.hoisted(() => ({ marks: 0 }))
const fp = vi.hoisted(() => ({ units: 0 }))

vi.mock('../listFingerprint', async (importOriginal) => {
    const real = await importOriginal<typeof import('../listFingerprint')>()
    const counted = (value: unknown): number => {
        fp.units += typeof value === 'string' ? value.length : 0
        return real.fingerprintElement(value)
    }
    return {
        fingerprintElement: counted,
        mixElementHashes: real.mixElementHashes,
        listFingerprintOf: (list: readonly unknown[], elementHash: (value: unknown) => number = counted) => {
            const hashes = new Array<number>(list.length)
            for (let i = 0; i < list.length; i++) hashes[i] = elementHash(list[i])
            return real.mixElementHashes(hashes)
        },
    }
})

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
    }
})

interface LiveCharacter {
    chaId: string
    desc: string
    alternateGreetings: string[]
    chats: { id?: string; note: string; fmIndex?: number }[]
    chatPage: number
}

const texts = (n: number, length: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}:`.padEnd(length, 'x'))

function makeCharacter(chaId: string, greetings: string[]): LiveCharacter {
    return { chaId, desc: 'd0', alternateGreetings: greetings, chats: [{ id: 'c1', note: '', fmIndex: 1 }], chatPage: 0 }
}

let clock: FakeClock
let service: OwnerHistoryService
let queue: { run: (remainingMs: () => number) => void; cancelled: boolean }[]

function build(withIdle: boolean): void {
    clock = createFakeClock()
    queue = []
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        ...(withIdle
            ? {
                  scheduleIdle: (run: (remainingMs: () => number) => void) => {
                      const entry = { run, cancelled: false }
                      queue.push(entry)
                      return () => {
                          entry.cancelled = true
                      }
                  },
              }
            : {}),
    })
}

function flush(): void {
    while (queue.length > 0) {
        const entry = queue.shift()!
        if (!entry.cancelled) entry.run(() => 50)
    }
}

const ids = ['A', 'B']

// Opens a card the way Studio does: the card is selected and shown, then its owner is used.
async function visit(chaId: string): Promise<OwnerKey> {
    studioScreen.chaId = chaId
    selIdState.selId = ids.indexOf(chaId)
    const owner = characterOwnerKey(chaId)
    service.useOwner(owner)
    await service.whenReady(owner)
    return owner
}

// Units read by `run`.
function read(run: () => void): number {
    const start = fp.units
    run()
    return fp.units - start
}

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    DBState.db.characters = [makeCharacter('A', texts(6, 40, 'a')), makeCharacter('B', texts(4, 30, 'b'))] as unknown as typeof DBState.db.characters
    fp.units = 0
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('Z-S one card in the cache, through the service', () => {
    test('Z3 a return to a card reads its whole list in the visit\'s warm-up and nothing in the action after it', async () => {
        build(true)
        await visit('A')
        expect(read(flush)).toBe(240)
        await visit('B')
        expect(read(flush)).toBe(120)
        const owner = await visit('A')
        expect(read(flush)).toBe(240)
        expect(read(() => expect(service.greetingDelete(owner, 1).ok).toBe(true))).toBe(0)
    })

    test('Z4 without a warm-up, the first action after another card reads the whole list once', async () => {
        build(false)
        const a = await visit('A')
        expect(read(() => service.greetingDelete(a, 0))).toBe(240)
        const b = await visit('B')
        expect(read(() => service.greetingDelete(b, 0))).toBe(120)
        const again = await visit('A')
        clock.tick(COALESCE_MS)
        expect(read(() => service.greetingDelete(again, 0))).toBe(200)
        clock.tick(COALESCE_MS)
        expect(read(() => service.greetingDelete(again, 0))).toBe(0)
    })

    test('Z6 the same card\'s actions and its chat-note writes keep the cache', async () => {
        build(true)
        const owner = await visit('A')
        flush()
        const chat = chatOwnerKey('A', 'c1')
        await service.whenReady(chat)
        expect(read(() => {
            expect(service.greetingDelete(owner, 1).ok).toBe(true)
            expect(service.undo(owner).ok).toBe(true)
            expect(service.editField(chat, 'note', 'n1').ok).toBe(true)
            expect(service.redo(owner).ok).toBe(true)
            clock.tick(COALESCE_MS)
            expect(service.greetingAdd(owner).ok).toBe(true)
        })).toBe(0)
    })
})
