// @vitest-environment jsdom

/**
 * TS11, append and insert-above cells: `appendEffect` and `insertEffectBefore` equal, key order included, what the
 * real classic `TriggerV2List` writes when a user picks a type (and, for If types, the Else checkbox) and presses
 * Save on the trailing add button or above a row. Classic is mounted unchanged and driven live, so the goldens come
 * from the producer (MC-329). Each cell also asserts that classic changed the array, so a driver that stops
 * saving cannot pass.
 *
 * Titles saying "regression reproducer" fail against a Studio module that writes the wrong rows.
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
import { appendEffect, insertEffectBefore } from '../triggerV2Blocks'
import { v2DefaultEffect } from '../triggerV2Defaults'
import {
    APPEND_VARIANTS, CATEGORY_OF_TYPE, INSERT_VARIANTS, MALFORMED_IDS, WELL_FORMED_IDS, corpusArray, type AppendVariant,
} from './triggerBlockCorpus.test-helpers'
import {
    effectsOf, mountV2Events, openPicker, openPickerAboveRow, pickTypeIn, saveEffectForm, toggleAddElse, unmountAll,
} from './classicTriggerDriver.test-helpers.svelte'
import { firstDifference } from './triggerExactEqual.test-helpers'

vi.setConfig({ testTimeout: 30_000 })

afterAll(async () => {
    await unmountAll()
})

const COMPONENT = TriggerV2List as unknown as Component<never>

async function classicAppend(id: string, variant: AppendVariant): Promise<unknown[]> {
    const list = await mountV2Events(COMPONENT, corpusArray(id))
    await openPicker()
    await pickTypeIn(CATEGORY_OF_TYPE[variant.type], variant.type)
    if (variant.addElse) await toggleAddElse()
    await saveEffectForm()
    return effectsOf(list)
}

async function classicInsert(id: string, index: number, variant: AppendVariant): Promise<unknown[]> {
    const list = await mountV2Events(COMPONENT, corpusArray(id))
    await openPickerAboveRow(index)
    await pickTypeIn(CATEGORY_OF_TYPE[variant.type], variant.type)
    if (variant.addElse) await toggleAddElse()
    await saveEffectForm()
    return effectsOf(list)
}

const appendCells = (ids: readonly string[]): Array<readonly [string, string, AppendVariant]> =>
    ids.flatMap((id) => APPEND_VARIANTS.map((variant) => [id, variant.label, variant] as const))

const insertCells = (ids: readonly string[]): Array<readonly [string, number, string, AppendVariant]> =>
    ids.flatMap((id) => corpusArray(id).flatMap((_, index) => INSERT_VARIANTS.map((variant) => [id, index, variant.label, variant] as const)))

describe.each([
    ['TS11-W', WELL_FORMED_IDS],
    ['TS11-M', MALFORMED_IDS],
] as const)('%s append and insert on the %s corpus', (_group, ids) => {
    test.each(appendCells(ids))('regression reproducer: append on %s of %s equals classic, key order included', async (id, _label, variant) => {
        const input = corpusArray(id)
        const classic = await classicAppend(id, variant)
        expect(firstDifference(classic, input), 'classic must change the array').not.toBeNull()
        const studio = appendEffect(corpusArray(id), v2DefaultEffect(variant.type), { addElse: variant.addElse })
        expect(firstDifference(studio, classic)).toBeNull()
    })

    test.each(insertCells(ids))('regression reproducer: insert above %s row %i of %s equals classic, key order included', async (id, index, _label, variant) => {
        const input = corpusArray(id)
        const classic = await classicInsert(id, index, variant)
        expect(firstDifference(classic, input), 'classic must change the array').not.toBeNull()
        const studio = insertEffectBefore(corpusArray(id), index, v2DefaultEffect(variant.type), { addElse: variant.addElse })
        expect(firstDifference(studio, classic)).toBeNull()
    })
})

describe('TS11-c recorder anchors for append and insert (compatibility guards, pass before and after)', () => {
    test('compatibility guard: appending IfAdvanced with Else on W0 gives the opener, an End with endOfLoop false, the Else and a plain End', async () => {
        const classic = await classicAppend('W0', { label: 'IfAdvanced+Else', type: 'v2IfAdvanced', addElse: true })
        expect(firstDifference(classic, [
            v2DefaultEffect('v2IfAdvanced'),
            { type: 'v2EndIndent', indent: 1, endOfLoop: false },
            { type: 'v2Else', indent: 0 },
            { type: 'v2EndIndent', indent: 1 },
        ])).toBeNull()
    })

    test('compatibility guard: inserting IfAdvanced with Else above W1 row 0 writes the End without endOfLoop first and the End with endOfLoop last', async () => {
        const classic = await classicInsert('W1', 0, { label: 'IfAdvanced+Else', type: 'v2IfAdvanced', addElse: true })
        const input = corpusArray('W1')
        expect(firstDifference(classic, [
            v2DefaultEffect('v2IfAdvanced'),
            { type: 'v2EndIndent', indent: 1 },
            { type: 'v2Else', indent: 0 },
            { type: 'v2EndIndent', indent: 1, endOfLoop: false },
            ...input,
        ])).toBeNull()
    })
})
