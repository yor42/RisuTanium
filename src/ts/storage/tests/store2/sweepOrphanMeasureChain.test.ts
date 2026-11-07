// @vitest-environment node
/**
 * The orphan measurement over a library the real store2 producer made: a module with assets is committed, then deleted, and the
 * measurement is asked what is unreachable. The trees are encoded by `encodeDatabase` and `createSaveEncoder` with the real list
 * derivation (`createListDerivation()`, whose asset lists carry the module's `assets` rows as `saveAssetBytes` makes them),
 * committed through the real committer over a memory backend, and read through a real `Store2Session`.
 *
 * What is a stand-in: the backend and the page byte store are memory doubles, the clock is a counter, and the resident database
 * is empty (the module is gone from it). Nothing here says anything about a native store or a real library.
 *
 * The module does not exist on the commit before it, so a file here fails at import there, which proves nothing by
 * itself. A "reproducer" is red under the mutant named in the hand-back that removes the rule it pins.
 */
import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { assembleDatabase, previousFrom } from 'src/ts/storage/store2/codec'
import { ADMISSION_INTERVAL_MS, IMPORT_REPLACES_BASE } from 'src/ts/storage/store2/commit'
import { RETAINED_MAX } from 'src/ts/storage/store2/commitKey'
import { readUnit, UNIT_TYPE, type CommitKey, type Manifest } from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { Store2Session } from 'src/ts/storage/store2/session'
import { measureAssetOrphans, type AssetOrphanEnv } from 'src/ts/storage/store2/sweep/orphanMeasure'
import { startStore2, testEnv, type Store2Kit } from '../store2SaveKit'
import { buildSmall, type Obj } from './codecFixtures'

const MODULE_ID = 'mod-with-assets'

/** Distinct stored sizes, so a byte total identifies which assets it summed. */
const ASSET_BYTES = [101, 202, 303] as const

interface StoredAsset {
    name: string
    bytes: Uint8Array
}

/** The assets of the module: the name `saveAssetBytes` derives is the content's SHA-256 in hex plus the extension. */
function moduleAssets(): StoredAsset[] {
    return ASSET_BYTES.map((length, i) => {
        const bytes = Uint8Array.from({ length }, (_, at) => (at * 13 + i * 7 + 1) % 256)
        return { name: `${createHash('sha256').update(bytes).digest('hex')}.png`, bytes }
    })
}

function moduleBody(assets: readonly StoredAsset[]): Obj {
    return {
        id: MODULE_ID, name: 'Module with assets', description: 'about it',
        lorebook: [{ comment: 'c', content: 'text', key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal', bookVersion: 2 }],
        regex: [], trigger: [],
        assets: assets.map(asset => [asset.name.slice(0, 8), `assets/${asset.name}`, 'png']),
    }
}

function databaseWith(assets: readonly StoredAsset[]): Database {
    return { ...(buildSmall(2) as unknown as Obj), enabledModules: [MODULE_ID], moduleIntergration: '', modules: [moduleBody(assets)] } as unknown as Database
}

/** Commits `edit` applied to a copy of the seed database as a whole tree, as a page's save would. */
async function commitEdit(kit: Store2Kit, edit: (db: Database) => void, seed: number): Promise<CommitKey> {
    const db = JSON.parse(JSON.stringify(kit.seedDb)) as Database
    edit(db)
    const encoder = createSaveEncoder({ previous: previousFrom(kit.seeded.tree), lists: createListDerivation(), env: testEnv(kit.clock, seed) })
    const plan = await encoder.plan(db, { marked: new Set(), modules: true, whole: true })
    // The encoder is built from the seed tree and commits over a key that no longer names it, so the carry claim is replaced by the sentinel.
    const result = await kit.committer.commit(await kit.committer.readCommit(), { ...plan.commitRequest(), carry: IMPORT_REPLACES_BASE })
    if (result.status !== 'committed') {
        throw new Error(`The commit came to ${result.status}.`)
    }
    return result.value
}

function deleteModule(db: Database): void {
    db.modules = []
    db.enabledModules = []
}

/** The ids of the modules a stored manifest holds. */
function moduleIdsOf(kit: Store2Kit, manifestKey: string): string[] {
    const entries = kit.memory.snapshot()
    const stored = entries.get(manifestKey)
    if (stored === undefined) {
        throw new Error(`${manifestKey} is not stored.`)
    }
    const manifest = readUnit(stored, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok') {
        throw new Error(`The manifest is ${manifest.status}.`)
    }
    const db = assembleDatabase(manifest.value.body as Manifest, { get: key => entries.get(key) })
    return (db.modules as unknown as { id: string }[]).map(module => module.id)
}

async function chain() {
    const assets = moduleAssets()
    const kit = await startStore2({ db: databaseWith(assets), lists: createListDerivation() })
    const store = createMemoryByteStore()
    for (const asset of assets) {
        store.files.set(`assets/${asset.name}`, asset.bytes)
    }
    return { assets, kit, store }
}

async function measure(kit: Store2Kit, store: ReturnType<typeof createMemoryByteStore>, over: Partial<AssetOrphanEnv> = {}) {
    const session = await Store2Session.open(store, { kind: 'indexeddb', backend: kit.memory, upstreamMainFile: async () => false })
    const before = { files: new Map(store.files), backend: new Map(kit.memory.snapshot()) }
    const report = await measureAssetOrphans({ session, store, residentRefs: () => [], writtenThisPage: () => [], storeKind: 'indexeddb', ...over })
    return { report, before }
}

describe('a module that was imported and then deleted', () => {
    test('reproducer: while the module is in the current manifest none of its assets is an orphan', async () => {
        const { kit, store } = await chain()

        const { report } = await measure(kit, store)

        expect(report).toMatchObject({ status: 'done', listed: 3 })
        expect(report.status === 'done' ? report.notInHead : null).toEqual({ count: 0, bytes: 0, sample: [] })
        expect(report.status === 'done' ? report.notInAny : null).toEqual({ count: 0, bytes: 0, sample: [] })
    })

    test('reproducer: after the delete the assets are unreachable from the head, with their stored bytes, and nothing is written', async () => {
        const { assets, kit, store } = await chain()
        await commitEdit(kit, deleteModule, 31)
        const key = await kit.commitKey()
        const retained = key.retained.map(entry => moduleIdsOf(kit, entry.key))
        expect(retained).toEqual([[MODULE_ID]])

        const { report, before } = await measure(kit, store)

        expect(report.status).toBe('done')
        if (report.status !== 'done') {
            return
        }
        const names = assets.map(asset => asset.name).sort()
        const total = ASSET_BYTES.reduce((sum, length) => sum + length, 0)
        expect(report.retained).toBe(1)
        expect(report.pins).toBe(0)
        expect(report.keep).toEqual({ head: { keepSet: 'complete' }, full: { keepSet: 'complete' } })
        expect(report.notInHead).toEqual({ count: 3, bytes: total, sample: names })
        expect(report.bytesSource).toBe('read')
        expect(store.files).toEqual(before.files)
        expect(kit.memory.snapshot()).toEqual(before.backend)
        expect(store.writes).toEqual([])
        expect(store.deletes).toEqual([])
    })

    test('reproducer: a restore point that still holds the module keeps its assets out of the any-reference tier', async () => {
        const { assets, kit, store } = await chain()
        kit.clock.advance(ADMISSION_INTERVAL_MS + 1)
        await commitEdit(kit, deleteModule, 32)
        const key = await kit.commitKey()
        expect(key.retained.map(entry => moduleIdsOf(kit, entry.key))).toContainEqual([MODULE_ID])

        const { report } = await measure(kit, store)

        expect(report.status).toBe('done')
        if (report.status !== 'done') {
            return
        }
        const total = ASSET_BYTES.reduce((sum, length) => sum + length, 0)
        expect(report.restorePointsOnly).toEqual({ count: 3, bytes: total, sample: assets.map(asset => asset.name).sort() })
        expect(report.notInAny).toEqual({ count: 0, bytes: 0, sample: [] })
    })

    test('reproducer: once later saves push the restore point out, the assets are unreachable from every manifest', async () => {
        const { assets, kit, store } = await chain()
        await commitEdit(kit, deleteModule, 33)
        for (let i = 0; i <= RETAINED_MAX; i++) {
            kit.clock.advance(ADMISSION_INTERVAL_MS + 1)
            await commitEdit(kit, db => { deleteModule(db); db.userIcon = `icon-${i}` }, 40 + i)
        }
        const key = await kit.commitKey()
        expect(key.retained.some(entry => moduleIdsOf(kit, entry.key).includes(MODULE_ID))).toBe(false)

        const { report } = await measure(kit, store)

        expect(report.status).toBe('done')
        if (report.status !== 'done') {
            return
        }
        const total = ASSET_BYTES.reduce((sum, length) => sum + length, 0)
        expect(report.notInAny).toEqual({ count: 3, bytes: total, sample: assets.map(asset => asset.name).sort() })
        expect(report.restorePointsOnly).toEqual({ count: 0, bytes: 0, sample: [] })
    })
})
