/**
 * The service key seam: a slot is backed by its connection, the value is the whole stored string, a
 * legacy database field is never read here, and the shared predicate marks a key read that must stop a request.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: vi.fn() }))

const rejectRead = vi.hoisted(() => ({ on: false }))
vi.mock('./keyAccess', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./keyAccess')>()
    return {
        ...actual,
        connectionKey: vi.fn(async (conn: Parameters<typeof actual.connectionKey>[0]) => {
            if (rejectRead.on) {
                const { VaultKeyUnavailableError } = await import('./keyVaultStore.svelte')
                throw new VaultKeyUnavailableError('not yet')
            }
            return actual.connectionKey(conn)
        }),
    }
})

import type { Database } from 'src/ts/storage/database.svelte'
import { SecretRefError } from 'src/ts/secretRef'
import { GLOBAL_SLOT_PROVIDERS, slotConnection } from './connections'
import { VaultKeyUnavailableError } from './keyVaultStore.svelte'
import { currentServiceKey, currentServiceKeyForUi } from 'src/ts/process/request/secretKey'
import {
    isKeyReadStop, SERVICE_SLOTS, serviceEditorValue, serviceKey, serviceKeyForUi, setServiceKey, type ServiceSlot,
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

const PROVIDERS: Record<ServiceSlot, string> = {
    elevenLabKey: 'elevenlabs', huggingfaceKey: 'huggingface', fishSpeechKey: 'fishspeech', NAIApiKey: 'novelai_media',
    stabilityKey: 'stability', falToken: 'fal', 'openaiCompatImage.key': 'openai_image', 'wavespeedImage.key': 'wavespeed',
    'deeplOptions.key': 'deepl', 'deeplXOptions.token': 'deeplx', supaMemoryKey: 'memory_openai', voyageApiKey: 'voyage',
    'hypaCustomSettings.key': 'embedding_custom',
}

beforeEach(() => { rejectRead.on = false })

describe('the service key table', () => {
    test('lists the 13 slots, each once, each with its own provider', () => {
        expect(SERVICE_SLOTS).toHaveLength(13)
        expect(new Set(SERVICE_SLOTS).size).toBe(13)
        expect([...SERVICE_SLOTS].sort()).toEqual(Object.keys(PROVIDERS).sort())
        expect(new Set(SERVICE_SLOTS.map((slot) => GLOBAL_SLOT_PROVIDERS[slot])).size).toBe(13)
        for (const slot of SERVICE_SLOTS) {
            expect(GLOBAL_SLOT_PROVIDERS[slot]).toBe(PROVIDERS[slot])
        }
    })

    test.each(Object.keys(PROVIDERS) as ServiceSlot[])('%s is stored in its connection and nowhere in the legacy fields', async (slot) => {
        const db = dbWith()
        const before = JSON.stringify(db)

        await setServiceKey(db, slot, `SYN-${slot}`)

        expect(slotConnection(db, slot)).toMatchObject({ provider: PROVIDERS[slot], key: `SYN-${slot}` })
        expect(serviceEditorValue(db, slot)).toBe(`SYN-${slot}`)
        expect(serviceKeyForUi(slot, db)).toBe(`SYN-${slot}`)
        expect(await serviceKey(slot, db)).toBe(`SYN-${slot}`)
        for (const other of SERVICE_SLOTS.filter((s) => s !== slot)) {
            expect(await serviceKey(other, db)).toBe('')
        }
        const { connections, ...rest } = db as unknown as { connections: unknown } & Record<string, unknown>
        expect(connections).toHaveLength(1)
        expect(JSON.stringify(rest)).toBe(before)
    })
})

describe('the stored value', () => {
    test('is returned whole, with its lines and its reference text, never split or resolved', async () => {
        const db = dbWith()
        await setServiceKey(db, 'elevenLabKey', 'L1\nL2')
        expect(await serviceKey('elevenLabKey', db)).toBe('L1\nL2')
        await setServiceKey(db, 'falToken', '${SYN_NAME}')
        expect(await serviceKey('falToken', db)).toBe('${SYN_NAME}')
    })

    test('a legacy field is never read: a slot with no connection is empty although its old position holds a key', async () => {
        const db = dbWith({
            elevenLabKey: 'SYN-legacy', deeplOptions: { key: 'SYN-legacy-deepl', freeApi: true },
            hypaCustomSettings: { url: 'u', key: 'SYN-legacy-hypa', model: 'm' },
        })
        expect(await serviceKey('elevenLabKey', db)).toBe('')
        expect(serviceKeyForUi('elevenLabKey', db)).toBe('')
        expect(serviceEditorValue(db, 'deeplOptions.key')).toBe('')
        expect(await serviceKey('hypaCustomSettings.key', db)).toBe('')
    })

    test('currentServiceKey and currentServiceKeyForUi return the same whole value as the seam', async () => {
        const db = dbWith()
        await setServiceKey(db, 'voyageApiKey', 'SYN-a\nSYN-b')
        expect(await currentServiceKey('voyageApiKey', db)).toBe('SYN-a\nSYN-b')
        expect(currentServiceKeyForUi('voyageApiKey', db)).toBe('SYN-a\nSYN-b')
    })

    test('a read that is rejected rejects, and is not turned into an empty key', async () => {
        const db = dbWith()
        await setServiceKey(db, 'deeplXOptions.token', 'SYN-dx')
        rejectRead.on = true
        await expect(serviceKey('deeplXOptions.token', db)).rejects.toBeInstanceOf(VaultKeyUnavailableError)
        await expect(currentServiceKey('deeplXOptions.token', db)).rejects.toBeInstanceOf(VaultKeyUnavailableError)
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
