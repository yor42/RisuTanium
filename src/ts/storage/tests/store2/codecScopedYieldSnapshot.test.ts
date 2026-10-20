// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { assembleDatabase, planScopedEncode, previousFrom, unitMapSource } from '../../store2/codec'
import { createKeyMint } from '../../store2/commit'
import type { Database } from '../../database.svelte'
import { buildSmall, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'

const NOW = 1_700_000_000_000

type Change = 'splice-front' | 'unshift-front' | 'reassign-filter'

function chaIds(characters: unknown[]): string[] {
    return characters.map(slot => String((slot as { chaId?: unknown }).chaId))
}

describe('a pass encodes one consistent character list, whatever the list does at a yield', () => {
    for (const change of ['splice-front', 'unshift-front', 'reassign-filter'] as Change[]) {
        test(`${change} at the first yield: the committed tree holds exactly the pre-pass characters`, async () => {
            const db = JSON.parse(JSON.stringify(buildSmall(5))) as Obj
            const first = encodeWith(db as unknown as Database)
            const before = chaIds(db.characters as unknown[])
            const extra = JSON.parse(JSON.stringify((db.characters as Obj[])[0])) as Obj
            extra.chaId = 'inserted-during-yield'
            let fired = false
            const plan = await planScopedEncode(
                db as unknown as Database,
                { env: seededEnv(2), lists: fakeLists, seq: 2, createdAt: NOW, previous: previousFrom(first) },
                {
                    modules: false,
                    characters: 'all',
                    yield: async () => {
                        if (fired) {
                            return
                        }
                        fired = true
                        const live = db.characters as Obj[]
                        if (change === 'splice-front') {
                            live.splice(0, 1)
                        } else if (change === 'unshift-front') {
                            live.unshift(extra)
                        } else {
                            db.characters = live.filter((_slot, index) => index !== 0)
                        }
                    },
                },
            )
            expect(fired).toBe(true)
            const { mint } = createKeyMint(seededEnv(901), null)
            const tree = plan.finalize({ mint, seq: 2, now: NOW })
            const decoded = assembleDatabase(tree.manifest, unitMapSource([...first.units, ...tree.units])) as unknown as { characters: unknown[] }
            const saved = chaIds(decoded.characters)
            expect(saved).toEqual(before)
            expect(new Set(saved).size).toBe(saved.length)
        })
    }
})
