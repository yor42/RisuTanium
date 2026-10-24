// @vitest-environment node
/**
 * What a 413 from the real Node server becomes at the committer, through the real server and a fetch wrapper that answers
 * the chosen requests with the body parser's 413. It sits next to `backendNode.test.ts` because the happy-dom kit suites
 * cannot load the server fixture. A 413 applied nothing, so an ordinary commit must end `failed` and a bulk commit
 * `abandoned`, both with the too-large cause; never `conflict` (a peer's write landing first) or an unknown outcome.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Store2BackendFailureError, Store2PayloadTooLargeError, Store2UnknownOutcomeError, createNodeBackend } from 'src/ts/storage/store2/backend'
import { createNodeHttpStore, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { createCommitter } from 'src/ts/storage/store2/commit'
import { previousFrom } from 'src/ts/storage/store2/codec'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { startNodeServer, hexOfKey, type NodeServerFixture } from '../nodeServerFixture'
import { createClock, fakeLists, seedTree, testEnv } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const fixtures: NodeServerFixture[] = []
afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()))
})

function tooLarge(marked: boolean): Response {
    return new Response(JSON.stringify({ error: 'Storage payload is too large', code: 'PAYLOAD_TOO_LARGE', message: 'Storage writes are limited to 100 MiB.' }), {
        status: 413,
        headers: marked ? { 'content-type': 'application/json', 'risu-storage-guarded': '1' } : { 'content-type': 'application/json' },
    })
}

async function world(refuse: { units: boolean, commit: boolean }, marked: boolean) {
    const fixture = await startNodeServer()
    fixtures.push(fixture)
    let armed = false
    const sent: string[] = []
    const wired: FetchLike = async (url, init) => {
        const path = new URL(url).pathname
        const headers = (init?.headers ?? {}) as Record<string, string>
        if (armed && path === '/api/write-checked') {
            const isCommit = headers['file-path'] === hexOfKey(COMMIT_KEY)
            sent.push(isCommit ? 'commit-key' : 'unit')
            if ((isCommit && refuse.commit) || (!isCommit && refuse.units)) {
                return tooLarge(marked)
            }
        }
        return fetch(url, init)
    }
    const store = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader(), fetch: wired })
    const backend = createNodeBackend(store)
    const clock = createClock()
    const db = buildSmall(40)
    const seeded = await seedTree(backend, db, testEnv(clock, 4242), fakeLists)
    const committer = createCommitter(backend, { owner: 'a'.repeat(26), env: testEnv(clock, 777) })
    const encoder = createSaveEncoder({ previous: previousFrom(seeded.tree), lists: fakeLists, env: testEnv(clock, 99) })
    return { backend, committer, encoder, db, arm: () => { armed = true }, sent }
}

describe.each([['marked', true], ['unmarked', false]])('a %s 413 at the committer level', (_label, marked) => {
    test('reproducer: an ordinary commit whose unit upload gets a 413 is failed with the too-large cause, not a conflict', async () => {
        const w = await world({ units: true, commit: false }, marked)
        const edited = JSON.parse(JSON.stringify(w.db))
        edited.characters[0].name = 'renamed'
        const plan = await w.encoder.plan(edited, { marked: new Set([String(edited.characters[0].chaId)]), modules: false, whole: false })
        w.arm()
        const result = await w.committer.commit(await w.committer.readCommit(), plan.commitRequest())
        expect(result.status).toBe('failed')
        expect((result as { cause?: unknown }).cause).toBeInstanceOf(Store2PayloadTooLargeError)
        expect(w.sent).not.toContain('commit-key')
    })

    test('reproducer: an ordinary commit whose commit-key write gets a 413 is failed with the too-large cause, not a conflict', async () => {
        const w = await world({ units: false, commit: true }, marked)
        const edited = JSON.parse(JSON.stringify(w.db))
        edited.characters[0].name = 'renamed'
        const plan = await w.encoder.plan(edited, { marked: new Set([String(edited.characters[0].chaId)]), modules: false, whole: false })
        w.arm()
        const result = await w.committer.commit(await w.committer.readCommit(), plan.commitRequest())
        expect(result.status).toBe('failed')
        expect((result as { cause?: unknown }).cause).toBeInstanceOf(Store2PayloadTooLargeError)
    })

    test('reproducer: a bulk commit whose unit upload gets a 413 is abandoned with the too-large cause and its own marker cleared', async () => {
        const w = await world({ units: true, commit: false }, marked)
        const edited = JSON.parse(JSON.stringify(w.db))
        for (const slot of edited.characters) {
            slot.name = `${slot.name} x`
        }
        const plan = await w.encoder.plan(edited, { marked: new Set(edited.characters.map((slot: { chaId: string }) => String(slot.chaId))), modules: true, whole: true, rewriteAll: true })
        w.arm()
        const result = await w.committer.commit(await w.committer.readCommit(), plan.commitRequest())
        expect(result.status).toBe('abandoned')
        const abandoned = result as { cause?: unknown, cleared: { status: string } | null }
        expect(abandoned.cause).toBeInstanceOf(Store2PayloadTooLargeError)
        expect(abandoned.cause).toBeInstanceOf(Store2BackendFailureError)
        expect(abandoned.cause).not.toBeInstanceOf(Store2UnknownOutcomeError)
        expect(abandoned.cleared?.status).toBe('cleared')
    })
})
