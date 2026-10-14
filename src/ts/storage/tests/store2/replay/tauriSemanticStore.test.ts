// @vitest-environment node
/**
 * The Tauri-semantics store of the replay: the gate's rules as the native side keeps
 * them (generation check and apply as one step, registration waiting for a call that
 * holds the lock, the key rules of the two decisive calls, the bypass guards) and the
 * two test options that remove them. The replay's red runs rest on this file's
 * statement of what the gate does.
 */
import { describe, expect, test } from 'vitest'
import { StoreDeleteManyError, StoreInvalidKeyError, StoreStaleGenerationError } from 'src/ts/storage/store/errors'
import { newUnitKey } from 'src/ts/storage/store2/format'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import { createClock, testEnv } from '../commitFixtures'
import { createTauriSemanticStore, rawOfTauriSemantic, type TauriSemanticOptions } from './tauriSemanticStore'
import type { TwoStepPageGate } from './scheduler'

const clock = createClock()
const BYTES = Uint8Array.from([1, 2, 3])
const OTHER = Uint8Array.from([4, 5, 6])

function build(options?: TauriSemanticOptions) {
    const fake = createTauriSemanticStore(options)
    const gate = fake.store.pageGate as TwoStepPageGate
    return { fake, gate, store: fake.store }
}

function unitKey(seed = 1): string {
    return newUnitKey(testEnv(clock, seed))
}

async function macrotask(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('generation check', () => {
    test('generation 0 is refused before any registration and nothing is applied', async () => {
        const { fake, gate } = build()
        await expect(gate.writeTop(0, COMMIT_KEY, BYTES)).rejects.toBeInstanceOf(StoreStaleGenerationError)
        expect(fake.peek(COMMIT_KEY)).toBeNull()
    })

    test('only the current generation writes; an older one and a newer one are refused', async () => {
        const { fake, gate } = build()
        const first = await gate.registerPage()
        const second = await gate.registerPage()
        expect(second).toBe(first + 1)
        await expect(gate.writeTop(first, COMMIT_KEY, BYTES)).rejects.toBeInstanceOf(StoreStaleGenerationError)
        await expect(gate.writeTop(second + 1, COMMIT_KEY, BYTES)).rejects.toBeInstanceOf(StoreStaleGenerationError)
        expect(fake.peek(COMMIT_KEY)).toBeNull()
        expect(await gate.writeTop(second, COMMIT_KEY, BYTES)).toEqual({ version: null, flushed: true })
        expect(fake.peek(COMMIT_KEY)).toEqual(BYTES)
    })

    test('a stale removal applies nothing', async () => {
        const { fake, gate } = build()
        const key = unitKey()
        fake.plant(key, BYTES)
        const stale = await gate.registerPage()
        await gate.registerPage()
        await expect(gate.removeTop(stale, [key])).rejects.toBeInstanceOf(StoreStaleGenerationError)
        expect(fake.peek(key)).toEqual(BYTES)
    })

    test('a refused write leaves the previous value in place', async () => {
        const { fake, gate } = build()
        const first = await gate.registerPage()
        await gate.writeTop(first, COMMIT_KEY, BYTES)
        await gate.registerPage()
        await expect(gate.writeTop(first, COMMIT_KEY, OTHER)).rejects.toBeInstanceOf(StoreStaleGenerationError)
        expect(fake.peek(COMMIT_KEY)).toEqual(BYTES)
    })
})

describe('keys of the decisive calls', () => {
    test('writeTop writes only store2-commit and store2-fence', async () => {
        const { gate } = build()
        const generation = await gate.registerPage()
        await expect(gate.writeTop(generation, unitKey(), BYTES)).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await expect(gate.writeTop(generation, 'database/database.bin', BYTES)).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await gate.writeTop(generation, FENCE_KEY, BYTES)
    })

    test('removeTop refuses the commit key and keys outside store2/ except the fence, as a whole call', async () => {
        const { fake, gate } = build()
        const generation = await gate.registerPage()
        const key = unitKey()
        fake.plant(key, BYTES)
        fake.plant(COMMIT_KEY, BYTES)
        await expect(gate.removeTop(generation, [key, COMMIT_KEY])).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await expect(gate.removeTop(generation, [key, 'database/database.bin'])).rejects.toBeInstanceOf(StoreInvalidKeyError)
        expect(fake.peek(key)).toEqual(BYTES)
        expect(fake.peek(COMMIT_KEY)).toEqual(BYTES)
        fake.plant(FENCE_KEY, BYTES)
        await gate.removeTop(generation, [FENCE_KEY, key])
        expect(fake.peek(FENCE_KEY)).toBeNull()
        expect(fake.peek(key)).toBeNull()
    })

    test('an absent key counts as removed', async () => {
        const { gate } = build()
        const generation = await gate.registerPage()
        await expect(gate.removeTop(generation, [unitKey()])).resolves.toBeUndefined()
    })

    test('a key the file system cannot address is reported failed and the others are still removed', async () => {
        const { fake, gate } = build()
        const generation = await gate.registerPage()
        const key = unitKey()
        fake.plant(key, BYTES)
        // A Windows path holds no colon.
        const unaddressable = 'store2/bad:name'
        const error = await gate.removeTop(generation, [unaddressable, key]).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(StoreDeleteManyError)
        expect((error as StoreDeleteManyError).report.map((entry) => [entry.key, entry.outcome])).toEqual([[unaddressable, 'failed'], [key, 'removed']])
        expect(fake.peek(key)).toBeNull()
    })

    test('a key listed twice is invalid input', async () => {
        const { gate } = build()
        const generation = await gate.registerPage()
        const key = unitKey()
        await expect(gate.removeTop(generation, [key, key])).rejects.toBeDefined()
    })
})

describe('bypass guards', () => {
    test('the plain write refuses store2-commit and store2-fence and applies nothing', async () => {
        const { fake, store } = build()
        await expect(store.write(COMMIT_KEY, BYTES, 'unconditional')).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await expect(store.write(FENCE_KEY, BYTES, 'unconditional')).rejects.toBeInstanceOf(StoreInvalidKeyError)
        expect(fake.peek(COMMIT_KEY)).toBeNull()
        expect(fake.peek(FENCE_KEY)).toBeNull()
    })

    test('the plain delete and deleteMany refuse the gated keys and every store2/ key', async () => {
        const { fake, store } = build()
        const key = unitKey()
        fake.plant(key, BYTES)
        fake.plant(COMMIT_KEY, BYTES)
        fake.plant(FENCE_KEY, BYTES)
        await expect(store.delete(COMMIT_KEY, 'unconditional')).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await expect(store.delete(FENCE_KEY, 'unconditional')).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await expect(store.delete(key, 'unconditional')).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await expect(store.deleteMany([{ key, condition: 'unconditional' }])).rejects.toBeInstanceOf(StoreInvalidKeyError)
        expect([fake.peek(key), fake.peek(COMMIT_KEY), fake.peek(FENCE_KEY)]).toEqual([BYTES, BYTES, BYTES])
    })

    test('the plain write still writes a unit and reports it flushed', async () => {
        const { fake, store } = build()
        const key = unitKey()
        expect(await store.write(key, BYTES, 'unconditional')).toEqual({ version: null, flushed: true })
        expect(await store.has(key)).toBe(true)
        expect((await store.read(key)).bytes).toEqual(BYTES)
        expect(await store.list('store2/')).toEqual([key])
        expect(fake.peek(key)).toEqual(BYTES)
    })

    test('a conditional write is refused: the store has no revisions', async () => {
        const { store } = build()
        await expect(store.write(unitKey(), BYTES, { ifVersion: 1 })).rejects.toBeDefined()
    })

    test('bypass allow lets the plain paths touch the gated keys', async () => {
        const { fake, store } = build({ bypass: 'allow' })
        await store.write(COMMIT_KEY, BYTES, 'unconditional')
        expect(fake.peek(COMMIT_KEY)).toEqual(BYTES)
        await store.deleteMany([{ key: COMMIT_KEY, condition: 'unconditional' }])
        expect(fake.peek(COMMIT_KEY)).toBeNull()
    })
})

describe('registration and the lock', () => {
    test('registration waits while a call holds the lock and returns only after the call applied', async () => {
        const { fake, gate } = build()
        const holder = await gate.registerPage()
        const landing = await gate.beginWriteTop(holder, COMMIT_KEY, BYTES)
        expect(fake.locked).toBe(true)
        let registered: number | null = null
        const registration = gate.registerPage().then((generation) => {
            registered = generation
            return generation
        })
        await macrotask()
        expect(registered).toBeNull()
        expect(fake.peek(COMMIT_KEY)).toBeNull()
        await landing()
        // The bytes are in place by the time registration is answered.
        expect(await registration).toBe(holder + 1)
        expect(fake.peek(COMMIT_KEY)).toEqual(BYTES)
        expect(fake.locked).toBe(false)
    })

    test('a decisive call that arrives while the lock is held waits and then applies under its own check', async () => {
        const { fake, gate } = build()
        const holder = await gate.registerPage()
        const landing = await gate.beginWriteTop(holder, COMMIT_KEY, BYTES)
        let settled = false
        const queued = gate.writeTop(holder, FENCE_KEY, OTHER).finally(() => { settled = true })
        await macrotask()
        expect(settled).toBe(false)
        await landing()
        await queued
        expect(fake.peek(FENCE_KEY)).toEqual(OTHER)
    })

    test('writeTop checks and applies under the lock: a registration queued behind it waits for the bytes', async () => {
        const { fake, gate } = build()
        const holder = await gate.registerPage()
        const landing = await gate.beginWriteTop(holder, COMMIT_KEY, BYTES)
        const queued = gate.writeTop(holder, FENCE_KEY, OTHER)
        const registration = gate.registerPage()
        await landing()
        expect(await registration).toBe(holder + 1)
        expect(fake.peek(FENCE_KEY)).toEqual(OTHER)
        await queued
    })

    test('removeTop checks and applies under the lock: a registration queued behind it waits for the removal', async () => {
        const { fake, gate } = build()
        const key = unitKey()
        fake.plant(key, BYTES)
        const holder = await gate.registerPage()
        const landing = await gate.beginWriteTop(holder, COMMIT_KEY, BYTES)
        const queued = gate.removeTop(holder, [key])
        const registration = gate.registerPage()
        await landing()
        expect(await registration).toBe(holder + 1)
        expect(fake.peek(key)).toBeNull()
        await queued
    })

    test('a queued call whose page was superseded before it reached the lock is refused', async () => {
        const { fake, gate } = build()
        const stale = await gate.registerPage()
        await gate.registerPage()
        await expect(gate.writeTop(stale, COMMIT_KEY, BYTES)).rejects.toBeInstanceOf(StoreStaleGenerationError)
        expect(fake.peek(COMMIT_KEY)).toBeNull()
    })

    test('a begin whose generation is stale is refused and leaves the lock free', async () => {
        const { fake, gate } = build()
        const stale = await gate.registerPage()
        await gate.registerPage()
        await expect(gate.beginWriteTop(stale, COMMIT_KEY, BYTES)).rejects.toBeInstanceOf(StoreStaleGenerationError)
        expect(fake.locked).toBe(false)
        await expect(gate.registerPage()).resolves.toBeGreaterThan(stale)
    })

    test('a landing happens once', async () => {
        const { gate } = build()
        const generation = await gate.registerPage()
        const landing = await gate.beginRemoveTop(generation, [unitKey()])
        await landing()
        await expect(landing()).rejects.toThrow('once')
    })
})

describe('gate disabled', () => {
    test('a stale generation is applied and registration does not wait', async () => {
        const { fake, gate } = build({ gate: false })
        const stale = await gate.registerPage()
        await gate.registerPage()
        await gate.writeTop(stale, COMMIT_KEY, BYTES)
        expect(fake.peek(COMMIT_KEY)).toEqual(BYTES)
        await gate.writeTop(0, COMMIT_KEY, OTHER)
        expect(fake.peek(COMMIT_KEY)).toEqual(OTHER)

        const landing = await gate.beginWriteTop(stale, FENCE_KEY, BYTES)
        expect(fake.locked).toBe(false)
        await expect(gate.registerPage()).resolves.toBeGreaterThan(stale)
        await landing()
        expect(fake.peek(FENCE_KEY)).toEqual(BYTES)
    })
})

describe('raw state', () => {
    test('is bytes-only with the commit key and the fence always present', async () => {
        const { fake, gate } = build()
        const generation = await gate.registerPage()
        await gate.writeTop(generation, COMMIT_KEY, BYTES)
        const raw = rawOfTauriSemantic(fake)()
        expect(raw.get(COMMIT_KEY)).toEqual({ bytes: BYTES, revision: null })
        expect(raw.get(FENCE_KEY)).toEqual({ bytes: null, revision: null })
    })
})
