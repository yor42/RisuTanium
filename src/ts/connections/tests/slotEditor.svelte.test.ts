import { describe, expect, it } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { slotConnection, type Connection } from '../connections'
import { setCustomModelUrl, setSlotKey } from '../slotEditor'

// A $state proxy rejects structuredClone, so the shared-connection clone must be a plain spread.
describe('custom setters over a $state database', () => {
    function reactiveDb(): Database {
        const shared: Connection & { keyWrapped: string } = {
            id: 'conn-1', name: 'c', provider: 'custom', key: 'K0', url: 'https://c.invalid', keyWrapped: 'w',
        }
        const db = $state({
            connections: [shared],
            customModels: [
                { id: 'ma', name: 'A', connectionId: 'conn-1' },
                { id: 'mb', name: 'B', connectionId: 'conn-1' },
            ],
        })
        return db as unknown as Database
    }

    it('clones with every unknown field and leaves the other model alone', async () => {
        const db = reactiveDb()
        await setSlotKey(db, 'customModels:ma', 'new')
        setCustomModelUrl(db, 'ma', 'https://n.invalid')
        expect(db.customModels[1].connectionId).toBe('conn-1')
        expect(db.connections!.find((c) => c.id === 'conn-1')).toMatchObject({ key: 'K0', url: 'https://c.invalid' })
        const clone = slotConnection(db, 'customModels:ma') as Connection & { keyWrapped?: string }
        expect(clone).toMatchObject({ key: 'new', url: 'https://n.invalid', keyWrapped: 'w' })
        expect(clone.id).not.toBe('conn-1')
    })
})
