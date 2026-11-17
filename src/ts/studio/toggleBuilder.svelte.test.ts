import { describe, expect, test, vi } from 'vitest'

const store = vi.hoisted(() => ({ db: {} as Record<string, unknown> }))
vi.mock('../stores.svelte', () => ({
    get DBState() { return store },
}))

import type { StudioRefusal, StudioResult } from './history/ownerHistory.svelte'
import { characterOwnerKey } from './history/ownerPhase'
import type { TogglePortMode, ToggleTextPort } from './edit/toggleTextPort'
import { residentModule, stubModule } from './studioFixtures.test-helpers'
import { appToggleKeys, createToggleBuilder, restoreLines, type BuilderOptions } from './toggleBuilder.svelte'
import { parseDefinition, textOf, type LineId } from './toggleDef'

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
        expect([...appToggleKeys('A')].sort()).toEqual(['mod', 'other', 'stored', 'working'])
    })
})
