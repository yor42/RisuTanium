import { describe, expect, test } from 'vitest'
import { senderInitial } from './senderInitial'

describe('senderInitial', () => {
    test('upper-cases the first letter of the name', () => {
        expect(senderInitial('alice')).toBe('A')
    })

    test('skips leading whitespace', () => {
        expect(senderInitial('  bob')).toBe('B')
    })

    test('keeps a surrogate-pair character whole', () => {
        expect(senderInitial('\u{1F600} smile')).toBe('\u{1F600}')
    })

    test('a blank name has no initial', () => {
        expect(senderInitial('')).toBe('')
        expect(senderInitial('   ')).toBe('')
    })
})
