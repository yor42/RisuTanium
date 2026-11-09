import { describe, expect, test } from 'vitest'
import {
    characterOwnerKey,
    chatOwnerKey,
    isOwnerKey,
    nextPhase,
    parseOwnerKey,
    type MemoryOnlyReason,
    type OwnerEvent,
    type OwnerPhase,
} from '../ownerPhase'

const claiming: OwnerPhase = { kind: 'claiming' }
const opening: OwnerPhase = { kind: 'opening' }
const loading: OwnerPhase = { kind: 'loading' }
const ready: OwnerPhase = { kind: 'ready', reason: null }
const excluded: OwnerPhase = { kind: 'excluded' }

function memoryOnly(reason: MemoryOnlyReason): OwnerPhase {
    return { kind: 'memoryOnly', reason }
}

interface Row {
    from: OwnerPhase
    event: OwnerEvent
    to: OwnerPhase
}

// Every row of the plan's phase table, written out independently of the implementation.
const ROWS: Row[] = [
    { from: claiming, event: { type: 'claim:granted' }, to: opening },
    { from: claiming, event: { type: 'claim:unsupported', tauri: true }, to: opening },
    { from: claiming, event: { type: 'claim:held' }, to: memoryOnly('otherTab') },
    { from: claiming, event: { type: 'claim:unsupported', tauri: false }, to: memoryOnly('noLocks') },
    { from: claiming, event: { type: 'claim:failed' }, to: memoryOnly('failed') },
    { from: claiming, event: { type: 'deadline' }, to: memoryOnly('failed') },
    { from: opening, event: { type: 'open:ok' }, to: loading },
    { from: opening, event: { type: 'open:unavailable' }, to: memoryOnly('unavailable') },
    { from: opening, event: { type: 'deadline' }, to: memoryOnly('unavailable') },
    { from: loading, event: { type: 'load:absent' }, to: ready },
    { from: loading, event: { type: 'load:ok' }, to: ready },
    { from: loading, event: { type: 'load:unreadable' }, to: { kind: 'ready', reason: 'unreadable' } },
    { from: loading, event: { type: 'load:keptUnreadable' }, to: memoryOnly('keptUnreadable') },
    { from: loading, event: { type: 'load:failed' }, to: memoryOnly('failed') },
    { from: loading, event: { type: 'deadline' }, to: memoryOnly('failed') },
    { from: loading, event: { type: 'closed' }, to: memoryOnly('unavailable') },
    { from: ready, event: { type: 'save:ok', asided: false, trimmed: false }, to: ready },
    { from: ready, event: { type: 'save:ok', asided: true, trimmed: false }, to: { kind: 'ready', reason: 'unreadable' } },
    { from: ready, event: { type: 'save:ok', asided: false, trimmed: true }, to: { kind: 'ready', reason: 'trimmed' } },
    { from: ready, event: { type: 'save:unwritable' }, to: { kind: 'ready', reason: 'unwritable' } },
    { from: ready, event: { type: 'save:kept' }, to: memoryOnly('keptUnreadable') },
    { from: ready, event: { type: 'save:notLoaded' }, to: memoryOnly('failed') },
    { from: ready, event: { type: 'closed' }, to: memoryOnly('unavailable') },
]

const ALL_EVENTS: OwnerEvent[] = [
    { type: 'firstUse', restricted: false },
    { type: 'firstUse', restricted: true },
    { type: 'claim:granted' },
    { type: 'claim:held' },
    { type: 'claim:unsupported', tauri: true },
    { type: 'claim:unsupported', tauri: false },
    { type: 'claim:failed' },
    { type: 'deadline' },
    { type: 'open:ok' },
    { type: 'open:unavailable' },
    { type: 'load:absent' },
    { type: 'load:ok' },
    { type: 'load:unreadable' },
    { type: 'load:keptUnreadable' },
    { type: 'load:failed' },
    { type: 'save:ok', asided: false, trimmed: false },
    { type: 'save:ok', asided: true, trimmed: false },
    { type: 'save:ok', asided: false, trimmed: true },
    { type: 'save:unwritable' },
    { type: 'save:kept' },
    { type: 'save:notLoaded' },
    { type: 'closed' },
]

const ALL_PHASES: OwnerPhase[] = [
    claiming,
    opening,
    loading,
    ready,
    { kind: 'ready', reason: 'unwritable' },
    memoryOnly('otherTab'),
    memoryOnly('noLocks'),
    memoryOnly('failed'),
    memoryOnly('unavailable'),
    memoryOnly('keptUnreadable'),
    excluded,
]

function describeEvent(event: OwnerEvent): string {
    return JSON.stringify(event)
}

describe('T-OP1 nextPhase table', () => {
    test('first use leaves "not used yet" for claiming, or excluded for a restricted owner', () => {
        expect(nextPhase(null, { type: 'firstUse', restricted: false })).toEqual({ kind: 'claiming' })
        expect(nextPhase(null, { type: 'firstUse', restricted: true })).toEqual({ kind: 'excluded' })
    })

    test.each(ROWS.map((row) => [JSON.stringify(row.from) + ' + ' + describeEvent(row.event), row] as const))(
        'row %s',
        (_name, row) => {
            expect(nextPhase(row.from, row.event)).toEqual(row.to)
        },
    )

    test('ready stays ready on a save that clears a former reason', () => {
        expect(nextPhase({ kind: 'ready', reason: 'unwritable' }, { type: 'save:ok', asided: false, trimmed: false })).toEqual({
            kind: 'ready',
            reason: null,
        })
    })

    test('every pair without a row is ignored and returns the phase by reference', () => {
        let ignored = 0
        for (const phase of ALL_PHASES) {
            for (const event of ALL_EVENTS) {
                const hasRow = ROWS.some((row) => row.from.kind === phase.kind && row.event.type === event.type)
                if (hasRow) {
                    continue
                }
                expect(nextPhase(phase, event), `${JSON.stringify(phase)} + ${describeEvent(event)}`).toBe(phase)
                ignored += 1
            }
        }
        expect(ignored).toBeGreaterThan(100)
    })

    test('the ignored pairs the plan names explicitly', () => {
        // A deadline in ready, a load result while opening, a claim result while loading.
        expect(nextPhase(ready, { type: 'deadline' })).toBe(ready)
        expect(nextPhase(opening, { type: 'load:ok' })).toBe(opening)
        expect(nextPhase(loading, { type: 'claim:granted' })).toBe(loading)
        expect(nextPhase(loading, { type: 'open:ok' })).toBe(loading)
    })

    test('memoryOnly and excluded accept no event, including a late load result', () => {
        for (const phase of ALL_PHASES.filter((p) => p.kind === 'memoryOnly' || p.kind === 'excluded')) {
            for (const event of ALL_EVENTS) {
                expect(nextPhase(phase, event), `${JSON.stringify(phase)} + ${describeEvent(event)}`).toBe(phase)
            }
        }
    })

    test('no event but first use leaves the "not used yet" state', () => {
        for (const event of ALL_EVENTS.filter((e) => e.type !== 'firstUse')) {
            expect(nextPhase(null, event)).toBeNull()
        }
    })

    test('a table row never mutates the phase it was given', () => {
        const phase: OwnerPhase = { kind: 'ready', reason: null }
        const snapshot = JSON.stringify(phase)
        nextPhase(phase, { type: 'save:unwritable' })
        expect(JSON.stringify(phase)).toBe(snapshot)
    })
})

describe('owner keys', () => {
    test('T-K2 keys are built from ids and round-trip', () => {
        const character = characterOwnerKey('c1')
        const chat = chatOwnerKey('c1', 'chatA')
        expect(character).toBe('character:c1')
        expect(chat).toBe('chat:c1/chatA')
        expect(parseOwnerKey(character)).toEqual({ kind: 'character', chaId: 'c1' })
        expect(parseOwnerKey(chat)).toEqual({ kind: 'chat', chaId: 'c1', chatId: 'chatA' })
    })

    test('two chats of one character have distinct keys, independent of any page index', () => {
        expect(chatOwnerKey('c1', 'a')).not.toBe(chatOwnerKey('c1', 'b'))
    })

    test('malformed keys are not owner keys', () => {
        for (const bad of ['', 'character:', 'chat:', 'chat:c1', 'chat:c1/', 'chat:/x', 'rec:character:c1', 'other:c1']) {
            expect(parseOwnerKey(bad), bad).toBeNull()
            expect(isOwnerKey(bad), bad).toBe(false)
        }
    })
})
