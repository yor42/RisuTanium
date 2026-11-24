// @vitest-environment jsdom

/**
 * TS11, copy then paste cells: `pasteEffects(target, at, copyEffects(source, index))` equals, key order included,
 * what the real classic `TriggerV2List` writes when a user copies a row (an opener copies its whole block) from one
 * event, selects another event and pastes above a row or at the end. The source event holds a copy of the target
 * array, except for the empty W0 target, which takes its block from W4. Classic is mounted unchanged and driven
 * live (MC-329).
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
import { copyEffects, pasteEffects } from '../triggerV2Blocks'
import {
    COPY_SOURCE_OF, MALFORMED_IDS, WELL_FORMED_IDS, copySources, corpusArray,
} from './triggerBlockCorpus.test-helpers'
import {
    contextMenuOnEnd, contextMenuOnRow, effectsOf, mountV2Events, selectEvent, unmountAll,
} from './classicTriggerDriver.test-helpers.svelte'
import { firstDifference } from './triggerExactEqual.test-helpers'

vi.setConfig({ testTimeout: 30_000 })

afterAll(async () => {
    await unmountAll()
})

const COMPONENT = TriggerV2List as unknown as Component<never>

/** Copies row `sourceIndex` of event 1, selects event 2 and pastes above row `at`, or at the end when `at` is the length. */
async function classicCopyPaste(sourceId: string, sourceIndex: number, targetId: string, at: number): Promise<unknown[]> {
    const target = corpusArray(targetId)
    const list = await mountV2Events(COMPONENT, corpusArray(sourceId), target)
    await contextMenuOnRow(sourceIndex, language.copy)
    await selectEvent(1)
    if (at < target.length) await contextMenuOnRow(at, language.paste)
    else await contextMenuOnEnd(language.paste)
    return effectsOf(list, 2)
}

type Cell = readonly [string, string, number, number]

/** [target id, source label, source index, paste position] for every source row and every paste position. */
const pasteCells = (ids: readonly string[]): Cell[] =>
    ids.flatMap((targetId) => {
        const sourceId = COPY_SOURCE_OF[targetId] ?? targetId
        const length = corpusArray(targetId).length
        return copySources(corpusArray(sourceId)).flatMap(({ label, index }) =>
            Array.from({ length: length + 1 }, (_, at) => [targetId, label, index, at] as const))
    })

describe.each([
    ['TS11-W', WELL_FORMED_IDS],
    ['TS11-M', MALFORMED_IDS],
] as const)('%s copy and paste on the %s corpus', (_group, ids) => {
    test.each(pasteCells(ids))('regression reproducer: paste into %s of the copied %s row %i at %i equals classic, key order included', async (targetId, _label, sourceIndex, at) => {
        const sourceId = COPY_SOURCE_OF[targetId] ?? targetId
        const input = corpusArray(targetId)
        const classic = await classicCopyPaste(sourceId, sourceIndex, targetId, at)
        expect(firstDifference(classic, input), 'classic must change the array').not.toBeNull()
        const copied = copyEffects(corpusArray(sourceId), sourceIndex)
        expect(copied, 'the copy must exist').not.toBeNull()
        const studio = pasteEffects(corpusArray(targetId), at, copied ?? [])
        expect(firstDifference(studio, classic)).toBeNull()
    })
})

describe('TS11-c recorder anchors for paste (compatibility guards, pass before and after)', () => {
    test('compatibility guard: pasting the W4 opener block into the empty W0 appends the whole block', async () => {
        const classic = await classicCopyPaste('W4', 0, 'W0', 0)
        expect(firstDifference(classic, corpusArray('W4').slice(0, 5))).toBeNull()
    })
})
