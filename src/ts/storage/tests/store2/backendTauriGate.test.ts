// @vitest-environment node
/**
 * The store2 Tauri backend and session against the page-generation gate, over the
 * real `createTauriFilesStore` on the desktop command and file system stand-ins:
 * registration before every top-level read and write, a stale page's definite
 * failure and idling, the factory failing (and the session reading
 * `backend-unavailable`) with no write or removal when the gate is missing or
 * registration fails, and the gate's key checks at the store. The Rust commands
 * are tested in `src-tauri`; a pass here is not evidence about them.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const fake = await import('src/ts/storage/tests/tauriDesktopFake')
    const desktop = fake.createDesktopInvoke(fs)
    const bounded = fake.createBoundedFs(fs)
    const paths = (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths()
    return { fs, desktop, bounded, paths }
})

vi.mock('@tauri-apps/plugin-fs', () => h.bounded.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({
    ...h.paths.coreModule,
    // The stand-in `write_durable` answers nothing; the Rust command answers `{ flushed }`, which a unit write needs to count as flushed.
    invoke: async (command: string, args?: unknown, options?: { headers?: Record<string, string> }) => {
        const answer = await h.desktop.invoke(command, args, options)
        return command === 'write_durable' ? { flushed: true } : answer
    },
}))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

import type { ByteStore } from 'src/ts/storage/store/contract'
import { StoreInvalidKeyError, StoreStaleGenerationError } from 'src/ts/storage/store/errors'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { Store2BackendFailureError, Store2StalePageError, Store2UnknownOutcomeError, createTauriBackend } from 'src/ts/storage/store2/backend'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import { Store2Session } from 'src/ts/storage/store2/session'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { resetGateTransportForTests } from 'src/ts/storage/tauriGateTransport'
import { absentCommit, absentFence, bytesOf, unit, unitKey } from './backendConformance'
import { createClock, seedStore, testEnv } from './commitFixtures'

const env = testEnv(createClock(), 77)

/** Every command that can write, remove or register, which a page that never registered must not send. */
const WRITING_COMMANDS = ['write_durable', 'write_chunk', 'write_chunk_raw', 'store2_write_top_raw', 'store2_write_top_chunk', 'store2_write_top_chunk_raw', 'store2_remove', 'app_fs_remove']

beforeEach(() => {
    h.fs.reset()
    h.desktop.reset()
    h.bounded.reset()
    h.paths.reset()
    h.desktop.chunk.reportFlushes()
    h.fs.setPlatform('windows')
    resetByteTransportForTests()
    resetGateTransportForTests()
})

function newStore(): ByteStore {
    return createTauriFilesStore({ platform: 'windows' })
}

function peek(key: string): number[] | null {
    const bytes = h.fs.files.get(key)
    return bytes === undefined ? null : [...bytes]
}

function sent(commands: readonly string[]): string[] {
    return h.desktop.commands.filter((command) => commands.includes(command))
}

describe('registration order', () => {
    test('the page registers before its first top-level read, and every top-level write carries that generation', async () => {
        const first = await createTauriBackend(newStore())
        await seedStore(first, env)
        h.desktop.commands.length = 0
        h.desktop.topCalls.length = 0

        const session = await Store2Session.open(newStore(), { kind: 'tauri', upstreamMainFile: async () => false })

        const commands = [...h.desktop.commands]
        expect(session.reflush).toEqual({ ok: true, commit: 'flushed', fence: 'absent' })
        expect(commands[0]).toBe('store2_register_page')
        expect(commands.filter((command) => command === 'store2_register_page')).toHaveLength(1)
        expect(commands.indexOf('store2_register_page')).toBeLessThan(commands.indexOf('read_range'))
        expect(commands.indexOf('store2_register_page')).toBeLessThan(commands.indexOf('store2_write_top_raw'))
        expect(h.desktop.topCalls.length).toBeGreaterThan(0)
        expect(new Set(h.desktop.topCalls.map((call) => call.gen))).toEqual(new Set([h.desktop.chunk.currentGeneration()]))
    })

    test('a backend registers once, when it is built, and not again for its steps', async () => {
        const backend = await createTauriBackend(newStore())
        await backend.casCommit(await absentCommit(backend), bytesOf(1))
        await backend.casFence(await absentFence(backend), bytesOf(2))

        expect(h.desktop.count('store2_register_page')).toBe(1)
        expect(h.desktop.topCalls.map((call) => [call.key, call.gen])).toEqual([[COMMIT_KEY, 1], [FENCE_KEY, 1]])
    })

    test('the top-level keys never go through the ungated durable command', async () => {
        const backend = await createTauriBackend(newStore())
        await backend.commitOrdinary(await absentCommit(backend), [unit(1)], bytesOf(5))
        await backend.casFence(await absentFence(backend), bytesOf(6))
        await backend.casFence((await backend.readFence()).token, null)
        await backend.removeBatch([unitKey(1)], (await backend.readCommit()).token, (await backend.readFence()).token)

        // Only the unit write is a durable-command write; the commit key, the fence write and both removals are gated.
        expect(h.desktop.count('write_durable')).toBe(1)
        expect(h.desktop.count('store2_write_top_raw')).toBe(2)
        expect(h.desktop.count('store2_remove')).toBe(2)
        expect(h.desktop.count('app_fs_remove')).toBe(0)
    })
})

describe('a stale page', () => {
    async function stalePair() {
        const store = newStore()
        const stale = await createTauriBackend(store)
        await stale.casCommit(await absentCommit(stale), bytesOf(1))
        const current = await createTauriBackend(store)
        return { stale, current }
    }

    test('its first refused write is a definite failure that applied nothing', async () => {
        const { stale } = await stalePair()
        const base = await stale.readCommit()

        const error = await stale.casCommit(base.token, bytesOf(2)).catch((e: unknown) => e)

        expect(error).toBeInstanceOf(Store2StalePageError)
        expect(error).toBeInstanceOf(Store2BackendFailureError)
        expect(error).not.toBeInstanceOf(Store2UnknownOutcomeError)
        expect((error as Error).cause).toBeInstanceOf(StoreStaleGenerationError)
        expect(peek(COMMIT_KEY)).toEqual([1])
    })

    test('it is then idle: no further decisive step is sent, no unit is written, and reads still work', async () => {
        const { stale, current } = await stalePair()
        const base = await stale.readCommit()
        await expect(stale.casCommit(base.token, bytesOf(2))).rejects.toBeInstanceOf(Store2StalePageError)
        h.fs.plant(FENCE_KEY, bytesOf(6))
        h.desktop.commands.length = 0
        const fence = await stale.readFence()

        await expect(stale.casCommit(base.token, bytesOf(3))).rejects.toBeInstanceOf(Store2StalePageError)
        await expect(stale.casFence(fence.token, bytesOf(4))).rejects.toBeInstanceOf(Store2StalePageError)
        await expect(stale.commitOrdinary(base.token, [unit(1)], bytesOf(5))).rejects.toBeInstanceOf(Store2StalePageError)
        await expect(stale.removeBatch([unitKey(2)], base.token, fence.token)).rejects.toBeInstanceOf(Store2StalePageError)
        // A fence delete is a removal, and the fence is there to be deleted.
        await expect(stale.casFence(fence.token, null)).rejects.toBeInstanceOf(Store2StalePageError)

        expect(sent(WRITING_COMMANDS)).toEqual([])
        expect(peek(FENCE_KEY)).toEqual([6])
        expect(peek(unitKey(1))).toBeNull()
        expect(peek(COMMIT_KEY)).toEqual([1])
        expect((await stale.readCommit()).bytes).toEqual(bytesOf(1))
        // The newer page is unaffected.
        await expect(current.casCommit((await current.readCommit()).token, bytesOf(9))).resolves.toEqual({ flushed: true })
    })

    test('a removal refused as stale is a definite failure, removes nothing, and idles the page', async () => {
        const { stale, current } = await stalePair()
        await current.putUnit(unitKey(1), bytesOf(1))
        const commit = await stale.readCommit()
        const fence = await stale.readFence()

        const error = await stale.removeBatch([unitKey(1)], commit.token, fence.token).catch((e: unknown) => e)

        expect(error).toBeInstanceOf(Store2StalePageError)
        expect(peek(unitKey(1))).toEqual([1])
        h.desktop.commands.length = 0
        await expect(stale.casCommit(commit.token, bytesOf(3))).rejects.toBeInstanceOf(Store2StalePageError)
        expect(sent(WRITING_COMMANDS)).toEqual([])
    })

    test('a fence delete refused as stale is a definite failure and the fence stays', async () => {
        const store = newStore()
        const stale = await createTauriBackend(store)
        await stale.casFence(await absentFence(stale), bytesOf(6))
        await createTauriBackend(store)

        const error = await stale.casFence((await stale.readFence()).token, null).catch((e: unknown) => e)

        expect(error).toBeInstanceOf(Store2StalePageError)
        expect(peek(FENCE_KEY)).toEqual([6])
    })

    test('a commit whose commit-key write is refused leaves the commit key as it was', async () => {
        const { stale } = await stalePair()

        await expect(stale.commitOrdinary((await stale.readCommit()).token, [unit(1)], bytesOf(2))).rejects.toBeInstanceOf(Store2StalePageError)

        expect(peek(COMMIT_KEY)).toEqual([1])
    })
})

describe('a page that cannot register', () => {
    async function seededStore(): Promise<ByteStore> {
        const store = newStore()
        await seedStore(await createTauriBackend(store), env)
        h.desktop.commands.length = 0
        h.desktop.topCalls.length = 0
        h.desktop.chunk.reset()
        return store
    }

    function expectNoWrites(): void {
        expect(sent(WRITING_COMMANDS)).toEqual([])
        expect(h.desktop.topCalls).toEqual([])
        expect(h.fs.removeLog).toEqual([])
    }

    test('a store without the gate capability makes the factory fail and the session read-only, with no write or removal', async () => {
        const gateless: ByteStore = { ...(await seededStore()), pageGate: undefined }

        await expect(createTauriBackend(gateless)).rejects.toBeInstanceOf(Store2BackendFailureError)
        const session = await Store2Session.open(gateless, { kind: 'tauri', upstreamMainFile: async () => false })

        expect(session.decision).toMatchObject({ row: null, mode: 'read-only', reason: 'backend-unavailable' })
        expect(session.backend).toBeNull()
        expect(session.committer).toBeNull()
        expectNoWrites()
    })

    test('a registration that rejects makes the factory fail and the session read-only, with no write or removal', async () => {
        const store = await seededStore()
        h.desktop.chunk.failRegistration('the registration task failed: boom')

        await expect(createTauriBackend(store)).rejects.toBeInstanceOf(Store2BackendFailureError)
        const session = await Store2Session.open(store, { kind: 'tauri', upstreamMainFile: async () => false })

        expect(session.decision).toMatchObject({ row: null, mode: 'read-only', reason: 'backend-unavailable' })
        expect(session.reflush).toBeNull()
        expectNoWrites()
    })

    test('a registration timeout makes the factory fail and the session read-only, with no write or removal', async () => {
        const store = await seededStore()
        h.desktop.chunk.failRegistration('registration-timeout: a write that holds the gate did not finish within 30000 ms')

        await expect(createTauriBackend(store)).rejects.toBeInstanceOf(Store2BackendFailureError)
        const session = await Store2Session.open(store, { kind: 'tauri', upstreamMainFile: async () => false })

        expect(session.decision).toMatchObject({ row: null, mode: 'read-only', reason: 'backend-unavailable' })
        expect(session.idleReason).toBe(session.decision.row === null && 'detail' in session.decision ? session.decision.detail : null)
        expect(await session.openGate('gc')).toMatchObject({ status: 'refused', reason: 'idle' })
        expect(h.desktop.chunk.currentGeneration()).toBe(0)
        expectNoWrites()
    })

    test('an injected backend is used as it is: the session registers nothing for it', async () => {
        const store = newStore()
        const backend = await createTauriBackend(store)
        await seedStore(backend, env)
        h.desktop.commands.length = 0

        await Store2Session.open(store, { kind: 'tauri', backend, upstreamMainFile: async () => false })

        expect(h.desktop.count('store2_register_page')).toBe(0)
    })
})

describe('the gate at the store', () => {
    test('a key the gate may not write or remove is refused, and a malformed key is refused before any call', async () => {
        const store = newStore()
        const gen = await store.pageGate!.registerPage()
        h.desktop.commands.length = 0

        await expect(store.pageGate!.writeTop(gen, 'store2/aaaa', bytesOf(1))).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await expect(store.pageGate!.removeTop(gen, [COMMIT_KEY])).rejects.toBeInstanceOf(StoreInvalidKeyError)
        expect(h.desktop.count('store2_write_top_raw')).toBe(1)
        expect(h.desktop.count('store2_remove')).toBe(1)

        await expect(store.pageGate!.writeTop(gen, 'a//b', bytesOf(1))).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await expect(store.pageGate!.removeTop(gen, ['store2/x', 'store2/x'])).rejects.toBeInstanceOf(StoreInvalidKeyError)
        expect(h.desktop.count('store2_write_top_raw')).toBe(1)
        expect(h.desktop.count('store2_remove')).toBe(1)
        expect(peek('store2/aaaa')).toBeNull()
    })

    test('writeTop resolves the flush status like write, and a gated write does not change the write path of other keys', async () => {
        const store = newStore()
        const gen = await store.pageGate!.registerPage()

        expect(await store.pageGate!.writeTop(gen, COMMIT_KEY, bytesOf(1))).toEqual({ version: null, flushed: true })
        expect(await store.write('plain/key', bytesOf(2), 'unconditional')).toMatchObject({ version: null })
        expect(peek(COMMIT_KEY)).toEqual([1])
        expect(peek('plain/key')).toEqual([2])
    })
})
