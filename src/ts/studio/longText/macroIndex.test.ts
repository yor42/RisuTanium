// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    buildMacroEntries,
    cbsNameKey,
    createMacroIndex,
    deriveUsage,
    type MacroEntry,
} from './macroIndex'
import type { CBSRegisterArg } from '../../cbs'

type Registration = Parameters<CBSRegisterArg['registerFunction']>[0]

function entry(over: Partial<MacroEntry> & { name: string }): MacroEntry {
    return {
        aliases: [],
        summary: '',
        usage: null,
        docOnly: false,
        internalOnly: false,
        blockSyntax: false,
        deprecated: null,
        ...over,
    }
}

describe('cbsNameKey', () => {
    test('A3a-u1: case, whitespace, underscore and hyphen are dropped', () => {
        expect(cbsNameKey('BLANK')).toBe('blank')
        expect(cbsNameKey('bl_ank')).toBe('blank')
        expect(cbsNameKey('b-lank')).toBe('blank')
        expect(cbsNameKey(' blank ')).toBe('blank')
    })

    test('A3a-u1: the first piece is the key, split on :: when the first colon is doubled', () => {
        expect(cbsNameKey('blank:a::b')).toBe('blank')
        expect(cbsNameKey('getvar::x')).toBe('getvar')
        expect(cbsNameKey('a::b:c')).toBe('a')
        expect(cbsNameKey('a:b::c')).toBe('a')
    })
})

describe('deriveUsage', () => {
    test('A3a-u2: single-line usage', () => {
        expect(deriveUsage('Returns x.\n\nUsage:: {{x}}')).toEqual({ summary: 'Returns x.', usage: '{{x}}' })
    })

    test('A3a-u2: multi-line usage keeps every line', () => {
        const d = deriveUsage('Does y.\n\nUsage:: {{#y a}}\n...\n{{/y}}\nmore')
        expect(d.summary).toBe('Does y.')
        expect(d.usage).toBe('{{#y a}}\n...\n{{/y}}\nmore')
    })

    test('A3a-u2: no marker gives the trimmed description and null usage', () => {
        expect(deriveUsage('  Plain text.  ')).toEqual({ summary: 'Plain text.', usage: null })
    })

    test('A3a-u2: only the first marker splits', () => {
        expect(deriveUsage('s Usage:: a Usage:: b').usage).toBe('a Usage:: b')
    })
})

describe('buildMacroEntries', () => {
    const base = {} as CBSRegisterArg

    test('collects every registration in order, with flags and without calling callbacks', () => {
        let called = false
        const register = (arg: CBSRegisterArg) => {
            const reg = (r: Registration) => arg.registerFunction(r)
            reg({ name: 'a', callback: () => { called = true; return null }, alias: ['aa'], description: 'A.\n\nUsage:: {{a}}' })
            reg({ name: '#blk', callback: 'doc_only', alias: [], description: 'B.', deprecated: { message: 'm', replacement: '#when' } })
            reg({ name: ':else', callback: 'doc_only', alias: [], description: 'E.' })
            reg({ name: '__', callback: () => '', alias: [], description: 'I', internalOnly: true })
        }
        const got = buildMacroEntries(register, base)
        expect(called).toBe(false)
        expect(got.map((e) => e.name)).toEqual(['a', '#blk', ':else', '__'])
        expect(got[0]).toMatchObject({ aliases: ['aa'], summary: 'A.', usage: '{{a}}', docOnly: false, blockSyntax: false })
        expect(got[1]).toMatchObject({ docOnly: true, blockSyntax: true, deprecated: { message: 'm', replacement: '#when' } })
        expect(got[2].blockSyntax).toBe(true)
        expect(got[3].internalOnly).toBe(true)
    })
})

describe('createMacroIndex', () => {
    test('A3a-u2: internal entries are left out of entries but found by lookup', () => {
        const idx = createMacroIndex([entry({ name: 'pub' }), entry({ name: 'hidden', internalOnly: true })])
        expect(idx.entries.map((e) => e.name)).toEqual(['pub'])
        expect(idx.lookup('hidden')?.internalOnly).toBe(true)
    })

    test('A3a-u2: doc_only entries are found', () => {
        const idx = createMacroIndex([entry({ name: '#if', docOnly: true })])
        expect(idx.lookup('#if')?.name).toBe('#if')
    })

    test('A3a-u2: aliases are found, and the key is normalised only on the typed side', () => {
        const idx = createMacroIndex([entry({ name: 'main', aliases: ['alt'] })])
        expect(idx.lookup('ALT::z')?.name).toBe('main')
        expect(idx.lookup('m_a_i_n')?.name).toBe('main')
    })

    test('A3a-u2: raw names are not normalised before matching', () => {
        const mixed = entry({ name: 'My_Macro' })
        const idx = createMacroIndex([mixed])
        expect(idx.lookup('My_Macro')).toBeNull()
        expect(idx.typedNameWorks(mixed)).toBe(false)
        const plain = entry({ name: 'plain', aliases: ['x'] })
        expect(createMacroIndex([plain]).typedNameWorks(plain)).toBe(true)
    })

    test('A3a-u2: a name reachable through its alias counts as working', () => {
        const e = entry({ name: 'Two_Words', aliases: ['twowords'] })
        expect(createMacroIndex([e]).typedNameWorks(e)).toBe(true)
    })

    test('A3a-u2: two callable entries of one name keep both and the second wins', () => {
        const idx = createMacroIndex([entry({ name: 'dup', summary: 'first' }), entry({ name: 'dup', summary: 'second' })])
        expect(idx.entries).toHaveLength(2)
        expect(idx.lookup('dup')?.summary).toBe('second')
    })

    test('A3a-u2: a callable entry beats a later doc_only one', () => {
        const idx = createMacroIndex([entry({ name: 'r', summary: 'callable' }), entry({ name: 'r', docOnly: true, summary: 'doc' })])
        expect(idx.lookup('r')?.summary).toBe('callable')
    })

    test('A3a-u2: two doc_only entries of one name give the second', () => {
        const idx = createMacroIndex([
            entry({ name: 's', docOnly: true, summary: 'a' }),
            entry({ name: 's', docOnly: true, summary: 'b' }),
        ])
        expect(idx.lookup('s')?.summary).toBe('b')
    })

    test('lookup of an unknown name is null', () => {
        expect(createMacroIndex([entry({ name: 'a' })]).lookup('nope')).toBeNull()
    })
})
