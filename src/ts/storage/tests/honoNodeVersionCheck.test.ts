// @vitest-environment node
/**
 * The Hono Node entry keeps its own copy of the CVE-2026-111497 version check
 * (`server/hono/src/nodeVersionCheck.ts`) because the Hono package cannot
 * import the CommonJS helper. The copy must agree with the original on every
 * version, and its fixed-version table must be equal.
 */
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'
import * as honoCopy from '../../../../server/hono/src/nodeVersionCheck'

interface NodeVersionCheck {
    nodeVersionWarning(version: unknown): string | null
    FIXED_VERSIONS: Record<number, number[]>
    LATEST_FIXED_MAJOR: number
}

const original = createRequire(import.meta.url)('../../../../server/node/nodeVersionCheck.cjs') as NodeVersionCheck

describe('hono nodeVersionWarning', () => {
    test('warns on an affected version and names the minimum fixed one', () => {
        const warning = honoCopy.nodeVersionWarning('24.19.0')
        expect(warning).toContain('CVE-2026-111497')
        expect(warning).toContain('Update Node.js to 24.22.1 or newer')
    })

    test('is silent on fixed and newer versions', () => {
        expect(honoCopy.nodeVersionWarning('24.22.1')).toBeNull()
        expect(honoCopy.nodeVersionWarning('27.0.0')).toBeNull()
    })

    test('keeps the same fixed-version table as the Node server helper', () => {
        expect(honoCopy.FIXED_VERSIONS).toEqual(original.FIXED_VERSIONS)
        expect(honoCopy.LATEST_FIXED_MAJOR).toBe(original.LATEST_FIXED_MAJOR)
    })

    test.each([
        '18.0.0', '20.19.0', '22.0.0', '22.23.3', '22.23.4', '23.1.0', '24.19.0', '24.22.0', '24.22.1',
        '25.0.0', '26.0.0', '26.12.0', '26.12.1', '27.0.0', 'v26.12.0', '', 'nonsense', undefined, 24,
    ])('gives the same answer as the Node server helper for %j', (version) => {
        expect(honoCopy.nodeVersionWarning(version)).toBe(original.nodeVersionWarning(version))
    })
})
