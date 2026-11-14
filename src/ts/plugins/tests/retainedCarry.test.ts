// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { keepLiveRetained, withLiveRetained } from '../retainedCarry'
import { ASSET_RETAINED_KEY } from '../../studio/assets/assetOwnerKeys'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from '../../storage/moduleStub'

/**
 * The plugin carry of the retained-paths field, as pure functions. A plugin holds a copy of an owner taken at read time,
 * so the write must give an owner it continues the live value (set it, or remove the key when the live owner has none),
 * except when the matched live module is a stub, and must leave an owner that continues nothing as it is. Feature
 * guards: the carry did not exist before. The integration tests drive the real plugin setters.
 */

type Owner = Record<string, unknown>

const LIVE = [['x', 'assets/K.png'], ['y', 'assets/Y.png']]
const STALE = [['x', 'assets/K.png']]
const FOREIGN = [['z', 'assets/Z.png']]

const holder = (id: string, retained?: unknown): Owner => retained === undefined ? { chaId: id, name: id } : { chaId: id, name: id, [ASSET_RETAINED_KEY]: retained }
const mod = (id: string, retained?: unknown): Owner => retained === undefined ? { id, name: id } : { id, name: id, [ASSET_RETAINED_KEY]: retained }

describe('keepLiveRetained (characters, changed in place)', () => {
    test('an incoming copy without the field takes the live value by reference', () => {
        const live = [holder('a', LIVE)]
        const incoming = [holder('a')]
        keepLiveRetained(live, incoming, 'chaId')
        expect(incoming[0][ASSET_RETAINED_KEY]).toBe(LIVE)
    })

    test('a stale incoming value loses to the live value', () => {
        const incoming = [holder('a', STALE)]
        keepLiveRetained([holder('a', LIVE)], incoming, 'chaId')
        expect(incoming[0][ASSET_RETAINED_KEY]).toBe(LIVE)
    })

    test('when the live owner lacks the field, the incoming owner loses its key', () => {
        const incoming = [holder('a', FOREIGN)]
        keepLiveRetained([holder('a')], incoming, 'chaId')
        expect(Object.hasOwn(incoming[0], ASSET_RETAINED_KEY)).toBe(false)
    })

    test('an incoming owner that moved to another index continues the live owner with its id when each list holds the id once', () => {
        const live = [holder('a', LIVE), holder('b', STALE)]
        const incoming = [holder('b'), holder('a')]
        keepLiveRetained(live, incoming, 'chaId')
        expect(incoming[0][ASSET_RETAINED_KEY]).toBe(STALE)
        expect(incoming[1][ASSET_RETAINED_KEY]).toBe(LIVE)
    })

    test('an incoming owner with a new id keeps its own value, present or absent', () => {
        const incoming = [holder('new', FOREIGN), holder('other')]
        keepLiveRetained([holder('a', LIVE)], incoming, 'chaId')
        expect(incoming[0][ASSET_RETAINED_KEY]).toBe(FOREIGN)
        expect(Object.hasOwn(incoming[1], ASSET_RETAINED_KEY)).toBe(false)
    })

    test('an id held twice in the incoming list is unmatched away from its own index, so each copy keeps its value', () => {
        const live = [holder('c'), holder('a', LIVE)]
        const incoming = [holder('a', STALE), holder('c'), holder('a', FOREIGN)]
        keepLiveRetained(live, incoming, 'chaId')
        expect(incoming[0][ASSET_RETAINED_KEY]).toBe(STALE)
        expect(incoming[2][ASSET_RETAINED_KEY]).toBe(FOREIGN)
    })

    test('a light entry and a value that is not a plain object are skipped', () => {
        const light = { ...holder('a'), lightEntry: true, type: 'character', creatorNotes: '', chatCount: 0, archived: false }
        const incoming: unknown[] = [light, 7, null, [holder('a')]]
        expect(() => keepLiveRetained([holder('a', LIVE)], incoming, 'chaId')).not.toThrow()
        expect(Object.hasOwn(light, ASSET_RETAINED_KEY)).toBe(false)
    })

    test('an incoming list that is not an array is left alone', () => {
        expect(() => keepLiveRetained([holder('a', LIVE)], 'text', 'chaId')).not.toThrow()
        expect(() => keepLiveRetained(undefined, [holder('a')], 'chaId')).not.toThrow()
    })

    test('an incoming object that is the live object is not changed', () => {
        const same = holder('a', LIVE)
        keepLiveRetained([same], [same], 'chaId')
        expect(same[ASSET_RETAINED_KEY]).toBe(LIVE)
    })
})

describe('withLiveRetained (modules, copies only the modules that change)', () => {
    test('a module without the field gets the live value on a copy; the plugin object is not mutated', () => {
        const live = [mod('m', LIVE)]
        const own = mod('m')
        const out = withLiveRetained(live, [own], 'id')
        expect(out).not.toBe(live)
        expect(out[0]).not.toBe(own)
        expect(out[0][ASSET_RETAINED_KEY]).toBe(LIVE)
        expect(Object.hasOwn(own, ASSET_RETAINED_KEY)).toBe(false)
    })

    test('a stale incoming value is replaced by the live value on a copy, and the plugin object keeps its own', () => {
        const own = mod('m', STALE)
        const out = withLiveRetained([mod('m', LIVE)], [own], 'id')
        expect(out[0][ASSET_RETAINED_KEY]).toBe(LIVE)
        expect(own[ASSET_RETAINED_KEY]).toBe(STALE)
    })

    test('a live module without the field removes the key from the copy', () => {
        const own = mod('m', FOREIGN)
        const out = withLiveRetained([mod('m')], [own], 'id')
        expect(Object.hasOwn(out[0], ASSET_RETAINED_KEY)).toBe(false)
        expect(own[ASSET_RETAINED_KEY]).toBe(FOREIGN)
    })

    test('an id that is not in the live list keeps the incoming value, and the list is returned as it is', () => {
        const incoming = [mod('new', FOREIGN)]
        expect(withLiveRetained([mod('m', LIVE)], incoming, 'id')).toBe(incoming)
    })

    test('the live array passed back, and a value that is not an array, come back as they are', () => {
        const live = [mod('m', LIVE)]
        expect(withLiveRetained(live, live, 'id')).toBe(live)
        const text = 'text'
        expect(withLiveRetained(live, text, 'id')).toBe(text)
    })

    test('a list in which no module changes is returned as it is', () => {
        const incoming = [mod('m', LIVE)]
        expect(withLiveRetained([mod('m', LIVE)], incoming, 'id')).toBe(incoming)
    })

    test('a matched live stub keeps the incoming value, whatever it holds, and is never asked for the field', () => {
        const reads: string[] = []
        const stub = new Proxy({ id: 'm', name: 'm', [MODULE_STUB_KEY]: MODULE_STUB_VALUE }, {
            get(target, key, receiver) {
                if (key === ASSET_RETAINED_KEY) reads.push(String(key))
                return Reflect.get(target, key, receiver)
            },
            getOwnPropertyDescriptor(target, key) {
                if (key === ASSET_RETAINED_KEY) reads.push(String(key))
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
            has(target, key) {
                if (key === ASSET_RETAINED_KEY) reads.push(String(key))
                return Reflect.has(target, key)
            },
        })
        const incoming = [mod('m', FOREIGN), mod('m2')]
        const out = withLiveRetained([stub, stub], incoming, 'id')
        expect(out).toBe(incoming)
        expect(out[0][ASSET_RETAINED_KEY]).toBe(FOREIGN)
        expect(reads).toEqual([])
    })

    test('the carry is applied by the same match rule as the characters: by index, then by a unique id', () => {
        const live = [mod('a', LIVE), mod('b', STALE)]
        const incoming = [mod('b'), mod('a')]
        const out = withLiveRetained(live, incoming, 'id')
        expect(out[0][ASSET_RETAINED_KEY]).toBe(STALE)
        expect(out[1][ASSET_RETAINED_KEY]).toBe(LIVE)
    })
})
