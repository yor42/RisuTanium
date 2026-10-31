import type { alertData } from './alert'

/**
 * What Escape does while an alert of a given type is up.
 * - `ignore`: the alert waits for an answer, or is deliberately left alone. Escape is consumed
 *   and changes nothing.
 * - `close`: an information alert with no answer to give. Escape closes it.
 * - `idle`: nothing is waiting on the user. Escape takes the ordinary path.
 */
export type AlertEscapeAction = 'ignore' | 'close' | 'idle'

/**
 * Total over `alertData['type']`, so a new alert type fails the type check until it is classified.
 * A prompt waiting for an answer is never answered by Escape. A `wait` alert carrying `onCancel`
 * is handled earlier in hotkey.ts and never reaches this table.
 */
export const ALERT_ESCAPE_ACTIONS: Record<alertData['type'], AlertEscapeAction> = {
    ask: 'ignore',
    pluginconfirm: 'ignore',
    select: 'ignore',
    input: 'ignore',
    selectChar: 'ignore',
    addchar: 'ignore',
    chatOptions: 'ignore',
    cardexport: 'ignore',
    selectModule: 'ignore',
    tos: 'ignore',
    staleAccountNotice: 'ignore',
    patternSelect: 'ignore',
    patternInput: 'ignore',
    progress: 'ignore',
    normal: 'close',
    error: 'close',
    markdown: 'close',
    requestdata: 'close',
    hypaV2: 'close',
    branches: 'close',
    requestlogs: 'close',
    pukmakkurit: 'close',
    wait2: 'close',
    none: 'idle',
    toast: 'idle',
    wait: 'idle',
}

export function escapeActionFor(type: alertData['type']): AlertEscapeAction {
    return ALERT_ESCAPE_ACTIONS[type]
}

/**
 * Whether an alert of a type covers the page: the app behind it takes no keys and no focus while it is
 * shown. Total over `alertData['type']`, so a new alert type fails the type check until it is classified.
 */
export const ALERT_COVERS_PAGE: Record<alertData['type'], boolean> = {
    ask: true,
    pluginconfirm: true,
    select: true,
    input: true,
    selectChar: true,
    addchar: true,
    chatOptions: true,
    cardexport: true,
    selectModule: true,
    tos: true,
    staleAccountNotice: true,
    patternSelect: true,
    patternInput: true,
    progress: true,
    normal: true,
    error: true,
    markdown: true,
    requestdata: true,
    hypaV2: true,
    branches: true,
    requestlogs: true,
    pukmakkurit: true,
    wait2: true,
    wait: true,
    none: false,
    toast: false,
}

export function coversPage(type: alertData['type']): boolean {
    return ALERT_COVERS_PAGE[type] === true
}
