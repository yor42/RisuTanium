// @vitest-environment jsdom

/**
 * TS11, edit and delete cells. `replaceEffect` equals, key order included, what the real classic `TriggerV2List`
 * writes when a user opens Edit on an If row, optionally flips the Else checkbox and presses Save; `deleteEffect`
 * equals what classic writes for the Delete key. The edit cells type a real edit into the open editor before Save, so the
 * compared array carries the typed change, not a no-op round trip. Classic is mounted unchanged and driven live (MC-329).
 *
 * MC-4117: classic's Else toggle on an If row whose `v2EndIndent` is missing splices the Else pair in at the wrong
 * place and then overwrites the row at the edited index, which corrupts the list. Three cells (M1 row 0, M3 row 1,
 * M6 row 2) pin that classic golden exactly (compatibility guard, passes before and after), and Studio refuses the
 * edit with `null` (regression reproducer). Every other cell needs exact parity.
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
import { language } from 'src/lang'
import TriggerV2List from 'src/lib/SideBars/Scripts/TriggerV2List.svelte'
import type { triggerEffect, triggerEffectV2 } from '../../../process/triggers'
import { deleteEffect, replaceEffect } from '../triggerV2Blocks'
import {
    MALFORMED_IDS, MC4117_CELLS, WELL_FORMED_IDS, corpusArray, typeOfRow,
} from './triggerBlockCorpus.test-helpers'
import {
    addElseChecked, contextMenuOnRow, deleteRowByKey, effectsOf, mountV2Events, saveEffectForm, toggleAddElse, typeIntoIfSource, unmountAll,
} from './classicTriggerDriver.test-helpers.svelte'
import { firstDifference } from './triggerExactEqual.test-helpers'

vi.setConfig({ testTimeout: 30_000 })

afterAll(async () => {
    await unmountAll()
})

const COMPONENT = TriggerV2List as unknown as Component<never>

/** The text a user types into the If row's source field, so that every edit cell carries a real change. */
const EDITED_SOURCE = 'edited source'

/**
 * Edit opens on the row; `flip` presses the Else checkbox; `edit` types a new source into the form first. Returns
 * classic's array and the checkbox state Save saw.
 */
async function classicEdit(id: string, index: number, flip: boolean, edit = true): Promise<{ result: unknown[], addElse: boolean }> {
    const list = await mountV2Events(COMPONENT, corpusArray(id))
    await contextMenuOnRow(index, language.edit)
    if (flip) await toggleAddElse()
    if (edit) await typeIntoIfSource(EDITED_SOURCE)
    const addElse = addElseChecked()
    await saveEffectForm()
    return { result: effectsOf(list), addElse }
}

async function classicDelete(id: string, index: number): Promise<unknown[]> {
    const list = await mountV2Events(COMPONENT, corpusArray(id))
    await deleteRowByKey(index)
    return effectsOf(list)
}

const isMc4117 = (id: string, index: number): boolean => MC4117_CELLS.some((cell) => cell.id === id && cell.index === index)

const isIfRow = (row: unknown): boolean => typeOfRow(row) === 'v2If' || typeOfRow(row) === 'v2IfAdvanced'

/**
 * Every If row of the array, once with the toggle flipped and once kept. The three MC-4117 rows are only edited
 * with the toggle kept here: their flipped edit has no parity cell, because Studio refuses it.
 */
const editCells = (ids: readonly string[]): Array<readonly [string, number, boolean]> =>
    ids.flatMap((id) => corpusArray(id).flatMap((row, index) => {
        if (!isIfRow(row)) return []
        const cells: Array<readonly [string, number, boolean]> = [[id, index, false]]
        if (!isMc4117(id, index)) cells.push([id, index, true])
        return cells
    }))

const deleteCells = (ids: readonly string[]): Array<readonly [string, number]> =>
    ids.flatMap((id) => corpusArray(id).map((_, index) => [id, index] as const))

describe.each([
    ['TS11-W', WELL_FORMED_IDS],
    ['TS11-M', MALFORMED_IDS],
] as const)('%s edit and delete on the %s corpus', (_group, ids) => {
    test.each(editCells(ids))('regression reproducer: edit %s row %i with the toggle flipped=%s equals classic, key order included', async (id, index, flip) => {
        const { result, addElse } = await classicEdit(id, index, flip)
        expect(JSON.stringify(result), 'classic must write the typed edit').toContain(EDITED_SOURCE)
        const input = corpusArray(id)
        const edited = { ...(corpusArray(id)[index] as object), source: EDITED_SOURCE } as triggerEffectV2
        const studio = replaceEffect(input, index, edited, { addElse })
        expect(studio, 'Studio must accept every edit outside the MC-4117 cells').not.toBeNull()
        expect(firstDifference(studio, result)).toBeNull()
    })

    test.each(deleteCells(ids))('regression reproducer: delete %s row %i equals classic, key order included', async (id, index) => {
        const input = corpusArray(id)
        const classic = await classicDelete(id, index)
        expect(firstDifference(classic, input), 'classic must change the array').not.toBeNull()
        expect(firstDifference(deleteEffect(corpusArray(id), index), classic)).toBeNull()
    })
})

describe('TS11-c recorder anchors for delete (compatibility guards, pass before and after)', () => {
    test('compatibility guard: deleting the opener of W2 leaves the dedented child and the trailing comment, without the End', async () => {
        const classic = await classicDelete('W2', 0)
        const input = corpusArray('W2')
        expect(firstDifference(classic, [{ ...(input[1] as object), indent: 0 }, input[3]])).toBeNull()
    })

    test('compatibility guard: the context menu Remove deletes like the Delete key', async () => {
        for (const [id, index] of [['W1', 0], ['W3', 0]] as const) {
            const list = await mountV2Events(COMPONENT, corpusArray(id))
            await contextMenuOnRow(index, language.remove)
            expect(firstDifference(effectsOf(list), await classicDelete(id, index)), id).toBeNull()
        }
    })
})

describe('TS11-Ec MC-4117: classic corrupts the list on an Else toggle with no matching v2EndIndent (compatibility guards, pass before and after)', () => {
    const goldens = (): Record<string, unknown[]> => {
        const m1 = corpusArray('M1')
        const m3 = corpusArray('M3')
        const m6 = corpusArray('M6')
        return {
            'M1 row 0': [m1[0], { type: 'v2EndIndent', indent: 1 }, m1[0], m1[1], m1[2]],
            'M3 row 1': [{ type: 'v2Else', indent: undefined }, m3[1], m3[0], m3[1], m3[2], m3[3]],
            'M6 row 2': [{ type: 'v2Else', indent: 0 }, { type: 'v2EndIndent', indent: 1 }, m6[2], m6[1], m6[2], m6[3]],
        }
    }

    test.each(MC4117_CELLS.map((cell) => [`${cell.id} row ${cell.index}`, cell.id, cell.index] as const))(
        'compatibility guard (MC-4117): the live classic golden of %s equals the pinned literal',
        async (label, id, index) => {
            const { result } = await classicEdit(id, index, true, false)
            expect(firstDifference(result, goldens()[label])).toBeNull()
        })
})

describe('TS11-E MC-4117: Studio refuses the Else toggle that classic corrupts', () => {
    test.each(MC4117_CELLS.map((cell) => [`${cell.id} row ${cell.index}`, cell.id, cell.index] as const))(
        'regression reproducer (MC-4117): replaceEffect with the toggle on returns null for %s',
        (_label, id, index) => {
            const input = corpusArray(id)
            const edited = corpusArray(id)[index] as triggerEffectV2
            expect(replaceEffect(input, index, edited, { addElse: true })).toBeNull()
        })

    test('compatibility guard (MC-4117 is narrow; also passes on a stub that returns its input): an edit of the same rows with the toggle off still lands', () => {
        for (const { id, index } of MC4117_CELLS) {
            const input = corpusArray(id)
            const edited = corpusArray(id)[index] as triggerEffectV2
            const studio: triggerEffect[] | null = replaceEffect(input, index, edited, { addElse: false })
            expect(firstDifference(studio, corpusArray(id)), id).toBeNull()
        }
    })
})
