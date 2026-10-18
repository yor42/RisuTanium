// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { createLegacyStoreReader } from 'src/ts/storage/store2/legacy/storeReader'
import { resolveLegacyTree } from 'src/ts/storage/store2/legacy/resolve'
import { randomId26 } from 'src/ts/storage/store2/format'
import { seededEnv } from './codecFixtures'

/**
 * Compatibility guard: it passes before and after the store2 reader redirect. A `.bin` or profile whose character stub
 * names a store2 entity (a `u`, not a legacy unit id) converts to a placeholder character and never aborts the
 * conversion: the converter answers `missing` for any key that is not a unit id before it asks its reader, so the
 * reader's answer for a `u` is never consulted. Both converter entries (`bootDispatch.ts` and `recoveryController.ts`) hand
 * the cold-storage reader to the same `createLegacyStoreReader`.
 */

const OPTIONS = { newId: () => 'placeholder-chat-id', now: () => 1_700_000_000_001 }

function danglingProfile(u: string): Database {
    return {
        characters: [
            { chaId: 'whole', name: 'Whole', type: 'character', chats: [{ id: 'c', name: 'c', message: [{ role: 'user', data: 'hello', time: 1 }], note: '', localLore: [] }], chatPage: 0 },
            { chaId: 'dangling', name: 'Dangling', type: 'character', coldstorage: u, coldStoragedChats: [], coldVersion: 3, coldChatCount: 2, chats: [], chatPage: 0 },
        ],
    } as unknown as Database
}

describe('guard: a dangling store2 stub converts to a placeholder', () => {
    test('the converter never reads the entity, keeps the other character and lists the stub as missing', async () => {
        const u = randomId26(seededEnv(5))
        const read = vi.fn(async (_key: string) => ({ status: 'error' as const, error: new Error('a plain failure would abort the conversion') }))

        const { database, incomplete } = await resolveLegacyTree(danglingProfile(u), createLegacyStoreReader(read), OPTIONS)

        expect(read).not.toHaveBeenCalled()
        const characters = database.characters as unknown as Array<Record<string, unknown>>
        expect(characters.map(slot => slot.chaId)).toEqual(['whole', 'dangling'])
        expect(characters[1].coldstorage).toBeUndefined()
        expect((characters[1].chats as unknown[]).length).toBe(1)
        expect(incomplete).toEqual([{ kind: 'character', chaId: 'dangling', name: 'Dangling', key: u, reason: 'missing' }])
    })

    test('a reader answering damaged is a placeholder (unparsable) where a plain error would abort', async () => {
        const reader = createLegacyStoreReader(async () => ({ status: 'error', error: new Error('damaged'), kind: 'damaged' }))
        expect(await reader.read('a-unit-id')).toEqual({ status: 'unparsable' })
        const plain = createLegacyStoreReader(async () => ({ status: 'error', error: new Error('plain') }))
        expect(await plain.read('a-unit-id')).toMatchObject({ status: 'error' })
    })
})
