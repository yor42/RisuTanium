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

import { assembleDatabase, previousFrom, unitMapSource } from 'src/ts/storage/store2/codec'
import { createKeyMint, type BuildContext } from 'src/ts/storage/store2/commit'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { acknowledgedManifestKey } from 'src/ts/storage/store2/saveLoop'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { encodeWith, buildSmall, fakeLists, seededEnv } from './codecFixtures'
import { bootB, ffSetup, ffTeardown, ffWorldOver, ownEdit, runLoopWorld, signal, takenBy } from './ffFixtures'
import { parsedKey } from './lineFixtures'

/**
 * The own-base fact of the automatic clean-up (`acknowledgedManifestKey` in `saveLoop.ts` and the encoder's `fastForwarded`
 * flag it reads): the manifest key this page's encoder acknowledged, `null` while an attempt is pending and, for the rest
 * of the page load, once the encoder fast-forwarded to a peer's tree. Guards: the accessor and the flag are new exports, and
 * the mutants (accessor returns the key while pending; accessor ignores `fastForwarded`; the flag is reset or never set)
 * each fail a case here.
 *
 * Module state: the accessor reads the last loop started in this file's module graph, so the first case runs before any loop.
 */

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

beforeEach(() => {
    ffSetup()
})

afterEach(() => {
    ffTeardown()
})

const NOW = 1_700_000_000_000

describe('acknowledgedManifestKey', () => {
    test('(a) it is null before any loop has started on the page', () => {
        expect(acknowledgedManifestKey()).toBeNull()
    })

    test('(b) it equals the encoder\'s manifest once the loop runs, (c) the new manifest after an own commit lands', async () => {
        const memory = createMemoryBackend()
        await ffWorldOver(memory)
        const b = await bootB(memory)
        const loop = runLoopWorld(b.context, b.db)
        expect(acknowledgedManifestKey()).toBe(b.context.encoder.manifestKey)
        const first = b.context.encoder.manifestKey

        await ownEdit(loop, b, 0, 'own edit')

        expect(b.context.encoder.manifestKey).not.toBe(first)
        expect(acknowledgedManifestKey()).toBe(b.context.encoder.manifestKey)
        expect(acknowledgedManifestKey()).toBe((await parsedKey(memory)).current?.key)
    })

    test('(d) it is null while an attempt is pending, (e) and returns once a later read adopts that attempt', async () => {
        const memory = createMemoryBackend()
        await ffWorldOver(memory)
        const b = await bootB(memory)
        runLoopWorld(b.context, b.db)
        const encoder = b.context.encoder
        const base = encoder.manifestKey
        const plan = await encoder.plan(b.db, { marked: new Set(), modules: false, whole: true })
        const { mint } = createKeyMint(seededEnv(901), null)
        const context: BuildContext = { mint, seq: 2, now: NOW }
        await plan.commitRequest().build(context)
        plan.keepAsPending()

        expect(encoder.pendingKey).not.toBeNull()
        expect(acknowledgedManifestKey()).toBeNull()

        expect(encoder.adoptIfCurrent(encoder.pendingKey)).toBe(true)
        expect(acknowledgedManifestKey()).toBe(encoder.manifestKey)
        expect(acknowledgedManifestKey()).not.toBe(base)
    })

    test('(f) after the encoder fast-forwarded to a peer\'s tree it is null, (g) and stays null after a later own commit', async () => {
        const memory = createMemoryBackend()
        const { page } = await ffWorldOver(memory)
        const b = await bootB(memory)
        const loop = runLoopWorld(b.context, b.db)
        expect(acknowledgedManifestKey()).not.toBeNull()
        expect(b.context.encoder.fastForwarded).toBe(false)

        await page.commitEdit((db) => { (db.characters as unknown as Array<Record<string, unknown>>)[1].personality = 'peer edit' })
        signal(loop)
        await takenBy(b, memory)

        expect(b.context.encoder.fastForwarded).toBe(true)
        expect(acknowledgedManifestKey()).toBeNull()

        await ownEdit(loop, b, 0, 'own edit after the fast-forward')

        expect(b.context.encoder.manifestKey).toBe((await parsedKey(memory)).current?.key)
        expect(b.context.encoder.fastForwarded).toBe(true)
        expect(acknowledgedManifestKey()).toBeNull()
    })
})

describe('the encoder\'s fastForwarded flag', () => {
    const first = encodeWith(buildSmall(6))
    const second = encodeWith(buildSmall(5))

    test('(h) it is false at creation, true after fastForward, and stays true after a later adoption of an own attempt', async () => {
        const encoder = createSaveEncoder({ previous: previousFrom(first), lists: fakeLists, env: seededEnv(77), now: () => NOW })
        expect(encoder.fastForwarded).toBe(false)

        encoder.fastForward(previousFrom(second))
        expect(encoder.fastForwarded).toBe(true)

        const plan = await encoder.plan(assembleDatabase(first.manifest, unitMapSource(first.units)), { marked: new Set(), modules: false, whole: true })
        const { mint } = createKeyMint(seededEnv(902), null)
        await plan.commitRequest().build({ mint, seq: 2, now: NOW })
        plan.keepAsPending()
        expect(encoder.adoptIfCurrent(encoder.pendingKey)).toBe(true)
        expect(encoder.fastForwarded).toBe(true)
    })

    test('a fastForward that throws leaves the flag false', async () => {
        const encoder = createSaveEncoder({ previous: previousFrom(first), lists: fakeLists, env: seededEnv(77), now: () => NOW })
        const units = new Map(previousFrom(second).units)
        units.delete('manifest')

        expect(() => encoder.fastForward({ units, entities: new Map() })).toThrow()
        expect(encoder.fastForwarded).toBe(false)
    })
})
