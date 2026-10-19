// @vitest-environment node
/**
 * The phase observer of the library imports (`ImportHooks.onPhase`): the marks of `importLegacyTree` and
 * `bootImportLegacyTree`, their order against the incomplete-items question and the first write, and the rule that an
 * observer can neither fail nor delay an import. Driven over a memory backend with the `.bin` goldens as the imported
 * trees. Labels in test names: `new behaviour` asserts the rule of this module; a recorded mutant (a temporary edit that
 * turns the named test red) is named in the hand-back, not here.
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
vi.mock('src/ts/process/coldUnitLocation', () => ({
    coldUnitKeyOfStoreKey: (key: string) => {
        const name = key.slice('coldstorage/'.length)
        return key.startsWith('coldstorage/') && !name.includes('/') ? name : null
    },
}))

import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { createMemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { firstLifeGrant } from 'src/ts/storage/store2/firstLife'
import { bootImportLegacyTree, type BootImportRequest } from 'src/ts/storage/store2/legacy/bootImport'
import { importLegacyTree, type ImportHooks, type ImportRequest } from 'src/ts/storage/store2/legacy/importTree'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { createClock as storeClock, testEnv as storeEnv } from '../store2SaveKit'
import { fakeLists } from './codecFixtures'
import { committerOf, createClock, seedStore, testEnv } from './commitFixtures'
import { loadGolden, readerOver, type Golden } from './legacyFixtures'

const OPTIONS = { newId: () => 'placeholder-chat-id', now: () => 1_700_000_000_001 }
const owner = freshOwnerId(storeEnv(storeClock(), 1))
const NEVER = 'never settles'

/** What a test hook may do with each phase it is told. */
type Observer = (phase: string) => void

const PAGE_MARKS = [/^import repaired$/, /^import resolved$/, /^import planned, \d+ units$/, /^import commit start$/]

/** A page import over a seeded memory store; `log` receives the phases, the question and the commit call in the order they happen. */
async function pageImport(golden: Golden, options: { onPhase?: Observer, confirm?: boolean } = {}) {
    const memory = createMemoryBackend()
    const clock = createClock()
    await seedStore(memory, testEnv(clock, 1))
    const committer = committerOf(memory, clock, 100)
    clock.advance(1000)
    const log: string[] = []
    const watched = { ...committer, commit: ((read, request) => { log.push('COMMIT'); return committer.commit(read, request) }) as typeof committer.commit }
    const request: ImportRequest = {
        source: { tree: golden.tree }, reader: readerOver(golden.units), committer: watched, backend: memory,
        lists: fakeLists, env: testEnv(clock, 300), resolve: OPTIONS,
    }
    const hooks: ImportHooks = {
        async confirmIncomplete() { log.push('CONFIRM'); return options.confirm ?? true },
        onPhase: (phase) => { log.push(phase); options.onPhase?.(phase) },
    }
    return { outcome: await importLegacyTree(request, hooks), log }
}

/** A boot import over an empty memory store; `log` receives the phases, the question and each unit write in order. */
async function bootImport(golden: Golden, options: { onPhase?: Observer, exit?: boolean } = {}) {
    const memory = createMemoryBackend()
    const store = createMemoryByteStore()
    const log: string[] = []
    const backend: Store2Backend = {
        ...memory,
        async putUnit(key, bytes) {
            log.push('PUT')
            return memory.putUnit(key, bytes)
        },
    }
    const read = await memory.readCommit()
    const granted = firstLifeGrant({ decision: { row: 1, mode: 'first-life', action: 'seed' }, commitRead: read, startupClear: null }, { label: 'import' })
    if (granted.status !== 'granted') {
        throw new Error('No first-life grant.')
    }
    const request: BootImportRequest = {
        source: { tree: golden.tree }, reader: readerOver(golden.units), backend,
        entry: options.exit === true ? { kind: 'exit', commitRead: read } : { kind: 'first-life', grant: granted.grant },
        owner, lists: fakeLists, env: storeEnv(storeClock(), 4242), resolve: OPTIONS,
        oldData: { store, listBackupTimes: async () => [] },
        upstreamMainFile: async () => false,
    }
    const hooks: ImportHooks = {
        async confirmIncomplete() { log.push('CONFIRM'); return true },
        onPhase: (phase) => { log.push(phase); options.onPhase?.(phase) },
    }
    return { result: await bootImportLegacyTree(request, hooks), log }
}

function marksOf(log: readonly string[]): string[] {
    return log.filter((entry) => entry.startsWith('import '))
}

/** Rejects with a readable failure instead of hanging the file when an awaited observer never settles. */
async function within<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const stalled = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('The import waited for the observer.')), 5000) })
    try {
        return await Promise.race([work, stalled])
    } finally {
        clearTimeout(timer)
    }
}

describe('new behaviour: the page import tells its phases in order', () => {
    test('repaired, resolved, planned and commit start come in this order, and commit start is before the commit call', async () => {
        const { outcome, log } = await pageImport(await loadGolden('upstream-full.bin'))
        expect(outcome.status).toBe('committed')
        const marks = marksOf(log)
        expect(marks).toHaveLength(PAGE_MARKS.length)
        PAGE_MARKS.forEach((pattern, index) => expect(marks[index]).toMatch(pattern))
        expect(log.indexOf('import commit start')).toBeGreaterThan(log.indexOf(marks[2]))
        expect(log.indexOf('import commit start')).toBe(log.indexOf('COMMIT') - 1)
    })

    test('the incomplete-items question comes after resolved and before planned', async () => {
        const { outcome, log } = await pageImport(await loadGolden('upstream-missing-unit.bin'))
        expect(outcome.status).toBe('committed')
        const question = log.indexOf('CONFIRM')
        expect(question).toBeGreaterThan(log.indexOf('import resolved'))
        expect(question).toBeLessThan(log.findIndex((entry) => entry.startsWith('import planned')))
    })

    test('a declined question ends the import before planned and commit start', async () => {
        const { outcome, log } = await pageImport(await loadGolden('upstream-missing-unit.bin'), { confirm: false })
        expect(outcome.status).toBe('declined')
        expect(marksOf(log)).toEqual(['import repaired', 'import resolved'])
    })

    test('the planned mark names the number of new units the plan carries', async () => {
        const { log } = await pageImport(await loadGolden('upstream-full.bin'))
        const planned = log.find((entry) => entry.startsWith('import planned'))
        expect(planned).toMatch(/^import planned, [1-9]\d* units$/)
    })
})

describe('new behaviour: an observer never decides the page import', () => {
    test('an observer that throws at every mark leaves the import committed', async () => {
        const { outcome, log } = await pageImport(await loadGolden('upstream-full.bin'), { onPhase: () => { throw new Error('observer failed') } })
        expect(outcome.status).toBe('committed')
        expect(marksOf(log)).toHaveLength(PAGE_MARKS.length)
    })

    test(`an observer that returns a promise that ${NEVER} does not stall the import`, async () => {
        const hung = new Promise<void>(() => { })
        const { outcome } = await within(pageImport(await loadGolden('upstream-full.bin'), { onPhase: (() => hung) as unknown as Observer }))
        expect(outcome.status).toBe('committed')
    })

    test('guard: a caller that passes no observer is unchanged', async () => {
        const golden = await loadGolden('upstream-full.bin')
        const memory = createMemoryBackend()
        const clock = createClock()
        await seedStore(memory, testEnv(clock, 1))
        const committer = committerOf(memory, clock, 100)
        clock.advance(1000)
        const outcome = await importLegacyTree(
            { source: { tree: golden.tree }, reader: readerOver(golden.units), committer, backend: memory, lists: fakeLists, env: testEnv(clock, 300), resolve: OPTIONS },
            { async confirmIncomplete() { return true } },
        )
        expect(outcome.status).toBe('committed')
    })
})

describe('new behaviour: the boot import tells its phases in order', () => {
    test('repaired, resolved, planned and commit start come in this order, and commit start is before the first unit write', async () => {
        const { result, log } = await bootImport(await loadGolden('upstream-full.bin'))
        expect(result.status).toBe('installed')
        const marks = marksOf(log)
        expect(marks).toHaveLength(PAGE_MARKS.length)
        PAGE_MARKS.forEach((pattern, index) => expect(marks[index]).toMatch(pattern))
        expect(log.indexOf('PUT')).toBeGreaterThan(log.indexOf('import commit start'))
    })

    test('the exit entry tells commit start too, before its first unit write', async () => {
        const { result, log } = await bootImport(await loadGolden('upstream-full.bin'), { exit: true })
        expect(result.status).toBe('installed')
        expect(marksOf(log)).toHaveLength(PAGE_MARKS.length)
        expect(log.indexOf('PUT')).toBeGreaterThan(log.indexOf('import commit start'))
    })

    test('a declined question ends the boot import before planned and commit start', async () => {
        const memory = createMemoryBackend()
        const log: string[] = []
        const granted = firstLifeGrant({ decision: { row: 1, mode: 'first-life', action: 'seed' }, commitRead: await memory.readCommit(), startupClear: null }, { label: 'import' })
        if (granted.status !== 'granted') {
            throw new Error('No first-life grant.')
        }
        const golden = await loadGolden('upstream-missing-unit.bin')
        const result = await bootImportLegacyTree({
            source: { tree: golden.tree }, reader: readerOver(golden.units), backend: memory,
            entry: { kind: 'first-life', grant: granted.grant }, owner, lists: fakeLists, env: storeEnv(storeClock(), 4242), resolve: OPTIONS,
            oldData: { store: createMemoryByteStore(), listBackupTimes: async () => [] }, upstreamMainFile: async () => false,
        }, { async confirmIncomplete() { return false }, onPhase: (phase) => { log.push(phase) } })
        expect(result.status).toBe('declined')
        expect(log).toEqual(['import repaired', 'import resolved'])
    })
})

describe('new behaviour: an observer never decides the boot import', () => {
    test.each([false, true])('an observer that throws at every mark leaves the import installed (exit entry: %s)', async (exit) => {
        const { result, log } = await bootImport(await loadGolden('upstream-full.bin'), { exit, onPhase: () => { throw new Error('observer failed') } })
        expect(result.status).toBe('installed')
        expect(marksOf(log)).toHaveLength(PAGE_MARKS.length)
    })

    test.each([false, true])(`an observer that returns a promise that ${NEVER} does not stall the import (exit entry: %s)`, async (exit) => {
        const hung = new Promise<void>(() => { })
        const { result } = await within(bootImport(await loadGolden('upstream-full.bin'), { exit, onPhase: (() => hung) as unknown as Observer }))
        expect(result.status).toBe('installed')
    })
})
