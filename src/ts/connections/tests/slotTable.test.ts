import { describe, expect, it } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { SECRET_FIELDS } from 'src/ts/secretFields'
import { GLOBAL_SLOT_PROVIDERS, SERVICE_SLOTS } from '../connections'
import { FAMILY_ROWS, GLOBAL_ROWS, SLOT_TABLE } from '../slotTable'

describe('slot table', () => {
    it('has 26 global rows and three family rows', () => {
        expect(GLOBAL_ROWS).toHaveLength(26)
        expect(new Set(GLOBAL_ROWS.map((row) => row.slot)).size).toBe(26)
        expect(FAMILY_ROWS.map((row) => row.kind)).toEqual(['oaicomp', 'custom', 'reverse_proxy'])
        expect(SLOT_TABLE).toHaveLength(29)
    })

    it('gives every global row its own provider, so a migration never folds two legacy values into one connection', () => {
        expect(new Set(GLOBAL_ROWS.map((row) => row.provider)).size).toBe(GLOBAL_ROWS.length)
        expect(GLOBAL_SLOT_PROVIDERS.NAIApiKey).not.toBe(GLOBAL_SLOT_PROVIDERS['novelai.token'])
    })

    it('appends the service rows after the 13 chat rows, in table order', () => {
        expect(GLOBAL_ROWS.slice(0, 13).map((row) => row.slot)).toEqual([
            'openAIKey', 'claudeAPIKey', 'openrouterKey', 'nanogptKey', 'mistralKey', 'cohereAPIKey', 'ollamaApiKey',
            'novellistAPI', 'mancerHeader', 'novelai.token', 'hordeConfig.apiKey', 'google.accessToken', 'vertexPrivateKey',
        ])
        expect(GLOBAL_ROWS.slice(13).map((row) => row.slot)).toEqual([...SERVICE_SLOTS])
    })

    it('takes each global provider from the one provider map', () => {
        for (const row of GLOBAL_ROWS) {
            expect(row.provider).toBe(GLOBAL_SLOT_PROVIDERS[row.slot])
        }
    })

    it('has a SECRET_FIELDS entry for every row, matched on scope, field and sub', () => {
        for (const row of SLOT_TABLE) {
            const hit = SECRET_FIELDS.some((entry) =>
                entry.scope === row.secretEntry.scope
                && entry.field === row.secretEntry.field
                && ('sub' in entry ? entry.sub : undefined) === row.secretEntry.sub)
            expect(hit, `${row.secretEntry.field}${row.secretEntry.sub ?? ''}`).toBe(true)
        }
    })

    it('reads and writes every global legacy position, a nested one through a new container', () => {
        const nestedRoots = ['novelai', 'hordeConfig', 'google', 'openaiCompatImage', 'wavespeedImage', 'deeplOptions', 'deeplXOptions', 'hypaCustomSettings']
        let nestedRows = 0
        for (const row of GLOBAL_ROWS) {
            const nested = { token: 't', model: 'm', apiKey: 'a', softPrompt: 's', accessToken: 'g', projectId: 'p', key: 'k', url: 'u', loras: [] }
            const db = {
                novelai: { ...nested }, hordeConfig: { ...nested }, google: { ...nested }, openaiCompatImage: { ...nested },
                wavespeedImage: { ...nested }, deeplOptions: { ...nested }, deeplXOptions: { ...nested }, hypaCustomSettings: { ...nested },
            } as unknown as Database
            const rows = db as unknown as Record<string, unknown>
            const before = Object.fromEntries(nestedRoots.map((root) => [root, rows[root]]))
            row.legacySet(db, 'secret')
            expect(row.legacyGet(db)).toBe('secret')
            const root = String(row.rootProp)
            if (nestedRoots.includes(root)) {
                nestedRows++
                expect(rows[root]).not.toBe(before[root])
                expect(JSON.stringify(before[root])).not.toContain('secret')
                const siblings = { ...(rows[root] as Record<string, unknown>) }
                const sub = row.secretEntry.sub?.slice(1) ?? ''
                delete siblings[sub]
                const original = { ...nested } as Record<string, unknown>
                delete original[sub]
                expect(siblings).toEqual(original)
            }
        }
        expect(nestedRows).toBe(8)
    })

    it('treats a non-string legacy value as empty', () => {
        const db = {
            openAIKey: 5, novelai: 'x', google: null, elevenLabKey: 5, deeplOptions: 'x', hypaCustomSettings: { key: 7 },
            wavespeedImage: [1], openaiCompatImage: { key: null },
        } as unknown as Database
        for (const row of GLOBAL_ROWS) {
            expect(row.legacyGet(db)).toBe('')
        }
    })

    it('writes only the key when a nested container is not a record, and never spreads it', () => {
        for (const row of GLOBAL_ROWS.filter((r) => r.secretEntry.sub !== undefined)) {
            const sub = row.secretEntry.sub?.slice(1) ?? ''
            for (const bad of ['x', undefined, null, ['a', 'b'], 5]) {
                const db = { [row.rootProp]: bad } as unknown as Database
                row.legacySet(db, 'secret')
                expect((db as unknown as Record<string, unknown>)[row.rootProp]).toEqual({ [sub]: 'secret' })
            }
        }
    })
})
