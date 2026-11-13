import { describe, expect, test } from 'vitest'
import { emptyRecord, type Op, type OwnerRecord, type Step } from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'
import { createRetainedPaths, retainedPathsOf, stepNamesAssetPath, stepsOf } from '../retainedPaths'

function step(id: string, ops: Op[]): Step {
    return { id, at: 0, label: { kind: 'assetDelete', count: 1, name: null }, ops }
}

const remove = (path: string): Op => ({ op: 'assetRowRemove', array: 'additionalAssets', index: 0, tuple: ['n', path], count: 1 })
const insert = (path: string): Op => ({ op: 'assetRowInsert', array: 'emotionImages', index: 0, tuple: ['n', path], count: 0 })
const set = (before: string, after: string): Op => ({ op: 'assetRowSet', array: 'assets', index: 0, before: ['n', before], after: ['n', after] })

function record(done: Step[], undone: Step[] = []): OwnerRecord {
    return { ...emptyRecord(characterOwnerKey('c1'), 0), done, undone }
}

describe('retainedPathsOf', () => {
    test('names the sorted unique paths of every asset op and nothing else', () => {
        const steps = new Set<Step>([
            step('a', [remove('p2'), insert('p1')]),
            step('b', [set('p3', 'p4'), remove('p2')]),
            step('c', [{ op: 'textEdit', target: 'desc', offset: 0, from: 'a', to: 'b' }, { op: 'listInsert', index: 0, value: 'p9' }]),
        ])
        expect(retainedPathsOf(steps)).toEqual(['p1', 'p2', 'p3', 'p4'])
        expect(retainedPathsOf(new Set())).toEqual([])
    })

    test('stepNamesAssetPath is true only for a step with an asset path', () => {
        expect(stepNamesAssetPath(step('a', [remove('p1')]))).toBe(true)
        expect(stepNamesAssetPath(step('b', [{ op: 'assetFolderOrder', before: [], after: ['F'] }]))).toBe(false)
        expect(stepNamesAssetPath(step('c', [{ op: 'listInsert', index: 0, value: 'p1' }]))).toBe(false)
    })

    test('stepsOf holds a step shared by two records once', () => {
        const shared = step('s', [remove('p1')])
        const a = record([shared], [step('u', [remove('p2')])])
        const b = record([shared])
        expect(stepsOf(a, b).size).toBe(2)
    })

    test('T38r the incremental output equals a from-scratch union after each of 200 random joins and departures', () => {
        let seed = 7
        const next = (n: number): number => {
            seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
            return seed % n
        }
        const pool: Step[] = []
        for (let i = 0; i < 12; i++) {
            pool.push(step(`s${i}`, [remove(`p${next(6)}`), ...(next(2) === 0 ? [insert(`p${next(6)}`)] : [])]))
        }
        const memory = new Set<Step>()
        const acknowledged = new Set<Step>()
        const unsettled = new Set<Step>()
        const tracker = createRetainedPaths()
        for (let i = 0; i < 200; i++) {
            const target = [memory, acknowledged, unsettled][next(3)]
            const chosen = pool[next(pool.length)]
            if (target.has(chosen)) {
                target.delete(chosen)
            } else {
                target.add(chosen)
            }
            // A step held by two sets is one member of the union.
            const union = new Set<Step>([...memory, ...acknowledged, ...unsettled])
            expect(tracker.update(union)).toEqual(retainedPathsOf(union))
        }
    })

    test('a step held by two records is released when it leaves both', () => {
        const shared = step('s', [remove('p1')])
        const tracker = createRetainedPaths()
        expect(tracker.update(stepsOf(record([shared]), record([shared])))).toEqual(['p1'])
        expect(tracker.update(stepsOf(record([]), record([])))).toEqual([])
    })

    test('T77a a first call over 200 steps of 300 ops and an incremental update stay within the budget', () => {
        // Best of five on fresh steps (a cold per-step cache each time): a loaded host spikes single runs.
        let firstMs = Infinity
        let updateMs = Infinity
        for (let attempt = 0; attempt < 5; attempt++) {
            const steps: Step[] = []
            for (let i = 0; i < 200; i++) {
                const ops: Op[] = []
                for (let j = 0; j < 300; j++) {
                    ops.push(remove(`p${(i * 300 + j) % 1000}`))
                }
                steps.push(step(`s${i}`, ops))
            }
            const tracker = createRetainedPaths()
            const start = performance.now()
            const first = tracker.update(new Set(steps))
            firstMs = Math.min(firstMs, performance.now() - start)
            expect(first).toHaveLength(1000)
            const joined = new Set(steps)
            joined.add(step('extra', [remove('p5000')]))
            const again = performance.now()
            tracker.update(joined)
            updateMs = Math.min(updateMs, performance.now() - again)
        }
        // The plan's PC-proxy budgets; the phone run is owed.
        expect(firstMs).toBeLessThan(10)
        expect(updateMs).toBeLessThan(2)
    })
})

describe('retainedPaths across two records and an unsettled set', () => {
    test('a step held by both records is counted once and released when it leaves both', () => {
        const shared = step('s', [remove('p1')])
        const memory = record([shared])
        const acknowledged = record([shared])
        const tracker = createRetainedPaths()
        expect(tracker.update(stepsOf(memory, acknowledged))).toEqual(['p1'])
        // An unchanged update names the same set: no step is counted again.
        expect(tracker.update(stepsOf(memory, acknowledged))).toEqual(['p1'])
        // It leaves the memory record only: the acknowledged record still holds it.
        expect(tracker.update(stepsOf(record([]), acknowledged))).toEqual(['p1'])
        expect(tracker.update(stepsOf(record([]), acknowledged))).toEqual(['p1'])
        // It leaves both: the path is gone.
        expect(tracker.update(stepsOf(record([]), record([])))).toEqual([])
    })
})
