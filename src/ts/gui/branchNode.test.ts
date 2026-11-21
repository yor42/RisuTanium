import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    character: {} as unknown,
}))

vi.mock('../storage/database.svelte', () => ({
    getCurrentCharacter: () => h.character,
}))

import { getChatBranches } from './branches'
import {
    branchMoveTarget,
    branchNodeKey,
    branchNodeName,
    branchNodeText,
    classifyBranchKey,
    resolveBranchStop,
    type BranchMove,
} from './branchNode'

type ChatSeed = { fmIndex?: number, message: Array<{ role: string, data: string }> }

const chatOf = (texts: string[], fmIndex?: number): ChatSeed => ({
    ...(fmIndex === undefined ? {} : { fmIndex }),
    message: texts.map((data, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data })),
})

type Owner = Parameters<typeof branchNodeText>[0]

const seed = (firstMessage: string, alternateGreetings: string[], chats: ChatSeed[]): Owner => {
    const owner = { firstMessage, alternateGreetings, chats } as unknown as Owner
    h.character = owner
    return owner
}

const FALLBACK = '(empty)'
const name = (text: string): string => branchNodeName(text, FALLBACK)

beforeEach(() => {
    h.character = {}
})

describe('branchNodeName', () => {
    test('a plain line is its own name', () => {
        expect(name('Hello')).toBe('Hello')
    })

    test('a multi-line message is named by its first line', () => {
        expect(name('first\nsecond')).toBe('first')
    })

    test('leading blank lines are skipped', () => {
        expect(name('\n  \n\n   Hi there\nmore')).toBe('Hi there')
    })

    test('CRLF and lone CR end a line', () => {
        expect(name('one\r\ntwo')).toBe('one')
        expect(name('\r\r  one\rtwo')).toBe('one')
    })

    test('tabs, no-break spaces and runs collapse to one space', () => {
        expect(name('  a \t\t b  c  ')).toBe('a b c')
    })

    test('exactly 40 code points are kept whole', () => {
        const forty = 'x'.repeat(40)
        expect(name(forty)).toBe(forty)
    })

    test('41 code points become 39 and an ellipsis', () => {
        expect(name('x'.repeat(41))).toBe('x'.repeat(39) + '…')
    })

    test('a line of surrogate pairs is cut between pairs, never inside one', () => {
        const result = name('\u{1F600}'.repeat(50))
        expect(result).toBe('\u{1F600}'.repeat(39) + '…')
        expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    })

    test('a space before the cut is trimmed so the ellipsis follows a visible character', () => {
        expect(name('a'.repeat(38) + ' ' + 'b'.repeat(10))).toBe('a'.repeat(38) + '…')
    })

    test('an empty or whitespace-only message is named by the fallback', () => {
        expect(name('')).toBe(FALLBACK)
        expect(name('  \n\t  ')).toBe(FALLBACK)
    })

    test('a 100000 character line is cut to 40 code points', () => {
        const result = name('y'.repeat(100000))
        expect(Array.from(result)).toHaveLength(40)
        expect(result.endsWith('…')).toBe(true)
    })

    test('markdown and HTML are kept as the raw text', () => {
        expect(name('**Bold** <img src=x onerror=alert(1)>')).toBe('**Bold** <img src=x onerror=alert(1)>')
    })
})

describe('branchNodeText', () => {
    test('depth 0 reads the default first message', () => {
        const owner = seed('Hello', ['Alt'], [chatOf(['a'])])
        expect(branchNodeText(owner, { y: 0, chatId: 0 })).toBe('Hello')
    })

    test('depth 0 reads the alternate greeting of a valid fmIndex', () => {
        const owner = seed('Hello', ['Alt'], [chatOf(['a'], 0)])
        expect(branchNodeText(owner, { y: 0, chatId: 0 })).toBe('Alt')
    })

    test('depth y reads message[y - 1]', () => {
        const owner = seed('Hello', [], [chatOf(['m1', 'm2']), chatOf(['n1'])])
        expect(branchNodeText(owner, { y: 2, chatId: 0 })).toBe('m2')
        expect(branchNodeText(owner, { y: 1, chatId: 1 })).toBe('n1')
    })

    test('a missing message reads as empty', () => {
        const owner = seed('Hello', [], [chatOf(['m1'])])
        expect(branchNodeText(owner, { y: 5, chatId: 0 })).toBe('')
    })
})

describe('classifyBranchKey', () => {
    const plain = { altKey: false, ctrlKey: false, shiftKey: false, metaKey: false }

    test('the six plain keys map to their moves', () => {
        const table: Array<[string, BranchMove]> = [
            ['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['Home', 'home'], ['End', 'end'],
        ]
        for (const [key, move] of table) expect(classifyBranchKey({ key, ...plain })).toBe(move)
    })

    test.each(['altKey', 'ctrlKey', 'shiftKey', 'metaKey'])('%s turns every key into null', (modifier) => {
        for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
            expect(classifyBranchKey({ key, ...plain, [modifier]: true })).toBeNull()
        }
    })

    test('Escape, Enter, Tab and Space are not tree keys', () => {
        for (const key of ['Escape', 'Enter', 'Tab', ' ']) expect(classifyBranchKey({ key, ...plain })).toBeNull()
    })
})

/** BF2 in tree order: 0 R1, 1 a1, 2 a2, 3 b1, 4 b2, 5 R2, 6 c1. */
const seedBF2 = (): Owner => seed('Greeting', ['Other greeting'], [chatOf(['a1', 'a2']), chatOf(['b1', 'b2']), chatOf(['c1'], 0)])

const seedBF = (): Owner => seed('Hello from Alice\nSecond line', [], [
    chatOf(['\n\n   Hi there\nmore', '   \t ']),
    chatOf(['\n\n   Hi there\nmore', 'A'.repeat(30) + ' ' + 'B'.repeat(20), '**Bold** <img src=x onerror=alert(1)>']),
])

const seedCF = (): Owner => seed('Hi', [], [chatOf(['Aa', 'x']), chatOf(['BB', 'y'])])

describe('the tree model over the real getChatBranches', () => {
    test('BF2 comes out in the expected tree order', () => {
        const owner = seedBF2()
        const nodes = getChatBranches()
        expect(nodes.map((node) => branchNodeText(owner, node))).toEqual(['Greeting', 'a1', 'a2', 'b1', 'b2', 'Other greeting', 'c1'])
        expect(nodes.map((node) => node.y)).toEqual([0, 1, 2, 1, 2, 0, 1])
    })

    test.each([['BF', seedBF], ['BF2', seedBF2], ['CF', seedCF]])('node keys are unique in %s', (_title, arrange) => {
        arrange()
        const keys = getChatBranches().map(branchNodeKey)
        expect(new Set(keys).size).toBe(keys.length)
    })

    test('where a position is unique, the parent by tree order is the node at the connect position', () => {
        for (const arrange of [seedBF, seedBF2, seedCF]) {
            arrange()
            const nodes = getChatBranches()
            nodes.forEach((node, index) => {
                if (node.connectX === -1) return
                const here = nodes.filter((other) => other.x === node.x && other.y === node.y)
                const at = nodes.filter((other) => other.x === node.connectX && other.y === node.connectY)
                if (here.length !== 1 || at.length !== 1) return
                expect(nodes.indexOf(at[0])).toBe(branchMoveTarget(nodes, index, 'up'))
            })
        }
    })

    test('every move from every BF2 node equals the literal table, edges included', () => {
        seedBF2()
        const nodes = getChatBranches()
        const TABLE: Record<BranchMove, Array<number | null>> = {
            up:    [null, 0, 1, 0, 3, null, 5],
            down:  [1, 2, null, 4, null, 6, null],
            left:  [null, null, null, 1, 2, 0, 3],
            right: [5, 3, 4, 6, null, null, null],
            home:  [null, 0, 0, 0, 0, null, 5],
            end:   [2, 2, null, 4, null, 6, null],
        }
        for (const move of Object.keys(TABLE) as BranchMove[]) {
            expect(nodes.map((_node, index) => branchMoveTarget(nodes, index, move)), move).toEqual(TABLE[move])
        }
    })

    test('a merged node goes Down to its first leaf and Right to the next leaf', () => {
        seedCF()
        const nodes = getChatBranches()
        expect(nodes.map((node) => node.y)).toEqual([0, 1, 2, 2])
        expect(branchMoveTarget(nodes, 1, 'down')).toBe(2)
        expect(branchMoveTarget(nodes, 2, 'right')).toBe(3)
    })

    test('an index outside the list moves nowhere', () => {
        seedBF2()
        expect(branchMoveTarget(getChatBranches(), 99, 'down')).toBeNull()
    })
})

describe('resolveBranchStop', () => {
    const nodes = [{ y: 0, chatId: 0 }, { y: 1, chatId: 0 }, { y: 1, chatId: 1 }]

    test('no nodes means no stop', () => {
        expect(resolveBranchStop([], null)).toBeNull()
        expect(resolveBranchStop([], { key: '0:0', index: 0 })).toBeNull()
    })

    test('nothing remembered means the first node', () => {
        expect(resolveBranchStop(nodes, null)).toBe(0)
    })

    test('a remembered node that moved is found by its key', () => {
        expect(resolveBranchStop(nodes, { key: '1:1', index: 0 })).toBe(2)
    })

    test('a vanished key falls back to the remembered index, clamped to the last node', () => {
        expect(resolveBranchStop(nodes, { key: '9:9', index: 1 })).toBe(1)
        expect(resolveBranchStop(nodes, { key: '9:9', index: 7 })).toBe(2)
    })
})
