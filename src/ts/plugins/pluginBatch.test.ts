/**
 * The pure plugin batch rules (src/ts/plugins/pluginBatch.ts): how picked files
 * sort against the installed list, how accepted entries are applied, and how a
 * review section is capped. Labels: "feature" tests describe the new behaviour
 * and fail without pluginBatch.ts; "guard" tests pin a property that must stay.
 */
import { describe, test, expect } from 'vitest'
import type { RisuPlugin } from './plugins.svelte'
import { applyPluginBatch, capReviewLines, classifyPluginBatch, type PreparedPlugin } from './pluginBatch'

function plugin(name: string, extra: Partial<RisuPlugin> = {}): RisuPlugin {
    return {
        name, displayName: name, script: `//@name ${name}\n// installed`, version: '3.0',
        arguments: { key: 'string' }, realArg: { key: '' }, customLink: [], argMeta: {}, enabled: true,
        ...extra,
    } as RisuPlugin
}

function prepared(file: string, name: string, extra: Partial<RisuPlugin> = {}): PreparedPlugin {
    return { file, entry: plugin(name, { script: `//@name ${name}\n// incoming`, ...extra }) }
}

const REPEATED = 'repeated'

describe('classifyPluginBatch', () => {
    test('feature: a name not installed is new, an installed name is an update with both versions', () => {
        const live = [plugin('A', { versionOfPlugin: '1.0.0' })]
        const result = classifyPluginBatch(live, [prepared('a.js', 'A', { versionOfPlugin: '2.0.0' }), prepared('b.js', 'B')], REPEATED)
        expect(result.news.map((n) => n.file)).toEqual(['b.js'])
        expect(result.updates).toHaveLength(1)
        expect(result.updates[0]).toMatchObject({ file: 'a.js', fromVersion: '1.0.0', toVersion: '2.0.0' })
        expect(result.failed).toEqual([])
    })

    test('feature: the same script, or a version that is not newer, is still an update', () => {
        const same = plugin('A', { script: 'same', versionOfPlugin: '3.0.0' })
        const result = classifyPluginBatch(
            [same, plugin('B', { versionOfPlugin: '5.0.0' })],
            [{ file: 'a.js', entry: plugin('A', { script: 'same', versionOfPlugin: '3.0.0' }) }, prepared('b.js', 'B', { versionOfPlugin: '1.0.0' })],
            REPEATED,
        )
        expect(result.updates.map((u) => u.file)).toEqual(['a.js', 'b.js'])
        expect(result.news).toEqual([])
    })

    test('feature: a version missing on either side is reported as empty, not undefined', () => {
        const result = classifyPluginBatch([plugin('A')], [prepared('a.js', 'A')], REPEATED)
        expect(result.updates[0].fromVersion).toBe('')
        expect(result.updates[0].toVersion).toBe('')
    })

    test('feature: a name repeated inside the batch counts once, the later file fails with the repeated reason', () => {
        const result = classifyPluginBatch([], [prepared('one.js', 'A'), prepared('two.js', 'A'), prepared('three.js', 'A')], REPEATED)
        expect(result.news.map((n) => n.file)).toEqual(['one.js'])
        expect(result.failed).toEqual([{ file: 'two.js', reason: REPEATED }, { file: 'three.js', reason: REPEATED }])
    })

    test('guard: an installed entry with no name never matches and never throws', () => {
        const unnamed = { script: 'x' } as unknown as RisuPlugin
        const result = classifyPluginBatch([unnamed, plugin('A')], [prepared('a.js', 'A'), prepared('b.js', 'B')], REPEATED)
        expect(result.updates.map((u) => u.file)).toEqual(['a.js'])
        expect(result.news.map((n) => n.file)).toEqual(['b.js'])
    })

    test('guard: the installed list is not changed', () => {
        const live = [plugin('A')]
        const before = JSON.stringify(live)
        classifyPluginBatch(live, [prepared('a.js', 'A')], REPEATED)
        expect(JSON.stringify(live)).toBe(before)
    })
})

describe('applyPluginBatch', () => {
    test('feature: an update keeps its place, its saved values and its on/off state', () => {
        const live = [plugin('A'), plugin('B', { realArg: { key: 'secret' }, enabled: false }), plugin('C')]
        applyPluginBatch(live, [plugin('B', { script: 'new', realArg: { key: '' } })])
        expect(live.map((p) => p.name)).toEqual(['A', 'B', 'C'])
        expect(live[1].script).toBe('new')
        expect(live[1].realArg).toEqual({ key: 'secret' })
        expect(live[1].enabled).toBe(false)
    })

    test('feature: a new plugin is appended switched on, in the order given', () => {
        const live = [plugin('A')]
        applyPluginBatch(live, [plugin('X', { enabled: undefined }), plugin('Y')])
        expect(live.map((p) => p.name)).toEqual(['A', 'X', 'Y'])
        expect(live[1].enabled).toBe(true)
    })

    test('guard: plugins without a name are never removed or reordered', () => {
        const unnamedFirst = { script: 'u1' } as unknown as RisuPlugin
        const unnamedLast = { script: 'u2' } as unknown as RisuPlugin
        const live = [unnamedFirst, plugin('A'), unnamedLast, plugin('B')]
        applyPluginBatch(live, [plugin('B', { script: 'new' }), plugin('N')])
        expect(live[0]).toBe(unnamedFirst)
        expect(live[2]).toBe(unnamedLast)
        expect(live.map((p) => p.name)).toEqual([undefined, 'A', undefined, 'B', 'N'])
    })

    test('feature: each name is looked up in the list as it is now, so a plugin removed meanwhile is added again, not skipped', () => {
        const live = [plugin('A'), plugin('B')]
        live.splice(0, 1)
        applyPluginBatch(live, [plugin('A', { script: 'new' })])
        expect(live.map((p) => p.name)).toEqual(['B', 'A'])
        expect(live[1].script).toBe('new')
    })
})

describe('capReviewLines', () => {
    const more = (n: number) => `+${n}`
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`)

    test('feature: 15 lines pass unchanged', () => {
        expect(capReviewLines(lines(15), more)).toEqual(lines(15))
    })

    test('feature: more than 15 lines show 15 and then the count of the rest', () => {
        const out = capReviewLines(lines(16), more)
        expect(out).toHaveLength(16)
        expect(out[14]).toBe('l14')
        expect(out[15]).toBe('+1')
        expect(capReviewLines(lines(40), more)[15]).toBe('+25')
    })

    test('guard: an empty section stays empty', () => {
        expect(capReviewLines([], more)).toEqual([])
    })
})
