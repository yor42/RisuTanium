/**
 * The saved "always for this workspace" grants (MC-3409, MC-3415): where they live, how a revoke survives another page's
 * stale cache, how a file the build cannot read is kept, and what the restore's clear does. Each "page" is a fresh copy of
 * the module over one shared in-memory byte store; nothing here says anything about the native store.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { nodeCreatableViolation, tauriCreatableViolation } from 'src/ts/storage/store/keyRules'
import { createMemoryByteStore, type MemoryByteStore } from '../../files/tests/memoryByteStore'

const h = vi.hoisted(() => ({
    store: null as ByteStore | null,
    notices: [] as string[],
}))

vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStore: async () => h.store,
}))
vi.mock('src/ts/alertPrompts', () => ({
    queueNotice: (text: string) => { h.notices.push(text) },
}))
vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false }))
// Only the key rules are wanted from the native writer's module; its filesystem imports stay out.
vi.mock('src/ts/storage/appFs', () => ({ appFsExists: async () => false, appFsRemove: async () => { }, usesAppFs: () => false }))
vi.mock('src/ts/storage/tauriByteTransport', () => ({ shouldChunkWrite: () => false, writeChunked: async () => { } }))

const KEY = 'consent/workspace-tool-grants.json'
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

type Page = typeof import('../toolGrants')

async function page(): Promise<Page> {
    vi.resetModules()
    return await import('../toolGrants')
}

let store: MemoryByteStore

function stored(): { v: number, grants: Record<string, Record<string, { at: number }>> } {
    return JSON.parse(text(store.files.get(KEY)!))
}

beforeEach(() => {
    store = createMemoryByteStore()
    h.store = store
    h.notices.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

describe('persistence', () => {
    test('an added grant is saved as v1 under the consent key and read back by a new page', async () => {
        const a = await page()
        expect(await a.addToolGrant('ws1', 'write_file')).toBe(true)

        expect(stored().v).toBe(1)
        expect(typeof stored().grants.ws1.write_file.at).toBe('number')
        const b = await page()
        expect(await b.hasToolGrant('ws1', 'write_file')).toBe(true)
    })

    test('a grant covers one tool in one workspace only (MC-3409)', async () => {
        const a = await page()
        await a.addToolGrant('ws1', 'write_file')

        expect(await a.hasToolGrant('ws1', 'delete_file')).toBe(false)
        expect(await a.hasToolGrant('ws2', 'write_file')).toBe(false)
    })

    test('a revoke removes the grant and leaves the others', async () => {
        const a = await page()
        await a.addToolGrant('ws1', 'write_file')
        await a.addToolGrant('ws1', 'edit_file')
        await a.revokeToolGrant('ws1', 'write_file')

        expect(stored().grants.ws1).toEqual({ edit_file: expect.any(Object) })
        expect(await (await page()).hasToolGrant('ws1', 'write_file')).toBe(false)
    })

    test('removing a workspace drops all its grants and no other workspace\'s', async () => {
        const a = await page()
        await a.addToolGrant('ws1', 'write_file')
        await a.addToolGrant('ws1', 'delete_file')
        await a.addToolGrant('ws2', 'write_file')
        await a.removeWorkspaceToolGrants('ws1')

        expect(Object.keys(stored().grants)).toEqual(['ws2'])
    })

    test('the list names every saved grant', async () => {
        const a = await page()
        await a.addToolGrant('ws1', 'write_file')
        expect((await a.listToolGrants()).map(entry => `${entry.workspaceId}:${entry.tool}`)).toEqual(['ws1:write_file'])
    })
})

describe('a stale cache cannot undo another page\'s change', () => {
    test('a revoke made in page B survives page A adding another grant from its older cache', async () => {
        const a = await page()
        await a.addToolGrant('ws1', 'write_file')
        await a.addToolGrant('ws1', 'delete_file')
        const b = await page()
        await b.revokeToolGrant('ws1', 'write_file')

        await a.addToolGrant('ws1', 'edit_file')

        expect(Object.keys(stored().grants.ws1).sort()).toEqual(['delete_file', 'edit_file'])
    })

    test('page A stops honouring a grant page B revoked', async () => {
        const a = await page()
        await a.addToolGrant('ws1', 'write_file')
        expect(await a.hasToolGrant('ws1', 'write_file')).toBe(true)
        await (await page()).revokeToolGrant('ws1', 'write_file')

        expect(await a.hasToolGrant('ws1', 'write_file')).toBe(false)
    })

    test('changes made at once on one page all land', async () => {
        const a = await page()
        await Promise.all([a.addToolGrant('ws1', 'write_file'), a.addToolGrant('ws1', 'edit_file'), a.addToolGrant('ws2', 'write_file')])
        expect(Object.keys(stored().grants).sort()).toEqual(['ws1', 'ws2'])
        expect(Object.keys(stored().grants.ws1).sort()).toEqual(['edit_file', 'write_file'])
    })
})

describe('bytes the build cannot read are kept', () => {
    test.each([
        ['a newer format', () => new TextEncoder().encode('{"v":2,"grants":{"ws1":{"write_file":{"at":1}}}}')],
        ['text that is not JSON', () => new TextEncoder().encode('not json')],
        ['a grant of the wrong shape', () => new TextEncoder().encode('{"v":1,"grants":{"ws1":"x"}}')],
    ])('%s: nothing matches, the bytes are never written, a grant holds in memory, one notice', async (_label, bytes) => {
        const original = bytes()
        store.files.set(KEY, original.slice())
        const a = await page()

        expect(await a.hasToolGrant('ws1', 'write_file')).toBe(false)
        expect(await a.addToolGrant('ws1', 'write_file')).toBe(true)
        expect(await a.addToolGrant('ws1', 'edit_file')).toBe(true)

        expect(await a.hasToolGrant('ws1', 'write_file')).toBe(true)
        expect(store.files.get(KEY)).toEqual(original)
        expect(store.writes).toEqual([])
        expect(h.notices).toHaveLength(1)
        expect(h.notices[0]).toContain(KEY)
    })

    test('a read that throws is kept the same way', async () => {
        store.failRead = () => new Error('read failed')
        const a = await page()
        expect(await a.addToolGrant('ws1', 'write_file')).toBe(true)
        expect(store.writes).toEqual([])
        expect(h.notices).toHaveLength(1)
    })

    test('a write that fails reports it and keeps no grant', async () => {
        const a = await page()
        store.failWrite = () => new Error('disk full')
        expect(await a.addToolGrant('ws1', 'write_file')).toBe(false)
        store.failWrite = null
        expect(await a.hasToolGrant('ws1', 'write_file')).toBe(false)
    })
})

describe('the restore clear', () => {
    test('writes an empty v1 file, drops the grants and seals: nothing matches, nothing is offered, no change is accepted', async () => {
        const a = await page()
        await a.addToolGrant('ws1', 'write_file')

        const cleared = await a.clearToolGrantsForRestore()

        expect(cleared.ok).toBe(true)
        expect(stored()).toEqual({ v: 1, grants: {} })
        expect(a.toolGrantsOffered()).toBe(false)
        expect(await a.hasToolGrant('ws1', 'write_file')).toBe(false)
        const writesBefore = store.writes.length
        expect(await a.addToolGrant('ws1', 'write_file')).toBe(false)
        expect(await a.revokeToolGrant('ws1', 'write_file')).toBe(false)
        expect(await a.removeWorkspaceToolGrants('ws1')).toBe(false)
        expect(store.writes.length).toBe(writesBefore)
    })

    test('release lifts the seal for a stopped restore', async () => {
        const a = await page()
        const cleared = await a.clearToolGrantsForRestore()
        if (cleared.ok === false) {
            throw new Error('the clear failed')
        }
        cleared.release()

        expect(a.toolGrantsOffered()).toBe(true)
        expect(await a.addToolGrant('ws1', 'write_file')).toBe(true)
        expect(await a.hasToolGrant('ws1', 'write_file')).toBe(true)
    })

    test('overwrites an unreadable file too: no earlier approval survives', async () => {
        store.files.set(KEY, new TextEncoder().encode('{"v":2,"grants":{}}'))
        const a = await page()
        expect((await a.clearToolGrantsForRestore()).ok).toBe(true)
        expect(stored()).toEqual({ v: 1, grants: {} })
    })

    test('a write that fails answers ok:false with the cause, never rejects, and lifts its own seal', async () => {
        const a = await page()
        await a.addToolGrant('ws1', 'write_file')
        store.failWrite = () => new Error('disk full')

        const cleared = await a.clearToolGrantsForRestore()

        expect(cleared).toEqual({ ok: false, detail: 'disk full' })
        expect(a.toolGrantsOffered()).toBe(true)
        expect(stored().grants.ws1.write_file).toBeDefined()
    })

    test('a grant added while the clear is queued is dropped by it', async () => {
        const a = await page()
        const adding = a.addToolGrant('ws1', 'write_file')
        const cleared = await a.clearToolGrantsForRestore()
        await adding

        expect(cleared.ok).toBe(true)
        expect(stored()).toEqual({ v: 1, grants: {} })
        expect(await a.hasToolGrant('ws1', 'write_file')).toBe(false)
    })
})

describe('keys', () => {
    test('a workspace id such as __proto__ is an ordinary key, and inherited names never match', async () => {
        const a = await page()
        expect(await a.addToolGrant('__proto__', 'write_file')).toBe(true)
        expect(await (await page()).hasToolGrant('__proto__', 'write_file')).toBe(true)
        expect(await a.hasToolGrant('other', 'write_file')).toBe(false)
        expect(await a.hasToolGrant('ws1', 'constructor')).toBe(false)
        expect(await a.hasToolGrant('constructor', 'write_file')).toBe(false)
    })

    test('an empty workspace id or tool is refused', async () => {
        const a = await page()
        expect(await a.addToolGrant('', 'write_file')).toBe(false)
        expect(await a.addToolGrant('ws1', '')).toBe(false)
        expect(await a.hasToolGrant('', 'write_file')).toBe(false)
        expect(store.writes).toEqual([])
    })
})

describe('fail closed', () => {
    test('a grant does not match between the seal and the clear\'s write', async () => {
        const a = await page()
        await a.addToolGrant('ws1', 'write_file')
        const realWrite = store.write.bind(store)
        let release: () => void = () => { }
        const held = new Promise<void>((resolve) => { release = resolve })
        store.write = async (...args: Parameters<MemoryByteStore['write']>) => {
            await held
            return await realWrite(...args)
        }
        const clearing = a.clearToolGrantsForRestore()

        expect(stored().grants.ws1.write_file).toBeDefined()
        expect(await a.hasToolGrant('ws1', 'write_file')).toBe(false)
        release()
        expect((await clearing).ok).toBe(true)
    })

    test('a grant read in flight when the seal goes on does not match', async () => {
        const a = await page()
        await a.addToolGrant('ws1', 'write_file')
        const realRead = store.read.bind(store)
        let release: () => void = () => { }
        const held = new Promise<void>((resolve) => { release = resolve })
        store.read = async (key: string) => {
            await held
            return await realRead(key)
        }
        const matching = a.hasToolGrant('ws1', 'write_file')
        const clearing = a.clearToolGrantsForRestore()
        release()

        expect(await matching).toBe(false)
        await clearing
    })

    test('a fresh read that fails in loaded mode matches nothing, not the cached grants', async () => {
        const a = await page()
        expect(await a.addToolGrant('ws1', 'write_file')).toBe(true)
        expect(await a.hasToolGrant('ws1', 'write_file')).toBe(true)
        store.failRead = () => new Error('read failed')

        expect(await a.hasToolGrant('ws1', 'write_file')).toBe(false)
    })
})

describe('the consent key', () => {
    test('is creatable on the native and the node stores', () => {
        expect(tauriCreatableViolation(KEY)).toBeNull()
        expect(nodeCreatableViolation(KEY)).toBeNull()
    })
})
