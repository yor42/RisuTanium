// @vitest-environment node
/**
 * How the Node server reads the TRUST_PROXY environment variable
 * (`server/node/trustProxy.cjs`). Express rejects the string 'true' for the
 * `trust proxy` setting at startup, so the boolean words must become booleans.
 */
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'

interface TrustProxy {
    parseTrustProxy(value: string | undefined): boolean | number | string | undefined
}

const { parseTrustProxy } = createRequire(import.meta.url)('../../../../server/node/trustProxy.cjs') as TrustProxy

describe('parseTrustProxy', () => {
    test.each([
        ['true', true],
        ['TRUE', true],
        [' True ', true],
        ['false', false],
        [' false ', false],
        ['FALSE', false],
    ])('reads %j as the boolean %s', (input, expected) => {
        expect(parseTrustProxy(input)).toBe(expected)
    })

    test.each([
        ['0', 0],
        ['1', 1],
        ['2', 2],
        [' 3 ', 3],
        ['10', 10],
    ])('reads %j as the hop count %s', (input, expected) => {
        expect(parseTrustProxy(input)).toBe(expected)
    })

    test.each([
        ['10.0.0.0/8', '10.0.0.0/8'],
        ['loopback', 'loopback'],
        ['loopback, 10.0.0.1', 'loopback, 10.0.0.1'],
        [' 10.0.0.1 ', '10.0.0.1'],
        ['1e1', '1e1'],
        ['0x10', '0x10'],
        ['-1', '-1'],
    ])('passes %j through as the string %j for express to validate', (input, expected) => {
        expect(parseTrustProxy(input)).toBe(expected)
    })

    test.each([undefined, '', '   '])('treats %j as unset', (input) => {
        expect(parseTrustProxy(input)).toBeUndefined()
    })
})
