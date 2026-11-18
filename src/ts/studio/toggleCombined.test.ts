import { describe, expect, test } from 'vitest'

import type { OwnerTag } from './ownerModel'
import { buildToggleCombined, type CombinedSourceInput } from './toggleCombined'

/**
 * The combined toggles model over literal toggle texts as the producers write them. Every case is a new-behaviour guard
 * (class G): the module is new, so its red proof is the named mutant, not a run on the unchanged base.
 */

const source = (ownerKey: string, text: string | null, tags: readonly OwnerTag[] = []): CombinedSourceInput =>
    ({ ownerKey, name: `name ${ownerKey}`, tags, text })
const none = new Map<string, readonly string[]>()

describe('CB-1 lists', () => {
    test('active sources keep the input order and off sources stay apart', () => {
        const combined = buildToggleCombined(
            [source('preset:0', 'a=A'), source('module:m', 'b=B'), source('character:c', 'c=C')],
            [source('module:off1', 'd=D'), source('module:off2', 'e=E')],
            none,
        )
        expect(combined.active.map((entry) => entry.ownerKey)).toStrictEqual(['preset:0', 'module:m', 'character:c'])
        expect(combined.off.map((entry) => entry.ownerKey)).toStrictEqual(['module:off1', 'module:off2'])
        expect(combined.unshown).toBe(0)
    })

    test('an active source without text is listed nowhere and counts as unshown; an off one is omitted and not counted', () => {
        const combined = buildToggleCombined(
            [source('module:stub', null, ['notLoaded']), source('character:c', 'c=C'), source('character:p', null, ['private'])],
            [source('module:offStub', null), source('module:off', 'd=D')],
            none,
        )
        expect(combined.active.map((entry) => entry.ownerKey)).toStrictEqual(['character:c'])
        expect(combined.off.map((entry) => entry.ownerKey)).toStrictEqual(['module:off'])
        expect(combined.unshown).toBe(2)
    })

    test('an off source without text alone leaves unshown at zero', () => {
        expect(buildToggleCombined([], [source('module:offStub', null)], none)).toStrictEqual({ active: [], off: [], unshown: 0 })
    })

    test('entries are the value rows in line order with their line, label, kind and holding group', () => {
        const text = ['top=Top', '', 'bad', 'g=Group A=group', 'in=Inside=select=x,y', '=note=caption', 'g_end=x=groupEnd', 'after=After=textarea'].join('\n')
        const [read] = buildToggleCombined([source('character:c', text, ['private'])], [], none).active
        expect(read.tags).toStrictEqual(['private'])
        expect(read.entries).toStrictEqual([
            { line: 0, key: 'top', label: 'Top', valueKind: 'check', group: null, shared: [] },
            { line: 4, key: 'in', label: 'Inside', valueKind: 'select', group: 'Group A', shared: [] },
            { line: 7, key: 'after', label: 'After', valueKind: 'textarea', group: null, shared: [] },
        ])
        expect(read.unreadable).toBe(1)
    })

    test('dividers, captions, group lines and blank lines are not entries and not unreadable', () => {
        const [read] = buildToggleCombined([source('character:c', '==divider\n=note=caption\n\ng=G=group\ng_end=G=groupEnd')], [], none).active
        expect(read.entries).toStrictEqual([])
        expect(read.unreadable).toBe(0)
    })

    test('CRLF text reads as the engine reads it: a CR after the type makes the row a check', () => {
        const [read] = buildToggleCombined([source('character:c', 'a=A=text\r\nb=B=select=x,y\r\n')], [], none).active
        expect(read.entries.map((entry) => [entry.key, entry.valueKind])).toStrictEqual([['a', 'check'], ['b', 'select']])
    })
})

describe('CB-2 shared keys', () => {
    test('names the other shown sources, active then off, then the app owners, once each and never the source itself', () => {
        const combined = buildToggleCombined(
            [source('preset:0', 'tone=Tone\nonly=Only'), source('module:m', 'tone=Tone\ntone=Again'), source('character:c', 'tone=Tone')],
            [source('module:off', 'tone=Tone')],
            new Map([['tone', ['App Char', 'name character:c', 'App Preset']]]),
        )
        const tone = (ownerKey: string) => combined.active.find((entry) => entry.ownerKey === ownerKey)?.entries[0].shared
        expect(tone('preset:0')).toStrictEqual(['name module:m', 'name character:c', 'name module:off', 'App Char', 'App Preset'])
        expect(tone('module:m')).toStrictEqual(['name preset:0', 'name character:c', 'name module:off', 'App Char', 'App Preset'])
        expect(combined.active[0].entries[1].shared).toStrictEqual([])
        expect(combined.off[0].entries[0].shared).toStrictEqual(['name preset:0', 'name module:m', 'name character:c', 'App Char', 'App Preset'])
    })

    test('a duplicate key inside one source does not make the source share with itself', () => {
        const [read] = buildToggleCombined([source('module:m', 'k=A\nk=B')], [], none).active
        expect(read.entries.map((entry) => entry.shared)).toStrictEqual([[], []])
    })

    test('keys are compared exactly: case, edge space and interior space differ', () => {
        const combined = buildToggleCombined(
            [source('preset:0', 'tone=A'), source('module:a', 'tone =A'), source('module:b', 'Tone=A'), source('module:c', 'to ne=A'), source('character:c', 'tone=A')],
            [],
            none,
        )
        expect(combined.active[0].entries[0].shared).toStrictEqual(['name character:c'])
        expect(combined.active[1].entries[0].shared).toStrictEqual([])
        expect(combined.active[2].entries[0].shared).toStrictEqual([])
        expect(combined.active[3].entries[0].shared).toStrictEqual([])
    })

    test('a source without text does not share its keys, and an app key of another name is listed as given', () => {
        const combined = buildToggleCombined([source('module:stub', null), source('character:c', 'k=A')], [], new Map([['k', ['Other']], ['z', ['Never']]]))
        expect(combined.active[0].entries[0].shared).toStrictEqual(['Other'])
    })
})

describe('CB-3 an open group belongs to its own source', () => {
    const open = 'g=G=group\na=A'
    const closed = 'g=G=group\na=A\ng_end=G=groupEnd'

    test('the preset ends inside its group: only the preset is flagged', () => {
        const combined = buildToggleCombined([source('preset:0', open), source('module:m', closed), source('character:c', 'c=C')], [], none)
        expect(combined.active.map((entry) => entry.unclosedGroup)).toStrictEqual([true, false, false])
    })

    test('nothing else differs from the closed case', () => {
        const withOpen = buildToggleCombined([source('preset:0', open), source('module:m', 'b=B')], [source('module:off', 'c=C')], none)
        const withClosed = buildToggleCombined([source('preset:0', closed), source('module:m', 'b=B')], [source('module:off', 'c=C')], none)
        const withoutFlag = (combined: typeof withOpen) => JSON.stringify(combined, (key, value) => key === 'unclosedGroup' ? undefined : value)
        expect(withoutFlag(withOpen)).toBe(withoutFlag(withClosed))
        expect(withOpen.active[0].unclosedGroup).toBe(true)
        expect(withClosed.active[0].unclosedGroup).toBe(false)
    })

    test('a group replaced by the next group is not open at the end; the last one is', () => {
        const [replaced, atEnd] = buildToggleCombined(
            [source('module:a', 'g=G=group\na=A\nh=H=group\nb=B\nh_end=H=groupEnd'), source('module:b', 'g=G=group\na=A\nh=H=group\nb=B')],
            [],
            none,
        ).active
        expect([replaced.unclosedGroup, atEnd.unclosedGroup]).toStrictEqual([false, true])
    })

    test('an off source is flagged by its own text too', () => {
        expect(buildToggleCombined([], [source('module:off', open)], none).off[0].unclosedGroup).toBe(true)
    })
})
