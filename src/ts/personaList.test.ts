/**
 * The persona-list helpers over plain objects: the mirror invariant (INV-M), index upkeep on remove,
 * restore and move, id stamping and keys, and the binding count. These are guards for new behaviour:
 * the helpers have no pre-fix form. The reactive-store behaviour is in `personaList.state.svelte.test.ts`.
 */
import 'src/ts/polyfill'
import { describe, expect, test } from 'vitest'
import type { RisuPersona } from 'src/ts/storage/database.svelte'
import {
    activatePersona, adoptMirror, countBindings, createPersona, duplicatePersona, editPersona, movePersona,
    nextActiveAfterRemove, normalizePersonas, personaRenderKeys, removePersona, restorePersona, syncMirror,
    type PersonaStore, type RemovedPersona,
} from './personaList'

function persona(name: string, id?: string): RisuPersona {
    return { name, icon: 'icon-' + name, personaPrompt: 'prompt-' + name, note: 'note-' + name, ...(id === undefined ? {} : { id }) }
}

function makeDb(names: string[], selected = 0): PersonaStore {
    const personas = names.map((name) => persona(name, 'id-' + name))
    const active = personas[selected]
    return {
        personas,
        selectedPersona: selected,
        username: active.name,
        userIcon: active.icon,
        personaPrompt: active.personaPrompt,
        userNote: active.note ?? '',
    }
}

function expectMirror(db: PersonaStore) {
    expect(db.personas.length).toBeGreaterThanOrEqual(1)
    expect(db.selectedPersona).toBeGreaterThanOrEqual(0)
    expect(db.selectedPersona).toBeLessThan(db.personas.length)
    const active = db.personas[db.selectedPersona]
    expect(db.username).toBe(active.name)
    expect(db.userIcon).toBe(active.icon)
    expect(db.personaPrompt).toBe(active.personaPrompt)
    expect(db.userNote).toBe(active.note ?? '')
}

function names(db: PersonaStore): string[] {
    return db.personas.map((entry) => entry.name)
}

function removed(result: ReturnType<typeof removePersona>): RemovedPersona {
    if (result === null || result === 'last') {
        throw new Error('expected a removal')
    }
    return result
}

describe('removePersona and nextActiveAfterRemove', () => {
    test('L1: removing below the active persona shifts the index down', () => {
        const db = makeDb(['a', 'b', 'c', 'd'], 2)
        removed(removePersona(db, 'id-a'))
        expect(names(db)).toEqual(['b', 'c', 'd'])
        expect(db.selectedPersona).toBe(1)
        expect(db.username).toBe('c')
        expectMirror(db)
    })

    test('L2: removing above the active persona leaves the index', () => {
        const db = makeDb(['a', 'b', 'c', 'd'], 1)
        removed(removePersona(db, 'id-d'))
        expect(db.selectedPersona).toBe(1)
        expect(db.username).toBe('b')
        expectMirror(db)
    })

    test('L3: removing the active persona makes the first remaining one active, also at index 0', () => {
        const middle = makeDb(['a', 'b', 'c'], 1)
        const result = removed(removePersona(middle, 'id-b'))
        expect(result.wasActive).toBe(true)
        expect(result.index).toBe(1)
        expect(middle.selectedPersona).toBe(0)
        expect(middle.username).toBe('a')
        expectMirror(middle)

        const first = makeDb(['a', 'b', 'c'], 0)
        removed(removePersona(first, 'id-a'))
        expect(first.selectedPersona).toBe(0)
        expect(first.username).toBe('b')
        expectMirror(first)
    })

    test('L4: the last persona is refused and nothing changes', () => {
        const db = makeDb(['a'])
        const before = JSON.stringify(db)
        expect(removePersona(db, 'id-a')).toBe('last')
        expect(JSON.stringify(db)).toBe(before)
        expect(removePersona(db, 'missing')).toBeNull()
    })

    test('the confirm names the persona that becomes active', () => {
        const db = makeDb(['a', 'b', 'c'], 1)
        expect(nextActiveAfterRemove(db, 'id-b')?.name).toBe('a')
        expect(nextActiveAfterRemove(db, 'id-a')?.name).toBe('b')
        expect(nextActiveAfterRemove(makeDb(['a', 'b'], 1), 'id-a')?.name).toBe('b')
        db.username = 'b-mirror'
        expect(nextActiveAfterRemove(db, 'id-c')?.name).toBe('b-mirror')
        expect(nextActiveAfterRemove(makeDb(['a']), 'id-a')).toBeNull()
    })
})

describe('restorePersona', () => {
    test('L5: clamps the index, shifts the active index at or below it, keeps the id and syncs the mirror', () => {
        const db = makeDb(['a', 'b', 'c', 'd'], 2)
        const result = removed(removePersona(db, 'id-b'))
        expect(db.selectedPersona).toBe(1)

        expect(restorePersona(db, result.copy, result.index, result.wasActive)).toBe('restored')
        expect(names(db)).toEqual(['a', 'b', 'c', 'd'])
        expect(db.personas[1].id).toBe('id-b')
        expect(db.selectedPersona).toBe(2)
        expectMirror(db)

        const tail = removed(removePersona(db, 'id-d'))
        expect(restorePersona(db, tail.copy, 99, false)).toBe('restored')
        expect(names(db)).toEqual(['a', 'b', 'c', 'd'])
        expect(db.selectedPersona).toBe(2)
        expectMirror(db)

        expect(restorePersona(db, tail.copy, tail.index, false)).toBe('present')
        expect(names(db)).toEqual(['a', 'b', 'c', 'd'])
    })

    test('L6: restoring the formerly active persona makes it active again', () => {
        const db = makeDb(['a', 'b', 'c'], 1)
        const result = removed(removePersona(db, 'id-b'))
        expect(db.username).toBe('a')

        restorePersona(db, result.copy, result.index, result.wasActive)
        expect(db.selectedPersona).toBe(1)
        expect(db.username).toBe('b')
        expectMirror(db)
    })

    test('L7: a binding left dangling by the removal resolves again after the restore', () => {
        const db = makeDb(['a', 'b', 'c'], 0)
        const chat = { bindedPersona: 'id-b' }
        const resolve = () => db.personas.find((entry) => entry.id === chat.bindedPersona)
        expect(resolve()?.name).toBe('b')

        const result = removed(removePersona(db, 'id-b'))
        expect(resolve()).toBeUndefined()
        expect(chat.bindedPersona).toBe('id-b')

        restorePersona(db, result.copy, result.index, result.wasActive)
        expect(resolve()?.name).toBe('b')
    })
})

describe('movePersona', () => {
    test('L8: the active identity is kept for every kind of move', () => {
        for (let active = 0; active < 4; active++) {
            for (let from = 0; from < 4; from++) {
                for (let to = 0; to < 4; to++) {
                    const db = makeDb(['a', 'b', 'c', 'd'], active)
                    const activeName = db.personas[active].name
                    movePersona(db, db.personas[from].id as string, to)
                    expect(db.personas[db.selectedPersona].name).toBe(activeName)
                    expectMirror(db)
                }
            }
        }
        const db = makeDb(['a', 'b', 'c'], 0)
        expect(movePersona(db, 'id-c', 0)).toBe(true)
        expect(names(db)).toEqual(['c', 'a', 'b'])
        expect(db.selectedPersona).toBe(1)
        expect(movePersona(db, 'id-c', 0)).toBe(false)
    })
})

describe('editPersona, activatePersona, create, duplicate', () => {
    test('L9: editing the selected persona writes entry and mirror; another persona only the entry', () => {
        const db = makeDb(['a', 'b'], 0)
        editPersona(db, 'id-a', 'name', 'A2')
        editPersona(db, 'id-a', 'note', 'N2')
        editPersona(db, 'id-a', 'personaPrompt', 'P2')
        editPersona(db, 'id-a', 'icon', 'I2')
        expect(db.personas[0]).toMatchObject({ name: 'A2', note: 'N2', personaPrompt: 'P2', icon: 'I2' })
        expect([db.username, db.userNote, db.personaPrompt, db.userIcon]).toEqual(['A2', 'N2', 'P2', 'I2'])

        editPersona(db, 'id-b', 'name', 'B2')
        expect(db.personas[1].name).toBe('B2')
        expect(db.username).toBe('A2')
        expect(editPersona(db, 'id-b', 'largePortrait', true)).toBe(true)
        expect(db.personas[1].largePortrait).toBe(true)
        expect(editPersona(db, 'missing', 'name', 'x')).toBe(false)
        expectMirror(db)
    })

    test('L9b: a leading mirror is adopted before an edit of another persona', () => {
        const db = makeDb(['a', 'b'], 0)
        db.username = 'A2'
        editPersona(db, 'id-b', 'note', 'x')
        expect(db.personas[0].name).toBe('A2')
        expectMirror(db)
    })

    test('L10: activating adopts the old mirror, then switches', () => {
        const db = makeDb(['a', 'b'], 0)
        db.personaPrompt = 'legacy edit'
        expect(activatePersona(db, 'id-b')).toBe(true)
        expect(db.personas[0].personaPrompt).toBe('legacy edit')
        expect(db.selectedPersona).toBe(1)
        expect(db.username).toBe('b')
        expectMirror(db)
        expect(activatePersona(db, 'missing')).toBe(false)
    })

    test('L11: every structural helper adopts a leading mirror first', () => {
        const steps: Array<(db: PersonaStore) => void> = [
            (db) => { createPersona(db, 'n') },
            (db) => { duplicatePersona(db, 'id-b') },
            (db) => { removePersona(db, 'id-b') },
            (db) => { movePersona(db, 'id-b', 0) },
            (db) => { activatePersona(db, 'id-b') },
            (db) => { restorePersona(db, persona('z', 'id-z'), 0, false) },
        ]
        for (const step of steps) {
            const db = makeDb(['a', 'b', 'c'], 0)
            db.username = 'lead'
            step(db)
            expect(db.personas.some((entry) => entry.name === 'lead')).toBe(true)
        }
    })

    test('L12: create gets an id and is not active', () => {
        const db = makeDb(['a'])
        const id = createPersona(db, 'New')
        expect(db.personas).toHaveLength(2)
        expect(db.personas[1]).toMatchObject({ name: 'New', icon: '', personaPrompt: '', note: '', id })
        expect(id).toBeTruthy()
        expect(db.selectedPersona).toBe(0)
        expectMirror(db)
    })

    test('L13: duplicate is a deep copy with a new id and is not active', () => {
        const db = makeDb(['a', 'b'])
        const source = db.personas[0]
        source.embeddedModule = { name: 'm', id: 'm1', lorebook: [] } as unknown as RisuPersona['embeddedModule']
        const id = duplicatePersona(db, 'id-a')
        expect(id).toBeTruthy()
        expect(id).not.toBe('id-a')
        expect(db.personas).toHaveLength(3)
        const copy = db.personas[2]
        expect(copy.name).toBe('a')
        expect(copy.id).toBe(id)
        expect(copy.embeddedModule).toEqual(source.embeddedModule)
        expect(copy.embeddedModule).not.toBe(source.embeddedModule)
        expect(db.selectedPersona).toBe(0)
        expect(duplicatePersona(db, 'missing')).toBeNull()
    })
})

describe('countBindings', () => {
    test('L14: skips stub chats, ignores empty bindings and counts groups', () => {
        const stub = {
            coldstorage: 'unit-1',
            chats: [{ bindedPersona: 'id-a' }],
        }
        const loaded = { chats: [{ bindedPersona: 'id-a' }, { bindedPersona: 'id-b' }, { bindedPersona: '' }, {}] }
        const group = { chats: [{ bindedPersona: 'id-a' }] }

        const withStub = countBindings([loaded, stub, group])
        expect(withStub.orMore).toBe(true)
        expect(withStub.counts.get('id-a')).toBe(2)
        expect(withStub.counts.get('id-b')).toBe(1)
        expect(withStub.counts.has('')).toBe(false)

        expect(countBindings([loaded, group]).orMore).toBe(false)
        expect(countBindings([]).counts.size).toBe(0)
    })
})

describe('normalizePersonas and personaRenderKeys', () => {
    test('L-N1: adopts a leading mirror, stamps missing ids, keeps existing ones, and is idempotent', () => {
        const db = makeDb(['a', 'b', 'c', 'd'], 0)
        delete db.personas[1].id
        delete db.personas[2].id
        ;(db.personas[3] as unknown as { id: unknown }).id = 7
        db.username = 'A2'

        expect(normalizePersonas(db)).toBe(true)
        expect(db.personas[0].name).toBe('A2')
        expect(db.personas[0].id).toBe('id-a')
        const ids = db.personas.map((entry) => entry.id)
        expect(new Set(ids).size).toBe(4)
        for (const id of ids) {
            expect(typeof id).toBe('string')
            expect(id).not.toBe('')
        }
        expectMirror(db)

        const snapshot = JSON.stringify(db)
        expect(normalizePersonas(db)).toBe(false)
        expect(JSON.stringify(db)).toBe(snapshot)
    })

    test('L-N2: the first holder of a repeated id keeps it, so first-match resolvers resolve as before', () => {
        const db = makeDb(['a', 'b', 'c'], 0)
        db.personas[0].id = 'x'
        db.personas[1].id = 'y'
        db.personas[2].id = 'x'
        const resolveBefore = db.personas.findIndex((entry) => entry.id === 'x')

        normalizePersonas(db)

        expect(db.personas[0].id).toBe('x')
        expect(db.personas[1].id).toBe('y')
        expect(db.personas[2].id).not.toBe('x')
        expect(db.personas[2].id).toBeTruthy()
        expect(db.personas.findIndex((entry) => entry.id === 'x')).toBe(resolveBefore)
    })

    test('L-N3: an out-of-range selection does not throw; ids are still stamped and nothing is adopted', () => {
        const db = makeDb(['a', 'b'], 0)
        delete db.personas[1].id
        db.selectedPersona = 9
        db.username = 'lead'

        expect(() => normalizePersonas(db)).not.toThrow()
        expect(db.personas[1].id).toBeTruthy()
        expect(db.personas.some((entry) => entry.name === 'lead')).toBe(false)
        expect(adoptMirror(db)).toBe(false)
        expect(syncMirror(db)).toBe(false)
    })

    test('K-KEY: keys never collide whatever the stored ids are', () => {
        const personas = [undefined, undefined, 'a', 'a', '', 'ix:0', 5].map((id) => ({ id })) as unknown as RisuPersona[]
        const keys = personaRenderKeys(personas)
        expect(new Set(keys).size).toBe(keys.length)
        expect(keys[2]).toBe('id:a')
        expect(keys[3]).toBe('ix:3')
        expect(keys[5]).toBe('id:ix:0')
        expect(keys[0]).toBe('ix:0')
        expect(keys[6]).toBe('ix:6')
    })
})

function mulberry32(seed: number) {
    let state = seed
    return () => {
        state = (state + 0x6D2B79F5) | 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

describe('INV-M over a random run', () => {
    test('L15: 200 operations with mirror-only writes interleaved: invariant holds and no legacy edit is lost', () => {
        const random = mulberry32(20261114)
        const db = makeDb(['a', 'b', 'c', 'd'], 1)
        const removedCopies: RemovedPersona[] = []
        type Field = 'name' | 'icon' | 'personaPrompt' | 'note'
        const mirrorKey: Record<Field, 'username' | 'userIcon' | 'personaPrompt' | 'userNote'> = {
            name: 'username', icon: 'userIcon', personaPrompt: 'personaPrompt', note: 'userNote',
        }
        const fields: Field[] = ['name', 'icon', 'personaPrompt', 'note']
        let pending = new Map<Field, { id: string, token: string }>()
        let counter = 0
        const pick = (n: number) => Math.floor(random() * n)

        for (let step = 0; step < 200; step++) {
            if (random() < 0.4) {
                const field = fields[pick(4)]
                const token = 'tok' + counter++
                db[mirrorKey[field]] = token
                pending.set(field, { id: db.personas[db.selectedPersona].id as string, token })
                continue
            }
            const target = db.personas[pick(db.personas.length)].id as string
            const overwritten = new Set<string>()
            const newCopies: RemovedPersona[] = []
            switch (pick(7)) {
                case 0: createPersona(db, 'n' + counter++); break
                case 1: duplicatePersona(db, target); break
                case 2: {
                    const result = removePersona(db, target)
                    if (result !== null && result !== 'last') {
                        newCopies.push(result)
                        removedCopies.push(result)
                    }
                    break
                }
                case 3: {
                    const last = removedCopies.pop()
                    if (last) {
                        restorePersona(db, last.copy, last.index, last.wasActive)
                    } else {
                        activatePersona(db, target)
                    }
                    break
                }
                case 4: movePersona(db, target, pick(db.personas.length)); break
                case 5: activatePersona(db, target); break
                default: {
                    const field = fields[pick(4)] as Field
                    const token = 'edit' + counter++
                    const selectedId = db.personas[db.selectedPersona].id as string
                    editPersona(db, target, field, token)
                    if (target === selectedId) {
                        overwritten.add(field)
                    }
                    break
                }
            }

            expectMirror(db)
            for (const [field, { id, token }] of pending) {
                if (overwritten.has(field)) {
                    continue
                }
                const found = db.personas.find((entry) => entry.id === id)
                const holder = found ?? newCopies.map((r) => r.copy).find((copy) => copy.id === id)
                expect(holder?.[field], `${token} for ${field}`).toBe(token)
            }
            pending = new Map()
        }
    })
})
