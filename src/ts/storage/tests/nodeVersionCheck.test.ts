// @vitest-environment node
/**
 * The startup warning for CVE-2026-111497 (`server/node/nodeVersionCheck.cjs`):
 * affected Node versions get a warning naming the CVE and the minimum fixed
 * version for the line; fixed and newer versions get none.
 */
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'

interface NodeVersionCheck {
    nodeVersionWarning(version: unknown): string | null
}

const { nodeVersionWarning } = createRequire(import.meta.url)('../../../../server/node/nodeVersionCheck.cjs') as NodeVersionCheck

describe('nodeVersionWarning', () => {
    test.each([
        ['22.23.3', '22.23.4'],
        ['22.0.0', '22.23.4'],
        ['v22.22.9', '22.23.4'],
        ['24.22.0', '24.22.1'],
        ['24.19.0', '24.22.1'],
        ['26.12.0', '26.12.1'],
        ['26.0.0', '26.12.1'],
    ])('warns on %s and names the fixed %s', (version, fixed) => {
        const warning = nodeVersionWarning(version)
        expect(warning).toContain('CVE-2026-111497')
        expect(warning).toContain(`Update Node.js to ${fixed} or newer`)
    })

    test.each(['22.23.4', '22.23.5', '22.24.0', 'v24.22.1', '24.22.2', '24.23.0', '26.12.1', '26.13.0', '26.99.0'])(
        'stays silent on the fixed %s', (version) => {
            expect(nodeVersionWarning(version)).toBeNull()
        })

    test.each(['27.0.0', '28.1.2', '100.0.0'])('stays silent on the newer major %s', (version) => {
        expect(nodeVersionWarning(version)).toBeNull()
    })

    test.each(['20.19.0', '23.11.0', '25.1.0', '18.20.4', '21.7.3'])(
        'warns on the unfixed line of %s and points to a fixed line', (version) => {
            const warning = nodeVersionWarning(version)
            expect(warning).toContain('CVE-2026-111497')
            expect(warning).toContain('22.23.4, 24.22.1, 26.12.1')
        })

    test.each(['', 'nonsense', '24', '24.x.1', undefined, null, 24])('warns as unknown on %j', (version) => {
        const warning = nodeVersionWarning(version)
        expect(warning).toContain('CVE-2026-111497')
        expect(warning).toContain('could not be recognized')
    })
})
