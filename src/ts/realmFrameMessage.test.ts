import { describe, expect, test } from 'vitest'
import { acceptRealmFrameMessage, realmFrameOrigin } from './realmFrameMessage'

const ORIGIN = 'https://realm.risuai.net'
const frame = {} as Window
const otherFrame = {} as Window

function accept(data: unknown, overrides: { origin?: string, source?: Window | null, frameWindow?: Window | null } = {}) {
    return acceptRealmFrameMessage(
        {
            source: overrides.source === undefined ? frame : overrides.source,
            origin: overrides.origin ?? ORIGIN,
            data,
        },
        overrides.frameWindow === undefined ? frame : overrides.frameWindow,
        ORIGIN,
    )
}

describe('realmFrameOrigin', () => {
    test('diagnostic: is the bare origin of the upload URL, without path or hash', () => {
        expect(realmFrameOrigin()).toBe(ORIGIN)
    })
})

describe('acceptRealmFrameMessage', () => {
    test('guard: accepts each well-formed message from the frame at the Realm origin', () => {
        expect(accept({ type: 'pong' })).toEqual({ type: 'pong' })
        expect(accept({ type: 'close' })).toEqual({ type: 'close' })
        expect(accept({ type: 'filedata', success: true })).toEqual({ type: 'filedata' })
        expect(accept({ type: 'success', id: 'abc123' })).toEqual({ type: 'success', id: 'abc123' })
        expect(accept({ type: 'success', id: '0f8fad5b-d9cb-469f-a165-70867728950e' }))
            .toEqual({ type: 'success', id: '0f8fad5b-d9cb-469f-a165-70867728950e' })
    })

    test('refuses a foreign origin, including the opaque null origin', () => {
        expect(accept({ type: 'close' }, { origin: 'https://evil.example' })).toBeNull()
        expect(accept({ type: 'close' }, { origin: 'null' })).toBeNull()
        expect(accept({ type: 'close' }, { origin: '' })).toBeNull()
        expect(accept({ type: 'close' }, { origin: 'https://realm.risuai.net.evil.example' })).toBeNull()
    })

    test('refuses a source that is not the frame window', () => {
        expect(accept({ type: 'close' }, { source: otherFrame })).toBeNull()
        expect(accept({ type: 'close' }, { source: null })).toBeNull()
    })

    test('refuses everything while there is no frame window, even a null source', () => {
        expect(accept({ type: 'close' }, { source: null, frameWindow: null })).toBeNull()
        expect(accept({ type: 'close' }, { source: null, frameWindow: undefined })).toBeNull()
        expect(accept({ type: 'close' }, { frameWindow: null })).toBeNull()
    })

    test.each([null, undefined, 'close', 5, true])('refuses non-object data %s', (data) => {
        expect(accept(data)).toBeNull()
    })

    test('refuses an unknown or missing type', () => {
        expect(accept({ type: 'ping' })).toBeNull()
        expect(accept({ type: 5 })).toBeNull()
        expect(accept({})).toBeNull()
    })

    test('refuses file data without a truthy success', () => {
        expect(accept({ type: 'filedata' })).toBeNull()
        expect(accept({ type: 'filedata', success: false })).toBeNull()
    })

    test.each([
        ['backtick', 'a`b'],
        ['newline', 'a\nb'],
        ['slash', 'x/../y'],
        ['space', 'a b'],
        ['empty', ''],
        ['number', 123],
        ['object', {}],
        ['missing', undefined],
        ['129 characters', 'a'.repeat(129)],
    ])('refuses a success with an unsafe id (%s)', (_label, id) => {
        expect(accept({ type: 'success', id })).toBeNull()
    })

    test('accepts a success id of exactly 128 characters', () => {
        const id = 'a'.repeat(128)
        expect(accept({ type: 'success', id })).toEqual({ type: 'success', id })
    })
})
