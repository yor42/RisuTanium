import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import type { Database } from 'src/ts/storage/database.svelte'
import { isMalformedStore } from '../connections'
import { migrateConnections, planConnections } from '../migrate'

// Any value at any position the planner reads: it must neither throw nor write on a garbage store.
const odd = fc.anything()

const dbArb = fc.record({
    openAIKey: odd, proxyKey: odd, forceReplaceUrl: odd, claudeAPIKey: odd, vertexPrivateKey: odd,
    novelai: odd, hordeConfig: odd, google: odd, OaiCompAPIKeys: odd,
    proxyConnectionId: odd,
    botPresets: fc.oneof(odd, fc.array(odd)),
    customModels: fc.oneof(odd, fc.array(odd)),
    connections: fc.oneof(fc.constant(undefined), odd),
}, { requiredKeys: [] })

describe('planner property', () => {
    it('never throws on odd, null and garbage values', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        fc.assert(fc.property(dbArb, (input) => {
            const db = input as unknown as Database
            expect(() => planConnections(db)).not.toThrow()
            expect(() => migrateConnections(structuredClone(db))).not.toThrow()
        }), { numRuns: 300 })
    })

    it('answers skip and writes nothing for a malformed store', () => {
        fc.assert(fc.property(dbArb, (input) => {
            const db = input as unknown as Database
            fc.pre(isMalformedStore(db))
            const before = structuredClone(db)
            expect(planConnections(db)).toBe('skip')
            expect(migrateConnections(db)).toBe('skip')
            expect(db).toEqual(before)
        }), { numRuns: 300 })
    })
})
