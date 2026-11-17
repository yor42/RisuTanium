// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import type { Database } from 'src/ts/storage/database.svelte'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { resetStore2BootForTest } from 'src/ts/storage/store2/bootActive'
import type { Hooks } from './commitFixtures'
import { hooked, treeRequest } from './commitFixtures'
import { resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest, type Store2SaveContext } from 'src/ts/storage/store2/saveActive'
import { resetRetainedForTest } from 'src/ts/process/coldRetained'
import { setFastForwardHostForTest } from 'src/ts/storage/store2/fastForward'
import { testHost } from './ffFixtures'
import { bootThroughDispatch, createClock, testEnv, type PeerDouble } from '../store2SaveKit'
import { fakeLists } from './codecFixtures'
import { encodeUnit, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { nextCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    chaIdOf, chars, damageCommitKey, extrasOf, lineSeededStore, olderBuildCommit, olderBuildRecovery, parsedKey, peerPage,
    plantBytes, recoveryInstall, runLoopOver, stopAllLoops, until, type LoopHandle,
} from './lineFixtures'

/**
 * The pages of one store, judged by the save loop: a peer's restore, import or install is never offered Save mine, and a
 * commit whose descent from this page's baseline is unproven parks with today's prompt. Page B is booted through the
 * real dispatch as an indexeddb page (the loop's lineage judge is live for indexeddb and node); the peer is built from
 * the committer and encoder APIs only. A page that is clean reads its prompt's offers from `peer.clean`, a dirty one from
 * `peer.asked`. An unproven descent parks a clean page with Reload and Export this tab first, and a proven one with
 * Reload only, so the clean offers tell the two verdicts apart. Mocked storage here says nothing about a native backend.
 */

function resetPage(): void {
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
    resetRetainedForTest()
}

beforeEach(() => {
    // The page's own modules are not loaded by these rows: a peer commit that descends reaches the fast-forward, which gets a host with nothing open.
    setFastForwardHostForTest(testHost().host)
    resetPage()
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    setFastForwardHostForTest(null)
    stopAllLoops()
    resetPage()
    vi.restoreAllMocks()
})

interface PageB {
    db: Database
    context: Store2SaveContext & { encoder: NonNullable<Store2SaveContext['encoder']> }
    peer: PeerDouble
}

async function bootB(memory: MemoryBackend, kind: 'indexeddb' | 'node' = 'indexeddb'): Promise<PageB> {
    resetPage()
    const booted = await bootThroughDispatch(memory, { lists: fakeLists, kind })
    if (booted.result.kind !== 'store2') {
        throw new Error(`The boot answered ${booted.result.kind}.`)
    }
    const context = getActiveStore2Save()
    if (context?.encoder === undefined) {
        throw new Error('No save context.')
    }
    return { db: booted.result.database, context: context as PageB['context'], peer: booted.peer }
}

async function world(options: { mintLine: boolean }) {
    const memory = createMemoryBackend()
    const clock = createClock()
    const store = await lineSeededStore(memory, clock, options)
    return { memory, clock, ...store }
}

/** B edits a character and the loop commits it: B's own commit, which the page acknowledges. */
async function commitOwnEdit(loop: LoopHandle, db: Database, index: number, text: string): Promise<void> {
    const before = loop.state.saved
    chars(db)[index].personality = text
    loop.mark(chaIdOf(db, index))
    await until(() => loop.state.saved > before, 'the own commit', 4000)
}

const signal = (loop: LoopHandle) => { loop.state.peerHeard = true }

async function cleanPrompt(b: PageB, count = 1) {
    await until(() => b.peer.clean.length >= count, 'the clean notice', 4000)
    return b.peer.clean[count - 1]
}

const EXPORT_FIRST = ['reload', 'export-first']
/** Longer than the admission window of the retained list, so a replaced current can be restored later. */
const RETAIN_ADMISSION_MS = 10 * 60_000

describe('a peer restore, import or install is never offered Save mine', () => {
    test('R11 a restore shown to a dirty page offers Reload and Export this tab first, and the key carries the restore stamp', async () => {
        const { memory, clock, page, firstManifest } = await world({ mintLine: true })
        const b = await bootB(memory)
        clock.advance(RETAIN_ADMISSION_MS)
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        const restored = await page.restore(firstManifest)
        const loop = runLoopOver(b.context, b.db)
        chars(b.db)[0].personality = 'my edit'
        loop.mark(chaIdOf(b.db, 0))
        await until(() => b.peer.asked.length >= 1, 'the prompt', 4000)
        expect(b.peer.asked[0].offers).toEqual(EXPORT_FIRST)
        expect(b.peer.asked[0]).toMatchObject({ reason: 'tree-replaced', saveMineUnavailable: 'tree-replaced', unsaved: true })
        expect(extrasOf(restored).replaced).toMatchObject({ kind: 'restore', seq: restored.seq, epoch: restored.epoch })
        expect(loop.crashed).toEqual([])
    })

    test('R11b a later peer signal and the park recheck keep the offers free of Save mine', async () => {
        const { memory, clock, page, firstManifest } = await world({ mintLine: true })
        const b = await bootB(memory)
        clock.advance(RETAIN_ADMISSION_MS)
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        await page.restore(firstManifest)
        const loop = runLoopOver(b.context, b.db)
        chars(b.db)[0].personality = 'my edit'
        loop.mark(chaIdOf(b.db, 0))
        await until(() => b.peer.asked.length >= 1, 'the prompt', 4000)
        await page.commitEdit((db) => { chars(db)[2].personality = 'a later peer edit' })
        signal(loop)
        chars(b.db)[1].personality = 'another edit'
        loop.mark(chaIdOf(b.db, 1))
        await new Promise<void>((resolve) => setTimeout(resolve, 80))
        for (const prompt of b.peer.asked) {
            expect(prompt.offers).not.toContain('save-mine')
        }
        expect(loop.crashed).toEqual([])
    })

    test('R11b (clean) a clean page parked on a restore keeps the replaced-tree park through a later peer commit and its recheck, and is asked with those offers when it gains an edit', async () => {
        const { memory, clock, page, firstManifest } = await world({ mintLine: true })
        const b = await bootB(memory)
        clock.advance(RETAIN_ADMISSION_MS)
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        await page.restore(firstManifest)
        const loop = runLoopOver(b.context, b.db)
        signal(loop)
        expect(await cleanPrompt(b)).toMatchObject({ reason: 'tree-replaced' })
        await page.commitEdit((db) => { chars(db)[2].personality = 'a later peer edit' })
        signal(loop)
        await new Promise<void>((resolve) => setTimeout(resolve, 80))
        chars(b.db)[0].personality = 'my late edit'
        loop.mark(chaIdOf(b.db, 0))
        await until(() => b.peer.asked.length >= 1, 'the prompt', 4000)
        expect(b.peer.asked[0]).toMatchObject({ reason: 'tree-replaced', unsaved: true })
        expect(b.peer.asked[0].offers).toEqual(EXPORT_FIRST)
    })

    test('R11c a late Save mine answer to an earlier question writes nothing over a peer restore, and the re-ask offers no Save mine', async () => {
        const { memory, clock, page, firstManifest } = await world({ mintLine: true })
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        let release: () => void = () => { }
        b.peer.hold = new Promise<void>((resolve) => { release = resolve })
        b.peer.answer = 'save-mine'
        clock.advance(RETAIN_ADMISSION_MS)
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        chars(b.db)[3].personality = 'my edit to the same record'
        loop.mark(chaIdOf(b.db, 3))
        await until(() => b.peer.asked.length === 1, 'the first question', 4000)
        expect(b.peer.asked[0].offers).toEqual(['reload', 'save-mine'])
        const restored = await page.restore(firstManifest)
        b.peer.hold = null
        release()
        await until(() => b.peer.asked.length >= 2, 'the question after the restore', 4000)
        expect(b.peer.asked[1].offers).toEqual(EXPORT_FIRST)
        expect((await parsedKey(memory)).epoch).toBe(restored.epoch)
        expect((await parsedKey(memory)).current?.key).toBe(firstManifest)
        expect(loop.state.saved).toBe(0)
    })

    test('R12 an ordinary-path import shown to a dirty page offers Reload and Export this tab first, and the key carries the import stamp', async () => {
        const memory = createMemoryBackend()
        const clock = createClock()
        const { page } = await lineSeededStore(memory, clock, { mintLine: true })
        const b = await bootB(memory)
        const imported = await page.committer.commit(await page.committer.readCommit(), { ...treeRequest(0, { label: 'import' }), force: true })
        expect(imported.status).toBe('committed')
        const loop = runLoopOver(b.context, b.db)
        chars(b.db)[0].personality = 'my edit'
        loop.mark(chaIdOf(b.db, 0))
        await until(() => b.peer.asked.length >= 1, 'the prompt', 4000)
        expect(b.peer.asked[0].offers).toEqual(EXPORT_FIRST)
        expect(extrasOf(await parsedKey(memory)).replaced).toMatchObject({ kind: 'import' })
        expect(loop.crashed).toEqual([])
    })

    test('R12b a bulk-path import stamps the final key, never the marker, in every rejudge round, and a dirty page gets the same offers', async () => {
        const memory = createMemoryBackend()
        const clock = createClock()
        const { page } = await lineSeededStore(memory, clock, { mintLine: true })
        const b = await bootB(memory)
        const seen: Array<{ staging: boolean, stamped: boolean }> = []
        let hooksOn = true
        const hooks: Hooks = {
            async before(name, count) {
                if (name === 'putUnit' && count === 1 && hooksOn) {
                    hooksOn = false
                    // A peer writes under the marker: the final write conflicts once and is judged again.
                    const key = await parsedKey(memory)
                    await plantBytes(memory, encodeUnit(
                        UNIT_TYPE.commit,
                        nextCommitKey(key, { pins: [{ key: key.current?.key ?? '', reason: 'peer pin' }] }, testEnv(clock, 31)),
                    ))
                    const marked = await parsedKey(memory)
                    seen.push({ staging: marked.staging !== null, stamped: extrasOf(marked).replaced !== undefined })
                }
            },
        }
        const wrapped = hooked(memory, hooks)
        const importer = peerPage(wrapped.backend, clock, 11).committer
        const request = { ...treeRequest(49, { label: 'import' }), force: true }
        const result = await importer.commit(await importer.readCommit(), request)
        expect(result.status).toBe('committed')
        const final = await parsedKey(memory)
        expect(seen).toEqual([{ staging: true, stamped: false }])
        expect(final.staging).toBeNull()
        expect(extrasOf(final).replaced).toMatchObject({ kind: 'import', seq: final.seq, epoch: final.epoch })
        const loop = runLoopOver(b.context, b.db)
        chars(b.db)[0].personality = 'my edit'
        loop.mark(chaIdOf(b.db, 0))
        await until(() => b.peer.asked.length >= 1, 'the prompt', 4000)
        expect(b.peer.asked[0].offers).toEqual(EXPORT_FIRST)
    })

    test('R13 a restore followed by an ordinary commit before the page reads still parks the page with the replaced-tree offers', async () => {
        const { memory, clock, page, firstManifest } = await world({ mintLine: true })
        const b = await bootB(memory)
        clock.advance(RETAIN_ADMISSION_MS)
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        await page.restore(firstManifest)
        await page.commitEdit((db) => { chars(db)[2].personality = 'an edit after the restore' })
        const loop = runLoopOver(b.context, b.db)
        chars(b.db)[0].personality = 'my edit'
        loop.mark(chaIdOf(b.db, 0))
        await until(() => b.peer.asked.length >= 1, 'the prompt', 4000)
        expect(b.peer.asked[0].offers).toEqual(EXPORT_FIRST)
        expect(b.peer.asked[0].reason).toBe('tree-replaced')
    })

    test('R13r a recovery install followed by an ordinary commit before the page reads still parks the page with the replaced-tree offers', async () => {
        const { memory, clock, page, firstManifest } = await world({ mintLine: true })
        const b = await bootB(memory)
        const bootManifest = b.context.encoder.manifestKey
        const before = await parsedKey(memory)
        await damageCommitKey(memory)
        const installed = await recoveryInstall(memory, clock, bootManifest, before.seq + 5)
        expect(extrasOf(installed).replaced).toMatchObject({ kind: 'install' })
        await page.commitEdit((db) => { chars(db)[2].personality = 'an edit after the install' })
        const loop = runLoopOver(b.context, b.db)
        chars(b.db)[0].personality = 'my edit'
        loop.mark(chaIdOf(b.db, 0))
        await until(() => b.peer.asked.length >= 1, 'the prompt', 4000)
        expect(b.peer.asked[0].offers).toEqual(EXPORT_FIRST)
        expect(b.peer.asked[0].reason).toBe('tree-replaced')
    })

    test('a clean page parks with Reload only and the replaced-tree reason', async () => {
        const { memory, clock, page, firstManifest } = await world({ mintLine: true })
        const b = await bootB(memory)
        clock.advance(RETAIN_ADMISSION_MS)
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        await page.restore(firstManifest)
        const loop = runLoopOver(b.context, b.db)
        signal(loop)
        const prompt = await cleanPrompt(b)
        expect(prompt).toMatchObject({ reason: 'tree-replaced', offers: ['reload'], saveMineUnavailable: 'tree-replaced', unsaved: false })
    })
})

describe('an unproven descent parks with today\'s prompt', () => {
    test('R24 a peer\'s web Save mine over this page\'s committed edit parks a dirty page, keeping its edits and offering Save mine', async () => {
        const { memory, page } = await world({ mintLine: true })
        const b = await bootB(memory)
        const frozen = await page.freeze()
        const loop = runLoopOver(b.context, b.db)
        await commitOwnEdit(loop, b.db, 1, 'B edit to Y')
        await page.saveMine(frozen, (db) => { chars(db)[3].personality = 'X edit from the stale peer' })
        chars(b.db)[2].personality = 'B edit to Z'
        loop.mark(chaIdOf(b.db, 2))
        await until(() => b.peer.asked.length >= 1, 'the prompt', 4000)
        expect(b.peer.asked[0]).toMatchObject({ reason: 'peer-commit', unsaved: true, offers: ['reload', 'save-mine'] })
        expect(chars(b.db)[1].personality).toBe('B edit to Y')
    })

    test('R24c the same park on a clean page offers Reload and Export this tab first', async () => {
        const { memory, page } = await world({ mintLine: true })
        const b = await bootB(memory)
        const frozen = await page.freeze()
        const loop = runLoopOver(b.context, b.db)
        await commitOwnEdit(loop, b.db, 1, 'B edit to Y')
        await page.saveMine(frozen, (db) => { chars(db)[3].personality = 'X edit from the stale peer' })
        signal(loop)
        const prompt = await cleanPrompt(b)
        expect(prompt).toMatchObject({ reason: 'peer-commit', unsaved: false })
        expect(prompt.offers).toEqual(EXPORT_FIRST)
        expect(chars(b.db)[1].personality).toBe('B edit to Y')
    })

    test('R25 a bulk final that lands over this page\'s ordinary commit made under the marker parks it and keeps its edit', async () => {
        const { memory, clock } = await world({ mintLine: true })
        const b = await bootB(memory)
        let markerSeen = false
        let gate: () => void = () => { }
        const held = new Promise<void>((resolve) => { gate = resolve })
        const hooks: Hooks = {
            async before(name, count) {
                if (name === 'putUnit' && count === 1) {
                    markerSeen = (await parsedKey(memory)).staging !== null
                    await held
                }
            },
        }
        const bulker = peerPage(hooked(memory, hooks).backend, clock, 13)
        const more = (db: Database) => {
            for (let index = 0; index < 15; index++) {
                const added = JSON.parse(JSON.stringify(chars(db)[0])) as Record<string, unknown>
                added.chaId = `bulk-added-${index}`
                added.name = `Bulk ${index}`
                chars(db).push(added)
            }
        }
        const bulk = bulker.commitEdit(more)
        await until(() => markerSeen, 'the marker under the held upload', 4000)
        const loop = runLoopOver(b.context, b.db)
        await commitOwnEdit(loop, b.db, 1, 'B edit under the marker')
        gate()
        const landed = await bulk
        expect(landed.staging).toBeNull()
        signal(loop)
        const prompt = await cleanPrompt(b)
        expect(prompt.offers).toEqual(EXPORT_FIRST)
        expect(chars(b.db)[1].personality).toBe('B edit under the marker')
    })

    test('R26 a commit by an older build parks the page, whose descent is unproven', async () => {
        const { memory, page } = await world({ mintLine: true })
        const b = await bootB(memory)
        const older = await olderBuildCommit(memory, page, (db) => { (db as unknown as Record<string, unknown>).temperature = 77 })
        expect(extrasOf(older).line?.tip).not.toBe(older.current?.key)
        const loop = runLoopOver(b.context, b.db)
        signal(loop)
        expect((await cleanPrompt(b)).offers).toEqual(EXPORT_FIRST)
    })

    test('R26b a later commit by a build with the rule does not make the older build\'s key provable', async () => {
        const { memory, page } = await world({ mintLine: true })
        const b = await bootB(memory)
        await olderBuildCommit(memory, page, (db) => { (db as unknown as Record<string, unknown>).temperature = 77 })
        await page.commitEdit((db) => { chars(db)[2].personality = 'a disjoint delta over the older key' })
        const loop = runLoopOver(b.context, b.db)
        signal(loop)
        expect((await cleanPrompt(b)).offers).toEqual(EXPORT_FIRST)
    })

    test('R27a a recovery by an older build over a damaged key parks the page, and a later delta over the recovered key still parks it', async () => {
        const { memory, clock, page, firstManifest } = await world({ mintLine: true })
        const b = await bootB(memory)
        const before = await parsedKey(memory)
        await damageCommitKey(memory)
        const recovered = await olderBuildRecovery(memory, clock, b.context.encoder.manifestKey, 'copy', before.seq + 5)
        expect(extrasOf(recovered).line).toBeUndefined()
        await page.commitEdit((db) => { chars(db)[2].personality = 'a disjoint delta over the recovered key' })
        const loop = runLoopOver(b.context, b.db)
        signal(loop)
        expect((await cleanPrompt(b)).offers).toEqual(EXPORT_FIRST)
        expect(b.peer.live[0]().parked).toBe(true)
    })

    test('R27b a key recovered in place over a store without a line is never proven, so this page keeps its own edit', async () => {
        const { memory, clock, page, firstManifest } = await world({ mintLine: false })
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        await commitOwnEdit(loop, b.db, 1, 'B edit to Y')
        const own = await parsedKey(memory)
        await damageCommitKey(memory)
        const recovered = await olderBuildRecovery(memory, clock, firstManifest, 'in-place', own.seq + 10)
        expect(recovered.seq).toBeGreaterThan(own.seq)
        await page.commitEdit((db) => { (db as unknown as Record<string, unknown>).temperature = 55 })
        signal(loop)
        expect((await cleanPrompt(b)).offers).toEqual(EXPORT_FIRST)
        expect(chars(b.db)[1].personality).toBe('B edit to Y')
    })

    test('R28 on a store without a line, a clean page parks once with Export this tab first, and after Reload its baseline holds the line', async () => {
        const { memory, page } = await world({ mintLine: false })
        const b = await bootB(memory)
        expect((b.context as unknown as { lineage?: { base: unknown } }).lineage?.base).toMatchObject({ line: null })
        const landed = await page.commitEdit((db) => { chars(db)[3].personality = 'a disjoint change' })
        const loop = runLoopOver(b.context, b.db)
        signal(loop)
        const prompt = await cleanPrompt(b)
        expect(prompt).toMatchObject({ reason: 'peer-commit' })
        expect(prompt.offers).toEqual(EXPORT_FIRST)
        loop.stop()
        const reloaded = await bootB(memory)
        const base = (reloaded.context as unknown as { lineage?: { base: { line: string | null, seq: number } } }).lineage?.base
        expect(extrasOf(landed).line?.id).toBeDefined()
        expect(base?.line).toBe(extrasOf(landed).line?.id)
        expect(base?.seq).toBe(landed.seq)
    })
})

describe('the descent baseline starts from the commit key that names the opened manifest', () => {
    test('R1 the row-5 boot seeds the baseline with the key\'s line, stamp and seq', async () => {
        const { memory } = await world({ mintLine: true })
        const key = await parsedKey(memory)
        const b = await bootB(memory)
        const lineage = (b.context as unknown as { lineage?: { base: unknown } }).lineage
        expect(lineage?.base).toEqual({ line: extrasOf(key).line?.id, stamp: null, seq: key.seq })
        expect(extrasOf(key).line?.id).toBeDefined()
    })

    test('R31 (boot half) a page booted through the first-life seed starts from the landed install key, stamp included', async () => {
        const memory = createMemoryBackend()
        const b = await bootB(memory)
        const key = await parsedKey(memory)
        const base = (b.context as unknown as { lineage?: { base: { line: string | null, stamp: string | null, seq: number } } }).lineage?.base
        expect(extrasOf(key).replaced).toMatchObject({ kind: 'install' })
        expect(base?.line).toBe(extrasOf(key).line?.id)
        expect(base?.line).not.toBeNull()
        expect(base?.seq).toBe(key.seq)
        expect(JSON.parse(base?.stamp ?? 'null')).toEqual(extrasOf(key).replaced)
    })
})

