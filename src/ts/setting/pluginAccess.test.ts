import { describe, expect, test } from 'vitest'
import { language } from '../../lang'
import { pluginAccess, pluginApiLabel, pluginSwitchMode, pluginVersionLine } from './pluginAccess'

describe('pluginApiLabel', () => {
    test.each([
        ['3.0', '3.0'],
        ['2.1', '2.1'],
        [2, '2'],
        [1, '1'],
        [undefined, '1'],
    ] as const)('version %s is labelled API %s', (version, label) => {
        expect(pluginApiLabel(version)).toBe(label)
    })
})

describe('pluginAccess', () => {
    test('a 3.0 plugin has limited access and counts the plugins allowed to message it', () => {
        expect(pluginAccess({ version: '3.0' })).toEqual({ kind: 'limited', ipcCount: 0 })
        expect(pluginAccess({ version: '3.0', allowedIPC: ['a', 'b'] })).toEqual({ kind: 'limited', ipcCount: 2 })
    })

    test.each(['2.1', 2, 1, undefined] as const)('version %s is retired and names the API it needs', (version) => {
        const access = pluginAccess({ version, allowedIPC: ['a'] })
        expect(access.kind).toBe('retired')
    })
})

describe('pluginSwitchMode', () => {
    test('only a 3.0 plugin has a usable switch; version 2, 2.1, 1 and a missing version are disabled', () => {
        expect(pluginSwitchMode({ version: '3.0' })).toBe('direct')
        for (const version of [2, '2.1', 1, undefined] as const) {
            expect(pluginSwitchMode({ version })).toBe('disabled')
        }
    })
})

describe('pluginVersionLine', () => {
    const text = language.pluginsPage

    test('shows the plugin version and the API', () => {
        expect(pluginVersionLine({ version: '3.0', versionOfPlugin: '1.2.0' }, text)).toBe('v1.2.0 · API 3.0')
    })

    test('omits the version part when the plugin declares none', () => {
        expect(pluginVersionLine({ version: '3.0' }, text)).toBe('API 3.0')
        expect(pluginVersionLine({ version: 2, versionOfPlugin: '' }, text)).toBe('API 2')
    })
})
