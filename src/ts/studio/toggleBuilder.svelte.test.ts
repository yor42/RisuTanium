import { afterEach, describe, expect, test, vi } from 'vitest'

const store = vi.hoisted(() => ({ db: {} as Record<string, unknown> }))
vi.mock('../stores.svelte', () => ({
    get DBState() { return store },
}))

import type { StudioRefusal, StudioResult } from './history/ownerHistory.svelte'
import { characterOwnerKey } from './history/ownerPhase'
import type { TogglePortMode, ToggleTextPort } from './edit/toggleTextPort'
import { residentModule, stubModule } from './studioFixtures.test-helpers'
import type { FavouriteRef } from '../chatShell/toggleFavourites'
import { appToggleKeys, createToggleBuilder, restoreLines, type BuilderOptions, type CarryDeps } from './toggleBuilder.svelte'
import { planCarry } from './toggleCarry'
import type { CarryValuePort } from './toggleCarryApply'
import { PENDING_PREFIX, readPending, resetToggleCarrySessionForTests } from './toggleCarryPending'
import { parseDefinition, textOf, type LineId } from './toggleDef'
import { replaceText } from './toggleDefEdit'

// The pending record lives in device storage and a page-lifetime map; a test never inherits another's.
afterEach(() => {
    localStorage.clear()
    resetToggleCarrySessionForTests()
})

interface FakePort extends ToggleTextPort {
    text: string
    readonly writes: { value: string, mode: TogglePortMode }[]
    refuse: StudioRefusal | null
    unavailable: boolean
}

function fakePort(initial: string): FakePort {
    const port: FakePort = {
        owner: characterOwnerKey('A'),
        text: initial,
        writes: [],
        refuse: null,
        unavailable: false,
        begin() {},
        read() { return port.text },
        view() { return { editable: true, banner: null, restricted: false } },
        write(next, mode): StudioResult | null {
            if (port.unavailable) return null
            if (port.refuse !== null) return { ok: false, reason: port.refuse }
            port.writes.push({ value: next, mode })
            port.text = next
            return { ok: true }
        },
        closeOpenStep() {},
    }
    return port
}

const live = (overrides: Partial<BuilderOptions> = {}): BuilderOptions => ({ keyEditsLive: false, stem: 'stem', appKeys: new Set(), ...overrides })
const idOf = (text: string, index: number): LineId => parseDefinition(text).lines[index].id

describe('G-C1 the carry guard while key edits are not live', () => {
    const TEXT = 'a=Mode\nb=Other\n'

    test('a rename of a key present at the start is not written; with key edits live it is', () => {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, live())
        builder.open(idOf(TEXT, 0))
        const outcome = builder.setKey(idOf(TEXT, 0), 'c')
        expect(outcome).toEqual({ ok: false, kind: 'held' })
        expect(port.writes).toEqual([])
        expect(port.text).toBe(TEXT)
        expect(textOf(builder.def)).toBe(TEXT)
        expect(builder.error).toEqual({ ok: false, kind: 'held' })

        const open = fakePort(TEXT)
        const free = createToggleBuilder(open, live({ keyEditsLive: true }))
        free.open(idOf(TEXT, 0))
        expect(free.setKey(idOf(TEXT, 0), 'c').ok).toBe(true)
        expect(open.text).toBe('c=Mode\nb=Other\n')
    })

    test('a label edit of a base row is written; the guard sees no carry item', () => {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, live())
        builder.open(idOf(TEXT, 0))
        expect(builder.setLabel(idOf(TEXT, 0), 'Mode 2').ok).toBe(true)
        expect(port.text).toBe('a=Mode 2\nb=Other\n')
    })

    test('a kind change of a base value row is held: its saved value would be reinterpreted', () => {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, live())
        builder.open(idOf(TEXT, 0))
        expect(builder.changeKind(idOf(TEXT, 0), 'select')).toEqual({ ok: false, kind: 'held' })
        expect(port.writes).toEqual([])
    })

    test('a new row that passes through a deleted visit key while typing is written', () => {
        const port = fakePort('a=Mode\n')
        const builder = createToggleBuilder(port, live())
        expect(builder.deleteRow(idOf('a=Mode\n', 0)).ok).toBe(true)
        builder.startAdd('check', null)
        expect(builder.typePending('Mode').ok).toBe(true)
        const created = builder.editor?.id as LineId
        expect(builder.editor?.origin).toBe('new')
        expect(builder.setKey(created, 'a').ok).toBe(true)
        // Extending the key reads as a rename of the visit key `a` for a base row; for a new row it is typing.
        expect(builder.setKey(created, 'ab').ok).toBe(true)
        expect(port.text).toBe('ab=Mode')
    })

    test('deleting a group that holds two same-name toggles is written', () => {
        const text = 'g=G=group\na=On\nb=On\ng_end=G=groupEnd\n'
        const port = fakePort(text)
        const builder = createToggleBuilder(port, live())
        const outcome = builder.deleteRow(idOf(text, 0))
        expect(outcome.ok).toBe(true)
        expect(port.text).toBe('')
    })
})

describe('G-C4 an outside change under an open editor', () => {
    test('the origin of the open row is derived again from the line now under it', () => {
        const start = 'a=A\n'
        const port = fakePort(start)
        const builder = createToggleBuilder(port, live())
        builder.startAdd('check', null)
        builder.typePending('New')
        expect(port.text).toBe('a=A\nnew=New\n')
        const created = builder.editor?.id as LineId
        expect(builder.editor?.origin).toBe('new')
        // The text outside Studio swaps the two lines: positional ids now put the visit key under the open editor.
        port.text = 'new=New\na=A\n'
        builder.resync(port.text)
        expect(builder.editor?.id).toBe(created)
        expect(builder.editor?.origin).toBe('base')
        const before = port.writes.length
        expect(builder.setKey(created, 'z')).toEqual({ ok: false, kind: 'held' })
        expect(port.writes.length).toBe(before)
        expect(builder.setLabel(created, 'A 2').ok).toBe(true)
    })

    test('a resync takes the live text in and writes nothing', () => {
        const port = fakePort('a=A\n')
        const builder = createToggleBuilder(port, live())
        port.text = 'a=A\nb=B\n'
        builder.resync(port.text)
        expect(textOf(builder.def)).toBe('a=A\nb=B\n')
        expect(port.writes).toEqual([])
        builder.resync(port.text)
        expect(port.writes).toEqual([])
    })

    test('an open row that the outside change removed closes its editor', () => {
        const port = fakePort('a=A\nb=B\n')
        const builder = createToggleBuilder(port, live())
        builder.open(idOf('a=A\nb=B\n', 1))
        port.text = 'a=A\n'
        builder.resync(port.text)
        expect(builder.editor).toBeNull()
    })
})

describe('adding rows', () => {
    test('an unwritten row writes nothing until a first valid name; the key follows the name', () => {
        const port = fakePort('a=A\n')
        const builder = createToggleBuilder(port, live())
        expect(builder.startAdd('check', null).ok).toBe(true)
        expect(builder.pending).toMatchObject({ kind: 'check' })
        expect(builder.typePending('')).toEqual({ ok: true })
        expect(port.writes).toEqual([])
        builder.typePending('Combat mode')
        expect(port.text).toBe('a=A\ncombat_mode=Combat mode\n')
        expect(builder.pending).toBeNull()
        const id = builder.editor?.id as LineId
        builder.setLabel(id, 'Combat style')
        expect(port.text).toBe('a=A\ncombat_style=Combat style\n')
        builder.setKey(id, 'mine')
        builder.setLabel(id, 'Other name')
        expect(port.text).toBe('a=A\nmine=Other name\n')
    })

    test('a suggested key avoids the keys of the other sources and of the text', () => {
        const port = fakePort('combat=X\n')
        const builder = createToggleBuilder(port, live({ appKeys: new Set(['combat_2']) }))
        builder.startAdd('check', null)
        builder.typePending('Combat')
        expect(port.text).toBe('combat=X\ncombat_3=Combat\n')
    })

    test('an addition at the end closes a group left open there, in the same write', () => {
        const port = fakePort('g=G=group\nm=M\n')
        const builder = createToggleBuilder(port, live())
        builder.startAdd('check', null)
        builder.typePending('Combat mode')
        expect(port.writes.length).toBe(1)
        expect(port.text).toBe('g=G=group\nm=M\ng_end=G=groupEnd\ncombat_mode=Combat mode\n')
    })

    test('an addition into a group appends inside it', () => {
        const text = 'g=G=group\nm=M\ng_end=G=groupEnd\nz=Z\n'
        const port = fakePort(text)
        const builder = createToggleBuilder(port, live())
        builder.startAdd('check', idOf(text, 0))
        builder.typePending('Inside')
        expect(port.text).toBe('g=G=group\nm=M\ninside=Inside\ng_end=G=groupEnd\nz=Z\n')
    })

    test('a divider and a group are written at once; a new group takes a placeholder key', () => {
        const port = fakePort('')
        const builder = createToggleBuilder(port, live())
        builder.startAdd('divider', null)
        expect(port.text).toBe('==divider')
        builder.startAdd('group', null)
        expect(port.text).toBe('==divider\nstem_t1==group\nstem_t1_end==groupEnd')
    })

    test('the discrete insert is its own step and typing after it is a typing write', () => {
        const port = fakePort('a=A\n')
        const builder = createToggleBuilder(port, live())
        builder.startAdd('check', null)
        builder.typePending('B')
        builder.setLabel(builder.editor?.id as LineId, 'Bb')
        expect(port.writes.map((write) => write.mode)).toEqual(['single', 'typing'])
    })

    test('a name with the field separator is refused and nothing is written', () => {
        const port = fakePort('')
        const builder = createToggleBuilder(port, live())
        builder.startAdd('check', null)
        const outcome = builder.typePending('a=b')
        expect(outcome).toMatchObject({ ok: false, kind: 'field', refusal: { code: 'fieldHasEquals' } })
        expect(port.writes).toEqual([])
        expect(builder.pending).not.toBeNull()
    })
})

describe('refused and unavailable writes', () => {
    test('a refused write leaves the definition and the text as they were and records the refusal', () => {
        const port = fakePort('a=A\n')
        const builder = createToggleBuilder(port, live())
        port.refuse = 'not-selected'
        builder.open(idOf('a=A\n', 0))
        expect(builder.setLabel(idOf('a=A\n', 0), 'B')).toEqual({ ok: false, kind: 'refused', reason: 'not-selected' })
        expect(textOf(builder.def)).toBe('a=A\n')
        expect(port.text).toBe('a=A\n')
        expect(builder.error).toEqual({ ok: false, kind: 'refused', reason: 'not-selected' })
        port.refuse = null
        expect(builder.setLabel(idOf('a=A\n', 0), 'B').ok).toBe(true)
        expect(builder.error).toBeNull()
    })

    test('no write path is reported as unavailable', () => {
        const port = fakePort('a=A\n')
        port.unavailable = true
        const builder = createToggleBuilder(port, live())
        expect(builder.setLabel(idOf('a=A\n', 0), 'B')).toEqual({ ok: false, kind: 'unavailable' })
    })

    test('a value the format cannot hold is refused before any write', () => {
        const port = fakePort('a=A\n')
        const builder = createToggleBuilder(port, live())
        expect(builder.setLabel(idOf('a=A\n', 0), 'x=y')).toMatchObject({ ok: false, kind: 'field' })
        expect(port.writes).toEqual([])
    })
})

describe('structure edits', () => {
    test('delete removes a group with its members and gives the lines back for Undo', () => {
        const text = 'a=A\ng=G=group\nb=B\nc=C\ng_end=G=groupEnd\nz=Z\n'
        const port = fakePort(text)
        const builder = createToggleBuilder(port, live())
        const outcome = builder.deleteRow(idOf(text, 1))
        expect(port.text).toBe('a=A\nz=Z\n')
        expect(outcome.ok && outcome.removed).toEqual({ index: 1, raws: ['g=G=group', 'b=B', 'c=C', 'g_end=G=groupEnd'], label: 'G' })
        expect(port.writes.map((write) => write.mode)).toEqual(['single'])
    })

    test('Undo puts the removed lines into the current text and keeps a later edit', () => {
        const text = 'a=A\ng=G=group\nb=B\ng_end=G=groupEnd\nz=Z\n'
        const port = fakePort(text)
        const builder = createToggleBuilder(port, live())
        const outcome = builder.deleteRow(idOf(text, 1))
        builder.setLabel(builder.def.lines[1].id, 'ZZ')
        expect(port.text).toBe('a=A\nz=ZZ\n')
        expect(outcome.ok && outcome.removed && restoreLines(port, outcome.removed).ok).toBe(true)
        expect(port.text).toBe('a=A\ng=G=group\nb=B\ng_end=G=groupEnd\nz=ZZ\n')
        expect(port.writes.at(-1)?.mode).toBe('single')
    })

    test('Undo reports a refusal and an unavailable service', () => {
        const port = fakePort('a=A\n')
        const removed = { index: 0, raws: ['b=B'], label: 'B' }
        port.refuse = 'precondition'
        expect(restoreLines(port, removed)).toEqual({ ok: false, kind: 'refused', reason: 'precondition' })
        port.refuse = null
        port.unavailable = true
        expect(restoreLines(port, removed)).toEqual({ ok: false, kind: 'unavailable' })
    })

    test('duplicate copies the row after itself under a new key', () => {
        const port = fakePort('a=A\nb=B\n')
        const builder = createToggleBuilder(port, live())
        expect(builder.duplicate(idOf('a=A\nb=B\n', 0)).ok).toBe(true)
        expect(port.text).toBe('a=A\na_copy=A\nb=B\n')
        expect(builder.editor?.origin).toBe('new')
    })

    test('a move writes one step and reports the new position; the ends refuse', () => {
        const port = fakePort('a=A\nb=B\n')
        const builder = createToggleBuilder(port, live())
        const outcome = builder.move(idOf('a=A\nb=B\n', 0), 'down')
        expect(outcome).toEqual({ ok: true, movedTo: 2 })
        expect(port.text).toBe('b=B\na=A\n')
        expect(builder.move(idOf('a=A\nb=B\n', 0), 'down')).toEqual({ ok: false, kind: 'cantMove' })
        expect(port.writes.length).toBe(1)
    })

    test('a raw edit fixes an unreadable line', () => {
        const port = fakePort('broken\n')
        const builder = createToggleBuilder(port, live())
        builder.open(idOf('broken\n', 0))
        expect(builder.setRawLine(idOf('broken\n', 0), 'k=Fixed').ok).toBe(true)
        expect(port.text).toBe('k=Fixed\n')
    })

    test('a kind change of a new row that drops options says so', () => {
        const port = fakePort('')
        const builder = createToggleBuilder(port, live())
        builder.startAdd('select', null)
        builder.typePending('Pick')
        const id = builder.editor?.id as LineId
        builder.setOptions(id, ['x', 'y'], 'single')
        expect(port.text).toBe('pick=Pick=select=x,y')
        expect(builder.changeKind(id, 'check')).toEqual({ ok: true, optionsDropped: true })
        expect(port.text).toBe('pick=Pick')
    })

    test('collapsing a group is state only and writes nothing', () => {
        const text = 'g=G=group\nm=M\ng_end=G=groupEnd\n'
        const port = fakePort(text)
        const builder = createToggleBuilder(port, live())
        builder.toggleCollapsed(idOf(text, 0))
        expect(builder.rows().map((row) => row.id)).toEqual([0])
        builder.toggleCollapsed(idOf(text, 0))
        expect(builder.rows().length).toBe(2)
        expect(port.writes).toEqual([])
    })

    test('opening a base value row locks its key; a new row is not locked', () => {
        const port = fakePort('a=A\n')
        const builder = createToggleBuilder(port, live())
        builder.open(0 as LineId)
        expect(builder.isLocked(0 as LineId)).toBe(true)
        const free = createToggleBuilder(fakePort('a=A\n'), live({ keyEditsLive: true }))
        free.open(0 as LineId)
        expect(free.isLocked(0 as LineId)).toBe(false)
    })

    test('Undo clamps its place when the live text became shorter than the deleted row index', () => {
        const port = fakePort('a=A\n')
        expect(restoreLines(port, { index: 5, raws: ['b=B'], label: 'B' }).ok).toBe(true)
        expect(port.text).toBe('a=A\nb=B\n')
        const empty = fakePort('')
        expect(restoreLines(empty, { index: 3, raws: ['b=B'], label: 'B' }).ok).toBe(true)
        expect(empty.text).toBe('b=B')
    })

    test('deleting the open row closes the editor, and so does deleting the group that holds it', () => {
        const single = 'a=A\nb=B\n'
        const port = fakePort(single)
        const builder = createToggleBuilder(port, live())
        builder.open(idOf(single, 1))
        expect(builder.deleteRow(idOf(single, 1)).ok).toBe(true)
        expect(builder.editor).toBeNull()
        const text = 'g=G=group\nm=M\ng_end=G=groupEnd\nz=Z\n'
        const grouped = createToggleBuilder(fakePort(text), live())
        grouped.open(idOf(text, 1))
        expect(grouped.deleteRow(idOf(text, 0)).ok).toBe(true)
        expect(grouped.editor).toBeNull()
    })
})

describe('a collapsed group opens for what lands in it', () => {
    const TEXT = 'g=G=group\nm=M\ng_end=G=groupEnd\nz=Z\n'

    test('adding a row into a collapsed group expands it', () => {
        const builder = createToggleBuilder(fakePort(TEXT), live())
        builder.toggleCollapsed(idOf(TEXT, 0))
        expect(builder.collapsed.has(idOf(TEXT, 0))).toBe(true)
        builder.startAdd('check', idOf(TEXT, 0))
        builder.typePending('Inside')
        expect(builder.collapsed.has(idOf(TEXT, 0))).toBe(false)
    })

    test('moving a row into a collapsed group expands it', () => {
        const builder = createToggleBuilder(fakePort(TEXT), live({ keyEditsLive: true }))
        builder.toggleCollapsed(idOf(TEXT, 0))
        expect(builder.moveToGroup(idOf(TEXT, 3), idOf(TEXT, 0)).ok).toBe(true)
        expect(builder.collapsed.has(idOf(TEXT, 0))).toBe(false)
    })
})

interface CarryRig {
    readonly stored: Record<string, string>
    readonly stars: FavouriteRef[]
    readonly deps: CarryDeps
    readonly marks: { count: number }
}

// The global value as the only place, and a favourites list; both are read live like the app's own.
function carryRig(initial: Record<string, string> = {}, stars: FavouriteRef[] = []): CarryRig {
    const stored: Record<string, string> = { ...initial }
    const marks = { count: 0 }
    const values: CarryValuePort = {
        read: (ref, key) => (ref.kind === 'global' ? stored[key] : 'gone'),
        write: (_ref, key, value) => {
            if (value === undefined) {
                delete stored[key]
            } else {
                stored[key] = value
            }
        },
        mark: () => { marks.count += 1 },
    }
    const deps: CarryDeps = {
        reach: () => ({ places: [{ ref: { kind: 'global' }, entries: stored }], others: [] }),
        values,
        starSource: 'character:A',
        stars: {
            has: (ref) => stars.some((known) => known.s === ref.s && known.k === ref.k),
            rename: (ref, to) => {
                const at = stars.findIndex((known) => known.s === ref.s && known.k === ref.k)
                if (at >= 0) {
                    stars[at] = { s: ref.s, k: to }
                }
            },
        },
        reachKind: 'own',
    }
    return { stored, stars, deps, marks }
}

const liveCarry = (rig: CarryRig, overrides: Partial<BuilderOptions> = {}): BuilderOptions => live({ keyEditsLive: true, carry: rig.deps, ...overrides })
const OWNER = characterOwnerKey('A')

describe('F-O3 a key the list created is never a rename target', () => {
    const TEXT = 'a=Mode\nb=B\n'

    test('(i) delete a, add a row named Mode through the list: no question; the same pair after a resync or a text write asks the rename', () => {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, liveCarry(carryRig()))
        expect(builder.deleteRow(idOf(TEXT, 0)).ok).toBe(true)
        builder.startAdd('check', null)
        builder.typePending('M')
        const id = builder.editor?.id as LineId
        builder.setLabel(id, 'Mode')
        expect(port.text).not.toMatch(/^a=/m)
        expect(port.text).toContain('mode=Mode')
        builder.checkpoint()
        expect(builder.question).toBeNull()
        expect(planCarry(parseDefinition(TEXT), builder.def, new Set(['mode']))).toEqual([])

        port.text = `${port.text}c=C\n`
        builder.resync(port.text)
        builder.checkpoint()
        expect(builder.question?.lines).toEqual([{ kind: 'key', from: 'a', to: 'mode' }])
    })

    test('(i) the same pair asks the rename after a text-view write', () => {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, liveCarry(carryRig()))
        builder.deleteRow(idOf(TEXT, 0))
        builder.startAdd('check', null)
        builder.typePending('M')
        builder.setLabel(builder.editor?.id as LineId, 'Mode')
        expect(builder.writeText(replaceText(builder.def, port.text.replace('b=B', 'b=Bee')))).toBeNull()
        builder.checkpoint()
        expect(builder.question?.lines).toEqual([{ kind: 'key', from: 'a', to: 'mode' }])
    })

    test('(ii) a duplicate of a, then a deleted: no question', () => {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, liveCarry(carryRig()))
        expect(builder.duplicate(idOf(TEXT, 0)).ok).toBe(true)
        expect(port.text).toContain('a_copy=Mode')
        expect(builder.deleteRow(idOf(TEXT, 0)).ok).toBe(true)
        builder.checkpoint()
        expect(builder.question).toBeNull()
        expect(planCarry(parseDefinition(TEXT), builder.def, new Set(['a_copy']))).toEqual([])
    })
})

describe('F-12 the origin of a list row ends with a text-view write or a resync', () => {
    const TEXT = 'a=Mode\n'

    test('F-12t a text-view write that deletes the list row and rekeys a asks the rename', () => {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, liveCarry(carryRig()))
        builder.startAdd('check', null)
        builder.typePending('b')
        expect(port.text).toBe('a=Mode\nb=b\n')
        expect(builder.writeText(replaceText(builder.def, 'b=Mode\n'))).toBeNull()
        builder.checkpoint()
        expect(builder.question?.lines).toEqual([{ kind: 'key', from: 'a', to: 'b' }])
    })

    test('F-12r a resync that deletes the list row and rekeys a asks the rename', () => {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, liveCarry(carryRig()))
        builder.startAdd('check', null)
        builder.typePending('b')
        port.text = 'b=Mode\n'
        builder.resync(port.text)
        builder.checkpoint()
        expect(builder.question?.lines).toEqual([{ kind: 'key', from: 'a', to: 'b' }])
    })
})

describe('F-H1 the text-write entry holds a visit-key rename while key edits are not live', () => {
    test('a rename is held with no write; another edit writes once', () => {
        const port = fakePort('a=A\nb=B\n')
        const builder = createToggleBuilder(port, live())
        expect(builder.writeText(replaceText(builder.def, 'z=A\nb=B\n'))).toEqual({ ok: false, kind: 'held' })
        expect(port.writes).toEqual([])
        expect(builder.writeText(replaceText(builder.def, 'a=A\nb=Bee\n'))).toBeNull()
        expect(port.writes.length).toBe(1)
    })
})

describe('F-E1t the record follows every landed definition write', () => {
    test('one text-view write, no checkpoint: a new instance on the same storage asks', () => {
        const port = fakePort('a=A\nb=B\n')
        const first = createToggleBuilder(port, liveCarry(carryRig()))
        expect(first.writeText(replaceText(first.def, 'z=A\nb=B\n'))).toBeNull()
        expect(first.question).toBeNull()
        const second = createToggleBuilder(port, liveCarry(carryRig()))
        expect(second.question?.lines).toEqual([{ kind: 'key', from: 'a', to: 'z' }])
    })

    test('a not-editable owner stores nothing', () => {
        const port = fakePort('a=A\nb=B\n')
        port.view = () => ({ editable: false, banner: null, restricted: false })
        const builder = createToggleBuilder(port, liveCarry(carryRig()))
        expect(builder.writeText(replaceText(builder.def, 'z=A\nb=B\n'))).toBeNull()
        expect(readPending(OWNER).status).toBe('absent')
    })

    test('an empty-plan record is cleared when the builder ends', () => {
        const port = fakePort('a=A\nb=B\n')
        const builder = createToggleBuilder(port, liveCarry(carryRig()))
        builder.open(idOf('a=A\nb=B\n', 0))
        builder.setLabel(idOf('a=A\nb=B\n', 0), 'A2')
        expect(readPending(OWNER).status).toBe('ok')
        builder.dispose()
        expect(readPending(OWNER).status).toBe('absent')
    })

    test('a record whose plan is still asking survives the end of the builder', () => {
        const port = fakePort('a=A\nb=B\n')
        const builder = createToggleBuilder(port, liveCarry(carryRig()))
        builder.writeText(replaceText(builder.def, 'z=A\nb=B\n'))
        builder.dispose()
        expect(readPending(OWNER).status).toBe('ok')
    })
})

describe('the carry, its answers and its undo', () => {
    const TEXT = 'a=Mode\nb=B\n'

    function renamed(rig: CarryRig) {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, liveCarry(rig))
        builder.open(idOf(TEXT, 0))
        expect(builder.setKey(idOf(TEXT, 0), 'c').ok).toBe(true)
        builder.checkpoint()
        return { port, builder }
    }

    test('Carry copies the value, moves the star, answers the question and clears the record; Undo reverses all of it and reopens the question for this page only', () => {
        const rig = carryRig({ toggle_a: '1' }, [{ s: 'character:A', k: 'a' }])
        const { builder } = renamed(rig)
        expect(builder.question?.carryable).toBe(true)
        expect(builder.carryEvent?.kind).toBe('shown')
        const outcome = builder.carryValues()
        expect(outcome.ok).toBe(true)
        expect(rig.stored).toEqual({ toggle_a: '1', toggle_c: '1' })
        expect(rig.stars).toEqual([{ s: 'character:A', k: 'c' }])
        expect(builder.question).toBeNull()
        expect(builder.carried).toBe(true)
        expect(readPending(OWNER).status).toBe('absent')

        expect(builder.undoCarry().ok).toBe(true)
        expect(rig.stored).toEqual({ toggle_a: '1' })
        expect(rig.stars).toEqual([{ s: 'character:A', k: 'a' }])
        expect(builder.question?.lines).toEqual([{ kind: 'key', from: 'a', to: 'c' }])
        expect(builder.carryNotKept).toBe(true)
        expect(localStorage.getItem(PENDING_PREFIX + OWNER)).toBeNull()
        expect(readPending(OWNER)).toEqual({ status: 'ok', baseline: TEXT, kept: 'session' })
    })

    test('F-C an Undo after the rename was undone outside reopens nothing', () => {
        const rig = carryRig({ toggle_a: '1' })
        const { builder, port } = renamed(rig)
        expect(builder.carryValues().ok).toBe(true)
        port.text = TEXT
        builder.resync(port.text)
        expect(builder.undoCarry().ok).toBe(true)
        expect(rig.stored).toEqual({ toggle_a: '1' })
        expect(builder.question).toBeNull()
        expect(readPending(OWNER).status).toBe('absent')
    })

    test('a value that changed after the question was shown is a recheck and writes nothing', () => {
        const rig = carryRig({ toggle_a: '1' })
        const { builder } = renamed(rig)
        rig.stored.toggle_c = '9'
        expect(builder.carryValues()).toEqual({ ok: false, reason: 'stale' })
        expect(rig.stored).toEqual({ toggle_a: '1', toggle_c: '9' })
        expect(builder.carryEvent?.kind).toBe('recheck')
        expect(builder.question?.planned.notice.overwrite).toEqual(['c'])
        expect(builder.carryValues().ok).toBe(true)
        expect(rig.stored.toggle_c).toBe('1')
    })

    test('Leave takes the text as the new baseline: nothing is written and a later rename asks again', () => {
        const rig = carryRig({ toggle_a: '1' })
        const { builder } = renamed(rig)
        builder.answerCarry()
        expect(rig.stored).toEqual({ toggle_a: '1' })
        expect(builder.question).toBeNull()
        expect(readPending(OWNER).status).toBe('absent')
        builder.setKey(idOf(TEXT, 0), 'd')
        builder.checkpoint()
        expect(builder.question?.lines).toEqual([{ kind: 'key', from: 'c', to: 'd' }])
    })

    test('typing the old key back cancels the question, clears the record and announces', () => {
        const rig = carryRig({ toggle_a: '1' })
        const { builder } = renamed(rig)
        builder.setKey(idOf(TEXT, 0), 'a')
        expect(builder.question).toBeNull()
        expect(builder.carryEvent?.kind).toBe('cancelled')
        expect(readPending(OWNER).status).toBe('absent')
    })

    test('F-V1 an Undo of a carry that belongs to an ended builder or to an earlier carry is gone and writes nothing', () => {
        const rig = carryRig({ toggle_a: '1' })
        const { builder } = renamed(rig)
        const first = builder.carryValues()
        expect(first.ok).toBe(true)
        expect(builder.undoCarry(999)).toEqual({ ok: false, reason: 'gone' })
        expect(rig.stored.toggle_c).toBe('1')
        builder.dispose()
        expect(builder.undoCarry()).toEqual({ ok: false, reason: 'gone' })
        expect(rig.stored.toggle_c).toBe('1')
    })

    test('an Undo that finds a changed value is refused and writes nothing', () => {
        const rig = carryRig({ toggle_a: '1' })
        const { builder } = renamed(rig)
        builder.carryValues()
        rig.stored.toggle_c = '5'
        expect(builder.undoCarry()).toEqual({ ok: false, reason: 'changed' })
        expect(rig.stored.toggle_c).toBe('5')
    })

    test('a failing write rolls back and keeps the question', () => {
        const rig = carryRig({ toggle_a: '1' })
        const throwing: CarryDeps = { ...rig.deps, values: { ...rig.deps.values, write: () => { throw new Error('write failed') } } }
        const failing = createToggleBuilder(fakePort(TEXT), live({ keyEditsLive: true, carry: throwing }))
        failing.setKey(idOf(TEXT, 0), 'c')
        failing.checkpoint()
        expect(failing.carryValues()).toEqual({ ok: false, reason: 'failed' })
        expect(failing.question).not.toBeNull()
        expect(rig.stored).toEqual({ toggle_a: '1' })
    })
})

describe('the renames the uses list reads (B1, B2)', () => {
    const TEXT = 'a=Mode\nb=B\n'

    function renamed(rig: CarryRig) {
        const builder = createToggleBuilder(fakePort(TEXT), liveCarry(rig))
        builder.open(idOf(TEXT, 0))
        expect(builder.setKey(idOf(TEXT, 0), 'c').ok).toBe(true)
        builder.checkpoint()
        return builder
    }

    test('B1 the question holds every rename, a late line included', () => {
        const builder = renamed(carryRig({ toggle_a: '1' }))
        expect(builder.question?.renames).toEqual([{ from: 'a', to: 'c' }])
        expect(builder.usesRenames).toEqual([{ from: 'a', to: 'c' }])
        expect(builder.usesKept).toBe(false)

        const rig = carryRig({ toggle_s: '0' })
        const port = fakePort('s=S=select=x,y\n')
        const first = createToggleBuilder(port, liveCarry(rig))
        const id = first.def.lines[0].id
        first.open(id)
        first.setOptions(id, ['y', 'x'], 'single')
        first.dispose()
        const second = createToggleBuilder(port, liveCarry(rig))
        second.open(second.def.lines[0].id)
        second.setKey(second.def.lines[0].id, 'd')
        second.checkpoint()
        expect(second.question?.lines).toEqual([{ kind: 'late', key: 's', now: 'd' }])
        expect(second.usesRenames).toEqual([{ from: 's', to: 'd' }])
    })

    test('B2 Carry keeps the renames for the list and Close clears them', () => {
        const carried = renamed(carryRig({ toggle_a: '1' }))
        expect(carried.carryValues().ok).toBe(true)
        expect(carried.question).toBeNull()
        expect(carried.usesRenames).toEqual([{ from: 'a', to: 'c' }])
        expect(carried.usesKept).toBe(true)
        carried.dismissUses()
        expect(carried.usesRenames).toEqual([])
        expect(carried.usesKept).toBe(false)
    })

    test('B2 Leave keeps the renames; a new question replaces them, and the old ones do not return when it is cancelled', () => {
        const left = renamed(carryRig({ toggle_a: '1' }))
        left.answerCarry()
        expect(left.usesRenames).toEqual([{ from: 'a', to: 'c' }])
        expect(left.usesKept).toBe(true)
        left.setKey(idOf(TEXT, 0), 'd')
        left.checkpoint()
        expect(left.usesRenames).toEqual([{ from: 'c', to: 'd' }])
        expect(left.usesKept).toBe(false)
        left.setKey(idOf(TEXT, 0), 'c')
        left.checkpoint()
        expect(left.question).toBeNull()
        expect(left.usesRenames).toEqual([])
    })

    test('B2 an update clears the kept renames', () => {
        const updated = renamed(carryRig({ toggle_a: '1' }))
        updated.answerCarry()
        expect(updated.usesRenames).toEqual([{ from: 'a', to: 'c' }])
        updated.noteUpdated()
        expect(updated.usesRenames).toEqual([])
    })

    test('B2 the end of the visit clears the kept renames', () => {
        const ended = renamed(carryRig({ toggle_a: '1' }))
        ended.answerCarry()
        expect(ended.usesRenames).toEqual([{ from: 'a', to: 'c' }])
        ended.dispose()
        expect(ended.usesRenames).toEqual([])
    })

    test('B2 an Undo that reopens nothing leaves no kept renames behind', () => {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, liveCarry(carryRig({ toggle_a: '1' })))
        builder.open(idOf(TEXT, 0))
        expect(builder.setKey(idOf(TEXT, 0), 'c').ok).toBe(true)
        builder.checkpoint()
        expect(builder.carryValues().ok).toBe(true)
        port.text = TEXT
        builder.resync(port.text)
        expect(builder.undoCarry().ok).toBe(true)
        expect(builder.question).toBeNull()
        expect(builder.usesRenames).toEqual([])
        expect(builder.usesKept).toBe(false)
    })

    test('B1 a question with two renames holds both, in order, and the kept list holds both after Leave', () => {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, liveCarry(carryRig({ toggle_a: '1', toggle_b: '2' })))
        builder.open(idOf(TEXT, 0))
        expect(builder.setKey(idOf(TEXT, 0), 'c').ok).toBe(true)
        builder.open(idOf(TEXT, 1))
        expect(builder.setKey(idOf(TEXT, 1), 'd').ok).toBe(true)
        builder.checkpoint()
        expect(builder.usesRenames).toEqual([{ from: 'a', to: 'c' }, { from: 'b', to: 'd' }])
        builder.answerCarry()
        expect(builder.usesRenames).toEqual([{ from: 'a', to: 'c' }, { from: 'b', to: 'd' }])
    })

    test('O-P2 a kept rename that a resync reverts is dropped, and stays dropped when the rename is made again', () => {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, liveCarry(carryRig({ toggle_a: '1' })))
        builder.open(idOf(TEXT, 0))
        expect(builder.setKey(idOf(TEXT, 0), 'c').ok).toBe(true)
        builder.checkpoint()
        builder.answerCarry()
        expect(builder.usesRenames).toEqual([{ from: 'a', to: 'c' }])
        const renamedText = port.text
        port.text = TEXT
        builder.resync(port.text)
        expect(builder.usesRenames).toEqual([])
        expect(builder.usesKept).toBe(false)
        port.text = renamedText
        builder.resync(port.text)
        expect(builder.usesRenames).toEqual([])
        expect(builder.usesKept).toBe(false)
    })

    test('O-P2 a kept rename whose old key a resync defines again is dropped while its new key stays defined', () => {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, liveCarry(carryRig({ toggle_a: '1' })))
        builder.open(idOf(TEXT, 0))
        expect(builder.setKey(idOf(TEXT, 0), 'c').ok).toBe(true)
        builder.checkpoint()
        builder.answerCarry()
        port.text = 'c=Mode\na=New\nb=B\n'
        builder.resync(port.text)
        expect(builder.usesRenames).toEqual([])
    })

    test('O-P2 a key edit after Leave that moves the new key away ends the kept list at once, without a resync', () => {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, liveCarry(carryRig({ toggle_a: '1' })))
        builder.open(idOf(TEXT, 0))
        expect(builder.setKey(idOf(TEXT, 0), 'c').ok).toBe(true)
        builder.checkpoint()
        builder.answerCarry()
        expect(builder.usesKept).toBe(true)
        expect(builder.setKey(idOf(TEXT, 0), 'e').ok).toBe(true)
        expect(builder.usesRenames).toEqual([])
        expect(builder.usesKept).toBe(false)
    })

    test('O-P2 a kept rename whose target key a resync removes is dropped', () => {
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, liveCarry(carryRig({ toggle_a: '1' })))
        builder.open(idOf(TEXT, 0))
        expect(builder.setKey(idOf(TEXT, 0), 'c').ok).toBe(true)
        builder.checkpoint()
        builder.answerCarry()
        port.text = 'z=Z\nb=B\n'
        builder.resync(port.text)
        expect(builder.usesRenames).toEqual([])
    })

    test('B2 an Undo of the carry drops the kept renames and the reopened question supplies its own', () => {
        const builder = renamed(carryRig({ toggle_a: '1' }))
        expect(builder.carryValues().ok).toBe(true)
        expect(builder.undoCarry().ok).toBe(true)
        expect(builder.usesKept).toBe(false)
        expect(builder.usesRenames).toEqual([{ from: 'a', to: 'c' }])
    })
})

describe('F-N1 a renumbering seen in an earlier visit is not carried', () => {
    const TEXT = 'p=Pick=select=x,y\n'

    test('a reorder offers Carry; after a remount the same reorder offers OK only and writes nothing', () => {
        const rig = carryRig({ toggle_p: '0' })
        const port = fakePort(TEXT)
        const first = createToggleBuilder(port, liveCarry(rig))
        first.open(idOf(TEXT, 0))
        first.setOptions(idOf(TEXT, 0), ['y', 'x'], 'single')
        expect(first.question?.carryable).toBe(true)
        first.dispose()
        const second = createToggleBuilder(port, liveCarry(rig))
        expect(second.question?.lines).toEqual([{ kind: 'late', key: 'p', now: null }])
        expect(second.question?.carryable).toBe(false)
        expect(second.question?.planned.writes).toEqual([])
        expect(second.carryValues()).toEqual({ ok: false, reason: 'unavailable' })
        expect(rig.stored).toEqual({ toggle_p: '0' })
    })
})

describe('F-N1 the window: where the start text is set, reset and restored', () => {
    const SELECT = 's=S=select=x,y\n'
    const MIXED = 's=S=select=x,y\nt=T\n'

    // A first visit reorders the options of `s` and ends with its record kept; the returned instance is a later visit.
    function laterVisit(text: string, rig: CarryRig) {
        const port = fakePort(text)
        const first = createToggleBuilder(port, liveCarry(rig))
        const id = first.def.lines[0].id
        first.open(id)
        first.setOptions(id, ['y', 'x'], 'single')
        first.dispose()
        return { port, second: createToggleBuilder(port, liveCarry(rig)) }
    }

    // One instance renames `s` to `d` and reorders its options in the same window.
    function renameAndReorder(rig: CarryRig) {
        const port = fakePort(SELECT)
        const builder = createToggleBuilder(port, liveCarry(rig))
        const id = builder.def.lines[0].id
        builder.open(id)
        builder.setKey(id, 'd')
        builder.setOptions(id, ['y', 'x'], 'single')
        builder.checkpoint()
        return { port, builder, id }
    }

    test('F-N1(1)(2) the rename of a late key is OK only and writes nothing, on the visit and on a second remount', () => {
        const rig = carryRig({ toggle_s: '0' })
        const { port, second } = laterVisit(SELECT, rig)
        const id = second.def.lines[0].id
        second.open(id)
        expect(second.setKey(id, 'd').ok).toBe(true)
        second.checkpoint()
        expect(second.question?.lines).toEqual([{ kind: 'late', key: 's', now: 'd' }])
        expect(second.question?.carryable).toBe(false)
        expect(second.question?.planned.writes).toEqual([])
        expect(second.carryValues()).toEqual({ ok: false, reason: 'unavailable' })
        expect(rig.stored).toEqual({ toggle_s: '0' })
        second.dispose()

        const third = createToggleBuilder(port, liveCarry(rig))
        expect(third.question?.lines).toEqual([{ kind: 'late', key: 's', now: 'd' }])
        expect(third.question?.carryable).toBe(false)
        expect(third.question?.planned.writes).toEqual([])
        expect(rig.stored).toEqual({ toggle_s: '0' })
    })

    test('F-N1(4) one late key does not make the other items late, and Undo keeps the late key late', () => {
        const rig = carryRig({ toggle_s: '0', toggle_t: '1' })
        const { second } = laterVisit(MIXED, rig)
        const t = second.def.lines[1].id
        second.open(t)
        second.setKey(t, 'u')
        second.checkpoint()
        const lines = second.question?.lines ?? []
        expect(lines).toHaveLength(2)
        expect(lines).toContainEqual({ kind: 'late', key: 's', now: null })
        expect(lines).toContainEqual({ kind: 'key', from: 't', to: 'u' })
        expect(second.question?.carryable).toBe(true)
        expect(second.carryValues().ok).toBe(true)
        expect(rig.stored).toEqual({ toggle_s: '0', toggle_t: '1', toggle_u: '1' })

        expect(second.undoCarry().ok).toBe(true)
        expect(rig.stored).toEqual({ toggle_s: '0', toggle_t: '1' })
        const reopened = second.question?.lines ?? []
        expect(reopened).toHaveLength(2)
        expect(reopened).toContainEqual({ kind: 'late', key: 's', now: null })
        expect(reopened).toContainEqual({ kind: 'key', from: 't', to: 'u' })
        expect(second.question?.carryable).toBe(true)
    })

    test('F-N1(5) a rename and a reorder made in one window carry the renumbered value; Undo offers the same carry again', () => {
        const rig = carryRig({ toggle_s: '0' })
        const { builder } = renameAndReorder(rig)
        expect(builder.question?.carryable).toBe(true)
        expect(builder.carryValues().ok).toBe(true)
        expect(rig.stored).toEqual({ toggle_s: '0', toggle_d: '1' })

        expect(builder.undoCarry().ok).toBe(true)
        expect(rig.stored).toEqual({ toggle_s: '0' })
        expect(builder.question?.carryable).toBe(true)
        expect(builder.question?.lines.some((line) => line.kind === 'late')).toBe(false)
    })

    test('F-N1(5) after a Carry the next reorder in the same instance is made in a fresh window and offers Carry', () => {
        const rig = carryRig({ toggle_s: '0' })
        const { builder, id } = renameAndReorder(rig)
        expect(builder.carryValues().ok).toBe(true)
        builder.setOptions(id, ['x', 'y'], 'single')
        builder.checkpoint()
        expect(builder.question?.lines).toEqual([{ kind: 'options', key: 'd' }])
        expect(builder.question?.carryable).toBe(true)
        expect(builder.carryValues().ok).toBe(true)
        expect(rig.stored).toEqual({ toggle_s: '0', toggle_d: '0' })
    })

    test('F-N1(5) after Leave the next reorder in the same instance is made in a fresh window and offers Carry', () => {
        const rig = carryRig({ toggle_s: '0' })
        const { builder, id } = renameAndReorder(rig)
        builder.answerCarry()
        expect(rig.stored).toEqual({ toggle_s: '0' })
        builder.setOptions(id, ['x', 'y'], 'single')
        builder.checkpoint()
        expect(builder.question?.lines).toEqual([{ kind: 'options', key: 'd' }])
        expect(builder.question?.carryable).toBe(true)
    })

    test('F-N1(6) a cancelled question starts a fresh window: the next reorder offers Carry', () => {
        const rig = carryRig({ toggle_s: '0' })
        const { second } = laterVisit(SELECT, rig)
        const id = second.def.lines[0].id
        second.open(id)
        expect(second.question?.carryable).toBe(false)
        second.setOptions(id, ['x', 'y'], 'single')
        expect(second.question).toBeNull()
        expect(second.carryEvent?.kind).toBe('cancelled')
        second.setOptions(id, ['y', 'x'], 'single')
        second.checkpoint()
        expect(second.question?.lines).toEqual([{ kind: 'options', key: 's' }])
        expect(second.question?.carryable).toBe(true)
    })

    test('F-N1(7) a record that could not be cleared leaves the carried text late for the next visit and its values untouched', () => {
        const rig = carryRig({ toggle_s: '0' })
        const port = fakePort(SELECT)
        const first = createToggleBuilder(port, liveCarry(rig))
        const id = first.def.lines[0].id
        first.open(id)
        first.setOptions(id, ['y', 'x'], 'single')
        first.checkpoint()
        const removal = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw new Error('storage failed') })
        try {
            expect(first.carryValues().ok).toBe(true)
        } finally {
            removal.mockRestore()
        }
        expect(rig.stored).toEqual({ toggle_s: '1' })
        expect(readPending(OWNER).status).toBe('ok')

        const next = createToggleBuilder(port, liveCarry(rig))
        expect(next.question?.lines).toEqual([{ kind: 'late', key: 's', now: null }])
        expect(next.question?.carryable).toBe(false)
        expect(next.carryValues()).toEqual({ ok: false, reason: 'unavailable' })
        expect(rig.stored).toEqual({ toggle_s: '1' })
    })
})

describe('F-C an Undo whose restored plan is empty starts a window on the current text', () => {
    test('a later rename is asked against the text the Undo found, not the old baseline', () => {
        const TEXT = 'a=Mode\nb=B\n'
        const rig = carryRig({ toggle_a: '1' })
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, liveCarry(rig))
        const first = idOf(TEXT, 0)
        builder.open(first)
        builder.setKey(first, 'c')
        builder.checkpoint()
        expect(builder.carryValues().ok).toBe(true)
        port.text = 'a=Mode2\nb=B\n'
        builder.resync(port.text)
        expect(builder.undoCarry().ok).toBe(true)
        expect(builder.question).toBeNull()

        const id = builder.def.lines[0].id
        builder.open(id)
        builder.setKey(id, 'e')
        builder.checkpoint()
        expect(builder.question?.lines).toEqual([{ kind: 'key', from: 'a', to: 'e' }])
    })
})

describe('F-O2 an Undo keeps its reopened question for the page', () => {
    test('a new instance on the same page asks the same question and says it is not kept', () => {
        const TEXT = 'a=Mode\nb=B\n'
        const rig = carryRig({ toggle_a: '1' })
        const port = fakePort(TEXT)
        const builder = createToggleBuilder(port, liveCarry(rig))
        builder.open(idOf(TEXT, 0))
        builder.setKey(idOf(TEXT, 0), 'c')
        builder.checkpoint()
        expect(builder.carryValues().ok).toBe(true)
        expect(builder.undoCarry().ok).toBe(true)
        builder.dispose()

        const again = createToggleBuilder(port, liveCarry(rig))
        expect(again.question?.lines).toEqual([{ kind: 'key', from: 'a', to: 'c' }])
        expect(again.carryNotKept).toBe(true)
    })
})

describe('G-C4 a new row stops following its name after an outside change', () => {
    test('the key of a row added before the change is not rebuilt from a later label', () => {
        const port = fakePort('a=A\n')
        const builder = createToggleBuilder(port, live())
        builder.startAdd('check', null)
        builder.typePending('Combat')
        const id = builder.editor?.id as LineId
        port.text = 'a=A\ncombat=Combat\nz=Z\n'
        builder.resync(port.text)
        builder.setLabel(id, 'Fight')
        expect(port.text).toBe('a=A\ncombat=Fight\nz=Z\n')
    })
})

describe('mounting writes nothing', () => {
    test('creating a builder over any text never writes', () => {
        const port = fakePort('a=A\r\nbroken\r\n\r\ng=G=group\r\n')
        createToggleBuilder(port, live())
        expect(port.writes).toEqual([])
    })
})

describe('appToggleKeys', () => {
    test('reads the keys of the other characters, resident modules and working presets, and skips stubs and the open character', () => {
        store.db = {
            characters: [
                { chaId: 'A', type: 'character', customModuleToggle: 'own=Own' },
                { chaId: 'B', type: 'character', customModuleToggle: 'other=Other' },
                { chaId: 'G', type: 'group' },
            ],
            modules: [residentModule('r', { customModuleToggle: 'mod=Mod' }), stubModule('s')],
            botPresets: [{ customPromptTemplateToggle: 'stored=S' }, { customPromptTemplateToggle: 'old=O' }],
            botPresetsId: 1,
            customPromptTemplateToggle: 'working=W',
        }
        expect([...appToggleKeys({ kind: 'character', chaId: 'A' })].sort()).toEqual(['mod', 'other', 'stored', 'working'])
    })

    test('K-M for a module it holds the other modules and the characters, and none of the module\'s own keys', () => {
        store.db = {
            characters: [{ chaId: 'A', type: 'character', customModuleToggle: 'ch=Char' }],
            modules: [residentModule('M1', { customModuleToggle: 'own=Own' }), residentModule('M2', { customModuleToggle: 'other=Other' }), stubModule('s')],
            botPresets: [],
            botPresetsId: -1,
            customPromptTemplateToggle: '',
        }
        expect([...appToggleKeys({ kind: 'module', moduleId: 'M1' })].sort()).toEqual(['ch', 'other'])
        expect([...appToggleKeys({ kind: 'character', chaId: 'A' })].sort()).toEqual(['other', 'own'])
    })})
