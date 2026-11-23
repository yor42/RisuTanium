import { describe, expect, it } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { addCustomModelUnder, customModelsUnder, editCustomModelUnder, ownsCustomModels, removeCustomModelUnder } from '../customModelsUnder'

function db(): Database {
    return {
        connections: [
            { id: 'c-custom', name: 'Local', provider: 'custom', key: 'k', url: 'http://l.invalid/v1' },
            { id: 'c-other', name: 'Other', provider: 'custom', key: '', url: '' },
            { id: 'c-proxy', name: 'Proxy', provider: 'reverse_proxy', key: 'k', url: 'http://p.invalid' },
        ],
        customModels: [
            { id: 'xcustom:::1', internalId: 'a', name: 'A', format: 0, tokenizer: 0, params: '', flags: [], connectionId: 'c-custom' },
            { id: 'xcustom:::2', internalId: 'b', name: 'B', format: 0, tokenizer: 0, params: '', flags: [], connectionId: 'c-other' },
        ],
    } as unknown as Database
}

describe('custom models under a connection', () => {
    it('lists only the models naming the connection', () => {
        expect(customModelsUnder(db(), 'c-custom')).toEqual([{ id: 'xcustom:::1', name: 'A', internalId: 'a' }])
    })

    it('adds a model that names the connection and refuses a non-custom or unknown one', () => {
        const d = db()
        const id = addCustomModelUnder(d, 'c-custom')
        expect(id).toMatch(/^xcustom:::/)
        expect(d.customModels.find((m) => m.id === id)?.connectionId).toBe('c-custom')
        expect(addCustomModelUnder(d, 'c-proxy')).toBeNull()
        expect(addCustomModelUnder(d, 'nope')).toBeNull()
        expect(d.customModels).toHaveLength(3)
        expect(ownsCustomModels(d, 'c-proxy')).toBe(false)
    })

    it('edits and removes only models of that connection', () => {
        const d = db()
        expect(editCustomModelUnder(d, 'c-custom', 'xcustom:::2', { name: 'X' })).toBe(false)
        expect(removeCustomModelUnder(d, 'c-custom', 'xcustom:::2')).toBe(false)
        expect(editCustomModelUnder(d, 'c-custom', 'xcustom:::1', { name: 'A2', internalId: 'a2' })).toBe(true)
        expect(d.customModels[0]).toMatchObject({ name: 'A2', internalId: 'a2' })
        expect(removeCustomModelUnder(d, 'c-custom', 'xcustom:::1')).toBe(true)
        expect(d.customModels.map((m) => m.id)).toEqual(['xcustom:::2'])
    })
})
