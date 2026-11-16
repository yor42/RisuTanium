/**
 * Importing a persona PNG whose chunk carries `largePortrait: true` keeps the flag on the new
 * persona. The fixture has a non-empty name and personaPrompt, so it passes the old acceptance
 * predicate and the flag is the only thing the regression reproducer can fail on. The PNG is built
 * directly with the real `PngChunk.write`, the producer format `persona.exchange.test.ts` pins.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: { personas: [] as Record<string, unknown>[] },
    picked: null as { name: string, data: Uint8Array } | null,
    alertError: vi.fn(),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: h.alertError,
    alertNormal: vi.fn(),
    alertClear: vi.fn(),
    alertStore: { set: vi.fn(), update: vi.fn(), subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: () => h.db,
    saveImage: vi.fn(async () => 'saved-icon'),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    downloadFile: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(async () => h.picked),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (img: Uint8Array) => img),
}) as unknown as typeof import('src/ts/process/files/inlays'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/process/memory/busyActions'), () => ({
    beginBusy: () => ({ end: vi.fn() }),
}) as unknown as typeof import('src/ts/process/memory/busyActions'))

import { Buffer } from 'buffer'
import { PngChunk } from './pngChunk'
import { importUserPersona } from './persona'

const MINIMAL_PNG = new Uint8Array(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
))

beforeEach(() => {
    h.db.personas = []
    h.alertError.mockReset()
})

describe('importUserPersona: largePortrait flag', () => {
    test('regression reproducer: the pushed persona carries largePortrait true', async () => {
        const body = Buffer.from(JSON.stringify({ name: 'A', personaPrompt: 'P', note: 'n', largePortrait: true })).toString('base64')
        const png = new Uint8Array(await PngChunk.write(MINIMAL_PNG, { persona: body }) as Buffer)
        h.picked = { name: 'a.png', data: png }

        await importUserPersona()

        expect(h.alertError).not.toHaveBeenCalled()
        expect(h.db.personas).toHaveLength(1)
        expect(h.db.personas[0].name).toBe('A')
        expect(h.db.personas[0].personaPrompt).toBe('P')
        expect(h.db.personas[0].largePortrait).toBe(true)
    })
})
