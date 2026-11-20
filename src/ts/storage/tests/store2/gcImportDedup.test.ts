// @vitest-environment node
/**
 * Garbage collection over a profile whose tree names units an earlier import stored (content reuse by an import):
 * once the earlier manifest is no longer named, the pass deletes only what no named manifest names, and every unit the
 * current tree names (the reused ones included) is still stored and reads back. Label: compatibility guard of the unchanged
 * pass. Before content reuse its sharing precondition fails (nothing is shared); after it, it pins that the pass keeps
 * every shared unit the current tree names.
 */
import { describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { readBaseContentIndex } from 'src/ts/storage/store2/baseContent'
import { gcPass } from 'src/ts/storage/store2/gc/pass'
import { markLiveKeys } from 'src/ts/storage/store2/gc/mark'
import { importLegacyTree, type ImportOutcome } from 'src/ts/storage/store2/legacy/importTree'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { refsOf, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { fakeLists } from './codecFixtures'
import { committerOf, createClock, expectInvariant, parsedCommit, plantKey, seedStore, testEnv } from './commitFixtures'
import { loadGolden, readerOver } from './legacyFixtures'

const accept = { async confirmIncomplete() { return true } }

function committed(outcome: ImportOutcome): Extract<ImportOutcome, { status: 'committed' }> {
    if (outcome.status !== 'committed') {
        throw new Error(`The import answered ${outcome.status}.`)
    }
    return outcome
}

async function importGolden(memory: MemoryBackend, committer: ReturnType<typeof committerOf>, seed: number, clock: ReturnType<typeof createClock>) {
    const golden = await loadGolden('upstream-full.bin')
    let n = 0
    return committed(await importLegacyTree({
        source: { tree: golden.tree },
        reader: readerOver(golden.units),
        committer,
        backend: memory,
        lists: fakeLists,
        env: testEnv(clock, seed),
        resolve: { newId: () => 'placeholder-chat-id', now: () => 1_700_000_000_001, newUnitId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` },
    }, accept))
}

describe('guard: a dedup re-import, then the earlier manifest unnamed, then a collection pass', () => {
    test('the pass deletes the earlier tree\'s own units and keeps every unit the current tree names', async () => {
        const memory = createMemoryBackend()
        const clock = createClock()
        await seedStore(memory, testEnv(clock, 1))
        const committer = committerOf(memory, clock, 100)
        clock.advance(1000)
        const first = await importGolden(memory, committer, 300, clock)
        const firstKeys = new Set([...(await readBaseContentIndex(memory, await memory.readCommit())).units.values()].flat().map(unit => unit.key))
        clock.advance(1000)
        const second = await importGolden(memory, committer, 301, clock)
        const index = await readBaseContentIndex(memory, await memory.readCommit())
        // The second manifest's indexed units, among them those the first import stored (named by both manifests).
        const reusedKeys = new Set([...index.units.values()].flat().map(unit => unit.key))
        expect(first.manifestKey).not.toBe(second.manifestKey)
        expect([...reusedKeys].filter(key => firstKeys.has(key)).length).toBeGreaterThan(0)

        // Only the second manifest stays named: the first import's manifest, shards and order unit become garbage.
        const key = await parsedCommit(memory)
        await plantKey(memory, { ...key, seq: key.seq + 1, epoch: 'h'.repeat(key.epoch.length), current: { key: second.manifestKey, at: 5 }, retained: [], pins: [] })
        const before = await readTreeBytes(memory, second.manifestKey)
        expect(before.status).toBe('ok')
        const databaseBefore = before.status === 'ok' ? JSON.stringify(assembleDatabase(before.tree.manifest, before.tree.source).characters) : ''

        const result = await gcPass({ backend: memory, kind: 'tauri', idleReason: () => null })

        expect(result.status === 'done' && result.deleted).toBeGreaterThan(0)
        const listed = new Set(await memory.listStore2())
        for (const reused of reusedKeys) {
            expect(listed.has(reused), `${reused} is still stored`).toBe(true)
        }
        const live = await markLiveKeys(memory, await memory.readCommit())
        expect(live.status).toBe('marked')
        const manifest = (await readTreeBytes(memory, second.manifestKey))
        expect(manifest.status).toBe('ok')
        if (manifest.status === 'ok') {
            for (const target of refsOf(UNIT_TYPE.manifest, manifest.tree.manifest)) {
                expect(listed.has(`store2/${target.tail}`), `${target.tail} named by the current manifest`).toBe(true)
            }
            expect(JSON.stringify(assembleDatabase(manifest.tree.manifest, manifest.tree.source).characters)).toBe(databaseBefore)
        }
        expect(classifyCommitRead(await memory.readCommit()).status).toBe('parsed')
        await expectInvariant(memory)
    })
})
