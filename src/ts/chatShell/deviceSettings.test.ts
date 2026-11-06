// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest'
import { readEnterMode, writeEnterMode } from './deviceSettings'

beforeEach(() => localStorage.clear())

describe('I5/T16 device-local Enter mode', () => {
    test('unknown stored enum returns the legacy default without rewriting it', () => {
        localStorage.setItem('risuChatShell.enterMode', 'future-mode')
        expect(readEnterMode(true)).toBe('auto')
        expect(readEnterMode(false)).toBe('newline')
        expect(localStorage.getItem('risuChatShell.enterMode')).toBe('future-mode')
    })

    test('valid choices round trip in the device namespace', () => {
        writeEnterMode('send')
        expect(readEnterMode(false)).toBe('send')
        expect(localStorage.getItem('risuChatShell.enterMode')).toBe('send')
    })
})
