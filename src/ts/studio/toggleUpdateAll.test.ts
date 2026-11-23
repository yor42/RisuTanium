// Class G (new-behaviour guard): update all has no earlier version. No row is a regression reproducer.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ClassifiedTarget } from './assets/referenceTargets'
import {
    applyUpdate, checkUndo, isUpdatableToggleKey, planFromScan, restoreUpdate, scanReach, writeOpFor,
    type ScanHit, type UpdatePort, type UpdatePlan, type UpdateReach, type UseOwner, type UseOwnerRef, type UseScan,
} from './toggleUpdateAll'

const target = (path: string, text: string, cls: ClassifiedTarget['cls'] = 'rewritable'): ClassifiedTarget => ({ path, text, cls })
function owner(id: string, targets: ClassifiedTarget[], toggleText = '', kind: 'character' | 'module' = 'character'): UseOwner {
    return kind === 'character'
        ? { ref: { kind, chaId: id }, key: `character:${id}`, name: id, toggleText, targets }
        : { ref: { kind, moduleId: id }, key: `module:${id}`, name: id, toggleText, targets }
}
const reachOf = (...owners: UseOwner[]): UpdateReach => ({ owners, unreached: [] })

function plan(reach: UpdateReach, renames: { from: string, to: string }[], optIn: string[] = []): UpdatePlan {
    return planFromScan(reach, scanReach(reach, new Set(renames.map((rename) => rename.from))), renames, new Set(optIn))
}

describe('isUpdatableToggleKey (U7a)', () => {
    test.each([
        ['a'], ['Z'], ['기분'], ['각'], ['हिंदी'], ['é'], ['7'], ['٣'], ['_'], ['-'], ['mood_2-b'],
    ])('%j is updatable', (key) => {
        expect(isUpdatableToggleKey(key)).toBe(true)
    })

    test.each([
        ['a:b'], ['mood:'], ['a::b'], ['{a'], ['a}'], ['a#'], ['<a'], ['a>'], ['a|b'], ['a b'], ['a=b'], [''],
    ])('%j is not updatable', (key) => {
        expect(isUpdatableToggleKey(key)).toBe(false)
    })

    test('every printable ASCII character outside letters, digits, _ and -, and the invisible ones, is refused alone and between letters', () => {
        const refused: string[] = []
        for (let code = 0x20; code < 0x7f; code++) {
            const char = String.fromCharCode(code)
            if (!/[A-Za-z0-9_-]/.test(char)) {
                refused.push(char)
            }
        }
        refused.push('​', ' ', '\n', '‍', '­')
        for (const char of refused) {
            expect(isUpdatableToggleKey(char), JSON.stringify(char)).toBe(false)
            expect(isUpdatableToggleKey(`a${char}b`), JSON.stringify(char)).toBe(false)
        }
    })

    test('numerals of every number category are digits for this rule', () => {
        expect(isUpdatableToggleKey('²')).toBe(true)
        expect(isUpdatableToggleKey('Ⅷ')).toBe(true)
    })
})

describe('a blocked plan writes nothing and lists every use (U7b to U7d)', () => {
    const text = '{{getglobalvar::toggle_mood::x}}{{#when::mood::tis::1}}Z{{/}}{{getglobalvar::toggle_mood}}'

    test('U7b a new key ending in a colon', () => {
        const reach = reachOf(owner('c', [target('desc', text)], 'mood=Mood\n'))
        const result = plan(reach, [{ from: 'mood', to: 'mood:' }])
        expect(result.writes).toEqual([])
        expect(result.count).toBe(0)
        expect(result.blocked).toEqual(['mood:'])
        expect(result.skipped).toEqual([])
        expect(result.listed.map((use) => [use.reason, use.key, use.path])).toEqual([
            ['blocked', 'mood', 'desc'], ['blocked', 'mood', 'desc'], ['blocked', 'mood', 'desc'],
        ])
    })

    test('U7c an old key that is not updatable', () => {
        const reach = reachOf(owner('c', [target('desc', '{{getglobalvar::toggle_a:b}}')]))
        const result = plan(reach, [{ from: 'a:b', to: 'c' }])
        expect(result.writes).toEqual([])
        expect(result.blocked).toEqual(['a:b'])
        expect(result.listed.map((use) => use.reason)).toEqual(['blocked'])
    })

    test('U7d one failing rename of several blocks the whole plan, and its a-hits are listed too', () => {
        const reach = reachOf(owner('c', [target('desc', '{{getglobalvar::toggle_a}}{{getglobalvar::toggle_c}}')]))
        const result = plan(reach, [{ from: 'a', to: 'b' }, { from: 'c', to: 'c d' }])
        expect(result.writes).toEqual([])
        expect(result.blocked).toEqual(['c d'])
        expect(result.listed.map((use) => [use.key, use.reason])).toEqual([['a', 'blocked'], ['c', 'blocked']])
    })

    test('the blocked keys are deduplicated and kept in rename order', () => {
        const reach = reachOf(owner('c', [target('desc', '{{getglobalvar::toggle_x}}')]))
        expect(plan(reach, [{ from: 'x', to: 'p q' }, { from: 'y', to: 'p q' }]).blocked).toEqual(['p q'])
        expect(plan(reach, [{ from: 'x', to: 'm n' }, { from: 'y', to: 'o p' }]).blocked).toEqual(['m n', 'o p'])
    })

    test('a flagged use keeps its own reason in a blocked plan', () => {
        const reach = reachOf(owner('c', [target('desc', '{{getglobalvar::toggle_a{{x}}}}')]))
        expect(plan(reach, [{ from: 'a', to: 'b c' }]).listed.map((use) => use.reason)).toEqual(['dynamicName'])
    })
})

describe('keys of any script (U7e, U7f)', () => {
    const text = '{{getglobalvar::toggle_mood}}{{#when::toggle::mood}}Z{{/}}{{? @toggle_mood}}{{calc::@toggle_mood}}'

    test.each(['기분', 'a-b'])('U7e renaming mood to %s writes the getglobalvar and #when uses and lists the calc uses', (to) => {
        const reach = reachOf(owner('c', [target('desc', text)]))
        const result = plan(reach, [{ from: 'mood', to }])
        expect(result.writes).toHaveLength(1)
        expect(result.writes[0].after).toBe(`{{getglobalvar::toggle_${to}}}{{#when::toggle::${to}}}Z{{/}}{{? @toggle_mood}}{{calc::@toggle_mood}}`)
        expect(result.count).toBe(2)
        expect(result.listed.map((use) => use.reason)).toEqual(['calcKey', 'calcKey'])
        const rescan = scanReach(reachOf(owner('c', [target('desc', result.writes[0].after)])), new Set([to]))
        expect(rescan.hits.map((hit) => hit.syntax)).toEqual(['getglobalvar', 'when'])
    })

    test.each(['{{? @toggle_mood(1)}}', '{{? @toggle_mood$x}}', '{{calc::@toggle_mood(1)}}'])('U7g %s is listed as calcKey and never rewritten, while a plain use beside it is', (calc) => {
        const result = plan(reachOf(owner('c', [target('desc', `{{getglobalvar::toggle_mood}}${calc}`)])), [{ from: 'mood', to: 'feel' }])
        expect(result.writes[0].after).toBe(`{{getglobalvar::toggle_feel}}${calc}`)
        expect(result.count).toBe(1)
        expect(result.listed.map((use) => use.reason)).toEqual(['calcKey'])
    })

    test('U7f renaming 기분 to mood rewrites its getglobalvar and #when uses; @toggle_기분 is not read by calc', () => {
        const source = '{{getglobalvar::toggle_기분}}{{#when::toggle::기분}}Z{{/}}{{? @toggle_기분}}'
        const result = plan(reachOf(owner('c', [target('desc', source)])), [{ from: '기분', to: 'mood' }])
        expect(result.writes[0].after).toBe('{{getglobalvar::toggle_mood}}{{#when::toggle::mood}}Z{{/}}{{? @toggle_기분}}')
        expect(result.listed).toEqual([])
    })
})

describe('decisions of the planner', () => {
    const read = '{{getglobalvar::toggle_a}}'

    test('P1 an owner that defines the key skips its uses with their count; other owners are written', () => {
        const defining = owner('m', [target('lore/0/content', `${read}${read}`)], 'a=Alpha\n', 'module')
        const other = owner('c', [target('desc', read)], 'z=Zed\n')
        const result = plan(reachOf(other, defining), [{ from: 'a', to: 'b' }])
        expect(result.skipped).toEqual([{ owner: 'module:m', key: 'a', count: 2 }])
        expect(result.writes.map((write) => write.owner)).toEqual(['character:c'])
        expect(result.count).toBe(1)
    })

    test('P2 an opt-in rewrites that owner only', () => {
        const first = owner('m', [target('lore/0/content', read)], 'a=Alpha\n', 'module')
        const second = owner('n', [target('lore/0/content', read)], 'a=Alpha\n', 'module')
        const result = plan(reachOf(first, second), [{ from: 'a', to: 'b' }], ['module:m'])
        expect(result.writes.map((write) => write.owner)).toEqual(['module:m'])
        expect(result.skipped).toEqual([{ owner: 'module:n', key: 'a', count: 1 }])
    })

    test('P3 a swap rewrites both keys exactly, in one pass', () => {
        const result = plan(reachOf(owner('c', [target('desc', '{{getglobalvar::toggle_a}}{{getglobalvar::toggle_b}}')])), [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])
        expect(result.writes[0].after).toBe('{{getglobalvar::toggle_b}}{{getglobalvar::toggle_a}}')
        expect(result.count).toBe(2)
    })

    test('P4 owners are written in reach order, once each, and targets in registry order', () => {
        const first = owner('c', [target('desc', read), target('firstMessage', read)])
        const second = owner('m', [target('lore/0/content', read)], '', 'module')
        const result = plan(reachOf(first, second, first), [{ from: 'a', to: 'long_key' }])
        expect(result.writes.map((write) => write.after)).toEqual(Array(3).fill('{{getglobalvar::toggle_long_key}}'))
        expect(result.count).toBe(3)
        expect(result.writes.map((write) => [write.owner, write.path])).toEqual([
            ['character:c', 'desc'], ['character:c', 'firstMessage'], ['module:m', 'lore/0/content'],
        ])
    })

    test('P5 the signature is stable and follows every part of the plan', () => {
        const base = reachOf(owner('c', [target('desc', `${read}${read}`)], ''), owner('m', [target('lore/0/content', read)], 'a=A\n', 'module'))
        const signature = (reach: UpdateReach, renames = [{ from: 'a', to: 'b' }], optIn: string[] = []) => plan(reach, renames, optIn).signature
        const same = signature(base)
        expect(signature(base)).toBe(same)
        expect(signature(base, [{ from: 'a', to: 'c' }])).not.toBe(same)
        expect(signature(base, undefined, ['module:m'])).not.toBe(same)
        expect(signature(reachOf(owner('c', [target('desc', `x${read}${read}`)], ''), base.owners[1]))).not.toBe(same)
        expect(signature(reachOf(owner('c', [target('desc', read)], ''), base.owners[1]))).not.toBe(same)
        expect(signature(reachOf(owner('c', [target('desc', `${read}{{getglobalvar::toggle_a{{x}}}}`)], ''), base.owners[1]))).not.toBe(same)
        expect(signature(reachOf(base.owners[0]))).not.toBe(same)
        // The same offset and length reading another key is another plan.
        const aa = reachOf(owner('c', [target('desc', '{{getglobalvar::toggle_a}}')]))
        const bb = reachOf(owner('c', [target('desc', '{{getglobalvar::toggle_b}}')]))
        const both = [{ from: 'a', to: 'z' }, { from: 'b', to: 'z' }]
        expect(signature(aa, both)).not.toBe(signature(bb, both))
    })

    test('P6 the write is the splice of its edits, highest offset first, one write per target', () => {
        const text = `x${read}y${read}z`
        const result = plan(reachOf(owner('c', [target('desc', text)])), [{ from: 'a', to: 'long_key' }])
        expect(result.writes).toHaveLength(1)
        expect(result.writes[0]).toMatchObject({ before: text, count: 2, after: text.replaceAll('toggle_a', 'toggle_long_key') })
        expect(result.writes[0].pairs.map(([offset]) => text.slice(offset, offset + 1))).toEqual(['a', 'a'])
    })

    test('a rename of a key to itself changes nothing', () => {
        expect(plan(reachOf(owner('c', [target('desc', read)])), [{ from: 'a', to: 'a' }]).writes).toEqual([])
    })

    test('flagged uses are listed with their reason and never written', () => {
        const reach = reachOf(owner('c', [
            target('trigger/0/effect/0/code', 'getGlobal("toggle_a")', 'flagOnly'),
            target('regex/0/in', '{{getglobalvar::toggle_a}}', 'flagOnly'),
            target('desc', '{{#pure}}{{getglobalvar::toggle_a}}{{/pure}}'),
        ]))
        const result = plan(reach, [{ from: 'a', to: 'b' }])
        expect(result.writes).toEqual([])
        expect(result.listed.map((use) => use.reason)).toEqual(['code', 'regexPattern', 'literalBlock'])
    })
})

describe('the span guard (P7)', () => {
    const read = '{{getglobalvar::toggle_a}}'
    const at = read.indexOf('toggle_a') + 'toggle_'.length
    const hit = (ownerKey: ScanHit['owner'], path: string, offset: number, length = 1): ScanHit => ({ owner: ownerKey, path, offset, length, key: 'a', syntax: 'getglobalvar' })
    const planOver = (reach: UpdateReach, hits: ScanHit[]) =>
        planFromScan(reach, { hits, literalFallback: new Set() } satisfies UseScan, [{ from: 'a', to: 'b' }], new Set())

    test('(a) one wrong offset refuses the whole owner, both its targets, and spares the next owner', () => {
        const reach = reachOf(owner('c', [target('desc', read), target('firstMessage', read)]), owner('d', [target('desc', read)]))
        const result = planOver(reach, [hit('character:c', 'desc', at), hit('character:c', 'firstMessage', at + 2), hit('character:d', 'desc', at)])
        expect(result.writes.map((write) => write.owner)).toEqual(['character:d'])
        expect(result.listed.map((use) => [use.owner, use.path, use.reason])).toEqual([
            ['character:c', 'desc', 'mismatch'], ['character:c', 'firstMessage', 'mismatch'],
        ])
        expect(result.count).toBe(1)
    })

    test('(b) an offset on a later a that is not the key part is refused', () => {
        const text = `${read} a`
        const result = planOver(reachOf(owner('c', [target('desc', text)])), [hit('character:c', 'desc', text.length - 1)])
        expect(result.writes).toEqual([])
        expect(result.listed.map((use) => use.reason)).toEqual(['mismatch'])
    })

    test('(c) a correct scan writes', () => {
        const result = planOver(reachOf(owner('c', [target('desc', read)])), [hit('character:c', 'desc', at)])
        expect(result.writes[0].after).toBe('{{getglobalvar::toggle_b}}')
    })

    test('(d) an offset below the prefix length is refused even when the text starts with the prefix and key', () => {
        const text = `toggle_a ${read}`
        const result = planOver(reachOf(owner('c', [target('desc', text)])), [hit('character:c', 'desc', 4)])
        expect(result.writes).toEqual([])
        expect(result.listed.map((use) => use.reason)).toEqual(['mismatch'])
    })

    test('(e) an offset on the start of a longer key is refused', () => {
        const text = '{{getglobalvar::toggle_ab}}'
        const result = planOver(reachOf(owner('c', [target('desc', text)])), [hit('character:c', 'desc', at)])
        expect(result.writes).toEqual([])
    })

    test('(i) a calc hit followed by a key character is refused, a closing one is not', () => {
        const text = '{{? @toggle_ab}}'
        const calc: ScanHit = { owner: 'character:c', path: 'desc', offset: text.indexOf('ab'), length: 1, key: 'a', syntax: 'calc' }
        expect(planOver(reachOf(owner('c', [target('desc', text)])), [calc]).writes).toEqual([])
        const good = '{{? @toggle_a-1}}'
        expect(planOver(reachOf(owner('c', [target('desc', good)])), [{ ...calc, offset: good.indexOf('a-') }]).writes[0].after).toBe('{{? @toggle_b-1}}')
    })

    test('(f) a hit whose length differs from its key is refused', () => {
        const result = planOver(reachOf(owner('c', [target('desc', read)])), [hit('character:c', 'desc', at, 2)])
        expect(result.writes).toEqual([])
    })

    test('(h) an offset below the prefix length is refused even when the clamped prefix and key match and a closing character follows', () => {
        const text = '::a::x'
        const early: ScanHit = { owner: 'character:c', path: 'desc', offset: 0, length: 1, key: 'a', syntax: 'when' }
        const result = planOver(reachOf(owner('c', [target('desc', text)])), [early])
        expect(result.writes).toEqual([])
        expect(result.listed.map((use) => use.reason)).toEqual(['mismatch'])
    })

    test('(g) a #when hit is guarded by its `::` prefix', () => {
        const text = '{{#when::toggle::a}}'
        const good: ScanHit = { owner: 'character:c', path: 'desc', offset: text.indexOf('a}'), length: 1, key: 'a', syntax: 'when' }
        expect(planOver(reachOf(owner('c', [target('desc', text)])), [good]).writes[0].after).toBe('{{#when::toggle::b}}')
        expect(planOver(reachOf(owner('c', [target('desc', text)])), [{ ...good, offset: good.offset - 1 }]).writes).toEqual([])
    })
})

test('P8 writeOpFor gives the op shape the history replay of each path uses', () => {
    for (const path of ['desc', 'firstMessage', 'exampleMessage'] as const) {
        expect(writeOpFor('character', path, 'v')).toEqual({ op: 'set', path, value: { had: true, value: 'v' } })
    }
    expect(writeOpFor('character', 'alternateGreetings/0', 'v')).toEqual({ op: 'listSet', index: 0, value: 'v' })
    expect(writeOpFor('character', 'alternateGreetings/12', 'v')).toEqual({ op: 'listSet', index: 12, value: 'v' })
    expect(writeOpFor('character', 'lore/0/content', 'v')).toEqual({ op: 'textSet', target: 'lore/0/content', value: 'v' })
    expect(writeOpFor('character', 'systemPrompt', 'v')).toEqual({ op: 'set', path: 'systemPrompt', value: { had: true, value: 'v' } })
    expect(writeOpFor('character', 'depth_prompt/prompt', 'v')).toEqual({ op: 'set', path: 'depth_prompt.prompt', value: { had: true, value: 'v' } })
    expect(writeOpFor('character', 'newGenData/prompt', 'v')).toEqual({ op: 'textSet', target: 'newGenData/prompt', value: 'v' })
    for (const path of ['desc', 'lore/0/content', 'regex/1/out', 'backgroundEmbedding', 'trigger/0/effect/0/value']) {
        expect(writeOpFor('module', path, 'v')).toEqual({ op: 'textSet', target: path, value: 'v' })
    }
})

describe('the plan of a calc use whose new key fails the calc charset', () => {
    test('is listed calcKey while the getglobalvar use of the same key is written', () => {
        const result = plan(reachOf(owner('c', [target('desc', '{{getglobalvar::toggle_a}}{{? @toggle_a}}')])), [{ from: 'a', to: 'b-c' }])
        expect(result.writes[0].after).toBe('{{getglobalvar::toggle_b-c}}{{? @toggle_a}}')
        expect(result.listed.map((use) => use.reason)).toEqual(['calcKey'])
    })
})

// A port over a map of texts. `failOwner` refuses that owner's write; `throwOwner` changes then throws.
function fakePort(initial: Record<string, string>, options: { failOwner?: string, throwOwner?: string, throwSettle?: boolean } = {}) {
    const values = new Map(Object.entries(initial))
    const log: string[] = []
    const keyOf = (ref: UseOwnerRef) => (ref.kind === 'character' ? `character:${ref.chaId}` : `module:${ref.moduleId}`)
    const port: UpdatePort = {
        read: (ref, path) => values.get(`${keyOf(ref)}|${path}`) ?? 'gone',
        write(ref, writes) {
            const id = keyOf(ref)
            log.push(`write ${id}`)
            if (id === options.failOwner) {
                return false
            }
            for (const entry of writes) {
                values.set(`${id}|${entry.path}`, entry.value)
            }
            if (id === options.throwOwner) {
                throw new Error('after change')
            }
            return true
        },
        settle() {
            log.push('settle')
            if (options.throwSettle) {
                throw new Error('settle')
            }
        },
    }
    return { port, values, log }
}

describe('applyUpdate, checkUndo and restoreUpdate over a port', () => {
    const read = '{{getglobalvar::toggle_a}}'
    const reach = reachOf(owner('c', [target('desc', read)]), owner('m', [target('lore/0/content', read)], '', 'module'), owner('n', [target('lore/0/content', read)], '', 'module'))
    const updatePlan = plan(reach, [{ from: 'a', to: 'b' }])
    const before = { 'character:c|desc': read, 'module:m|lore/0/content': read, 'module:n|lore/0/content': read }
    const after = '{{getglobalvar::toggle_b}}'

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    test('a success writes every owner, settles once and journals the plan', () => {
        const { port, values, log } = fakePort(before)
        const result = applyUpdate(updatePlan, port)
        expect(result.ok).toBe(true)
        expect([...values.values()]).toEqual([after, after, after])
        expect(log.filter((line) => line === 'settle')).toHaveLength(1)
        expect(log.at(-1)).toBe('settle')
    })

    test('A2 a refused owner puts back the owners before it, fails, and settles once', () => {
        const { port, values, log } = fakePort(before, { failOwner: 'module:n' })
        expect(applyUpdate(updatePlan, port)).toEqual({ ok: false, reason: 'failed' })
        expect(Object.fromEntries(values)).toEqual(before)
        expect(log.filter((line) => line === 'settle')).toHaveLength(1)
    })

    test('A2b an owner that changes and then throws is put back with the ones before it, last first', () => {
        const { port, values, log } = fakePort(before, { throwOwner: 'module:m' })
        expect(applyUpdate(updatePlan, port)).toEqual({ ok: false, reason: 'failed' })
        expect(Object.fromEntries(values)).toEqual(before)
        expect(log.slice(0, 5)).toEqual(['write character:c', 'write module:m', 'write module:m', 'write character:c', 'settle'])
    })

    test('A2c a settle that throws is recorded and does not change the result', () => {
        const { port, log } = fakePort(before, { throwSettle: true })
        expect(applyUpdate(updatePlan, port).ok).toBe(true)
        expect(log.filter((line) => line === 'settle')).toHaveLength(1)
    })

    test('A3 a changed or gone target names its owner and nothing is written', () => {
        const done = applyUpdate(updatePlan, fakePort(before).port)
        expect(done.ok).toBe(true)
        if (!done.ok) {
            return
        }
        const changed = fakePort({ ...before, 'character:c|desc': after, 'module:m|lore/0/content': 'edited', 'module:n|lore/0/content': after })
        expect(checkUndo(done.journal, changed.port)).toEqual({ ok: false, owner: 'module:m' })
        const gone = fakePort({ 'character:c|desc': after })
        expect(checkUndo(done.journal, gone.port)).toEqual({ ok: false, owner: 'module:m' })
        expect(changed.log).toEqual([])
        expect(checkUndo(done.journal, fakePort({ 'character:c|desc': after, 'module:m|lore/0/content': after, 'module:n|lore/0/content': after }).port)).toEqual({ ok: true })
    })

    test('A4 a restore refused at an owner rolls the owners before it back to what the update wrote', () => {
        const done = applyUpdate(updatePlan, fakePort(before).port)
        if (!done.ok) {
            throw new Error('apply failed')
        }
        const state = { 'character:c|desc': after, 'module:m|lore/0/content': after, 'module:n|lore/0/content': after }
        const refused = fakePort(state, { failOwner: 'module:n' })
        expect(restoreUpdate(done.journal, refused.port)).toEqual({ ok: false, reason: 'failed' })
        expect(Object.fromEntries(refused.values)).toEqual(state)
        const thrown = fakePort(state, { throwOwner: 'module:m' })
        expect(restoreUpdate(done.journal, thrown.port)).toEqual({ ok: false, reason: 'failed' })
        expect(Object.fromEntries(thrown.values)).toEqual(state)
    })

    test('A5 a restore writes each target its before text and settles once', () => {
        const done = applyUpdate(updatePlan, fakePort(before).port)
        if (!done.ok) {
            throw new Error('apply failed')
        }
        const state = fakePort({ 'character:c|desc': after, 'module:m|lore/0/content': after, 'module:n|lore/0/content': after })
        expect(restoreUpdate(done.journal, state.port)).toEqual({ ok: true })
        expect(Object.fromEntries(state.values)).toEqual(before)
        expect(state.log.filter((line) => line === 'settle')).toHaveLength(1)
    })
})
