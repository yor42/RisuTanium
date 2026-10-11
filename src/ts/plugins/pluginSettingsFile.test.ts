/**
 * The plugin settings file seams (src/ts/plugins/pluginSettingsFile.ts): serialize, parse, plan,
 * the write-key intersection, and the import/export flows driven with injected dialogs. New
 * module, so there is no red-before-green reproducer: the evidence is that each named mutant
 * (see the report) fails one of these tests. Titles beginning "guard:" pin behaviour that holds
 * for any correct implementation.
 */
import { describe, test, expect, vi } from 'vitest'
import type { RisuPlugin } from './plugins.svelte'
import {
    applyPluginSettings,
    exportPluginSettings,
    findPluginByName,
    importPluginSettings,
    isSettingsFileTooLarge,
    openPluginSettingsMenu,
    parsePluginSettingsFile,
    planPluginSettings,
    selectWriteKeys,
    serializePluginSettings,
    pluginSettingsFileName,
    type PluginSettingsDeps,
} from './pluginSettingsFile'

function plugin(name: string, over: Partial<RisuPlugin> = {}): RisuPlugin {
    return {
        name, displayName: name, script: '', version: '3.0',
        arguments: { key: 'string', size: 'int', mode: ['a', 'b'] },
        realArg: { key: 'old-key', size: 3, mode: 'a' },
        customLink: [], argMeta: {}, enabled: true,
        ...over,
    } as RisuPlugin
}

const fileText = (values: Record<string, unknown>, name = 'P') =>
    JSON.stringify({ type: 'risutanium-plugin-settings', version: 1, plugin: { name, values } })

describe('serializePluginSettings', () => {
    test('exports declared visible keys only, never an undeclared stored key', () => {
        const p = plugin('P', { realArg: { key: 'k', size: 4, mode: 'b', stray: 'x', hidden_token: 't' } as RisuPlugin['realArg'],
            arguments: { key: 'string', size: 'int', mode: ['a', 'b'], hidden_token: 'string' } })
        const out = JSON.parse(serializePluginSettings(p))
        expect(out.plugin.values).toEqual({ key: 'k', size: 4, mode: 'b' })
    })

    test('a string argument stored as a number is exported as a string', () => {
        const out = JSON.parse(serializePluginSettings(plugin('P', { arguments: { key: 'string' }, realArg: { key: 7 } })))
        expect(out.plugin.values.key).toBe('7')
    })

    test('a select argument is exported only when its stored value is a string', () => {
        const out = JSON.parse(serializePluginSettings(plugin('P', { arguments: { mode: ['a', 'b'] }, realArg: { mode: 3 } })))
        expect(out.plugin.values).toEqual({})
    })

    test('an int argument keeps a number or numeric string and skips other values', () => {
        const a = JSON.parse(serializePluginSettings(plugin('P', { arguments: { size: 'int' }, realArg: { size: '5' } })))
        const b = JSON.parse(serializePluginSettings(plugin('P', { arguments: { size: 'int' }, realArg: { size: 'abc' } })))
        expect(a.plugin.values.size).toBe('5')
        expect(b.plugin.values).toEqual({})
    })

    test('an undefined realArg and undefined values are tolerated', () => {
        const p = plugin('P')
        ;(p as { realArg?: RisuPlugin['realArg'] }).realArg = undefined
        expect(JSON.parse(serializePluginSettings(p)).plugin.values).toEqual({})
    })

    test('the file carries the plugin version when known and nothing about enabled or the script', () => {
        const out = JSON.parse(serializePluginSettings(plugin('P', { versionOfPlugin: '1.2', script: 'SECRET-SCRIPT' })))
        expect(out.plugin.versionOfPlugin).toBe('1.2')
        expect(JSON.stringify(out)).not.toContain('SECRET-SCRIPT')
        expect(JSON.stringify(out)).not.toContain('enabled')
    })

    test('the file name is the plugin file stem plus .settings.json', () => {
        expect(pluginSettingsFileName('a/b')).toBe('ab.settings.json')
        expect(pluginSettingsFileName('')).toBe('plugin.settings.json')
    })
})

describe('parsePluginSettingsFile', () => {
    test('refuses bad JSON, wrong type, wrong version and a malformed shape', () => {
        const refusal = (text: string) => { const r = parsePluginSettingsFile(text); return 'reason' in r ? r.reason : 'ok' }
        expect(refusal('{nope')).toBe('json')
        expect(refusal(JSON.stringify({ type: 'other', version: 1, plugin: { name: 'P', values: {} } }))).toBe('type')
        expect(refusal(JSON.stringify({ type: 'risutanium-plugin-settings', version: 0, plugin: { name: 'P', values: {} } }))).toBe('version')
        expect(refusal(JSON.stringify({ type: 'risutanium-plugin-settings', version: 2, plugin: { name: 'P', values: {} } }))).toBe('version')
        expect(refusal(JSON.stringify({ type: 'risutanium-plugin-settings', version: 1, plugin: { values: {} } }))).toBe('shape')
        expect(refusal(JSON.stringify({ type: 'risutanium-plugin-settings', version: 1, plugin: { name: 'P', values: [] } }))).toBe('shape')
        expect(refusal(JSON.stringify({ type: 'risutanium-plugin-settings', version: 1, plugin: { name: 'P', values: null } }))).toBe('shape')
        expect(refusal('[]')).toBe('shape')
    })

    test('guard: a file with a byte order mark parses', () => {
        expect(parsePluginSettingsFile('\uFEFF' + fileText({ key: 'v' })).ok).toBe(true)
    })

    test('prototype keys are dropped and Object.prototype stays clean', () => {
        const r = parsePluginSettingsFile('{"type":"risutanium-plugin-settings","version":1,"plugin":{"name":"P","values":{"__proto__":{"polluted":"yes"},"constructor":"c","prototype":"p","key":"v"}}}')
        expect(r.ok).toBe(true)
        if (r.ok) {
            expect(Object.keys(r.file.plugin.values)).toEqual(['key'])
        }
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    test('guard: serialize then parse then plan reproduces the exported values', () => {
        const source = plugin('P', { realArg: { key: 'new', size: 9, mode: 'b' } })
        const parsed = parsePluginSettingsFile(serializePluginSettings(source))
        expect(parsed.ok).toBe(true)
        if (parsed.ok) {
            const plan = planPluginSettings(plugin('P'), parsed.file.plugin.values)
            expect(plan.merged).toEqual({ key: 'new', size: 9, mode: 'b' })
            expect(plan.changed.sort()).toEqual(['key', 'mode', 'size'])
        }
    })
})

describe('planPluginSettings', () => {
    test('int values: numbers and plain numeric strings pass, everything else is skipped', () => {
        const accepted = ['-3', '2.5', 4, '10']
        for (const v of accepted) {
            const plan = planPluginSettings(plugin('P', { realArg: {} }), { size: v })
            expect(plan.changed).toEqual(['size'])
        }
        const rejected = ['', ' ', '0x10', '1e3', NaN, Infinity, null, true, {}]
        for (const v of rejected) {
            const plan = planPluginSettings(plugin('P', { realArg: {} }), { size: v })
            expect(plan.changed).toEqual([])
            expect(plan.skipped).toBe(1)
        }
    })

    test('a string argument accepts strings only', () => {
        expect(planPluginSettings(plugin('P'), { key: 5 }).skipped).toBe(1)
        expect(planPluginSettings(plugin('P'), { key: 'x' }).changed).toEqual(['key'])
    })

    test('a select argument accepts only members of the live option list', () => {
        expect(planPluginSettings(plugin('P'), { mode: 'z' }).skipped).toBe(1)
        expect(planPluginSettings(plugin('P'), { mode: 'b' }).changed).toEqual(['mode'])
    })

    test('an unknown kind and an undeclared key are dropped', () => {
        const p = plugin('P', { arguments: { odd: 'weird' as unknown as 'int' } })
        const plan = planPluginSettings(p, { odd: 'x', ghost: 'y' })
        expect(plan.changed).toEqual([])
        expect(plan.skipped).toBe(2)
    })

    test('hidden arguments are never imported', () => {
        const p = plugin('P', { arguments: { hidden_t: 'string' }, realArg: {} })
        expect(planPluginSettings(p, { hidden_t: 'x' }).changed).toEqual([])
    })

    test('a blank value never overwrites a non-empty one, and is counted skipped', () => {
        const plan = planPluginSettings(plugin('P'), { key: '' })
        expect(plan.changed).toEqual([])
        expect(plan.skipped).toBe(1)
    })

    test('guard: a blank over an empty live value changes nothing', () => {
        const plan = planPluginSettings(plugin('P', { realArg: { key: '' } }), { key: '' })
        expect(plan.changed).toEqual([])
    })

    test('guard: values equal to the live ones are not changes', () => {
        const plan = planPluginSettings(plugin('P'), { key: 'old-key', size: '3', mode: 'a' })
        expect(plan.changed).toEqual([])
    })

    test('keys not in the file keep their live value in merged (merge, not replace)', () => {
        const plan = planPluginSettings(plugin('P'), { key: 'new' })
        expect(plan.merged).toEqual({ key: 'new', size: 3, mode: 'a' })
    })

    test('prototype-named keys are skipped, merged gets no own __proto__, and nothing leaks', () => {
        const values = JSON.parse('{"__proto__":"x","constructor":"y","key":"v"}') as Record<string, unknown>
        const p = plugin('P', { arguments: { constructor: 'string', key: 'string' } as RisuPlugin['arguments'] })
        const plan = planPluginSettings(p, values)
        expect(plan.changed).toEqual(['key'])
        expect(Object.prototype.hasOwnProperty.call(plan.merged, '__proto__')).toBe(false)
        expect(Object.prototype.hasOwnProperty.call(plan.merged, 'constructor')).toBe(false)
        expect(({} as Record<string, unknown>).key).toBeUndefined()
    })

    test('guard: the live plugin is not mutated', () => {
        const p = plugin('P')
        const before = JSON.stringify(p)
        planPluginSettings(p, { key: 'new', size: 9 })
        expect(JSON.stringify(p)).toBe(before)
    })

    test('an undefined realArg is tolerated', () => {
        const p = plugin('P')
        ;(p as { realArg?: RisuPlugin['realArg'] }).realArg = undefined
        expect(planPluginSettings(p, { key: 'v' }).changed).toEqual(['key'])
    })
})

describe('small seams', () => {
    test('the size cap refuses only above one MiB', () => {
        expect(isSettingsFileTooLarge(1_048_576)).toBe(false)
        expect(isSettingsFileTooLarge(1_048_577)).toBe(true)
    })

    test('findPluginByName returns the first match and tolerates a missing list', () => {
        const a = plugin('P', { script: 'first' })
        const b = plugin('P', { script: 'second' })
        expect(findPluginByName([a, b], 'P')).toBe(a)
        expect(findPluginByName(undefined, 'P')).toBeUndefined()
        expect(findPluginByName([a], 'Q')).toBeUndefined()
    })

    test('the write keys are the recomputed changes that were confirmed, no others', () => {
        expect(selectWriteKeys(['a', 'b', 'c'], ['a', 'c', 'z'])).toEqual(['a', 'c'])
        expect(selectWriteKeys(['x'], ['a'])).toEqual([])
    })

    test('applyPluginSettings writes only the chosen keys, in place on the entry', () => {
        const p = plugin('P')
        applyPluginSettings(p, { key: 'new', size: 9, mode: 'a' }, ['key'])
        expect(p.realArg).toEqual({ key: 'new', size: 3, mode: 'a' })
    })
})

//#region flows

interface Harness {
    deps: PluginSettingsDeps
    list: RisuPlugin[]
    confirm: ReturnType<typeof vi.fn>
    notify: ReturnType<typeof vi.fn>
    fail: ReturnType<typeof vi.fn>
    download: ReturnType<typeof vi.fn>
    reload: ReturnType<typeof vi.fn>
}

function harness(list: RisuPlugin[], over: Partial<PluginSettingsDeps> = {}): Harness {
    const confirm = vi.fn(async () => true)
    const notify = vi.fn()
    const fail = vi.fn()
    const download = vi.fn(async () => {})
    const reload = vi.fn(async () => {})
    const deps: PluginSettingsDeps = {
        plugins: () => list,
        select: vi.fn(async () => '2'),
        confirm, notify, fail, download, reload,
        pickFile: vi.fn(async () => null),
        ...over,
    }
    return { deps, list, confirm, notify, fail, download, reload }
}

const picked = (text: string) => async () => ({ name: 'x.json', data: new TextEncoder().encode(text) })

describe('exportPluginSettings', () => {
    test('declining the plain-text warning downloads nothing', async () => {
        const h = harness([plugin('P')])
        h.confirm.mockResolvedValue(false)
        await exportPluginSettings('P', h.deps)
        expect(h.download).not.toHaveBeenCalled()
    })

    test('a confirmed export downloads the named plugin under its settings file name', async () => {
        const h = harness([plugin('A'), plugin('B', { realArg: { key: 'b-key' } })])
        await exportPluginSettings('B', h.deps)
        expect(h.download).toHaveBeenCalledTimes(1)
        const [fileName, content] = h.download.mock.calls[0] as [string, string]
        expect(fileName).toBe('B.settings.json')
        expect(JSON.parse(content).plugin.values.key).toBe('b-key')
    })

    test('a plugin reordered while the warning was open is still the one exported', async () => {
        const a = plugin('A', { realArg: { key: 'a-key' } })
        const b = plugin('B', { realArg: { key: 'b-key' } })
        const list = [a, b]
        const h = harness(list)
        h.confirm.mockImplementation(async () => { list.reverse(); return true })
        await exportPluginSettings('B', h.deps)
        expect(JSON.parse((h.download.mock.calls[0] as [string, string])[1]).plugin.values.key).toBe('b-key')
    })

    test('a plugin removed while the warning was open is reported and nothing is downloaded', async () => {
        const list = [plugin('P')]
        const h = harness(list)
        h.confirm.mockImplementation(async () => { list.length = 0; return true })
        await exportPluginSettings('P', h.deps)
        expect(h.download).not.toHaveBeenCalled()
        expect(h.fail).toHaveBeenCalledTimes(1)
    })

    test('a failing download reports the error', async () => {
        const h = harness([plugin('P')])
        h.download.mockRejectedValue(new Error('disk full'))
        await exportPluginSettings('P', h.deps)
        expect(h.fail).toHaveBeenCalledTimes(1)
        expect(String(h.fail.mock.calls[0][0])).toContain('disk full')
        expect(h.notify).not.toHaveBeenCalled()
    })
})

describe('importPluginSettings', () => {
    test('a matching file writes the target only and leaves enabled alone', async () => {
        const a = plugin('A')
        const b = plugin('B', { enabled: false })
        const h = harness([a, b], { pickFile: picked(fileText({ key: 'new' }, 'B')) })
        await importPluginSettings('B', h.deps)
        expect(b.realArg.key).toBe('new')
        expect(a.realArg.key).toBe('old-key')
        expect(b.enabled).toBe(false)
        expect(h.notify).toHaveBeenCalledTimes(1)
    })

    test('the entry keeps its identity and the unlisted keys keep their values', async () => {
        const p = plugin('P')
        const list = [p]
        const h = harness(list, { pickFile: picked(fileText({ key: 'new' })) })
        await importPluginSettings('P', h.deps)
        expect(list[0]).toBe(p)
        expect(p.realArg).toEqual({ key: 'new', size: 3, mode: 'a' })
    })

    test('the file never changes enabled', async () => {
        const p = plugin('P', { enabled: false })
        const text = JSON.stringify({ type: 'risutanium-plugin-settings', version: 1, plugin: { name: 'P', enabled: true, values: { key: 'v' } } })
        await importPluginSettings('P', harness([p], { pickFile: picked(text) }).deps)
        expect(p.enabled).toBe(false)
    })

    test('nothing changed: no write, no reload, a notice', async () => {
        const p = plugin('P')
        const h = harness([p], { pickFile: picked(fileText({ key: 'old-key' })) })
        await importPluginSettings('P', h.deps)
        expect(h.reload).not.toHaveBeenCalled()
        expect(h.confirm).not.toHaveBeenCalled()
        expect(h.notify).toHaveBeenCalledTimes(1)
    })

    test('declining the replace confirmation writes nothing', async () => {
        const p = plugin('P')
        const h = harness([p], { pickFile: picked(fileText({ key: 'new' })) })
        h.confirm.mockResolvedValue(false)
        await importPluginSettings('P', h.deps)
        expect(p.realArg.key).toBe('old-key')
        expect(h.confirm).toHaveBeenCalledTimes(1)
    })

    test('the replace confirmation names the changed keys by label, never their values', async () => {
        const p = plugin('P', { argMeta: { key: { name: 'Shown Label' } } })
        const h = harness([p], { pickFile: picked(fileText({ key: 'secret-new', size: 8 })) })
        h.confirm.mockResolvedValue(false)
        await importPluginSettings('P', h.deps)
        const message = String(h.confirm.mock.calls[0][0])
        expect(message).toContain('Shown Label')
        expect(message).toContain('size')
        expect(message).not.toContain('secret-new')
    })

    test('the replace confirmation lists at most ten keys then a count of the rest, and shortens long names', async () => {
        const declared: RisuPlugin['arguments'] = {}
        const stored: RisuPlugin['realArg'] = {}
        const incoming: Record<string, unknown> = {}
        for (let i = 0; i < 12; i++) {
            declared['k' + i] = 'string'
            stored['k' + i] = 'old'
            incoming['k' + i] = 'new'
        }
        const longName = 'N'.repeat(70)
        const p = plugin(longName, { arguments: declared, realArg: stored, argMeta: { k0: { name: 'L'.repeat(70) } } })
        const h = harness([p], { pickFile: picked(fileText(incoming, longName)) })
        h.confirm.mockResolvedValue(false)
        await importPluginSettings(longName, h.deps)
        const message = String(h.confirm.mock.calls[0][0])
        expect(message).toContain('k9')
        expect(message).not.toContain('k10')
        expect(message).not.toContain('k11')
        expect(message).toContain('+2 more')
        expect(message).toContain('L'.repeat(60) + '…')
        expect(message).not.toContain('L'.repeat(61))
        expect(message).toContain('N'.repeat(60) + '…')
        expect(message).not.toContain('N'.repeat(61))
    })

    test('a name mismatch asks first, and declining writes nothing', async () => {
        const p = plugin('P')
        const h = harness([p], { pickFile: picked(fileText({ key: 'new' }, 'Other')) })
        h.confirm.mockResolvedValue(false)
        await importPluginSettings('P', h.deps)
        expect(h.confirm).toHaveBeenCalledTimes(1)
        expect(p.realArg.key).toBe('old-key')
    })

    test('no file, a bad file and an oversized file write nothing', async () => {
        const p = plugin('P')
        const none = harness([p])
        await importPluginSettings('P', none.deps)
        expect(none.fail).not.toHaveBeenCalled()

        const bad = harness([p], { pickFile: picked('not json') })
        await importPluginSettings('P', bad.deps)
        expect(bad.fail).toHaveBeenCalledTimes(1)

        const huge = harness([p], { pickFile: async () => ({ name: 'x.json', data: new Uint8Array(1_048_577) }) })
        await importPluginSettings('P', huge.deps)
        expect(huge.fail).toHaveBeenCalledTimes(1)
        expect(p.realArg.key).toBe('old-key')
    })

    test('a plugin removed while the picker was open is reported and nothing is written', async () => {
        const list = [plugin('P')]
        const h = harness(list, {
            pickFile: async () => { const f = await picked(fileText({ key: 'new' }))(); list.length = 0; return f },
        })
        await importPluginSettings('P', h.deps)
        expect(h.fail).toHaveBeenCalledTimes(1)
        expect(h.notify).not.toHaveBeenCalled()
    })

    test('a plugin removed while the replace confirmation was open is reported', async () => {
        const list = [plugin('P')]
        const h = harness(list, { pickFile: picked(fileText({ key: 'new' })) })
        h.confirm.mockImplementation(async () => { list.length = 0; return true })
        await importPluginSettings('P', h.deps)
        expect(h.fail).toHaveBeenCalledTimes(1)
        expect(h.reload).not.toHaveBeenCalled()
    })

    test('a plugin reordered while the replace confirmation was open is still the one written', async () => {
        const a = plugin('A')
        const b = plugin('B')
        const list = [a, b]
        const h = harness(list, { pickFile: picked(fileText({ key: 'new' }, 'B')) })
        h.confirm.mockImplementation(async () => { list.reverse(); return true })
        await importPluginSettings('B', h.deps)
        expect(b.realArg.key).toBe('new')
        expect(a.realArg.key).toBe('old-key')
    })

    test('a declaration changed during the dialog is judged on the fresh entry', async () => {
        const p = plugin('P')
        const h = harness([p], { pickFile: picked(fileText({ key: 'new' })) })
        h.confirm.mockImplementation(async () => { p.arguments = { key: 'int' }; return true })
        await importPluginSettings('P', h.deps)
        expect(p.realArg.key).toBe('old-key')
    })

    test('a key that becomes changeable during the confirmation, and was not listed, is not written', async () => {
        const p = plugin('P', { realArg: { key: 'old-key', size: 3, mode: 'a' } })
        const h = harness([p], { pickFile: picked(fileText({ key: 'file-key', size: 3, mode: 'b' })) })
        // size equals the live value at confirm time (not listed); the plugin moves it away, so the file now differs
        h.confirm.mockImplementation(async () => { p.realArg.size = 50; return true })
        await importPluginSettings('P', h.deps)
        expect(p.realArg.size).toBe(50)
        expect(p.realArg.key).toBe('file-key')
        expect(p.realArg.mode).toBe('b')
    })

    test('all listed keys converged during the confirmation: nothing written, no reload', async () => {
        const p = plugin('P')
        const h = harness([p], { pickFile: picked(fileText({ key: 'file-key' })) })
        h.confirm.mockImplementation(async () => { p.realArg.key = 'file-key'; return true })
        await importPluginSettings('P', h.deps)
        expect(h.reload).not.toHaveBeenCalled()
        expect(h.notify).toHaveBeenCalledTimes(1)
    })

    test('a disabled target is written without a reload; an enabled one reloads once', async () => {
        const off = plugin('P', { enabled: false })
        const hOff = harness([off], { pickFile: picked(fileText({ key: 'new' })) })
        await importPluginSettings('P', hOff.deps)
        expect(off.realArg.key).toBe('new')
        expect(hOff.reload).not.toHaveBeenCalled()

        const on = plugin('P')
        const hOn = harness([on], { pickFile: picked(fileText({ key: 'new' })) })
        await importPluginSettings('P', hOn.deps)
        expect(hOn.reload).toHaveBeenCalledTimes(1)
    })

    test('a failing reload keeps the write and reports it without a success notice', async () => {
        const p = plugin('P')
        const h = harness([p], { pickFile: picked(fileText({ key: 'new' })) })
        h.reload.mockRejectedValue(new Error('boom'))
        await importPluginSettings('P', h.deps)
        expect(p.realArg.key).toBe('new')
        expect(h.fail).toHaveBeenCalledTimes(1)
        expect(String(h.fail.mock.calls[0][0])).toContain('boom')
        expect(h.notify).not.toHaveBeenCalled()
    })

    test('duplicate plugin names target the first entry', async () => {
        const first = plugin('P')
        const second = plugin('P')
        await importPluginSettings('P', harness([first, second], { pickFile: picked(fileText({ key: 'new' })) }).deps)
        expect(first.realArg.key).toBe('new')
        expect(second.realArg.key).toBe('old-key')
    })
})

describe('openPluginSettingsMenu', () => {
    test('cancel does nothing; export and import branches run their flow for the captured name', async () => {
        const cancel = harness([plugin('P')])
        await openPluginSettingsMenu('P', cancel.deps)
        expect(cancel.confirm).not.toHaveBeenCalled()

        const exp = harness([plugin('P')], { select: vi.fn(async () => '0') })
        await openPluginSettingsMenu('P', exp.deps)
        expect(exp.download).toHaveBeenCalledTimes(1)

        const imp = harness([plugin('P')], { select: vi.fn(async () => '1'), pickFile: picked(fileText({ key: 'new' })) })
        await openPluginSettingsMenu('P', imp.deps)
        expect(imp.list[0].realArg.key).toBe('new')
    })
})

//#endregion
