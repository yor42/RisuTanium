/**
 * DIAGNOSTIC (5g), not a pass criterion. Runs the whole search stack over the scale fixture (2,000 lore entries,
 * 150 modules of which 75 are not loaded, 20 presets) with the real clock and reports how many slices the scan took
 * and how long. Timings depend on the machine and are printed, never asserted; the assertions cover only what holds
 * on any machine: the scan finishes, the list is capped, and no stub body is read.
 */
import { describe, expect, test } from 'vitest'
import { buildOwnerModel } from './ownerModel'
import { createSearchRunner, type RunnerState } from './searchRunner'
import { createSearchWork, planSearch, prepareQuery, type SearchChip, type SearchResult } from './studioSearch'
import { makeScaleFixture } from './studioFixtures.test-helpers'

function scanOnce(query: string, chips: SearchChip[]): Promise<{ last: RunnerState<SearchResult>, slices: number, ms: number, bodyReads: string[] }> {
    const fixture = makeScaleFixture()
    const model = buildOwnerModel(fixture.input)
    let slices = 0
    const began = performance.now()
    return new Promise((resolve) => {
        const runner = createSearchRunner<SearchResult>({
            current: () => ({ visitId: 1, modelVersion: 1 }),
            onUpdate: (state) => {
                slices += 1
                if (state.running) return
                resolve({ last: state, slices, ms: performance.now() - began, bodyReads: [...fixture.reads] })
            },
        })
        runner.start(query, () => createSearchWork(planSearch(model), {
            query: prepareQuery(query),
            chips: new Set(chips),
            labels: { kind: (kind) => kind, item: (item) => item.name || `${item.kind} ${item.index + 1}` },
            sources: {
                character: { chatPage: 0 },
                modules: fixture.input.modules,
                presets: [],
            },
        }))
    })
}

describe('5g scale diagnostic (desktop; timings are reported, not asserted)', () => {
    test('a name search over the scale fixture finishes, is capped and reads no stub body', async () => {
        const run = await scanOnce('lore', ['lore'])
        console.info(`[5g] name search: ${run.slices} updates, ${run.ms.toFixed(1)} ms, ${run.last.results.length} shown, ${run.last.more} more`)
        expect(run.last.running).toBe(false)
        expect(run.bodyReads).toEqual([])
        expect(run.last.results).toHaveLength(200)
        expect(run.last.more).toBeGreaterThan(0)
    })

    test('a text search over every kind finishes and reads no stub body', async () => {
        const run = await scanOnce('body', [])
        console.info(`[5g] text search: ${run.slices} updates, ${run.ms.toFixed(1)} ms, ${run.last.results.length} shown, ${run.last.more} more`)
        expect(run.last.running).toBe(false)
        expect(run.bodyReads).toEqual([])
        expect(run.last.results.length).toBeGreaterThan(0)
    })
})
