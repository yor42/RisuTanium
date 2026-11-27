// @vitest-environment jsdom

/**
 * TS11, move cells: `moveEffectUp` and `moveEffectDown` equal, key order included, what the real classic
 * `TriggerV2List` writes when a user drags a row's handle onto the drop zone before another row (or the end zone).
 * A refused move leaves classic's array unchanged, and Studio's `null` is compared as the unchanged input. Rows of
 * type `v2EndIndent` and `v2Else` render no drag handle, so their moves have no classic route; those cells are in
 * the pure refusal tests. Alt+Arrow swaps are compared where classic swaps. Classic is mounted unchanged and driven
 * live (MC-329); its handle and drop zones are found inside the effect pane only.
 */
import { writable } from 'svelte/store'
import { afterAll, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/process/triggers'), () => ({
    displayAllowList: ['v2GetDisplayState', 'v2SetDisplayState'],
    requestAllowList: ['v2GetRequestState', 'v2SetRequestState', 'v2GetRequestStateRole', 'v2SetRequestStateRole', 'v2GetRequestStateLength'],
}) as unknown as typeof import('src/ts/process/triggers'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { showDeprecatedTriggerV2: true, showDeprecatedTriggerV1: true } as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        alertStore: writable({ type: 'none', msg: '' }),
        disableHighlight: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertMd: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

import type { Component } from 'svelte'
import TriggerV2List from 'src/lib/SideBars/Scripts/TriggerV2List.svelte'
import { moveEffectDown, moveEffectUp } from '../triggerV2Blocks'
import {
    BLOCK_END, CORPUS_IDS, MALFORMED_IDS, WELL_FORMED_IDS, corpusArray, typeOfRow,
} from './triggerBlockCorpus.test-helpers'
import {
    altArrowOnRow, dragHandleOfRow, dragRow, effectRowButtons, effectsOf, mountV2Events, unmountAll,
} from './classicTriggerDriver.test-helpers.svelte'
import { firstDifference } from './triggerExactEqual.test-helpers'

vi.setConfig({ testTimeout: 30_000 })

afterAll(async () => {
    await unmountAll()
})

const COMPONENT = TriggerV2List as unknown as Component<never>

async function classicMove(id: string, from: number, to: number): Promise<unknown[]> {
    const list = await mountV2Events(COMPONENT, corpusArray(id))
    await dragRow(from, to)
    return effectsOf(list)
}

async function classicAlt(id: string, index: number, direction: 'up' | 'down'): Promise<unknown[]> {
    const list = await mountV2Events(COMPONENT, corpusArray(id))
    await altArrowOnRow(index, direction)
    return effectsOf(list)
}

const hasHandle = (row: unknown): boolean => typeOfRow(row) !== 'v2EndIndent' && typeOfRow(row) !== 'v2Else'

/** The drop target of a Move down: two rows past the end of the row's block, as the plan's mapping states. */
const downTarget = (id: string, index: number): number => (BLOCK_END[id]?.[index] ?? index) + 2

type Cell = readonly [string, number, 'up' | 'down', number]

/** Cells where classic refuses the move and leaves the array unchanged: they equal Studio's unchanged input on any base. */
const GUARD_MOVES: ReadonlySet<string> = new Set([
    'W3:1:down', 'W3:4:up', 'W6:2:down', 'W6:5:up', 'W7:1:down', 'M3:1:down', 'M7:1:down', 'M7:4:up',
])

/** [array, row, direction, drop target] for every row that has a handle and whose target zone exists. */
const moveCells = (ids: readonly string[]): Cell[] =>
    ids.flatMap((id) => {
        const rows = corpusArray(id)
        return rows.flatMap((row, index) => {
            if (!hasHandle(row)) return []
            const cells: Cell[] = []
            if (index >= 1) cells.push([id, index, 'up', index - 1])
            const down = downTarget(id, index)
            if (down <= rows.length) cells.push([id, index, 'down', down])
            return cells
        })
    })

describe('D-probe (diagnostic): the drop route moves a row', () => {
    test('diagnostic: dragging a row onto the zone before row 0 and a block onto the end zone changes classic\'s array, and End rows have no handle', async () => {
        const input = corpusArray('W2')
        const list = await mountV2Events(COMPONENT, corpusArray('W2'))
        expect(effectRowButtons().length).toBe(input.length)
        expect(dragHandleOfRow(2)).toBeNull()
        expect(dragHandleOfRow(0)).not.toBeNull()
        await dragRow(3, 0)
        expect(effectsOf(list).map(typeOfRow)).toEqual(['v2Comment', 'v2IfAdvanced', 'v2SetVar', 'v2EndIndent'])
        await dragRow(0, 4)
        expect(effectsOf(list).map(typeOfRow)).toEqual(['v2IfAdvanced', 'v2SetVar', 'v2EndIndent', 'v2Comment'])
    })
})

describe.each([
    ['TS11-W', WELL_FORMED_IDS],
    ['TS11-M', MALFORMED_IDS],
] as const)('%s move on the %s corpus', (_group, ids) => {
    // Each cell checks the partition it sits in: a reproducer cell must see classic change the array, a guard cell must see
    // it leave the array unchanged, so a cell in the wrong set fails instead of passing as a vacuous parity check.
    const checkIn = (guard: boolean) => async (id: string, index: number, direction: 'up' | 'down', to: number): Promise<void> => {
        const input = corpusArray(id)
        const classic = await classicMove(id, index, to)
        if (guard) {
            expect(firstDifference(classic, input), 'classic must leave the array unchanged').toBeNull()
        } else {
            expect(firstDifference(classic, input), 'classic must change the array').not.toBeNull()
        }
        const studio = direction === 'up' ? moveEffectUp(corpusArray(id), index) : moveEffectDown(corpusArray(id), index)
        expect(firstDifference(studio ?? input, classic)).toBeNull()
    }
    const isGuard = ([id, index, direction]: Cell): boolean => GUARD_MOVES.has([id, index, direction].join(':'))

    test.each(moveCells(ids).filter((cell) => !isGuard(cell)))('regression reproducer: move %s row %i %s to the zone before %i equals classic, key order included', checkIn(false))
    test.each(moveCells(ids).filter(isGuard))('compatibility guard (classic leaves the array unchanged, so it passes before and after): move %s row %i %s to the zone before %i equals classic, key order included', checkIn(true))
})

describe('TS11-c recorder anchor for move (compatibility guard, passes before and after)', () => {
    test('compatibility guard: moving the Loop of W4 down lands it on the end zone, so classic moves the whole block', async () => {
        const input = corpusArray('W4')
        expect(downTarget('W4', 0)).toBe(input.length)
        const classic = await classicMove('W4', 0, input.length)
        expect(firstDifference(classic, [input[5], ...input.slice(0, 5)])).toBeNull()
    })
})

describe('TS11-W Alt+Arrow swaps (classic swaps same-indent plain pairs; Studio\'s moveEffectUp and moveEffectDown equal the swap)', () => {
    const altCells = WELL_FORMED_IDS.flatMap((id) =>
        corpusArray(id).flatMap((_, index) => (['up', 'down'] as const).map((direction) => [id, index, direction] as const)))

    test.each(altCells)('regression reproducer where classic swaps (no assertion where it does not): Alt+%s on %s row %i matches the Studio move', async (id, index, direction) => {
        const input = corpusArray(id)
        const classic = await classicAlt(id, index, direction)
        if (firstDifference(classic, input) === null) return
        const studio = direction === 'up' ? moveEffectUp(corpusArray(id), index) : moveEffectDown(corpusArray(id), index)
        expect(firstDifference(studio, classic)).toBeNull()
    })

    test('regression reproducer: classic swaps the four neighbouring pairs of W1, so the Alt cells are not vacuous', async () => {
        let swaps = 0
        for (const [index, direction] of [[1, 'up'], [2, 'up'], [0, 'down'], [1, 'down']] as const) {
            const classic = await classicAlt('W1', index, direction)
            if (firstDifference(classic, corpusArray('W1')) !== null) swaps++
        }
        expect(swaps).toBe(4)
        expect(CORPUS_IDS.length).toBe(15)
    })
})
