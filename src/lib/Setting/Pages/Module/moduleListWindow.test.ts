// @vitest-environment jsdom

/**
 * The pure parts of the windowed module lists: the row keys (stable under the search, distinct for
 * a shared id), the search positions, and which element scrolls a module list. Compatibility
 * guards: the helper is new, so these pass on any base that has it.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { matchingModulePositions, moduleListScroller, moduleRowKeys } from './moduleListWindow'

afterEach(() => {
    document.body.innerHTML = ''
})

describe('moduleRowKeys', () => {
    test('guard: a key names the module and its occurrence of a shared id', () => {
        expect(moduleRowKeys([{ id: 'a' }, { id: 'b' }, { id: 'a' }])).toEqual([
            JSON.stringify(['m', 'a', 0]),
            JSON.stringify(['m', 'b', 0]),
            JSON.stringify(['m', 'a', 1]),
        ])
    })

    test('guard: an id that is not a string counts as the empty id', () => {
        const keys = moduleRowKeys([{ id: undefined as unknown as string }, { id: '' }])
        expect(keys).toEqual([JSON.stringify(['m', '', 0]), JSON.stringify(['m', '', 1])])
    })
})

describe('matchingModulePositions', () => {
    test('guard: matches the name ignoring case and keeps array order', () => {
        expect(matchingModulePositions([{ name: 'Bx' }, { name: 'a' }, { name: 'cX' }], 'x')).toEqual([0, 2])
        expect(matchingModulePositions([{ name: 'b' }, { name: 'a' }], '')).toEqual([0, 1])
    })

    // Regression reproducer (T9-SEARCH-NAME): a name that is not a string made the search throw on the previous code.
    test('a name that is not a string matches nothing and never throws', () => {
        const modules = [{ name: 5 }, { name: 'Alpha' }] as unknown as { name: string }[]
        expect(() => matchingModulePositions(modules, 'a')).not.toThrow()
        expect(matchingModulePositions(modules, 'a')).toEqual([1])
        expect(matchingModulePositions(modules, '')).toEqual([0, 1])
    })
})

describe('moduleListScroller', () => {
    function chain(parentScrolls: boolean, outerScrolls: boolean): { outer: HTMLElement, parent: HTMLElement, list: HTMLElement } {
        const outer = document.createElement('div')
        const parent = document.createElement('div')
        const list = document.createElement('div')
        if (outerScrolls) outer.style.overflowY = 'auto'
        if (parentScrolls) parent.style.overflowY = 'scroll'
        list.style.overflowY = 'auto'
        outer.appendChild(parent)
        parent.appendChild(list)
        document.body.appendChild(outer)
        return { outer, parent, list }
    }

    test('guard: the list scrolls itself when its parent is a scroll container', () => {
        const { list } = chain(true, true)
        expect(moduleListScroller(list)).toBe(list)
    })

    test('guard: otherwise the nearest scrolling ancestor above the list', () => {
        const { outer, list } = chain(false, true)
        expect(moduleListScroller(list)).toBe(outer)
    })

    test('guard: the window when nothing above the list scrolls', () => {
        const { list } = chain(false, false)
        expect(moduleListScroller(list)).toBeNull()
    })
})
