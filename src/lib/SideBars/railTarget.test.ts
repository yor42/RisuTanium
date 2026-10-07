import { describe, expect, test } from 'vitest'
import type { folder } from '../../ts/storage/database.svelte'
import { computeLayout, type Layout } from './railLayout'
import { resolveTarget, zoneCandidateAt, type Target } from './railTarget'
import { charKey, contentY, folderKey, memberKey, railItems } from './railTestKit'
import type { ItemRef } from './sidebarOrder'

const folderOf = (id: string, data: string[]): folder => ({ id, name: id, color: '', data }) as folder

function layoutOf(order: Array<string | folder>, open: string[] = []): Layout {
    return computeLayout(railItems(order, { open }), new Map())
}

const ref = {
    char: (id: string, occurrence = 0): ItemRef => ({ kind: 'char', id, occurrence }),
    folder: (id: string, occurrence = 0): ItemRef => ({ kind: 'folder', id, occurrence }),
    member: (folderId: string, id: string, occurrence = 0): ItemRef => ({
        kind: 'member',
        folder: { kind: 'folder', id: folderId, occurrence: 0 },
        id,
        occurrence,
    }),
}

function resolve(
    layout: Layout,
    y: number,
    source: ItemRef,
    extra: { outside?: boolean; zoneKey?: string | null; mergeArmed?: boolean } = {},
): Target {
    return resolveTarget({ layout, y, source, outside: extra.outside ?? false, zoneKey: extra.zoneKey ?? null, mergeArmed: extra.mergeArmed ?? false })
}

const gapAfter = (t: Target): string | null => {
    if (t.kind !== 'gap') {
        throw new Error(`expected a gap, got ${t.kind}`)
    }
    return t.gap.after ? t.gap.after.id : null
}

describe('nearest gap', () => {
    const layout = layoutOf(['A', 'B', 'C', 'D'])

    test('the upper part of a row picks the gap before it and the lower part the gap after it', () => {
        expect(gapAfter(resolve(layout, contentY(layout, charKey('C'), 0.1), ref.char('A')))).toBe('B')
        expect(gapAfter(resolve(layout, contentY(layout, charKey('C'), 0.9), ref.char('A')))).toBe('C')
    })

    test('a position on a gap picks that gap', () => {
        const target = resolve(layout, contentY(layout, charKey('A'), 1.1), ref.char('D'))
        expect(gapAfter(target)).toBe('A')
    })

    test('above the first row picks the first gap and below the last row and over the plus block picks the last gap', () => {
        expect(gapAfter(resolve(layout, -50, ref.char('D')))).toBeNull()
        expect(gapAfter(resolve(layout, layout.total - 5, ref.char('A')))).toBe('D')
        expect(gapAfter(resolve(layout, layout.total + 400, ref.char('A')))).toBe('D')
    })
})

describe('no-op gaps and the dragged row', () => {
    const layout = layoutOf(['A', 'B', 'C'])

    test('the two gaps next to the dragged character are no-ops', () => {
        const before = resolve(layout, contentY(layout, charKey('B'), 0) - 4, ref.char('B'))
        const after = resolve(layout, contentY(layout, charKey('B'), 1) + 4, ref.char('B'))
        expect(before).toMatchObject({ kind: 'gap', noop: true })
        expect(after).toMatchObject({ kind: 'gap', noop: true })
    })

    test('other gaps are not no-ops', () => {
        expect(resolve(layout, contentY(layout, charKey('C'), 1) + 4, ref.char('B'))).toMatchObject({ kind: 'gap', noop: false })
        expect(resolve(layout, 2, ref.char('B'))).toMatchObject({ kind: 'gap', noop: false })
    })

    test('over its own row there is no target', () => {
        for (const f of [0.1, 0.5, 0.9]) {
            expect(resolve(layout, contentY(layout, charKey('B'), f), ref.char('B')).kind).toBe('none')
        }
    })

    test('the gap before the dragged folder, and the gap after it when it is open, are no-ops', () => {
        const open = layoutOf(['A', folderOf('f1', ['B', 'C']), 'D'], ['f1'])
        const src = ref.folder('f1')
        const tail = open.indexByKey.get(JSON.stringify(['e', folderKey('f1')]))!
        const afterGapY = open.offsets[tail + 1] + 3
        expect(resolve(open, afterGapY, src)).toMatchObject({ kind: 'gap', noop: true })
        expect(resolve(open, contentY(open, charKey('A'), 1) + 3, src)).toMatchObject({ kind: 'gap', noop: true })
    })

    test('a member next to its own gaps inside the folder gets no-ops there', () => {
        const open = layoutOf([folderOf('f1', ['B', 'C', 'D'])], ['f1'])
        const src = ref.member('f1', 'C')
        expect(resolve(open, contentY(open, memberKey('f1', 'C'), 0) - 3, src)).toMatchObject({ kind: 'gap', noop: true })
        expect(resolve(open, contentY(open, memberKey('f1', 'C'), 1) + 3, src)).toMatchObject({ kind: 'gap', noop: true })
        expect(resolve(open, contentY(open, memberKey('f1', 'D'), 1) + 3, src)).toMatchObject({ kind: 'gap', noop: false })
    })
})

describe('zones', () => {
    const layout = layoutOf(['A', 'B', folderOf('f1', ['C']), folderOf('f2', ['D'])])
    const centre = (key: string) => contentY(layout, key, 0.5)

    test('a character row centre is a candidate for another character, a folder row centre for a character', () => {
        expect(zoneCandidateAt(layout, centre(charKey('B')), ref.char('A'))).toMatchObject({ key: charKey('B'), closedFolder: false })
        expect(zoneCandidateAt(layout, centre(folderKey('f1')), ref.char('A'))).toMatchObject({ key: folderKey('f1'), closedFolder: true })
    })

    test('the zone edges: inside at the top edge and outside at the bottom edge', () => {
        const i = layout.indexByKey.get(charKey('B'))!
        const top = layout.offsets[i] + layout.heights[i] / 4
        expect(zoneCandidateAt(layout, top, ref.char('A'))).not.toBeNull()
        expect(zoneCandidateAt(layout, top - 0.5, ref.char('A'))).toBeNull()
        const bottom = layout.offsets[i] + (layout.heights[i] * 3) / 4
        expect(zoneCandidateAt(layout, bottom - 0.5, ref.char('A'))).not.toBeNull()
        expect(zoneCandidateAt(layout, bottom, ref.char('A'))).toBeNull()
    })

    test('a dragged folder, the dragged row itself and a member row are never candidates', () => {
        expect(zoneCandidateAt(layout, centre(charKey('A')), ref.folder('f1'))).toBeNull()
        expect(zoneCandidateAt(layout, centre(folderKey('f2')), ref.folder('f1'))).toBeNull()
        expect(zoneCandidateAt(layout, centre(charKey('A')), ref.char('A'))).toBeNull()
        const open = layoutOf([folderOf('f1', ['B', 'C']), 'D'], ['f1'])
        expect(zoneCandidateAt(open, contentY(open, memberKey('f1', 'C')), ref.char('D'))).toBeNull()
    })

    test('a member over its own folder row is not a candidate, but over another folder it is', () => {
        const open = layoutOf([folderOf('f1', ['A', 'B']), folderOf('f2', ['C'])], ['f1'])
        expect(zoneCandidateAt(open, contentY(open, folderKey('f1')), ref.member('f1', 'A'))).toBeNull()
        expect(zoneCandidateAt(open, contentY(open, folderKey('f2')), ref.member('f1', 'A'))).toMatchObject({ key: folderKey('f2') })
    })

    test('an open folder is not closed', () => {
        const open = layoutOf([folderOf('f1', ['C']), 'A'], ['f1'])
        expect(zoneCandidateAt(open, contentY(open, folderKey('f1')), ref.char('A'))?.closedFolder).toBe(false)
    })
})

describe('resolveTarget with an active zone', () => {
    const layout = layoutOf(['A', 'B', 'C', folderOf('f1', ['D']), folderOf('f2', ['E'])])
    const centre = (key: string) => contentY(layout, key, 0.5)

    test('an active folder zone appends at once', () => {
        const t = resolve(layout, centre(folderKey('f1')), ref.char('A'), { zoneKey: folderKey('f1') })
        expect(t).toMatchObject({ kind: 'append', key: folderKey('f1') })
    })

    test('an active character zone merges only once the dwell has armed', () => {
        const y = centre(charKey('B'))
        expect(resolve(layout, y, ref.char('A'), { zoneKey: charKey('B') }).kind).toBe('gap')
        expect(resolve(layout, y, ref.char('A'), { zoneKey: charKey('B'), mergeArmed: true })).toMatchObject({ kind: 'merge', key: charKey('B') })
    })

    test('a zone that is not under the pointer does not apply', () => {
        const y = centre(charKey('C'))
        expect(resolve(layout, y, ref.char('A'), { zoneKey: charKey('B'), mergeArmed: true }).kind).toBe('gap')
    })

    test('a folder source never merges, appends or highlights', () => {
        const t = resolve(layout, centre(charKey('B')), ref.folder('f1'), { zoneKey: charKey('B'), mergeArmed: true })
        expect(t.kind).toBe('gap')
        const t2 = resolve(layout, centre(folderKey('f2')), ref.folder('f1'), { zoneKey: folderKey('f2') })
        expect(t2.kind).toBe('gap')
    })

    test('a member over its own folder row resolves to the nearest gap, never an append', () => {
        const open = layoutOf([folderOf('f1', ['A', 'B'])], ['f1'])
        const t = resolve(open, contentY(open, folderKey('f1')), ref.member('f1', 'A'), { zoneKey: folderKey('f1') })
        expect(t.kind).toBe('gap')
    })

    test('a member row under the pointer is never a merge target', () => {
        const open = layoutOf([folderOf('f1', ['A', 'B']), 'C'], ['f1'])
        const t = resolve(open, contentY(open, memberKey('f1', 'B')), ref.char('C'), { zoneKey: memberKey('f1', 'B'), mergeArmed: true })
        expect(t.kind).toBe('gap')
    })

    test('outside the column there is no target', () => {
        expect(resolve(layout, centre(folderKey('f1')), ref.char('A'), { outside: true, zoneKey: folderKey('f1') }).kind).toBe('none')
    })
})

describe('folder source', () => {
    test('only top-level gaps are offered, even over the members of an open folder', () => {
        const open = layoutOf(['A', folderOf('f1', ['B', 'C']), 'D'], ['f1'])
        const src = ref.folder('f1')
        for (const key of [memberKey('f1', 'B'), memberKey('f1', 'C')]) {
            for (const f of [0.1, 0.5, 0.9]) {
                const t = resolve(open, contentY(open, key, f), ref.folder('f1'))
                expect(t.kind).toBe('gap')
                expect((t as Extract<Target, { kind: 'gap' }>).gap.in).toBe('top')
            }
        }
        expect(resolve(open, contentY(open, charKey('D')), src).kind).toBe('gap')
    })
})
