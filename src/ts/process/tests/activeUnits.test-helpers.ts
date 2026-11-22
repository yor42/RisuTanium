import { activeUnits, type ActiveUnitKey } from '../activeUnits'

/**
 * A chat no test world uses, so a unit held under it makes the send gate busy for every chat. A test that needs the
 * unit to belong to its own chat passes that chat's key instead.
 */
const elsewhere: ActiveUnitKey = { chaId: 'test-running-send-elsewhere', chatId: 'test-running-send-elsewhere-chat' }

/** Holds a unit as a running send would, until `clearRunningSends`. */
export function simulateRunningSend(key: ActiveUnitKey = elsewhere): void {
    activeUnits.unit(key).take()
}

/** Drops every held unit, including one a failed test left behind. */
export function clearRunningSends(): void {
    activeUnits.resetForTests()
}