/**
 * The Undo for a deleted connection. `DBState` is a real `$state` object, as in production, so a
 * restore that aliased a reactive proxy or captured stale state would show here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({ holder: { db: undefined as unknown as Database } }))

vi.mock('src/ts/stores.svelte', () => ({
    get DBState() {
        return h.holder
    },
}))

import { storedConnections } from '../connections'
import { deleteConnection, needsKey } from '../connectionEditor'
import { connectionUndoAction } from '../connectionUndo'

const texts = { restored: 'restored', refused: 'refused', failed: 'failed' }

function resetDb() {
    const store = $state({
        connections: [
            { id: 'conn-1', name: 'OpenAI', provider: 'openai', key: 'sk-test-AAAA1234' },
            { id: 'conn-2', name: 'p.invalid', provider: 'reverse_proxy', key: 'sk-test-PPPP5678', url: 'https://p.invalid' },
        ],
        proxyConnectionId: 'conn-2',
        botPresets: [{ id: 'p1', name: 'one', proxyConnectionId: 'conn-2' }],
        customModels: [],
    })
    h.holder.db = store as unknown as Database
    needsKey.clear()
}

beforeEach(resetDb)

describe('connectionUndoAction', () => {
    it('restores an empty-key connection with its references and flags it for key entry', () => {
        const removed = deleteConnection(h.holder.db, 'conn-2')!
        const action = connectionUndoAction(removed, texts)
        expect(action.id).toBe('connection:conn-2')
        expect(action.failedText).toBe('failed')
        expect(action.run()).toEqual({ ok: true, text: 'restored' })
        expect(storedConnections(h.holder.db)[1]).toEqual({
            id: 'conn-2', name: 'p.invalid', provider: 'reverse_proxy', key: '', url: 'https://p.invalid',
        })
        expect(h.holder.db.proxyConnectionId).toBe('conn-2')
        expect(needsKey.has('conn-2')).toBe(true)
        expect(action.run()).toEqual({ ok: false, text: 'refused' })
    })

    it('T14: judges the live store at run time, not a captured copy', () => {
        const removed = deleteConnection(h.holder.db, 'conn-2')!
        const action = connectionUndoAction(removed, texts)
        h.holder.db.connections = [
            ...storedConnections(h.holder.db),
            { id: 'conn-2', name: 'newcomer', provider: 'mistral', key: 'sk-test-MMMM0000' },
        ]
        expect(action.run()).toEqual({ ok: false, text: 'refused' })
        expect(storedConnections(h.holder.db).filter((c) => c.id === 'conn-2')).toHaveLength(1)
        expect(storedConnections(h.holder.db)[1].name).toBe('newcomer')
    })

    it('restores from a private rebuilt copy: later edits to the removed record and extra fields never reach the store', () => {
        h.holder.db.botPresets = [...(h.holder.db.botPresets ?? []), { id: 'ghost', name: 'ghost', proxyConnectionId: '' }] as Database['botPresets']
        const removed = deleteConnection(h.holder.db, 'conn-2')!
        expect(JSON.stringify(removed)).not.toContain('sk-test')
        const action = connectionUndoAction(removed, texts)
        // Fields a record could carry beyond the whitelist, and edits made after the action was built.
        Object.assign(removed.snapshot, { key: 'sk-test-LEAK9999', wrapped: 'sk-test-WRAP0000', name: 'edited' })
        removed.refs.presetIds.push('ghost')
        expect(action.run()).toEqual({ ok: true, text: 'restored' })
        expect(storedConnections(h.holder.db)[1]).toStrictEqual({
            id: 'conn-2', name: 'p.invalid', provider: 'reverse_proxy', key: '', url: 'https://p.invalid',
        })
        expect(JSON.stringify(h.holder.db)).not.toContain('sk-test-LEAK')
        expect(JSON.stringify(h.holder.db)).not.toContain('sk-test-WRAP')
        expect(h.holder.db.botPresets?.find((preset) => preset.id === 'ghost')?.proxyConnectionId).toBe('')
        expect(h.holder.db.botPresets?.find((preset) => preset.id === 'p1')?.proxyConnectionId).toBe('conn-2')
    })

    it('a deleted connection that held an envelope comes back without it', () => {
        h.holder.db.connections = [
            ...storedConnections(h.holder.db),
            { id: 'conn-3', name: 'Sealed', provider: 'mistral', key: '', keyWrapped: 'SYNTH-ENVELOPE' },
        ]
        const removed = deleteConnection(h.holder.db, 'conn-3')!
        expect(JSON.stringify(removed)).not.toContain('SYNTH-ENVELOPE')
        const action = connectionUndoAction(removed, texts)
        Object.assign(removed.snapshot, { keyWrapped: 'SYNTH-ENVELOPE' })
        expect(action.run()).toEqual({ ok: true, text: 'restored' })
        const restored = storedConnections(h.holder.db).find((conn) => conn.id === 'conn-3')
        expect(restored).toStrictEqual({ id: 'conn-3', name: 'Sealed', provider: 'mistral', key: '' })
        expect(JSON.stringify(h.holder.db)).not.toContain('SYNTH-ENVELOPE')
    })

    it('reports the failed text for a malformed store', () => {
        const removed = deleteConnection(h.holder.db, 'conn-2')!
        const action = connectionUndoAction(removed, texts)
        h.holder.db.connections = 'broken' as unknown as Database['connections']
        expect(action.run()).toEqual({ ok: false, text: 'failed' })
    })
})
