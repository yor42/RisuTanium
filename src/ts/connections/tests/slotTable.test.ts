import { describe, expect, it } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { SECRET_FIELDS } from 'src/ts/secretFields'
import { GLOBAL_SLOT_PROVIDERS } from '../connections'
import { FAMILY_ROWS, GLOBAL_ROWS, SLOT_TABLE } from '../slotTable'

describe('slot table', () => {
    it('has 13 global rows and three family rows', () => {
        expect(GLOBAL_ROWS).toHaveLength(13)
        expect(new Set(GLOBAL_ROWS.map((row) => row.slot)).size).toBe(13)
        expect(FAMILY_ROWS.map((row) => row.kind)).toEqual(['oaicomp', 'custom', 'reverse_proxy'])
        expect(SLOT_TABLE).toHaveLength(16)
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
        for (const row of GLOBAL_ROWS) {
            const nested = { token: 't', model: 'm', apiKey: 'a', softPrompt: 's', accessToken: 'g', projectId: 'p' }
            const db = {
                novelai: { ...nested }, hordeConfig: { ...nested }, google: { ...nested },
            } as unknown as Database
            const before = { novelai: db.novelai, hordeConfig: db.hordeConfig, google: db.google }
            row.legacySet(db, 'secret')
            expect(row.legacyGet(db)).toBe('secret')
            if (row.rootProp === 'novelai' || row.rootProp === 'hordeConfig' || row.rootProp === 'google') {
                expect(db[row.rootProp]).not.toBe(before[row.rootProp])
                expect(JSON.stringify(before[row.rootProp])).not.toContain('secret')
            }
        }
    })

    it('treats a non-string legacy value as empty', () => {
        const db = { openAIKey: 5, novelai: 'x', google: null } as unknown as Database
        for (const row of GLOBAL_ROWS) {
            expect(row.legacyGet(db)).toBe('')
        }
    })
})
