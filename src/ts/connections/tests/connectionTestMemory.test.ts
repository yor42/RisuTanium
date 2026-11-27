import { describe, expect, it } from 'vitest'
import { forgetTest, rememberTest, rememberedTest, testStamp } from '../connectionTestMemory'

describe('connectionTestMemory', () => {
    it('returns a result only for the url and key state it ran against', () => {
        const stamp = testStamp('https://a.invalid/v1', '{"kind":"tail","tail":"1234"}')
        rememberTest('c1', stamp, { kind: 'ok', models: 3, ms: 12 })
        expect(rememberedTest('c1', stamp)).toEqual({ kind: 'ok', models: 3, ms: 12 })
        expect(rememberedTest('c1', testStamp('https://b.invalid/v1', '{"kind":"tail","tail":"1234"}'))).toBeNull()
        expect(rememberedTest('c1', testStamp('https://a.invalid/v1', '{"kind":"tail","tail":"9999"}'))).toBeNull()
        expect(rememberedTest('other', stamp)).toBeNull()
    })

    it('forgets a connection on delete', () => {
        const stamp = testStamp(undefined, 'k')
        rememberTest('c2', stamp, { kind: 'badKey' })
        forgetTest('c2')
        expect(rememberedTest('c2', stamp)).toBeNull()
    })
})
