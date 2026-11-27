// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest'
import { expandFolders, readExpandedFolders, writeExpandedFolders } from './loreFolderExpansion'

beforeEach(() => {
    localStorage.clear()
})

describe('loreFolderExpansion', () => {
    test('folders start collapsed and an owner keeps its own set', () => {
        expect(readExpandedFolders('character:A').size).toBe(0)
        writeExpandedFolders('character:A', new Set(['K1']))
        expect([...readExpandedFolders('character:A')]).toEqual(['K1'])
        expect(readExpandedFolders('chat:A:c1').size).toBe(0)
    })

    test('expanding adds keys and writes once; an unreadable value reads as collapsed', () => {
        writeExpandedFolders('character:A', new Set(['K1']))
        const set = expandFolders('character:A', ['K1', 'K2'])
        expect([...set].sort()).toEqual(['K1', 'K2'])
        expect([...readExpandedFolders('character:A')].sort()).toEqual(['K1', 'K2'])
        localStorage.setItem('risuStudio.loreFolders.character:A', '{"not":"a list"}')
        expect(readExpandedFolders('character:A').size).toBe(0)
        localStorage.setItem('risuStudio.loreFolders.character:A', 'not json')
        expect(readExpandedFolders('character:A').size).toBe(0)
    })

    test('an empty set removes the stored value', () => {
        writeExpandedFolders('character:A', new Set(['K1']))
        writeExpandedFolders('character:A', new Set())
        expect(localStorage.getItem('risuStudio.loreFolders.character:A')).toBeNull()
    })
})
