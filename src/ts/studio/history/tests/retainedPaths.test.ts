import { describe, expect, test } from 'vitest'
import { emptyRecord, type Op, type OwnerRecord, type Step } from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'
import { createRetainedPaths, nameOfPathIn, retainedPathsOf, stepNamesAssetPath, stepPathPairs, stepsOf } from '../retainedPaths'

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

    test('B-T11: a portrait step names the stored files it adds or removes, with the alternate\'s name, and never a file that stays or a non-store path', () => {
        const row = (uri: string, name: string) => ({ type: 'icon', name, uri, ext: 'png' })
        const stored = (letter: string): string => `assets/${letter.repeat(64)}.png`
        const portrait = (image: string, rows: ReturnType<typeof row>[]): Extract<Op, { op: 'portraitSet' }>['before'] => ({ image: { had: true, value: image }, alternates: { had: true, rows } })
        // Add: M moves to the alternates (stays), N is new; the old alternate P stays.
        const add = step('a', [{ op: 'portraitSet', before: portrait(stored('m'), [row(stored('p'), 'second')]), after: portrait(stored('n'), [row(stored('p'), 'second'), row(stored('m'), 'iconx')]) }])
        expect(stepPathPairs(add)).toEqual([['', stored('n')]])
        // Remove an alternate: the alternate's name comes with its path.
        const removeAlt = step('b', [{ op: 'portraitSet', before: portrait(stored('n'), [row(stored('p'), 'second')]), after: portrait(stored('n'), []) }])
        expect(stepPathPairs(removeAlt)).toEqual([['second', stored('p')]])
        // A swap keeps every file: it names none. A path outside the store is never named.
        const swap = step('c', [{ op: 'portraitSet', before: portrait(stored('n'), [row(stored('p'), 'second')]), after: portrait(stored('p'), [row(stored('n'), 'iconx')]) }])
        expect(stepNamesAssetPath(swap)).toBe(false)
        const foreign = step('d', [{ op: 'portraitSet', before: portrait('https://x.test/a.png', []), after: portrait(stored('n'), []) }])
        expect(retainedPathsOf(new Set([foreign]))).toEqual([stored('n')])
        expect(retainedPathsOf(new Set([add, removeAlt, swap]))).toEqual([stored('n'), stored('p')].sort())
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

    test('T77a each step\'s ops are walked once in total: a first call over 200 steps of 300 ops, an update after one new step and one departure, and the per-step name reads', () => {
        // Work is counted, not timed: every read of a step's ops goes through a Proxy, so the counts hold on any host.
        // A lost per-step cache (a later read of a cached step walks its ops again) or a full rescan on update
        // raises a count. The Map get/set calls of an update are counted the same way: an update that rebuilds every
        // count from every cached step makes tens of thousands of calls, the real one a few per changed path, so the
        // bounds hold on any host. The plan's timing budgets (first update under 10 ms, incremental under 2 ms) are not
        // asserted here or by any test; they are judged by the owed T77b device run.
        const mapCalls = (run: () => void): number => {
            const originalGet = Map.prototype.get
            const originalSet = Map.prototype.set
            let calls = 0
            Map.prototype.get = function (this: Map<unknown, unknown>, key: unknown) {
                calls++
                return originalGet.call(this, key)
            }
            Map.prototype.set = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
                calls++
                return originalSet.call(this, key, value)
            }
            try {
                run()
            } finally {
                Map.prototype.get = originalGet
                Map.prototype.set = originalSet
            }
            return calls
        }
        const walks: number[] = []
        const reads: number[] = []
        const counted = (index: number, ops: Op[]): Op[] => new Proxy(ops, {
            get(target, key, receiver) {
                if (key === Symbol.iterator) {
                    walks[index]++
                } else if (typeof key === 'string' && /^\d+$/.test(key)) {
                    reads[index]++
                }
                return Reflect.get(target, key, receiver)
            },
        })
        const make = (index: number, ops: Op[]): Step => {
            walks[index] = 0
            reads[index] = 0
            return step(`s${index}`, counted(index, ops))
        }
        const steps: Step[] = []
        for (let i = 0; i < 200; i++) {
            const ops: Op[] = []
            for (let j = 0; j < 300; j++) {
                ops.push(remove(`p${(i * 300 + j) % 1000}`))
            }
            steps.push(make(i, ops))
        }
        const tracker = createRetainedPaths()
        const first = tracker.update(new Set(steps))
        expect(first).toHaveLength(1000)
        // The proxy sees the walk: once per step, every op read once.
        expect(walks.every(count => count === 1)).toBe(true)
        expect(reads.every(count => count === 300)).toBe(true)

        const joined = new Set(steps)
        const extra = make(200, [remove('p5000')])
        joined.add(extra)
        let again: string[] = []
        // One new step naming one path: a get and a set for it, far under the bound; a rebuild is over 100000.
        expect(mapCalls(() => { again = tracker.update(joined) })).toBeLessThan(100)
        expect(again).toHaveLength(1001)
        expect(again).toContain('p5000')
        expect(walks.slice(0, 200).every(count => count === 1)).toBe(true)
        expect(reads.slice(0, 200).every(count => count === 300)).toBe(true)
        expect(walks[200]).toBe(1)
        expect(reads[200]).toBe(1)

        // A departure subtracts the step's cached paths, and the name reads use the same cache.
        const left = new Set(joined)
        left.delete(steps[0])
        // Its 300 paths are all named by other steps, so the set is unchanged; the calls are 300 gets and sets at most.
        let afterFirstLeaves: string[] = []
        expect(mapCalls(() => { afterFirstLeaves = tracker.update(left) })).toBeLessThan(2000)
        expect(afterFirstLeaves).toEqual(again)
        for (const kept of left) {
            stepNamesAssetPath(kept)
        }
        expect(nameOfPathIn([...left], 'p5000')).toBe('n')
        // The step that alone names p5000 leaves: subtraction drops the path and keeps the other 1000.
        const gone = new Set(left)
        gone.delete(extra)
        let afterExtraLeaves: string[] = []
        expect(mapCalls(() => { afterExtraLeaves = tracker.update(gone) })).toBeLessThan(100)
        expect(afterExtraLeaves).toHaveLength(1000)
        expect(afterExtraLeaves).not.toContain('p5000')
        expect(walks.slice(0, 201).every(count => count === 1)).toBe(true)
        expect(reads.slice(0, 200).every(count => count === 300)).toBe(true)
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

describe('nameOfPathIn', () => {
    test('is the name the first step naming the path gave it, and the path when no step names it or the name is empty', () => {
        const named = step('a', [{ op: 'assetRowRemove', array: 'additionalAssets', index: 0, tuple: ['grin', 'p1'], count: 1 }])
        const later = step('b', [{ op: 'assetRowRemove', array: 'additionalAssets', index: 0, tuple: ['other', 'p1'], count: 1 }])
        const blank = step('c', [assetRowRemoveOp('', 'p2')])
        expect(nameOfPathIn([named, later], 'p1')).toBe('grin')
        expect(nameOfPathIn([later, named], 'p1')).toBe('other')
        expect(nameOfPathIn([named], 'missing')).toBe('missing')
        expect(nameOfPathIn([blank], 'p2')).toBe('p2')
        expect(nameOfPathIn([], 'p1')).toBe('p1')
    })
})

function assetRowRemoveOp(name: string, path: string): Op {
    return { op: 'assetRowRemove', array: 'additionalAssets', index: 0, tuple: [name, path], count: 1 }
}
