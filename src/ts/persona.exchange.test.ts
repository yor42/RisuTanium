/**
 * The persona PNG exchange format: a tEXt chunk `persona` holding base64 JSON `{name, personaPrompt,
 * note}` plus the optional `largePortrait: true`. Runs the REAL `persona.ts` over the REAL `PngChunk`;
 * the image pipeline, the database, the download and the pickers are mocked. MOCKED success does not
 * prove the native download or picker paths.
 *
 * Titles beginning "regression reproducer:" fail against a version that drops the flag, refuses
 * empty fields or stops at the old predicate. "guard:" titles pin compatibility and new helpers:
 * the upstream transcription below models the importer of upstream/main 4d87a70ff `persona.ts`
 * (base64, JSON.parse, `name && personaPrompt`, push `{name, personaPrompt, note}`). The fork's
 * `PngChunk.readGenerator` differs from upstream's only in stream windowing, the key-scan bound and
 * refusing a cut body, so for a complete, uncut `Uint8Array` with a `persona` tEXt body the parse
 * is identical.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

interface TestPersona {
    name: string
    icon: string
    personaPrompt: string
    note?: string
    id?: string
    largePortrait?: boolean
}

const h = vi.hoisted(() => ({
    db: {
        username: 'Ann',
        userIcon: 'icon',
        personaPrompt: 'Prompt',
        userNote: 'Note',
        selectedPersona: 0,
        personas: [] as Record<string, unknown>[],
    },
    pngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    picked: null as { name: string, data: Uint8Array } | null,
    downloaded: [] as Uint8Array[],
    saveImage: vi.fn(async (_data: Uint8Array) => 'saved-icon'),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    postToast: vi.fn(),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: h.alertError,
    alertNormal: h.alertNormal,
    alertClear: vi.fn(),
    alertStore: { set: vi.fn(), update: vi.fn(), subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/toast/toastHost.svelte'), () => ({
    postToast: h.postToast,
}) as unknown as typeof import('src/ts/toast/toastHost.svelte'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: () => h.db,
    saveImage: h.saveImage,
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    downloadFile: vi.fn(async (_name: string, data: Uint8Array) => {
        h.downloaded.push(data)
        return true
    }),
    readImage: vi.fn(async () => new Uint8Array(Buffer.from(h.pngBase64, 'base64'))),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(async () => h.picked),
    selectMultipleFile: vi.fn(async () => (h.picked ? [h.picked] : null)),
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
import { exportUserPersona, exportPersona, importUserPersona, addPersonasFromPng } from './persona'

const MINIMAL_PNG = new Uint8Array(Buffer.from(h.pngBase64, 'base64'))

function b64(value: object): string {
    return Buffer.from(JSON.stringify(value)).toString('base64')
}

async function pngWithChunk(value: object): Promise<Uint8Array> {
    return new Uint8Array(await PngChunk.write(MINIMAL_PNG, { persona: b64(value) }) as Buffer)
}

async function chunkBase64Of(bytes: Uint8Array): Promise<string | undefined> {
    for await (const chunk of PngChunk.readGenerator(bytes)) {
        if (chunk && 'key' in chunk && chunk.key === 'persona') {
            return chunk.value
        }
    }
    return undefined
}

async function chunkJsonOf(bytes: Uint8Array): Promise<string | undefined> {
    const encoded = await chunkBase64Of(bytes)
    return encoded === undefined ? undefined : Buffer.from(encoded, 'base64').toString('utf-8')
}

type UpstreamResult = { accepted: true, persona: { name: string, personaPrompt: string, note?: string } } | { accepted: false }

/** Upstream's importer, transcribed: accepts only a non-empty name and a non-empty personaPrompt. */
async function upstreamImport(bytes: Uint8Array): Promise<UpstreamResult> {
    const decoded = await chunkBase64Of(bytes)
    if (!decoded) {
        return { accepted: false }
    }
    const data: { name: string, personaPrompt: string, note?: string } = JSON.parse(Buffer.from(decoded, 'base64').toString('utf-8'))
    if (data.name && data.personaPrompt) {
        return { accepted: true, persona: { name: data.name, personaPrompt: data.personaPrompt, note: data.note } }
    }
    return { accepted: false }
}

function seed(persona: TestPersona) {
    h.db.personas = [{ ...persona }]
    h.db.selectedPersona = 0
    h.db.username = persona.name
    h.db.userIcon = persona.icon
    h.db.personaPrompt = persona.personaPrompt
    h.db.userNote = persona.note ?? ''
}

function personaAt(index: number): TestPersona {
    return h.db.personas[index] as unknown as TestPersona
}

beforeEach(() => {
    h.downloaded.length = 0
    h.picked = null
    h.saveImage.mockReset()
    h.saveImage.mockResolvedValue('saved-icon')
    h.alertError.mockReset()
    h.alertNormal.mockReset()
    h.postToast.mockReset()
    seed({ name: 'Ann', icon: 'icon', personaPrompt: 'Prompt', note: 'Note', id: 'ann' })
})

describe('export chunk', () => {
    test('regression reproducer: the chunk carries largePortrait when the active persona has it', async () => {
        seed({ name: 'Ann', icon: 'icon', personaPrompt: 'Prompt', note: 'Note', id: 'ann', largePortrait: true })

        await exportUserPersona()

        expect(h.downloaded).toHaveLength(1)
        const json = JSON.parse(await chunkJsonOf(h.downloaded[0]) as string)
        expect(json.largePortrait).toBe(true)
        expect(json.name).toBe('Ann')
    })

    test('guard: a complete persona without the flag writes the byte-identical card of the old exporter', async () => {
        await exportUserPersona()

        expect(h.downloaded).toHaveLength(1)
        expect(await chunkJsonOf(h.downloaded[0])).toBe(JSON.stringify({ name: 'Ann', personaPrompt: 'Prompt', note: 'Note' }))
    })
})

describe('import: fork reads its own and upstream PNGs', () => {
    test('regression reproducer: a PNG with an empty personaPrompt is accepted', async () => {
        h.picked = { name: 'p.png', data: await pngWithChunk({ name: 'Bea', note: 'n' }) }

        await importUserPersona()

        expect(h.alertError).not.toHaveBeenCalled()
        expect(h.db.personas).toHaveLength(2)
        expect(personaAt(1).name).toBe('Bea')
        expect(personaAt(1).personaPrompt).toBe('')
    })

    test('guard: a PNG shaped like upstream output imports without the flag and gets a new id', async () => {
        h.picked = { name: 'p.png', data: await pngWithChunk({ name: 'Cy', personaPrompt: 'P', note: 'n' }) }

        await importUserPersona()

        expect(h.db.personas).toHaveLength(2)
        const added = personaAt(1)
        expect(added.name).toBe('Cy')
        expect(added.personaPrompt).toBe('P')
        expect(added.note).toBe('n')
        expect(added.largePortrait).toBeUndefined()
        expect(added.id).toBeTruthy()
    })

    test('guard: round trip through the real exporter keeps name, prompt, note and the flag, with a new id', async () => {
        await exportPersona({ name: 'Dee', icon: 'icon', personaPrompt: 'PP', note: 'NN', largePortrait: true })
        expect(h.downloaded).toHaveLength(1)
        h.picked = { name: 'dee.png', data: h.downloaded[0] }

        await importUserPersona()

        expect(h.db.personas).toHaveLength(2)
        const added = personaAt(1)
        expect(added.name).toBe('Dee')
        expect(added.personaPrompt).toBe('PP')
        expect(added.note).toBe('NN')
        expect(added.largePortrait).toBe(true)
        expect(added.id).toBeTruthy()
    })
})

describe('export: empty fields', () => {
    test('guard: exportPersona with an empty field exports and warns', async () => {
        await exportPersona({ name: 'Eve', icon: 'icon', personaPrompt: '', note: '' })

        expect(h.downloaded).toHaveLength(1)
        expect(h.alertError).not.toHaveBeenCalled()
        expect(h.postToast).toHaveBeenCalledTimes(1)
        expect(h.postToast.mock.calls[0][0].kind).toBe('warning')
        expect(JSON.parse(await chunkJsonOf(h.downloaded[0]) as string)).toEqual({ name: 'Eve', note: '' })
    })
})

describe('upstream acceptance of the fork export (transcription of upstream importUserPersona)', () => {
    test('guard: a complete persona is accepted with and without the flag, fields equal', async () => {
        await exportPersona({ name: 'Fay', icon: 'icon', personaPrompt: 'PF', note: 'NF' })
        await exportPersona({ name: 'Fay', icon: 'icon', personaPrompt: 'PF', note: 'NF', largePortrait: true })
        expect(h.downloaded).toHaveLength(2)

        for (const bytes of h.downloaded) {
            const result = await upstreamImport(bytes)
            expect(result).toEqual({ accepted: true, persona: { name: 'Fay', personaPrompt: 'PF', note: 'NF' } })
        }
    })

    test('guard: upstream refuses an empty-field export without throwing (accepted limitation)', async () => {
        await exportPersona({ name: 'Gus', icon: 'icon', personaPrompt: '', note: '' })
        expect(h.downloaded).toHaveLength(1)

        expect(await upstreamImport(h.downloaded[0])).toEqual({ accepted: false })
    })
})

describe('addPersonasFromPng', () => {
    function item(name: string) {
        return { fileName: name + '.png', card: { name, personaPrompt: 'P', note: 'n' }, bytes: MINIMAL_PNG }
    }

    test('guard: every icon is saved before any persona is pushed, then all are pushed with new ids', async () => {
        const ids = await addPersonasFromPng([item('a'), item('b')])

        expect(ids).toHaveLength(2)
        expect(h.db.personas).toHaveLength(3)
        expect(personaAt(1).name).toBe('a')
        expect(personaAt(2).name).toBe('b')
        expect(personaAt(1).id).toBe(ids[0])
        expect(personaAt(2).id).toBe(ids[1])
        expect(ids[0]).not.toBe(ids[1])
    })

    test('guard: a failing save rejects with that error and pushes nothing', async () => {
        const failure = new Error('disk full')
        h.saveImage.mockResolvedValueOnce('icon-1').mockRejectedValueOnce(failure)
        const before = JSON.stringify(h.db.personas)

        await expect(addPersonasFromPng([item('a'), item('b'), item('c')])).rejects.toBe(failure)

        expect(h.db.personas).toHaveLength(1)
        expect(JSON.stringify(h.db.personas)).toBe(before)
    })
})
