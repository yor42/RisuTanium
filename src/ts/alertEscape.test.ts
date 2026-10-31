/**
 * Specification of what Escape does for each alert type (`alertEscape.ts`).
 *
 * The table below is the specification, written out independently of the
 * module. It is typed as a total `Record` over `alertData['type']`, so an alert
 * type added to the union fails the type check here until it is given a class.
 * `alertEscape.ts` is imported with no mocks.
 *
 * Every alert that waits for an answer, and the progress overlay, is `ignore`:
 * Escape is consumed and changes nothing. An information alert has no answer to
 * give, so it is `close`. An alert that nothing waits on is `idle`.
 */
import { describe, expect, test } from 'vitest'
import type { alertData } from './alert'
import { ALERT_ESCAPE_ACTIONS, escapeActionFor, type AlertEscapeAction } from './alertEscape'

const SPECIFIED: Record<alertData['type'], AlertEscapeAction> = {
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

const TYPES = Object.keys(SPECIFIED) as Array<alertData['type']>

describe('specification: what Escape does for each alert type', () => {
    test.each(TYPES)('the type %s is classified as its specified class', (type) => {
        expect(escapeActionFor(type)).toBe(SPECIFIED[type])
    })

    test('the table classifies exactly the specified types, no more and no fewer', () => {
        expect(Object.keys(ALERT_ESCAPE_ACTIONS).sort()).toEqual([...TYPES].sort())
    })

    test('the table classifies every type as one of the three classes', () => {
        const classes = new Set<AlertEscapeAction>(['ignore', 'close', 'idle'])
        for (const type of TYPES) {
            expect(classes.has(escapeActionFor(type)), `the class of ${type}`).toBe(true)
        }
    })
})
