import { writable } from 'svelte/store'
import { describe, expect, test, vi, beforeEach } from 'vitest'

// The pure resolver needs only the real parser; the application graph util pulls in is mocked out.
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => undefined,
    getCurrentChat: () => undefined,
    getDatabase: () => ({}),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
}) as unknown as typeof import('src/ts/stores.svelte'))

import * as util from 'src/ts/util'
import {
    NO_TOGGLE_DEFAULTS,
    defaultValueOf,
    effectiveGlobalValue,
    isSetValue,
    sameDefaults,
    toggleDefaultsOf,
} from '../toggleDefaults'

const parseSpy = vi.spyOn(util, 'parseToggleSyntax')
const parseCalls = () => parseSpy.mock.calls.length

beforeEach(() => {
    parseSpy.mockClear()
})

describe('T1.4 defaultValueOf and toggleDefaultsOf accept set', () => {
    test('a checkbox default is exactly 1', () => {
        expect(toggleDefaultsOf(['a=A===1']).get('toggle_a')).toBe('1')
        for (const bad of ['0', '', 'yes', 'true', 'on', ' 1', '1 ', '01', '2']) {
            expect(toggleDefaultsOf([`b=B===${bad}`]).has('toggle_b'), JSON.stringify(bad)).toBe(false)
        }
    })

    test('a select default is the exact option text, stored as its index', () => {
        expect(toggleDefaultsOf(['m=Mood=select=calm,angry=angry']).get('toggle_m')).toBe('1')
        expect(toggleDefaultsOf(['m=Mood=select=calm,angry=calm']).get('toggle_m')).toBe('0')
        for (const bad of [' angry', 'Angry', 'angry ', '1', 'furious', '']) {
            expect(toggleDefaultsOf([`n=Mood=select=calm,angry=${bad}`]).has('toggle_n'), JSON.stringify(bad)).toBe(false)
        }
    })

    test('an option text that looks like an index is matched by text', () => {
        expect(toggleDefaultsOf(['q=Q=select=0,1=1']).get('toggle_q')).toBe('1')
        expect(toggleDefaultsOf(['r=R=select=0,1=0']).get('toggle_r')).toBe('0')
    })

    test('duplicate option texts give the first index', () => {
        expect(toggleDefaultsOf(['d=D=select=a,b,a=a']).get('toggle_d')).toBe('0')
        expect(toggleDefaultsOf(['e=E=select=a,b,b=b']).get('toggle_e')).toBe('1')
    })

    test('text, textarea and structural rows never give a default', () => {
        const defaults = toggleDefaultsOf([
            'x=X=text=a=1',
            'y=Y=textarea=a=1',
            'g=G=group=a=1',
            'c=C=caption=a=1',
            'v=V=divider=a=1',
            'z=Z=text==1',
        ])
        expect(defaults.size).toBe(0)
    })

    test('one trailing CR is stripped and nothing else', () => {
        expect(toggleDefaultsOf(['k=K===1\r\nm=M=select=a,b=b\r']).get('toggle_k')).toBe('1')
        expect(toggleDefaultsOf(['k=K===1\r\nm=M=select=a,b=b\r']).get('toggle_m')).toBe('1')
        expect(toggleDefaultsOf(['w=W===1\r\r']).has('toggle_w')).toBe(false)
    })

    test('the first definition of a key decides, even without a default', () => {
        expect(toggleDefaultsOf(['k=K', 'k=K===1']).has('toggle_k')).toBe(false)
        expect(toggleDefaultsOf(['k=K===1', 'k=K']).get('toggle_k')).toBe('1')
        expect(toggleDefaultsOf(['k=K=select=a,b=b', 'k=K===1']).get('toggle_k')).toBe('1')
    })

    test('texts join in order and undefined counts as empty', () => {
        const defaults = toggleDefaultsOf([undefined, 'a=A===1', '', 'b=B===1'])
        expect([...defaults.keys()]).toEqual(['toggle_a', 'toggle_b'])
    })

    test('all-empty input returns the shared empty map without parsing', () => {
        expect(toggleDefaultsOf([])).toBe(NO_TOGGLE_DEFAULTS)
        expect(toggleDefaultsOf([undefined, ''])).toBe(NO_TOGGLE_DEFAULTS)
        expect(parseCalls()).toBe(0)
        expect(Object.isFrozen(NO_TOGGLE_DEFAULTS)).toBe(true)
    })

    test('a text with no accepted default returns the shared empty map', () => {
        expect(toggleDefaultsOf(['plain=Plain'])).toBe(NO_TOGGLE_DEFAULTS)
    })

    test('defaultValueOf reads rows directly', () => {
        expect(defaultValueOf({ key: 'a', value: 'A', type: undefined, options: [], default: '1' })).toBe('1')
        expect(defaultValueOf({ key: 'a', value: 'A', type: undefined, options: [] })).toBeUndefined()
        expect(defaultValueOf({ key: 'a', value: 'A', type: 'text', options: [], default: '1' })).toBeUndefined()
        expect(defaultValueOf({ key: 'a', value: 'A', type: 'select', options: ['x', 'y'], default: 'y' })).toBe('1')
    })
})

describe('T1.5 memo', () => {
    test('equal arrays give the same map and one parse', () => {
        const first = toggleDefaultsOf(['memo1=M===1'])
        const second = toggleDefaultsOf(['memo1=M===1'])
        expect(second).toBe(first)
        expect(parseCalls()).toBe(1)
    })

    test('a changed element, length or undefined-to-text gives a new result', () => {
        const base = toggleDefaultsOf(['memo2=A===1', 'memo2b=B===1'])
        expect(toggleDefaultsOf(['memo2=A===1', 'memo2b=B'])).not.toBe(base)
        expect(toggleDefaultsOf(['memo2=A===1'])).not.toBe(base)
        const withUndefined = toggleDefaultsOf(['memo2=A===1', undefined])
        expect(toggleDefaultsOf(['memo2=A===1', 'memo2c=C===1'])).not.toBe(withUndefined)
        expect(toggleDefaultsOf(['memo2c=C===1', 'memo2=A===1']).get('toggle_memo2c')).toBe('1')
    })

    test('alternating two lists ten times parses twice', () => {
        const a = ['alt1=A===1']
        const b = ['alt2=B===1']
        toggleDefaultsOf(['evict-1=X===1'])
        toggleDefaultsOf(['evict-2=X===1'])
        parseSpy.mockClear()
        for (let i = 0; i < 10; i++) {
            toggleDefaultsOf(a)
            toggleDefaultsOf(b)
        }
        expect(parseCalls()).toBe(2)
    })

    test('a fifth distinct list evicts the least recently used', () => {
        const lists = [1, 2, 3, 4, 5].map((n) => [`lru${n}=L===1`])
        for (const list of lists.slice(0, 4)) {
            toggleDefaultsOf(list)
        }
        toggleDefaultsOf(lists[0])
        parseSpy.mockClear()
        toggleDefaultsOf(lists[4])
        expect(parseCalls()).toBe(1)
        toggleDefaultsOf(lists[0])
        toggleDefaultsOf(lists[2])
        toggleDefaultsOf(lists[3])
        expect(parseCalls()).toBe(1)
        toggleDefaultsOf(lists[1])
        expect(parseCalls()).toBe(2)
    })

    test('the memo does not alias the caller array', () => {
        const texts = ['alias=A===1']
        const first = toggleDefaultsOf(texts)
        texts[0] = 'alias=A'
        expect(toggleDefaultsOf(['alias=A===1'])).toBe(first)
        expect(toggleDefaultsOf(texts)).not.toBe(first)
    })
})

describe('T1.6 effectiveGlobalValue and sameDefaults', () => {
    const never = () => {
        throw new Error('fallback must not run')
    }

    test('a set local value wins and the fallback does not run', () => {
        expect(effectiveGlobalValue('0', '1', never)).toBe('0')
        expect(effectiveGlobalValue('1', undefined, never)).toBe('1')
    })

    test('an unset local falls to a set shared value', () => {
        for (const local of [undefined, '', 'null']) {
            expect(effectiveGlobalValue(local, '0', never), String(local)).toBe('0')
        }
    })

    test('both unset fall to the default, then to shared or null', () => {
        for (const local of [undefined, '', 'null']) {
            for (const shared of [undefined, '', 'null']) {
                expect(effectiveGlobalValue(local, shared, () => '1')).toBe('1')
            }
        }
        expect(effectiveGlobalValue(undefined, undefined, () => undefined)).toBe('null')
        expect(effectiveGlobalValue('', '', () => undefined)).toBe('')
        expect(effectiveGlobalValue('null', 'null', () => undefined)).toBe('null')
        expect(effectiveGlobalValue(undefined, '', () => undefined)).toBe('')
    })

    test('isSetValue', () => {
        expect(isSetValue(undefined)).toBe(false)
        expect(isSetValue('')).toBe(false)
        expect(isSetValue('null')).toBe(false)
        expect(isSetValue('0')).toBe(true)
    })

    test('sameDefaults compares by entries', () => {
        const a = new Map([['toggle_a', '1']])
        expect(sameDefaults(a, a)).toBe(true)
        expect(sameDefaults(a, new Map([['toggle_a', '1']]))).toBe(true)
        expect(sameDefaults(a, new Map([['toggle_a', '0']]))).toBe(false)
        expect(sameDefaults(a, new Map([['toggle_b', '1']]))).toBe(false)
        expect(sameDefaults(a, NO_TOGGLE_DEFAULTS)).toBe(false)
        expect(sameDefaults(NO_TOGGLE_DEFAULTS, new Map())).toBe(true)
    })
})

describe('T1.7 upstream-shaped lines (compatibility guard: passes after)', () => {
    test('a 5th part that is not accepted gives no default', () => {
        for (const line of ['x=A=B=C=hello', 'x=A=select=a,b=c', 'x=A=text=t=1', 'x=A===yes']) {
            expect(toggleDefaultsOf([line]).size, line).toBe(0)
        }
    })

    test('a sixth part is ignored and the 5th still decides', () => {
        expect(toggleDefaultsOf(['x=A=select=a,b=a=more']).get('toggle_x')).toBe('0')
    })
})
