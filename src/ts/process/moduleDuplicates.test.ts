/**
 * `src/ts/process/moduleDuplicates.ts`: name matching, the placement write, the replace note and the duplicate prompt of
 * one import action. All tests are feature tests: the file did not exist before. The prompt is a scripted `alertSelect`.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { RisuModule } from 'src/ts/process/modules'

const h = vi.hoisted(() => ({
    answers: [] as string[],
    asked: [] as { options: string[], display: string | undefined }[],
}))

vi.mock(import('src/ts/alert'), () => ({
    alertSelect: vi.fn(async (options: string[], display?: string) => {
        h.asked.push({ options, display })
        return h.answers.shift() ?? '1'
    }),
}) as unknown as typeof import('src/ts/alert'))

import { DuplicateSession, applyModulePlacement, describeReplace, findDuplicateIndex } from 'src/ts/process/moduleDuplicates'
import { language } from 'src/lang'
import { ASSET_FOLDER_KEY, ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'

const mod = (id: string, name: unknown, extra: Record<string, unknown> = {}) => ({ id, name, description: '', ...extra }) as unknown as RisuModule

beforeEach(() => {
    h.answers = []
    h.asked = []
})

describe('findDuplicateIndex', () => {
    test('matches the trimmed name on both sides, case-sensitively, and returns the first in list order', () => {
        const list = [mod('a', 'Other'), mod('b', '  Same  '), mod('c', 'Same')]
        expect(findDuplicateIndex(list, 'Same')).toBe(1)
        expect(findDuplicateIndex(list, '\tSame ')).toBe(1)
        expect(findDuplicateIndex(list, 'same')).toBe(-1)
    })

    test('an MCP module is never a target', () => {
        expect(findDuplicateIndex([mod('a', 'Same', { mcp: { url: 'x' } }), mod('b', 'Same')], 'Same')).toBe(1)
        expect(findDuplicateIndex([mod('a', 'Same', { mcp: { url: 'x' } })], 'Same')).toBe(-1)
    })

    test('a name that is not a string never matches and never throws, on either side', () => {
        const list = [mod('a', undefined), mod('b', 7), mod('c', null), mod('d', 'Named')]
        expect(findDuplicateIndex(list, undefined)).toBe(-1)
        expect(findDuplicateIndex(list, null)).toBe(-1)
        expect(findDuplicateIndex(list, 7)).toBe(-1)
        expect(findDuplicateIndex(list, 'Named')).toBe(3)
        expect(findDuplicateIndex([{}], undefined)).toBe(-1)
    })

    test('a name containing the select separator still matches', () => {
        expect(findDuplicateIndex([mod('a', 'A||B')], ' A||B ')).toBe(0)
    })
})

describe('applyModulePlacement', () => {
    test('a replace stores the incoming module under the target id at the target position', () => {
        const list = [mod('a', 'A'), mod('t', 'T', { namespace: 'old' }), mod('c', 'C')]
        const incoming = mod('fresh', 'T', { namespace: 'new', description: 'new text' })
        const placed = applyModulePlacement(list, incoming, { choice: 'replace', targetId: 't' })
        expect(placed.kind).toBe('replaced')
        expect(list.map((m) => m.id)).toEqual(['a', 't', 'c'])
        expect(list[1]).toMatchObject({ id: 't', namespace: 'new', description: 'new text' })
        expect(incoming.id).toBe('fresh')
    })

    test('a target that is gone makes the replace an add', () => {
        const list = [mod('a', 'A')]
        const placed = applyModulePlacement(list, mod('n', 'N'), { choice: 'replace', targetId: 'gone' })
        expect(placed.kind).toBe('added')
        expect(list.map((m) => m.id)).toEqual(['a', 'n'])
    })

    test('an add appends the incoming module with its own id', () => {
        const list = [mod('a', 'A')]
        applyModulePlacement(list, mod('n', 'A'), { choice: 'add' })
        expect(list.map((m) => m.id)).toEqual(['a', 'n'])
    })
})

describe('describeReplace', () => {
    test('a changed namespace is named with the old and new value', () => {
        expect(describeReplace({ name: 'M', namespace: 'old' }, { name: 'M', namespace: 'new' }))
            .toEqual([language.moduleReplaceNamespaceChanged('M', 'old', 'new')])
        expect(describeReplace({ name: 'M' }, { name: 'M', namespace: 'new' }))
            .toEqual([language.moduleReplaceNamespaceChanged('M', '', 'new')])
    })

    test('an unchanged or absent namespace has no note', () => {
        expect(describeReplace({ name: 'M', namespace: 'same' }, { name: 'M', namespace: 'same' })).toEqual([])
        expect(describeReplace({ name: 'M' }, { name: 'M' })).toEqual([])
    })
})

describe('DuplicateSession', () => {
    test('a name that is not installed is added without asking', async () => {
        const session = new DuplicateSession()
        expect(await session.decide([mod('a', 'A')], 'B', 'b.risum', true)).toEqual({ choice: 'add' })
        expect(await session.decide([mod('a', 'A')], undefined, 'b.risum', true)).toEqual({ choice: 'add' })
        expect(h.asked).toEqual([])
    })

    test('the three answers map to replace by id, skip and add', async () => {
        const list = [mod('a', 'A'), mod('t', 'T')]
        const session = new DuplicateSession()
        h.answers = ['0', '1', '2']
        expect(await session.decide(list, 'T', 'f', false)).toEqual({ choice: 'replace', targetId: 't' })
        expect(await session.decide(list, 'T', 'f', false)).toEqual({ choice: 'skip' })
        expect(await session.decide(list, 'T', 'f', false)).toEqual({ choice: 'add' })
        expect(session.replaced).toBe(false)
    })

    test('the prompt names the module and the file on one line and offers the three options on the last file', async () => {
        h.answers = ['1']
        await new DuplicateSession().decide([mod('t', ' T ')], 'T', 'f.risum', false)
        expect(h.asked).toEqual([{
            options: [language.moduleDuplicateReplace, language.moduleDuplicateSkip, language.moduleDuplicateAddAnyway],
            display: language.moduleDuplicatePrompt('T', 'f.risum'),
        }])
        expect(h.asked[0].display).not.toContain('\n')
    })

    test('the all-remaining options are offered while a later file exists', async () => {
        h.answers = ['1']
        await new DuplicateSession().decide([mod('t', 'T')], 'T', 'f', true)
        const labels = [language.moduleDuplicateReplace, language.moduleDuplicateSkip, language.moduleDuplicateAddAnyway]
        expect(h.asked[0].options).toEqual([...labels, ...labels.map((l) => language.moduleDuplicateAll(l))])
    })

    test('an all-remaining answer is sticky: later duplicates are not asked, other names still add', async () => {
        const list = [mod('t', 'T'), mod('u', 'U')]
        const session = new DuplicateSession()
        h.answers = ['3']
        expect(await session.decide(list, 'T', 'f1', true)).toEqual({ choice: 'replace', targetId: 't' })
        expect(await session.decide(list, 'U', 'f2', true)).toEqual({ choice: 'replace', targetId: 'u' })
        expect(await session.decide(list, 'New', 'f3', false)).toEqual({ choice: 'add' })
        expect(h.asked).toHaveLength(1)
    })

    test('a sticky skip and a sticky add keep their meaning', async () => {
        const list = [mod('t', 'T')]
        const skip = new DuplicateSession()
        h.answers = ['4']
        expect(await skip.decide(list, 'T', 'f', true)).toEqual({ choice: 'skip' })
        expect(await skip.decide(list, 'T', 'g', true)).toEqual({ choice: 'skip' })
        const add = new DuplicateSession()
        h.answers = ['5']
        expect(await add.decide(list, 'T', 'f', true)).toEqual({ choice: 'add' })
        expect(await add.decide(list, 'T', 'g', true)).toEqual({ choice: 'add' })
    })

    test('a separator in the name or the file is shown as a single bar', async () => {
        h.answers = ['1']
        await new DuplicateSession().decide([mod('t', 'A||B')], 'A||B', 'x||y.risum', false)
        expect(h.asked[0].display).toBe(language.moduleDuplicatePrompt('A|B', 'x|y.risum'))
    })

    test('runs of three or four bars in the name or the file leave no separator in the header, for both option sets', async () => {
        for (const [name, file] of [['A|||B', 'x|||y.risum'], ['|||Lore|||', 'f||||g.risum'], ['A||||B', 'x.risum']]) {
            for (const later of [false, true]) {
                h.asked = []
                h.answers = ['1']
                await new DuplicateSession().decide([mod('t', name)], name, file, later)
                expect(h.asked[0].display).not.toContain('||')
                expect(h.asked[0].options).toHaveLength(later ? 6 : 3)
            }
        }
    })

    test('an answer that is not an option skips and is not sticky', async () => {
        const list = [mod('t', 'T')]
        const session = new DuplicateSession()
        h.answers = ['', '9', '-1']
        expect(await session.decide(list, 'T', 'f', true)).toEqual({ choice: 'skip' })
        expect(await session.decide(list, 'T', 'f', false)).toEqual({ choice: 'skip' })
        expect(await session.decide(list, 'T', 'f', false)).toEqual({ choice: 'skip' })
        expect(h.asked).toHaveLength(3)
    })
})

describe('applyModulePlacement keeps the device-side fields of the module it replaces', () => {
    const KEPT = [['gone', 'assets/K.png']]
    const FILE_LIST = [['file', 'assets/File.png']]
    const FOLDERS = { v: 1, additional: { order: ['Faces'], of: [['smile', 'Faces']] } }
    const replace = { choice: 'replace', targetId: 't' } as const

    test('the retained field stays the target\'s, by reference, whatever the incoming module holds', () => {
        const list = [mod('t', 'T', { [ASSET_RETAINED_KEY]: KEPT })]
        applyModulePlacement(list, mod('fresh', 'T', { [ASSET_RETAINED_KEY]: FILE_LIST }), replace)
        expect(list[0][ASSET_RETAINED_KEY]).toBe(KEPT)
    })

    test('the retained field stays the target\'s when it is of another shape', () => {
        const odd = { a: ['assets/K2.png'] }
        const list = [mod('t', 'T', { [ASSET_RETAINED_KEY]: odd })]
        applyModulePlacement(list, mod('fresh', 'T'), replace)
        expect(list[0][ASSET_RETAINED_KEY]).toBe(odd)
    })

    test('a target without the field stays without it, so an incoming module cannot give it one', () => {
        const list = [mod('t', 'T')]
        applyModulePlacement(list, mod('fresh', 'T', { [ASSET_RETAINED_KEY]: FILE_LIST }), replace)
        expect(Object.hasOwn(list[0], ASSET_RETAINED_KEY)).toBe(false)
    })

    test('an incoming module without a folder document keeps the target\'s, by reference', () => {
        const list = [mod('t', 'T', { [ASSET_FOLDER_KEY]: FOLDERS })]
        applyModulePlacement(list, mod('fresh', 'T'), replace)
        expect(list[0][ASSET_FOLDER_KEY]).toBe(FOLDERS)
    })

    test.each([
        ['a v1 document', { v: 1, additional: { order: [], of: [] } }],
        ['a document of an unknown version', { v: 9, x: 1 }],
        ['a value that is not an object', 'garbage'],
    ])('an incoming module that holds %s wins over the target\'s', (_label, incomingDocument) => {
        const list = [mod('t', 'T', { [ASSET_FOLDER_KEY]: FOLDERS })]
        applyModulePlacement(list, mod('fresh', 'T', { [ASSET_FOLDER_KEY]: incomingDocument }), replace)
        expect(list[0][ASSET_FOLDER_KEY]).toBe(incomingDocument)
    })

    test('a target that holds neither field adds neither, and the rest still comes from the incoming module', () => {
        const list = [mod('t', 'T')]
        applyModulePlacement(list, mod('fresh', 'T', { description: 'new' }), replace)
        expect(list[0]).toMatchObject({ id: 't', description: 'new' })
        expect(Object.hasOwn(list[0], ASSET_FOLDER_KEY)).toBe(false)
        expect(Object.hasOwn(list[0], ASSET_RETAINED_KEY)).toBe(false)
    })

    test('an add never carries a field from another module', () => {
        const list = [mod('t', 'T', { [ASSET_RETAINED_KEY]: KEPT })]
        applyModulePlacement(list, mod('n', 'T'), { choice: 'add' })
        expect(Object.hasOwn(list[1], ASSET_RETAINED_KEY)).toBe(false)
    })
})
