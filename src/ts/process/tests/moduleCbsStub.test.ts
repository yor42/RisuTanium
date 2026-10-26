/**
 * The module CBS functions on a module stub. `moduleenabled` counts an unloaded stub by its namespace (the stub keeps
 * its id and namespace), and `moduleassetlist` of a stub or of a module without assets answers an empty array instead of
 * throwing. Drives the real callbacks of `registerCBS` with the dependencies handed in: `getModules` returns the fixture
 * and `makeArray` mirrors the parser's, which maps its argument and so throws on `undefined`.
 *
 * Labels: R = regression reproducer (the base throws a TypeError), G = guard (passes before and after).
 */
import { describe, test, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import { MODULE_STUB_KEY } from '../../storage/moduleStub'
import type { RisuModule } from '../modules'
import type { CBSRegisterArg, RegisterCallback, matcherArg } from '../../cbs'

vi.mock(import('../../stores.svelte'), () => ({
    CurrentTriggerIdStore: writable(null),
}) as unknown as typeof import('../../stores.svelte'))

import { defaultCBSRegisterArg, registerCBS } from '../../cbs'

function callbackOf(name: string, modules: RisuModule[]): RegisterCallback {
    const registered = new Map<string, RegisterCallback | 'doc_only'>()
    const arg: CBSRegisterArg = {
        ...defaultCBSRegisterArg,
        registerFunction: (entry) => { registered.set(entry.name, entry.callback) },
        getModules: () => modules,
        // The parser's own shape: it maps its argument, so `undefined` throws.
        makeArray: (items: unknown[]) => JSON.stringify(items.map((item) => item)),
    }
    registerCBS(arg)
    const callback = registered.get(name)
    if (typeof callback !== 'function') {
        throw new Error(`The function ${name} is not registered.`)
    }
    return callback
}

const matcher = { subject: undefined } as unknown as matcherArg

function stub(namespace: string): RisuModule {
    return { id: 'm1', name: 'Alpha', description: '', namespace, [MODULE_STUB_KEY]: 1 } as unknown as RisuModule
}

describe('module CBS functions on a stub', () => {
    test('G moduleenabled-counts-unloaded-stub', () => {
        const callback = callbackOf('moduleenabled', [stub('ns')])
        expect(callback('', matcher, ['ns'], null)).toBe('1')
        expect(callback('', matcher, ['other'], null)).toBe('0')
    })

    test('R moduleassetlist-tolerates-stub', () => {
        const callback = callbackOf('moduleassetlist', [stub('ns')])
        expect(callback('', matcher, ['ns'], null)).toBe('[]')
    })

    test('G moduleassetlist-lists-resident-assets', () => {
        const resident = { id: 'm2', name: 'Beta', description: '', namespace: 'ns2', assets: [['pic', 'path', 'png']] } as unknown as RisuModule
        const callback = callbackOf('moduleassetlist', [resident])
        expect(callback('', matcher, ['ns2'], null)).toBe('["pic"]')
    })
})
