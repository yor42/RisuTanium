import { describe, expect, test } from 'vitest'
import {
    composerWindowFor,
    isComposerWindowOpen,
    isUnitInProgressSignal,
    noteTurnReached,
    openComposerWindow,
    processStageIn,
    publishUnit,
    releaseUnit,
    setProcessStage,
    turnsReachedCount,
    unitTargetOfSignal,
} from '../generationOwnership.svelte'

const CHAT_A = { chaId: 'a', chatId: '1' }
const CHAT_B = { chaId: 'b', chatId: '2' }

describe('published unit tags are keyed by signal', () => {
    // R1 (regression reproducer): a second publish overwrote the single slot.
    test('two published units each answer with their own signal and target', () => {
        const cA = new AbortController()
        const cB = new AbortController()
        publishUnit(cA, CHAT_A)
        publishUnit(cB, CHAT_B)
        try {
            expect(isUnitInProgressSignal(cA.signal)).toBe(true)
            expect(isUnitInProgressSignal(cB.signal)).toBe(true)
            expect(unitTargetOfSignal(cA.signal)).toEqual(CHAT_A)
            expect(unitTargetOfSignal(cB.signal)).toEqual(CHAT_B)
        } finally {
            releaseUnit(cA)
            releaseUnit(cB)
        }
    })

    // G-R2 (compatibility guard, passes on base): a release removes only its own entry.
    test('releasing one unit leaves the other published', () => {
        const cA = new AbortController()
        const cB = new AbortController()
        publishUnit(cA, CHAT_A)
        publishUnit(cB, CHAT_B)
        releaseUnit(cA)
        releaseUnit(cA)
        try {
            expect(isUnitInProgressSignal(cA.signal)).toBe(false)
            expect(unitTargetOfSignal(cA.signal)).toBeNull()
            expect(isUnitInProgressSignal(cB.signal)).toBe(true)
            expect(unitTargetOfSignal(cB.signal)).toEqual(CHAT_B)
        } finally {
            releaseUnit(cB)
        }
        expect(isUnitInProgressSignal(cB.signal)).toBe(false)
    })
})

describe('the process stage is keyed by chat', () => {
    // G10 (post-fix guard): each chat reads its own stage; no chat reads 0.
    test('each chat reads its own stage, and no chat or an unknown chat reads 0', () => {
        setProcessStage(CHAT_A, 2)
        setProcessStage(CHAT_B, 4)

        expect(processStageIn(CHAT_A)).toBe(2)
        expect(processStageIn(CHAT_B)).toBe(4)
        expect(processStageIn(null)).toBe(0)
        expect(processStageIn({ chaId: 'never-sent', chatId: 'none' })).toBe(0)
    })
})

describe('turn counts are keyed by chat', () => {
    // R5 (regression reproducer): the count was global.
    test('a turn noted for chat A leaves chat B unchanged', () => {
        const beforeA = turnsReachedCount(CHAT_A)
        const beforeB = turnsReachedCount(CHAT_B)
        noteTurnReached(CHAT_A)
        expect(turnsReachedCount(CHAT_A) - beforeA).toBe(1)
        expect(turnsReachedCount(CHAT_B) - beforeB).toBe(0)
    })

    test('a turn noted for another chat of the same character leaves this chat unchanged', () => {
        const sibling = { chaId: CHAT_A.chaId, chatId: 'other' }
        const before = turnsReachedCount(sibling)
        noteTurnReached(CHAT_A)
        expect(turnsReachedCount(sibling) - before).toBe(0)
    })
})

describe('the composer window is a set of per-chat handles', () => {
    // R8 (regression reproducer): the window was one boolean with one origin.
    test('closing one handle of a chat leaves the chat open while another handle is held, and the window stays open until the last handle closes', () => {
        const a1 = openComposerWindow(CHAT_A)
        const b = openComposerWindow(CHAT_B)
        const a2 = openComposerWindow(CHAT_A)
        try {
            a1.close()
            expect(composerWindowFor(CHAT_A)).toBe(true)
            a1.close()
            expect(composerWindowFor(CHAT_A)).toBe(true)
            a2.close()
            expect(composerWindowFor(CHAT_A)).toBe(false)
            expect(composerWindowFor(CHAT_B)).toBe(true)
            expect(isComposerWindowOpen()).toBe(true)
            b.close()
            expect(isComposerWindowOpen()).toBe(false)
        }
        finally {
            a1.close()
            a2.close()
            b.close()
        }
    })
})