/**
 * The pure key ring: how a multi-line key field is split, which line a request leases and what a
 * key-limit failure does to the rotation. Synthetic keys only; nothing here touches a network.
 */
import { beforeEach, describe, expect, test } from 'vitest'
import { afterLimit, clearLease, newKeyRotation, pickLine, resetKeyRings, splitKeys } from './keyRing'

const A = 'sk-test-A'
const B = 'sk-test-B'
const C = 'sk-test-C'
const LIST = `${A}\n${B}\n${C}`

beforeEach(() => {
    resetKeyRings()
})

describe('splitKeys', () => {
    test('K1: a value with no line break is returned untouched, even with spaces', () => {
        expect(splitKeys(' sk ')).toEqual([' sk '])
        expect(splitKeys('')).toEqual([''])
    })

    test('K1: LF, CRLF and a lone CR split, each line is trimmed and blank lines drop', () => {
        expect(splitKeys(`${A}\n${B}`)).toEqual([A, B])
        expect(splitKeys(`${A}\r\n${B}`)).toEqual([A, B])
        expect(splitKeys(`${A}\r${B}`)).toEqual([A, B])
        expect(splitKeys(`${A}\n \n  ${B}  \n`)).toEqual([A, B])
    })

    test('K1: a non-string passes through and an all-blank value gives one empty line', () => {
        expect(splitKeys(undefined)).toEqual([undefined])
        expect(splitKeys('\n \n')).toEqual([''])
    })
})

describe('pickLine and afterLimit', () => {
    test('a value under two lines is returned as it is and leases nothing', () => {
        const rotation = newKeyRotation()
        expect(pickLine(rotation, 'openAIKey', ' sk ')).toBe(' sk ')
        expect(rotation.lease.size).toBe(0)
    })

    test('K2: the ring resets when the field is edited', () => {
        const rotation = newKeyRotation()
        expect(pickLine(rotation, 'openAIKey', LIST)).toBe(A)
        afterLimit(rotation, 'openAIKey', LIST)
        clearLease(rotation)
        expect(pickLine(rotation, 'openAIKey', LIST)).toBe(B)
        expect(pickLine(undefined, 'openAIKey', `${C}\n${A}`)).toBe(C)
    })

    test('K3: the cursor is last-writer-wins across rotations of one field', () => {
        const first = newKeyRotation()
        const second = newKeyRotation()
        expect(pickLine(first, 'openAIKey', LIST)).toBe(A)
        afterLimit(first, 'openAIKey', LIST)
        expect(pickLine(first, 'openAIKey', LIST)).toBe(A)
        clearLease(first)
        expect(pickLine(first, 'openAIKey', LIST)).toBe(B)
        // A second request starts on the cursor the first one left.
        expect(pickLine(second, 'openAIKey', LIST)).toBe(B)
    })

    test('K4: a foreign lease moves the cursor back but the next lease of this rotation still skips a tried line', () => {
        const rotation = newKeyRotation()
        pickLine(rotation, 'openAIKey', LIST)
        afterLimit(rotation, 'openAIKey', LIST)
        clearLease(rotation)
        expect(pickLine(rotation, 'openAIKey', LIST)).toBe(B)
        clearLease(rotation)

        // Another request that found B and C limited leases A and moves the cursor back to it.
        const other = newKeyRotation()
        other.tried.set('openAIKey', new Set([B, C]))
        expect(pickLine(other, 'openAIKey', LIST)).toBe(A)
        expect(pickLine(undefined, 'openAIKey', LIST)).toBe(A)

        // This rotation has already found A limited: it is not leased again although the cursor is on it.
        expect(pickLine(rotation, 'openAIKey', LIST)).toBe(B)
    })

    test('K5: an edit made mid-request still skips the tried line', () => {
        const rotation = newKeyRotation()
        pickLine(rotation, 'openAIKey', `${A}\n${B}`)
        // The edit reorders the lines, so a tried line must be recognised by its text, not its position.
        const edited = `${C}\n${A}\n${B}`
        expect(afterLimit(rotation, 'openAIKey', edited)).toBe('next')
        clearLease(rotation)
        expect(pickLine(rotation, 'openAIKey', edited)).toBe(C)
    })

    test('K6: fields are independent and a pick without a rotation never moves the cursor', () => {
        const rotation = newKeyRotation()
        pickLine(rotation, 'openAIKey', LIST)
        afterLimit(rotation, 'openAIKey', LIST)
        clearLease(rotation)
        expect(pickLine(rotation, 'proxyKey', LIST)).toBe(A)
        expect(pickLine(undefined, 'openAIKey', LIST)).toBe(A)
        expect(pickLine(undefined, 'openAIKey', LIST)).toBe(A)
    })

    test('K7: no lease and under two lines are single; then next; then exhausted, including after an edit', () => {
        const rotation = newKeyRotation()
        expect(afterLimit(rotation, 'openAIKey', A)).toBe('single')

        pickLine(rotation, 'openAIKey', `${A}\n${B}`)
        expect(afterLimit(rotation, 'openAIKey', A)).toBe('single')
        clearLease(rotation)

        const fresh = newKeyRotation()
        pickLine(fresh, 'openAIKey', `${A}\n${B}`)
        expect(afterLimit(fresh, 'openAIKey', `${A}\n${B}`)).toBe('next')
        clearLease(fresh)
        pickLine(fresh, 'openAIKey', `${A}\n${B}`)
        expect(afterLimit(fresh, 'openAIKey', `${A}\n${B}`)).toBe('exhausted')

        // An edit that removes the only untried line leaves nothing to send.
        resetKeyRings()
        const edited = newKeyRotation()
        pickLine(edited, 'openAIKey', `${A}\n${B}\n${C}`)
        expect(afterLimit(edited, 'openAIKey', `${A}\n${B}`)).toBe('next')
        clearLease(edited)
        expect(pickLine(edited, 'openAIKey', `${A}\n${B}`)).toBe(B)
        expect(afterLimit(edited, 'openAIKey', `${A}\n${B}`)).toBe('exhausted')
    })

    test('K8: only the field the request sent is marked and judged; an unleased field is single and marks nothing', () => {
        const rotation = newKeyRotation()
        const x = `${A}\n${B}`
        const y = `${B}\n${C}`
        pickLine(rotation, 'proxyKey', x)
        pickLine(rotation, 'openAIKey', y)

        expect(afterLimit(rotation, 'openAIKey', y)).toBe('next')
        expect(rotation.tried.has('proxyKey')).toBe(false)
        expect(afterLimit(rotation, 'claudeAPIKey', y)).toBe('single')
        expect(rotation.tried.has('claudeAPIKey')).toBe(false)
    })

    test('a line is never leased twice in one rotation, and duplicates count once', () => {
        const rotation = newKeyRotation()
        const seen: string[] = []
        const value = `${A}\n${A}\n${B}`
        for (let i = 0; i < 3; i++) {
            seen.push(pickLine(rotation, 'openAIKey', value))
            const verdict = afterLimit(rotation, 'openAIKey', value)
            clearLease(rotation)
            if (verdict === 'exhausted') {
                break
            }
        }
        expect(seen).toEqual([A, B])
    })
})
