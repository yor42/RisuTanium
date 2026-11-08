import { describe, expect, test } from 'vitest'
import {
    bootFraction, bootProgressFromLegacyText, bootSteps, bootStateWithNotice, createLegacyBootTracker,
    type BootNotice, type BootProgress, type BootStep,
} from './bootProgress'

describe('bootFraction', () => {
    test('is non-decreasing over the step order, with and without counts', () => {
        let previous = -1
        for (const step of bootSteps) {
            const start = bootFraction({ step, state: 'running' })
            const half = bootFraction({ step, state: 'running', count: { done: 1, total: 2 } })
            const full = bootFraction({ step, state: 'running', count: { done: 2, total: 2 } })
            expect(start).toBeGreaterThanOrEqual(previous)
            expect(half).toBeGreaterThan(start)
            expect(full).toBeGreaterThanOrEqual(half)
            previous = full
        }
        expect(previous).toBeLessThanOrEqual(1)
        expect(bootFraction({ step: 'finish', state: 'ready' })).toBe(1)
    })

    test('a later step never reads lower than an earlier step at its fullest', () => {
        for (let i = 1; i < bootSteps.length; i++) {
            const earlier: BootProgress = { step: bootSteps[i - 1], state: 'running', count: { done: 5, total: 5 } }
            const later: BootProgress = { step: bootSteps[i], state: 'running' }
            expect(bootFraction(later)).toBeGreaterThanOrEqual(bootFraction(earlier))
        }
    })

    test('out-of-range and empty counts stay inside the step share', () => {
        const base = bootFraction({ step: 'library', state: 'running' })
        const next = bootFraction({ step: 'app', state: 'running' })
        expect(bootFraction({ step: 'library', state: 'running', count: { done: 99, total: 3 } })).toBeCloseTo(next)
        expect(bootFraction({ step: 'library', state: 'running', count: { done: -4, total: 3 } })).toBe(base)
        expect(bootFraction({ step: 'library', state: 'running', count: { done: 1, total: 0 } })).toBe(base)
    })
})

// The text sequences are copies of what bootstrap.ts and bootArchivePass.ts write into LoadingStatusState.text, in the
// order of each branch of boot. They are copies on purpose: the mapping is tested against the producer's literals.
const backupText = `Reading Backup File ${1700000000000}...`

/** Reads texts the way the screen does: each result's step is the previous step for the next text. */
function walk(texts: readonly string[]): BootProgress[] {
    let last: BootStep = 'storage'
    return texts.map(text => {
        const progress = bootProgressFromLegacyText(text, last)
        last = progress.step
        return progress
    })
}

const stepsOf = (texts: readonly string[]) => walk(texts).map(progress => progress.step)

const tauriNormal = [
    'Checking Files...', 'Reading Save File...', 'Decoding Save File...', 'Archiving characters 1/2',
    'Updating archived characters 2/2', 'Checking Update...', 'Listing Stored Files...', 'Loading Plugins...',
    'Checking For Format Update...', 'Updating States...',
]
const tauriRecovery = [
    'Checking Files...', 'Reading Save File...', 'Reading Backup Files...', backupText, 'Checking Update...',
    'Listing Stored Files...',
]
const tauriStore2 = ['Checking Files...', 'Reading Save File...', 'Decoding Save File...', 'Checking Update...', 'Listing Stored Files...']
// A page whose store2 backend is unavailable writes the save text before the dispatch answers, then runs the legacy boot.
const tauriReadOnly = ['Checking Files...', 'Reading Save File...', 'Reading Save File...', 'Decoding Save File...', 'Checking Update...', 'Listing Stored Files...']
const webReadOnly = ['Checking Service Worker...', 'Reading Save File...', 'Loading Local Save File...', 'Decoding Local Save File...', 'Listing Stored Files...']
const webNormal = [
    'Checking Service Worker...', 'Loading Local Save File...', 'Archiving characters 1/3',
    'Decoding Local Save File...', 'Listing Stored Files...', 'Loading Plugins...', 'Checking For Format Update...',
    'Updating States...',
]
const webStore2 = [
    'Checking Service Worker...', 'Reading Save File...', 'Decoding Save File...', 'Listing Stored Files...',
    'Loading Plugins...', 'Checking For Format Update...', 'Updating States...',
]
const webRecovery = [
    'Checking Service Worker...', 'Loading Local Save File...', 'Decoding Local Save File...', backupText,
    'Listing Stored Files...',
]

describe('legacy boot text order', () => {
    test('reproducer: the step never decreases over any real text order on either platform', () => {
        for (const texts of [tauriNormal, tauriRecovery, tauriStore2, tauriReadOnly, webNormal, webStore2, webReadOnly, webRecovery]) {
            let previous = -1
            for (const step of stepsOf(texts)) {
                const index = bootSteps.indexOf(step)
                expect(index).toBeGreaterThanOrEqual(previous)
                previous = index
            }
        }
    })

    // A fresh tracker starts at `storage`, so the 'Checking Files...' and 'Checking Service Worker...' rows give
    // the same step as the default; the entries below still pin them for a tracker that has moved on.
    test('Tauri orders map to exact steps, counts and recovery details', () => {
        expect(stepsOf(tauriNormal)).toEqual([
            'storage', 'save', 'library', 'library', 'library', 'app', 'files', 'plugins', 'finish', 'finish',
        ])
        const counted = walk(tauriNormal)
        expect(counted[3].count).toEqual({ done: 0, total: 2 })
        expect(counted[3].detail).toBe('Archiving characters 1/2')
        expect(counted[4].count).toEqual({ done: 1, total: 2 })
        expect(counted[4].detail).toBe('Updating archived characters 2/2')
        expect(counted.filter(progress => progress.recovering)).toEqual([])

        expect(stepsOf(tauriRecovery)).toEqual(['storage', 'save', 'library', 'library', 'app', 'files'])
        const recovery = walk(tauriRecovery)
        for (const index of [2, 3]) {
            expect(recovery[index].recovering).toBe(true)
            expect(recovery[index].detail).toBe('Recovering from a backup')
        }
        expect(recovery.filter(progress => progress.recovering).length).toBe(2)

        expect(stepsOf(tauriStore2)).toEqual(['storage', 'save', 'library', 'app', 'files'])
        expect(stepsOf(tauriReadOnly)).toEqual(['storage', 'save', 'save', 'library', 'app', 'files'])
    })

    test('reproducer: web orders map to exact steps, with the service worker check in the storage step', () => {
        expect(stepsOf(webNormal)).toEqual([
            'storage', 'save', 'library', 'library', 'files', 'plugins', 'finish', 'finish',
        ])
        expect(stepsOf(webStore2)).toEqual(['storage', 'save', 'library', 'files', 'plugins', 'finish', 'finish'])
        expect(stepsOf(webReadOnly)).toEqual(['storage', 'save', 'save', 'library', 'files'])
        expect(stepsOf(webRecovery)).toEqual(['storage', 'save', 'library', 'library', 'files'])
        expect(walk(webRecovery)[3].recovering).toBe(true)
    })
})

describe('createLegacyBootTracker', () => {
    test('a fresh tracker starts at storage and keeps the last step for text it does not know', () => {
        const tracker = createLegacyBootTracker()
        expect(tracker.read('').step).toBe('storage')
        expect(tracker.read('Decoding Save File...').step).toBe('library')
        expect(tracker.read('Unknown text').step).toBe('library')
        expect(createLegacyBootTracker().read('Unknown text').step).toBe('storage')
    })

    test('counted text gives the step, the finished count and the text as the detail', () => {
        const tracker = createLegacyBootTracker()
        const first = tracker.read('Archiving characters 1/3')
        expect(first.step).toBe('library')
        expect(first.count).toEqual({ done: 0, total: 3 })
        expect(first.detail).toBe('Archiving characters 1/3')
        expect(tracker.read('Updating archived characters 3/3').count).toEqual({ done: 2, total: 3 })
    })
})

describe('bootProgressFromLegacyText previous step', () => {
    test('unknown or empty text keeps the step it is given', () => {
        expect(bootProgressFromLegacyText('x', 'files').step).toBe('files')
        expect(bootProgressFromLegacyText('').step).toBe('storage')
    })
})

describe('bootStateWithNotice', () => {
    const normal: BootNotice = { kind: 'normal', message: 'm' }
    const error: BootNotice = { kind: 'error', message: 'm' }
    const wait: BootNotice = { kind: 'wait', message: 'm' }

    test('failed and ready always win over a notice', () => {
        expect(bootStateWithNotice('failed', normal)).toBe('failed')
        expect(bootStateWithNotice('failed', error)).toBe('failed')
        expect(bootStateWithNotice('ready', error)).toBe('ready')
    })

    test('a normal or error notice pauses boot, a wait notice or none keeps the state', () => {
        expect(bootStateWithNotice('running', normal)).toBe('waiting')
        expect(bootStateWithNotice('running', error)).toBe('waiting')
        expect(bootStateWithNotice('running', wait)).toBe('running')
        expect(bootStateWithNotice('running')).toBe('running')
    })
})
