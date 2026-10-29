/**
 * The persisted approvals of stdio MCP programs: where they live, how a file the build cannot read is
 * treated, and the order in which the user sees the "unreadable" notice.
 *
 * Invariants pinned here: approvals are one fork-only byte-store key outside every listed or swept prefix;
 * v1 bytes keep reading; a file that cannot be read (it throws, does not parse, is empty or is a newer
 * format) is never written for the rest of the page, its approvals hold in memory only, and one notice
 * naming the key follows the answered prompt so that the prompt cannot replace it unseen.
 *
 * The byte store is the in-memory test store; nothing here touches a file system or says anything about
 * the native store.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ByteStore, ReadResult } from 'src/ts/storage/store/contract'
import { createMemoryByteStore } from '../../files/tests/memoryByteStore'
import { indexedDbCreatableViolation, nodeCreatableViolation, tauriCreatableViolation } from 'src/ts/storage/store/keyRules'
import type { StdioSpec } from '../stdioSpec'

const h = vi.hoisted(() => ({
    events: [] as string[],
    answer: true,
    errors: [] as string[],
    store: null as ByteStore | null,
    /** A notice is up until `waitUnreadNotice` is awaited, as in the real alert store. */
    noticeUp: false,
}))

vi.mock('../../../alert', () => ({
    alertConfirm: vi.fn(async () => { h.events.push('prompt'); return h.answer }),
    alertError: vi.fn((msg: string) => { h.events.push('error'); h.errors.push(String(msg)); h.noticeUp = true }),
    waitUnreadNotice: vi.fn(async () => {
        if (h.noticeUp) {
            h.noticeUp = false
            h.events.push('notice-read')
        }
    }),
}))
vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStore: async () => h.store,
}))
vi.mock('src/lang', () => ({
    language: {
        alerts: {
            mcpStdioConsent: (name: string) => `consent ${name}`,
            mcpStdioConsentCommand: (command: string) => `command ${command}`,
            mcpStdioConsentArgument: (index: number, argument: string) => `argument ${index} ${argument}`,
            mcpStdioConsentEnvironment: (name: string, value: string) => `environment ${name} ${value}`,
            mcpStdioConsentQuestion: 'question',
            mcpStdioApprovalsUnreadable: (location: string) => `unreadable ${location}`,
        },
    },
}))

const SPEC: StdioSpec = { command: 'npx', args: ['-y', '@x/server'], env: {} }
const KEY = 'consent/mcp-stdio-approvals.json'
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

type Page = {
    approval: typeof import('../stdioApproval')
    spec: typeof import('../stdioSpec')
}

async function newPage(store: ByteStore): Promise<Page> {
    vi.resetModules()
    h.store = store
    return { approval: await import('../stdioApproval'), spec: await import('../stdioSpec') }
}

beforeEach(() => {
    h.events.length = 0
    h.errors.length = 0
    h.noticeUp = false
    h.answer = true
})

describe('key placement', () => {
    test('guard: the key is creatable on every store and outside every listed or swept prefix', () => {
        expect(tauriCreatableViolation(KEY)).toBeNull()
        expect(nodeCreatableViolation(KEY)).toBeNull()
        expect(indexedDbCreatableViolation(KEY)).toBeNull()
        for (const prefix of ['assets/', 'remotes/', 'blocks/', 'database/', 'coldstorage/', 'inlays/', 'store2/']) {
            expect(KEY.startsWith(prefix)).toBe(false)
        }
    })

    test('guard: the module exports the key it uses', async () => {
        const page = await newPage(createMemoryByteStore())
        expect(page.approval.MCP_STDIO_APPROVALS_KEY).toBe(KEY)
    })
})

describe('a readable store', () => {
    test('an accepted approval is written as v1 and a fresh page reads it without a prompt', async () => {
        const store = createMemoryByteStore()
        const first = await newPage(store)
        expect(await first.approval.admitStdio(SPEC, [{ moduleId: 'm1', moduleName: 'One' }])).toBe(true)
        await vi.waitFor(() => { expect(store.files.has(KEY)).toBe(true) })

        const written = JSON.parse(text(store.files.get(KEY)!)) as { v: number, approvals: Record<string, Record<string, { at: number }>> }
        const hash = await first.spec.stdioSpecHash(SPEC)
        expect(written.v).toBe(1)
        expect(Object.keys(written.approvals.m1)).toEqual([hash])

        h.events.length = 0
        const second = await newPage(store)
        expect(await second.approval.admitStdio(SPEC, [{ moduleId: 'm1', moduleName: 'One' }])).toBe(true)
        expect(h.events).toEqual([])
    })

    test('a decline writes nothing', async () => {
        const store = createMemoryByteStore()
        const page = await newPage(store)
        h.answer = false
        expect(await page.approval.admitStdio(SPEC, [{ moduleId: 'm1', moduleName: 'One' }])).toBe(false)
        expect(store.writes).toEqual([])
    })

    test('committed v1 bytes read as approved with no prompt', async () => {
        const store = createMemoryByteStore()
        store.files.set(KEY, new TextEncoder().encode('{"v":1,"approvals":{"m1":{"abc123":{"at":1}}}}'))
        const page = await newPage(store)
        expect(await page.approval.isStdioApproved('m1', 'abc123')).toBe(true)
        expect(await page.approval.isStdioApproved('m1', 'other')).toBe(false)
        expect(await page.approval.isStdioApproved('m2', 'abc123')).toBe(false)
        expect(h.events).toEqual([])
    })

    test('a spec with no owner is never admitted and asks nothing', async () => {
        const page = await newPage(createMemoryByteStore())
        expect(await page.approval.admitStdio(SPEC, [])).toBe(false)
        expect(h.events).toEqual([])
    })
})

describe('a file the build cannot read is kept', () => {
    test.each([
        ['bytes that do not parse', 'not json {'],
        ['a newer format', '{"v":2,"approvals":{}}'],
        ['a wrong shape', '{"v":1,"approvals":{"m1":5}}'],
        ['a zero-length file', ''],
    ])('%s: unchanged after an accept, held for the page, one notice naming the key', async (_label, seed) => {
        const store = createMemoryByteStore()
        const seeded = new TextEncoder().encode(seed)
        store.files.set(KEY, seeded.slice())
        const page = await newPage(store)
        const owner = [{ moduleId: 'm1', moduleName: 'One' }]

        expect(await page.approval.admitStdio(SPEC, owner)).toBe(true)
        expect(await page.approval.admitStdio(SPEC, owner)).toBe(true)

        expect(Array.from(store.files.get(KEY)!)).toEqual(Array.from(seeded))
        expect(store.writes).toEqual([])
        expect(h.events.filter((e) => e === 'prompt')).toHaveLength(1)
        expect(h.errors).toHaveLength(1)
        expect(h.errors[0]).toContain(KEY)
    })

    test('a read that throws: nothing is written, one notice, and a fresh page with a working read sees only the stored approval', async () => {
        const inner = createMemoryByteStore()
        const stored = new TextEncoder().encode('{"v":1,"approvals":{"m1":{"seeded":{"at":1}}}}')
        inner.files.set(KEY, stored.slice())
        let failuresLeft = 1
        let writeCalls = 0
        const flaky: ByteStore = {
            ...inner,
            async read(key: string): Promise<ReadResult> {
                if (failuresLeft > 0) {
                    failuresLeft--
                    throw new Error('read refused')
                }
                return await inner.read(key)
            },
            async write(key, bytes, condition) {
                writeCalls++
                return await inner.write(key, bytes, condition)
            },
        }
        const page = await newPage(flaky)
        const owner = [{ moduleId: 'm1', moduleName: 'One' }]

        expect(await page.approval.admitStdio(SPEC, owner)).toBe(true)
        expect(await page.approval.admitStdio(SPEC, owner)).toBe(true)

        expect(Array.from(inner.files.get(KEY)!)).toEqual(Array.from(stored))
        expect(writeCalls).toBe(0)
        expect(h.events.filter((e) => e === 'prompt')).toHaveLength(1)
        expect(h.errors).toHaveLength(1)
        expect(h.errors[0]).toContain(KEY)

        const fresh = await newPage(flaky)
        expect(await fresh.approval.isStdioApproved('m1', 'seeded')).toBe(true)
        expect(await fresh.approval.isStdioApproved('m1', await fresh.spec.stdioSpecHash(SPEC))).toBe(false)
    })

    test('the notice follows the answered prompt, so the prompt cannot replace it unseen', async () => {
        const store = createMemoryByteStore()
        store.files.set(KEY, new TextEncoder().encode('not json {'))
        const page = await newPage(store)

        await page.approval.admitStdio(SPEC, [{ moduleId: 'm1', moduleName: 'One' }])

        expect(h.events).toEqual(['prompt', 'error'])
    })

    test('a later owner\'s prompt waits until the notice is read, so a sequential ask never covers it', async () => {
        const store = createMemoryByteStore()
        store.files.set(KEY, new TextEncoder().encode('not json {'))
        const page = await newPage(store)

        expect(await page.approval.admitStdio(SPEC, [{ moduleId: 'm1', moduleName: 'One' }])).toBe(true)
        expect(await page.approval.admitStdio(SPEC, [{ moduleId: 'm2', moduleName: 'Two' }])).toBe(true)

        expect(h.events).toEqual(['prompt', 'error', 'notice-read', 'prompt'])
        expect(h.errors).toHaveLength(1)
    })
})
