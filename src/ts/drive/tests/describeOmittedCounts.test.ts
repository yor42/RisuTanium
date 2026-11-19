/**
 * `describeOmittedCounts`: the lines the legacy partial notice and the export prompt of a read-only page show for what the
 * lenient decode left out. Characters are counted, never named; every other kind has its fixed line; the empty result is
 * the one predicate for "nothing the person cares about is missing". Pure function over synthetic maps.
 */
import { describe, test, expect } from 'vitest'
import { language } from 'src/lang'
import { describeOmitted, describeOmittedCounts } from 'src/ts/drive/describeOmitted'
import type { SalvageOmittedBlock, SalvageOmittedKind } from 'src/ts/storage/risuSave'

function omittedOf(entries: [string, SalvageOmittedKind][]): Map<string, SalvageOmittedBlock> {
    return new Map(entries.map(([name, kind]) => [name, { kind, reason: 'synthetic' }]))
}

describe('describeOmittedCounts', () => {
    test('new contract: characters are counted, kinds keep describeOmitted order, unreadable parts come last, ignored gives no line', () => {
        const omitted = omittedOf([
            ['secret-block-name-1', 'character'],
            ['secret-block-name-2', 'character'],
            ['modules', 'modules'],
            ['preset', 'presets'],
            ['config', 'ignored'],
            ['x1', 'other'],
            ['x2', 'other'],
        ])

        const lines = describeOmittedCounts(omitted)

        expect(lines).toEqual([
            language.legacyPartialCharacters(2),
            language.internalBackupLeftOutPresets,
            language.internalBackupLeftOutModules,
            language.legacyPartialUnreadable(2),
        ])
        expect(lines[0]).toBe('2 characters')
        expect(lines.join('\n')).not.toContain('secret-block-name')
    })

    test('new contract: every kind has its own line, singular counts are worded singular', () => {
        const lines = describeOmittedCounts(omittedOf([
            ['c', 'character'],
            ['l', 'loadouts'],
            ['p', 'plugins'],
            ['d', 'pluginStorage'],
            ['o', 'other'],
        ]))

        expect(lines).toEqual([
            '1 character',
            language.internalBackupLeftOutLoadouts,
            language.internalBackupLeftOutPlugins,
            language.internalBackupLeftOutPluginData,
            '1 other part this version cannot read',
        ])
    })

    test('new contract: only the ignored config block, or nothing, gives an empty list', () => {
        expect(describeOmittedCounts(omittedOf([['config', 'ignored']]))).toEqual([])
        expect(describeOmittedCounts(new Map())).toEqual([])
    })

    test('guard: describeOmitted is unchanged for its current callers (names, kind lines, the unreadable count)', () => {
        const omitted = omittedOf([['b', 'character'], ['plugins', 'plugins'], ['x', 'other']])

        expect(describeOmitted(omitted, new Map([['b', 'Bee']]))).toEqual([
            'Bee',
            language.internalBackupLeftOutPlugins,
            `1 ${language.internalBackupLeftOutUnreadable}`,
        ])
    })
})
