/**
 * The service key seam: one position per slot, the whole stored value, and the shared predicate
 * for a key read that must stop a request. The seam is backed by the legacy database position in
 * this stage, so these tests pin the position table; a later backing change keeps the same API.
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: vi.fn() }))

import type { Database } from 'src/ts/storage/database.svelte'
import { SecretRefError } from 'src/ts/secretRef'
import { VaultKeyUnavailableError } from './keyVaultStore.svelte'
import { currentServiceKey, currentServiceKeyForUi } from 'src/ts/process/request/secretKey'
import {
    isKeyReadStop, legacyServiceKey, SERVICE_SLOTS, serviceEditorValue, serviceKey, serviceKeyForUi, setServiceKey, type ServiceSlot,
} from './serviceKeys'

function dbWith(extra: Record<string, unknown> = {}): Database {
    return {
        elevenLabKey: '', huggingfaceKey: '', fishSpeechKey: '', NAIApiKey: '', stabilityKey: '', falToken: '',
        supaMemoryKey: '', voyageApiKey: '',
        openaiCompatImage: { url: 'https://img.example.invalid', key: '', model: 'm', size: '1024x1024', quality: 'auto' },
        wavespeedImage: { key: '', reference_image: 'ref', loras: [] },
        deeplOptions: { key: '', freeApi: true },
        deeplXOptions: { url: 'http://localhost:1188', token: '' },
        hypaCustomSettings: { url: 'https://embed.example.invalid', key: '', model: 'em' },
        ...extra,
    } as unknown as Database
}

/** The raw legacy position of each slot, spelled out so a table mistake in the seam cannot hide. */
const POSITIONS: Record<ServiceSlot, (db: Database) => unknown> = {
    elevenLabKey: (db) => db.elevenLabKey,
    huggingfaceKey: (db) => db.huggingfaceKey,
    fishSpeechKey: (db) => db.fishSpeechKey,
    NAIApiKey: (db) => db.NAIApiKey,
    stabilityKey: (db) => db.stabilityKey,
    falToken: (db) => db.falToken,
    'openaiCompatImage.key': (db) => db.openaiCompatImage.key,
    'wavespeedImage.key': (db) => db.wavespeedImage.key,
    'deeplOptions.key': (db) => db.deeplOptions.key,
    'deeplXOptions.token': (db) => db.deeplXOptions.token,
    supaMemoryKey: (db) => db.supaMemoryKey,
    voyageApiKey: (db) => db.voyageApiKey,
    'hypaCustomSettings.key': (db) => db.hypaCustomSettings.key,
}

describe('the service key table', () => {
    test('lists the 13 slots, each once', () => {
        expect(SERVICE_SLOTS).toHaveLength(13)
        expect(new Set(SERVICE_SLOTS).size).toBe(13)
        expect([...SERVICE_SLOTS].sort()).toEqual(Object.keys(POSITIONS).sort())
    })

    test.each(Object.keys(POSITIONS) as ServiceSlot[])('%s reads and writes its own legacy position and nothing else', async (slot) => {
        const db = dbWith()
        const before = JSON.stringify(db)

        await setServiceKey(db, slot, `SYN-${slot}`)

        expect(POSITIONS[slot](db)).toBe(`SYN-${slot}`)
        expect(legacyServiceKey(db, slot)).toBe(`SYN-${slot}`)
        expect(serviceEditorValue(db, slot)).toBe(`SYN-${slot}`)
        expect(serviceKeyForUi(slot, db)).toBe(`SYN-${slot}`)
        expect(await serviceKey(slot, db)).toBe(`SYN-${slot}`)
        // Only the one position changed: every other slot still reads empty and the siblings are intact.
        for (const other of SERVICE_SLOTS.filter((s) => s !== slot)) {
            expect(legacyServiceKey(db, other)).toBe('')
        }
        expect(JSON.stringify(db).replace(`SYN-${slot}`, '')).toBe(before)
    })
})

describe('the stored value', () => {
    test('is returned whole, with its lines and its reference text, never split or resolved', async () => {
        const db = dbWith({ elevenLabKey: 'L1\nL2' })
        expect(await serviceKey('elevenLabKey', db)).toBe('L1\nL2')
        const ref = dbWith({ falToken: '${SYN_NAME}' })
        expect(await serviceKey('falToken', ref)).toBe('${SYN_NAME}')
    })

    test('a value that is not a string counts as empty', () => {
        const db = dbWith({ elevenLabKey: 5, deeplOptions: 'x', hypaCustomSettings: { key: 7 } })
        expect(legacyServiceKey(db, 'elevenLabKey')).toBe('')
        expect(legacyServiceKey(db, 'deeplOptions.key')).toBe('')
        expect(legacyServiceKey(db, 'hypaCustomSettings.key')).toBe('')
    })

    test('currentServiceKey and currentServiceKeyForUi return the same whole value as the seam', async () => {
        const db = dbWith({ voyageApiKey: 'SYN-a\nSYN-b' })
        expect(await currentServiceKey('voyageApiKey', db)).toBe('SYN-a\nSYN-b')
        expect(currentServiceKeyForUi('voyageApiKey', db)).toBe('SYN-a\nSYN-b')
    })
})

describe('a nested write', () => {
    test('keeps the container and its siblings', async () => {
        const db = dbWith()
        const container = db.wavespeedImage
        await setServiceKey(db, 'wavespeedImage.key', 'SYN-w')
        expect(db.wavespeedImage).toBe(container)
        expect(db.wavespeedImage).toMatchObject({ key: 'SYN-w', reference_image: 'ref', loras: [] })
    })

    test('creates a container that is missing or not an object, with just the key', async () => {
        const missing = dbWith({ deeplOptions: undefined })
        await setServiceKey(missing, 'deeplOptions.key', 'SYN-d')
        expect(missing.deeplOptions).toEqual({ key: 'SYN-d' })
        const wrong = dbWith({ deeplXOptions: 'x' })
        await setServiceKey(wrong, 'deeplXOptions.token', 'SYN-x')
        expect(wrong.deeplXOptions).toEqual({ token: 'SYN-x' })
    })
})

describe('isKeyReadStop', () => {
    test('is true for an unresolvable reference and for an unreadable wrapped key', () => {
        expect(isKeyReadStop(new SecretRefError('SYN_NAME', 'unavailable'))).toBe(true)
        expect(isKeyReadStop(new VaultKeyUnavailableError('not yet'))).toBe(true)
    })

    test('is false for any other error and for a non-error', () => {
        expect(isKeyReadStop(new Error('network'))).toBe(false)
        expect(isKeyReadStop('SecretRefError')).toBe(false)
        expect(isKeyReadStop(undefined)).toBe(false)
    })
})
