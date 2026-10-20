/**
 * The page and boot commits hand the library an observer that records into the import phase ring: the page one tells the
 * attempt, the boot one does not, and both are synchronous. The library is a double that calls the observer the way the
 * real one does (the library's own order is pinned in `importTreeOnPhase.test.ts`). A pass says nothing about a device.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

const inert = vi.hoisted(() => (): Record<string, unknown> => new Proxy({}, {
    has: () => true,
    get: (_target, name) => name === 'then' ? undefined : (name === 'alertStore' ? {} : () => undefined),
}))
vi.mock('src/ts/alert', inert)
vi.mock('src/ts/globalApi.svelte', inert)
vi.mock('src/ts/process/coldstorage.svelte', inert)
vi.mock('src/ts/drive/backupWorkGuard', inert)
vi.mock('src/ts/drive/restoreReplace', inert)
vi.mock('src/lang', inert)
vi.mock('src/ts/storage/store2/commit', inert)
vi.mock('src/ts/storage/store2/commitKey', inert)
vi.mock('src/ts/storage/store2/bootActive', inert)
vi.mock('src/ts/storage/store2/backend/errors', inert)
vi.mock('src/ts/storage/store2/lists', inert)
vi.mock('src/ts/storage/store2/saveActive', inert)
vi.mock('src/ts/storage/saveYield', inert)
vi.mock('src/ts/storage/risuSave', inert)
vi.mock('src/ts/storage/bootBlockLoad', inert)
vi.mock('src/ts/storage/store2/ui/bootText', inert)
vi.mock('src/ts/storage/store2/legacy/storeReader', inert)
vi.mock('src/ts/storage/store2/legacy/binReader', inert)

const library = vi.hoisted(() => ({ hooks: null as null | { onPhase?: (phase: string) => unknown } }))
vi.mock('src/ts/storage/store2/legacy/importTree', () => ({
    importLegacyTree: async (_request: unknown, hooks: { onPhase?: (phase: string) => unknown }) => {
        library.hooks = hooks
        return { status: 'declined' }
    },
}))

import type { ImportPhaseRingHandle } from '../importPhaseRing'
import { commitBootImport, commitStore2Import } from '../storeImport'
import type { Database } from 'src/ts/storage/database.svelte'
import type { BootImportTarget } from 'src/ts/storage/store2/legacy/bootImport'
import type { Store2ImportRequest } from '../storeImport'

type RingGlobal = { __risuImportPhases?: ImportPhaseRingHandle }

const phasesOf = (): string[] => (globalThis as RingGlobal).__risuImportPhases?.snapshot().map((record) => record.phase) ?? []

beforeEach(() => {
    flag.measure = true
    library.hooks = null
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-import' ? 'on' : null })
    vi.spyOn(console, 'info').mockImplementation(() => { })
})

afterEach(() => {
    const ring = (globalThis as RingGlobal).__risuImportPhases
    if (typeof ring?.reset === 'function') {
        ring.reset()
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (globalThis as RingGlobal).__risuImportPhases
})

describe('the page commit hands the library an observer that records the attempt', () => {
    test('new behaviour: each phase the library tells lands in the ring at once, with the attempt number', async () => {
        const request = {
            target: { committer: {}, backend: {} },
            busy: {},
            decode: async () => ({}) as Database,
            reader: {},
        } as unknown as Store2ImportRequest

        await commitStore2Import(request)

        const onPhase = library.hooks?.onPhase
        expect(typeof onPhase).toBe('function')
        const before = phasesOf()
        expect(before).toEqual(['decoded, attempt 1', 'import declined, attempt 1'])
        for (const phase of ['import repaired', 'import resolved', 'import planned, 7 units', 'import commit start']) {
            const returned = onPhase!(phase)
            expect(returned).toBeUndefined()
            expect(phasesOf().at(-1)).toBe(`${phase}, attempt 1`)
        }
    })
})

describe('the boot commit hands the installer an observer that records the phase as told', () => {
    test('new behaviour: the observer the installer receives is synchronous and writes the ring', async () => {
        let seen: { onPhase?: (phase: string) => unknown } | null = null
        const target = {
            readColdStorageItem: async () => ({ status: 'missing' }),
            async install(_source: unknown, _reader: unknown, hooks: { onPhase?: (phase: string) => unknown }) {
                seen = hooks
                return { status: 'declined' }
            },
        } as unknown as BootImportTarget

        await commitBootImport({ target, decode: async () => ({}) as Database, reader: {} as never })

        expect(typeof seen!.onPhase).toBe('function')
        for (const phase of ['import repaired', 'import resolved', 'import planned, 7 units', 'import commit start']) {
            expect(seen!.onPhase!(phase)).toBeUndefined()
            expect(phasesOf().at(-1)).toBe(phase)
        }
    })
})
