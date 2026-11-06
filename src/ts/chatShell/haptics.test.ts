// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readHaptics, tickHaptic, writeHaptics } from './haptics'

beforeEach(() => localStorage.clear())

describe('T16 haptics storage and T10 feedback', () => {
    it('uses capability as default and leaves unknown values unchanged', () => {
        expect(readHaptics(true)).toBe(true)
        expect(readHaptics(false)).toBe(false)
        localStorage.setItem('risuChatShell.haptics', 'future')
        expect(readHaptics(true)).toBe(true)
        expect(localStorage.getItem('risuChatShell.haptics')).toBe('future')
        writeHaptics(false)
        expect(readHaptics(true)).toBe(false)
    })
    it('ticks only touch commit or arm on a supported device', () => {
        const vibrate = vi.fn(() => true)
        expect(tickHaptic('commit', 'touch', true, vibrate)).toBe(true)
        expect(tickHaptic('arm', 'touch', true, vibrate)).toBe(true)
        expect(tickHaptic('scroll', 'touch', true, vibrate)).toBe(false)
        expect(tickHaptic('commit', 'mouse', true, vibrate)).toBe(false)
        expect(tickHaptic('commit', 'pen', true, vibrate)).toBe(false)
        expect(tickHaptic('commit', 'touch', false, vibrate)).toBe(false)
        expect(tickHaptic('arm', 'touch', true, undefined)).toBe(false)
        expect(vibrate).toHaveBeenCalledTimes(2)
        expect(vibrate).toHaveBeenCalledWith(10)
    })
})
