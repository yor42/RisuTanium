import { describe, expect, test } from 'vitest'
import type { RisuPlugin } from '../plugins/plugins.svelte'
import { commitPluginArg } from './pluginArgCommit'

function entry(realArg: RisuPlugin['realArg'] = {}): RisuPlugin {
    return { name: 'p', script: '', version: '3.0', arguments: { n: 'int', t: 'string' }, realArg, customLink: [], argMeta: {} }
}

describe('commitPluginArg', () => {
    test('a number is parsed and saved', () => {
        const list = $state([entry({ n: 1 })])
        expect(commitPluginArg(list, list[0], 'n', 'int', '12')).toBe('saved')
        expect(list[0].realArg.n).toBe(12)
        expect(commitPluginArg(list, list[0], 'n', 'int', ' -3.5 ')).toBe('saved')
        expect(list[0].realArg.n).toBe(-3.5)
    })

    test('an empty or non-numeric number is refused and nothing is written', () => {
        const list = $state([entry({ n: 4 })])
        for (const raw of ['', '   ', 'x', '1x', 'NaN', 'Infinity', '1e999']) {
            expect(commitPluginArg(list, list[0], 'n', 'int', raw)).toBe('invalid')
        }
        expect(list[0].realArg.n).toBe(4)
    })

    test('text is stored as typed, including an empty string', () => {
        const list = $state([entry({ t: 'old' })])
        expect(commitPluginArg(list, list[0], 't', 'string', '')).toBe('saved')
        expect(list[0].realArg.t).toBe('')
    })

    test('an entry that is no longer listed is not written', () => {
        const kept = entry({ t: 'old' })
        const gone = entry({ t: 'old' })
        const list = $state([kept])
        expect(commitPluginArg(list, gone, 't', 'string', 'new')).toBe('gone')
        expect(gone.realArg.t).toBe('old')
        expect(commitPluginArg(undefined, gone, 't', 'string', 'new')).toBe('gone')
    })

    test('the same value is reported unchanged', () => {
        const list = $state([entry({ n: 7, t: 'a' })])
        expect(commitPluginArg(list, list[0], 'n', 'int', '7')).toBe('unchanged')
        expect(commitPluginArg(list, list[0], 't', 'string', 'a')).toBe('unchanged')
    })
})
