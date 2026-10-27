// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { IMPORT_REPLACES_BASE, type CommitRequest } from 'src/ts/storage/store2/commit'
import { committerOf, createClock, seedStore, testEnv, treeRequest } from './commitFixtures'

async function setup() {
    const raw = createMemoryBackend()
    const clock = createClock()
    const m0 = await seedStore(raw, testEnv(clock, 1))
    return { raw, committer: committerOf(raw, clock, 100), m0 }
}

function withCarry(carry: unknown): CommitRequest {
    return { ...treeRequest(0), carry } as unknown as CommitRequest
}

describe('the carry of a commit request is mandatory and fail-closed', () => {
    const bad: Array<[string, unknown]> = [
        ['null', null],
        ['undefined', undefined],
        ['a string', 'x'],
        ['a missing from', { units: 1 }],
        ['a non-string from', { from: 5, units: 1 }],
        ['negative units', { from: 'k', units: -1 }],
        ['fractional units', { from: 'k', units: 1.5 }],
        ['NaN units', { from: 'k', units: Number.NaN }],
        ['string units', { from: 'k', units: '1' }],
    ]
    for (const [name, carry] of bad) {
        test(`commit and saveMine reject ${name} before any write`, async () => {
            const { raw, committer } = await setup()
            const before = (await raw.readCommit()).bytes
            await expect(committer.commit(await committer.readCommit(), withCarry(carry))).rejects.toThrow(TypeError)
            await expect(committer.saveMine(await committer.readCommit(), withCarry(carry))).rejects.toThrow(TypeError)
            expect((await raw.readCommit()).bytes).toEqual(before)
        })
    }

    test('the sentinel and a well-formed Carry are accepted', async () => {
        const { committer, m0 } = await setup()
        expect((await committer.commit(await committer.readCommit(), withCarry(IMPORT_REPLACES_BASE))).status).toBe('committed')
        expect((await committer.commit(await committer.readCommit(), withCarry({ from: m0, units: 0 }))).status).toBe('committed')
    })

    test('a malformed carry throws even when the commit key is unusable, so the check never depends on the base', async () => {
        const raw = createMemoryBackend()
        const committer = committerOf(raw, createClock(), 100)
        await expect(committer.commit(await committer.readCommit(), withCarry(null))).rejects.toThrow(TypeError)
        await expect(committer.saveMine(await committer.readCommit(), withCarry(undefined))).rejects.toThrow(TypeError)
    })
})
