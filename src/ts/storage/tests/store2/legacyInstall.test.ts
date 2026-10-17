// @vitest-environment node
/**
 * `planWholeTreeInstall`: a resolved legacy database handed to the first-life
 * installer as one whole-tree install. Every golden installs, the stored tree
 * satisfies the independent I1 oracle (`expectInvariant`), and reading it back
 * through the codec equals the resolver's output. A pass says nothing about the
 * Node or Tauri backends: the memory backend stands in for the byte store.
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

import type { Database } from 'src/ts/storage/database.svelte'
import { createMemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyBoot, probeStore2Presence, runBootClear } from 'src/ts/storage/store2/boot'
import { assembleDatabase, StubRefusedError, type UnitSource } from 'src/ts/storage/store2/codec'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { firstLifeGrant, firstLifeInstall } from 'src/ts/storage/store2/firstLife'
import { readUnit, UNIT_TYPE, type Manifest } from 'src/ts/storage/store2/format'
import { planWholeTreeInstall } from 'src/ts/storage/store2/legacy/install'
import { resolveLegacyTree } from 'src/ts/storage/store2/legacy/resolve'
import { fakeLists } from './codecFixtures'
import { committerOf, createClock, expectInvariant, parsedCommit, testEnv, type TestClock } from './commitFixtures'
import { ALL_GOLDENS, loadGolden, readerOver } from './legacyFixtures'

const ME = 'a'.repeat(26)
const ABSENT_FENCE = { state: 'absent', token: { kind: 'bytes', bytes: null } } as const

/** The grant a page booting on an upstream main file and an absent commit key holds. */
async function convertGrant(backend: Store2Backend, clock: TestClock) {
    let read = await backend.readCommit()
    const commit = classifyCommitRead(read)
    const decision = classifyBoot({
        commit,
        fence: ABSENT_FENCE,
        presence: commit.status === 'absent' ? await probeStore2Presence(backend) : null,
        tree: null,
        upstreamMainFile: true,
        ownerId: ME,
        deviceOwner: false,
    })
    const startupClear = await runBootClear(committerOf(backend, clock, 41, { owner: ME }), read, decision, ME)
    if (startupClear !== null) {
        read = await backend.readCommit()
    }
    const result = firstLifeGrant({ decision, commitRead: read, startupClear })
    if (result.status !== 'granted') {
        throw new Error(`The grant was refused: ${result.reason}.`)
    }
    return result.grant
}

async function storedUnits(backend: Store2Backend): Promise<UnitSource> {
    const units = await backend.readUnits(await backend.listStore2())
    return { get: key => units.get(key) ?? undefined }
}

describe('new behaviour: a resolved legacy tree installs as one tree through the first-life installer', () => {
    test.each(ALL_GOLDENS)('%s installs, satisfies the invariant and assembles back to the resolved database', async (file) => {
        const golden = await loadGolden(file)
        const { database } = await resolveLegacyTree(golden.tree, readerOver(golden.units), { newId: () => 'id', now: () => 1 })
        const tree = { ...database, botPresets: database.botPresets ?? [] } as Database
        const backend = createMemoryBackend()
        const clock = createClock()
        const request = await planWholeTreeInstall(tree, { lists: fakeLists, env: testEnv(clock, 21), convertedFrom: 'database/database.bin' })

        const result = await firstLifeInstall(backend, await convertGrant(backend, clock), request, { owner: ME, env: testEnv(clock, 11) })

        expect(result.status).toBe('installed')
        if (result.status !== 'installed') {
            return
        }
        const stored = await parsedCommit(backend)
        expect(stored.current?.key).toBe(result.manifestKey)
        expect(stored.convertedFrom).toBe('database/database.bin')
        expect(stored.staging).toBeNull()
        await expectInvariant(backend)

        const source = await storedUnits(backend)
        const manifest = readUnit(source.get(result.manifestKey) as Uint8Array, UNIT_TYPE.manifest)
        expect(manifest.status).toBe('ok')
        if (manifest.status !== 'ok') {
            return
        }
        const assembled = assembleDatabase(manifest.value.body as Manifest, source) as Database
        expect(JSON.parse(JSON.stringify(assembled.characters))).toEqual(JSON.parse(JSON.stringify(tree.characters)))
        expect(assembled.pluginCustomStorage ?? {}).toEqual(tree.pluginCustomStorage ?? {})
    })

    test('guard: an unresolved tree is refused before any install request exists, so a stub never reaches the installer', async () => {
        const golden = await loadGolden('fork-full.bin')

        await expect(planWholeTreeInstall(golden.tree, { lists: fakeLists, env: testEnv(createClock(), 21), convertedFrom: 'x' })).rejects.toBeInstanceOf(StubRefusedError)
    })
})