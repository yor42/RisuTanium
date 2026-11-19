import { describe, expect, test } from 'vitest'
import { reconcileGateOpen } from '../gate'

/** The reconcile gate (guard, new rule): open only on a writable, set-up, visible page. Mutant M31c drops a term. */
describe('reconcileGateOpen', () => {
    test.each([
        [{ readOnly: false, didFirstSetup: true, visible: true }, true],
        [{ readOnly: true, didFirstSetup: true, visible: true }, false],
        [{ readOnly: false, didFirstSetup: false, visible: true }, false],
        [{ readOnly: false, didFirstSetup: true, visible: false }, false],
        [{ readOnly: true, didFirstSetup: false, visible: false }, false],
    ])('%j -> %s', (facts, expected) => {
        expect(reconcileGateOpen(facts)).toBe(expected)
    })
})
