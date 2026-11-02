import { describe, test, expect } from 'vitest'
import type { loreBook } from 'src/ts/storage/database.svelte'
import { getLoreBookSubtree } from './lorebookFolders'

function entry(comment: string, extra: Partial<loreBook> = {}): loreBook {
    return {
        key: 'k' + comment, comment, content: '', mode: 'normal', insertorder: 100,
        alwaysActive: false, secondkey: '', selective: false, ...extra,
    } as loreBook
}

function folder(comment: string, uuid: string, extra: Partial<loreBook> = {}): loreBook {
    return entry(comment, { mode: 'folder', key: 'folder:' + uuid, ...extra })
}

const names = (set: Set<loreBook>) => Array.from(set).map((l) => l.comment).sort()

describe('getLoreBookSubtree', () => {
    test('a plain entry is its own subtree', () => {
        const a = entry('a')
        const lore = [a, entry('b')]
        expect(names(getLoreBookSubtree(lore, a))).toEqual(['a'])
    })

    test('a folder holds its entries and every nested folder with their entries, and nothing else', () => {
        const outer = folder('outer', 'aaa')
        const inner = folder('inner', 'bbb', { folder: 'folder:aaa' })
        const lore = [outer, inner, entry('leaf', { folder: 'folder:bbb' }), entry('direct', { folder: 'folder:aaa' }), entry('keep'), folder('other', 'ccc'), entry('o', { folder: 'folder:ccc' })]
        expect(names(getLoreBookSubtree(lore, outer))).toEqual(['direct', 'inner', 'leaf', 'outer'])
    })

    test('deleting a nested folder leaves its parent and the parent\'s other entries', () => {
        const outer = folder('outer', 'aaa')
        const inner = folder('inner', 'bbb', { folder: 'folder:aaa' })
        const lore = [outer, inner, entry('leaf', { folder: 'folder:bbb' }), entry('sibling', { folder: 'folder:aaa' })]
        expect(names(getLoreBookSubtree(lore, inner))).toEqual(['inner', 'leaf'])
    })

    test('cyclic folder references terminate and contain both folders', () => {
        const a = folder('a', 'aaa', { folder: 'folder:bbb' })
        const b = folder('b', 'bbb', { folder: 'folder:aaa' })
        const lore = [a, b, entry('x', { folder: 'folder:aaa' })]
        expect(names(getLoreBookSubtree(lore, a))).toEqual(['a', 'b', 'x'])
    })

    test('a folder that names itself terminates', () => {
        const a = folder('a', 'aaa', { folder: 'folder:aaa' })
        expect(names(getLoreBookSubtree([a, entry('x', { folder: 'folder:aaa' })], a))).toEqual(['a', 'x'])
    })

    test.each([['undefined'], ['empty']] as const)('a seed folder with a %s key reaches no top-level entry', (kind) => {
        const keyless = entry('F', { mode: 'folder' })
        if (kind === 'undefined') delete (keyless as { key?: string }).key
        else keyless.key = ''
        const lore = [entry('top0', kind === 'empty' ? { folder: '' } : {}), keyless, entry('top1')]
        expect(names(getLoreBookSubtree(lore, keyless))).toEqual(['F'])
    })

    test.each([['undefined'], ['empty']] as const)('a nested folder with a %s key contributes no children', (kind) => {
        const outer = folder('outer', 'aaa')
        const keyless = entry('K', { mode: 'folder', folder: 'folder:aaa' })
        if (kind === 'undefined') delete (keyless as { key?: string }).key
        else keyless.key = ''
        const lore = [outer, keyless, entry('top0', kind === 'empty' ? { folder: '' } : {}), entry('top1')]
        expect(names(getLoreBookSubtree(lore, outer))).toEqual(['K', 'outer'])
    })
})
