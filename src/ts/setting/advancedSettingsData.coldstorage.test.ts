/**
 * The "Archive characters at startup" entry of the advanced settings
 * (`adv.coldstorage` in `src/ts/setting/advancedSettingsData.ts`): turning the
 * setting off forgets the device memo of the boot archive pass, so turning it
 * on again tries the skipped characters and a too-large save once more.
 *
 * The memo module is loaded inside each test that needs it, so a test that
 * does not need it is not affected by it. Tests titled `guard:` assert
 * behaviour that must not change; they pass with and without the memo. The
 * other asserts behaviour only the memo clearing has.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

import { advancedSettingsItems } from 'src/ts/setting/advancedSettingsData'

type MemoModule = typeof import('src/ts/storage/bootArchiveMemo')

async function memoModule(): Promise<MemoModule> {
    const path = '/src/ts/storage/bootArchiveMemo'
    return await import(/* @vite-ignore */ path) as MemoModule
}

interface ArchiveEntry {
    getValue(db: Record<string, unknown>): boolean
    setValue(db: Record<string, unknown>, value: boolean): void
}

function archiveEntry(): ArchiveEntry {
    const entry = advancedSettingsItems.find((item) => item.id === 'adv.coldstorage')
    if (!entry) {
        throw new Error('the archive entry is missing from the advanced settings')
    }
    return entry as unknown as ArchiveEntry
}

beforeEach(() => {
    localStorage.clear()
})

describe('adv.coldstorage', () => {
    test('guard: reads on unless the setting is false, and writes the value it is given', () => {
        const entry = archiveEntry()
        const db: Record<string, unknown> = {}

        expect(entry.getValue(db)).toBe(true)
        entry.setValue(db, false)
        expect(db.archiveCharacters).toBe(false)
        expect(entry.getValue(db)).toBe(false)
        entry.setValue(db, true)
        expect(db.archiveCharacters).toBe(true)
        expect(entry.getValue(db)).toBe(true)
    })

    test('turning the setting off forgets the skipped characters and the too-large save', async () => {
        await memoModule()
        localStorage.setItem('archivePassSkipped', JSON.stringify(['a', 'b']))
        localStorage.setItem('archivePassTooLarge', '1')

        archiveEntry().setValue({}, false)

        expect(localStorage.getItem('archivePassSkipped')).toBeNull()
        expect(localStorage.getItem('archivePassTooLarge')).toBeNull()
    })

    test('turning the setting off forgets the strike count and the told record of the crash-loop breaker', async () => {
        await memoModule()
        localStorage.setItem('archivePassStrikes', '2')
        localStorage.setItem('archivePassPausedTold', '1')
        localStorage.setItem('unrelated-key', 'kept')

        archiveEntry().setValue({}, false)

        expect(localStorage.getItem('archivePassStrikes')).toBeNull()
        expect(localStorage.getItem('archivePassPausedTold')).toBeNull()
        expect(localStorage.getItem('unrelated-key')).toBe('kept')
    })

    test('turning the setting off and on again leaves a paused device with no record of the pause', async () => {
        await memoModule()
        localStorage.setItem('archivePassStrikes', '2')
        localStorage.setItem('archivePassPausedTold', '1')
        const db: Record<string, unknown> = {}

        archiveEntry().setValue(db, false)
        archiveEntry().setValue(db, true)

        expect(localStorage.getItem('archivePassStrikes')).toBeNull()
        expect(localStorage.getItem('archivePassPausedTold')).toBeNull()
    })

    test('guard: turning the setting on leaves a strike count and a told record alone', async () => {
        await memoModule()
        localStorage.setItem('archivePassStrikes', '1')
        localStorage.setItem('archivePassPausedTold', '1')

        archiveEntry().setValue({}, true)

        expect(localStorage.getItem('archivePassStrikes')).toBe('1')
        expect(localStorage.getItem('archivePassPausedTold')).toBe('1')
    })

    test('guard: turning the setting off where the memo is already clear does not throw and writes nothing', async () => {
        await memoModule()

        expect(() => archiveEntry().setValue({}, false)).not.toThrow()

        expect(localStorage.length).toBe(0)
    })

    test('guard: turning the setting on writes no memo', async () => {
        await memoModule()

        archiveEntry().setValue({}, true)

        expect(localStorage.length).toBe(0)
    })

    // The stub-enrichment count (key `stubEnrichStrikes`) bounds enrichment on a profile whose archiving is off
    // and is not cleared by `clearArchiveMemo`; a change of the setting in either direction re-arms it.
    test.each([
        ['off', false],
        ['on', true],
    ] as const)('turning the setting %s removes the stub-enrichment count', async (_label, value) => {
        await memoModule()
        localStorage.setItem('stubEnrichStrikes', '2')
        localStorage.setItem('unrelated-key', 'kept')

        archiveEntry().setValue({}, value)

        expect(localStorage.getItem('stubEnrichStrikes')).toBeNull()
        expect(localStorage.getItem('unrelated-key')).toBe('kept')
    })

    test.each(['1', '2', 'not a count'])('turning the setting off removes a stub-enrichment count of %j instead of writing zero', async (stored) => {
        await memoModule()
        localStorage.setItem('stubEnrichStrikes', stored)

        archiveEntry().setValue({}, false)

        expect(localStorage.getItem('stubEnrichStrikes')).toBeNull()
    })

    test('turning the setting off and on again leaves no stub-enrichment count', async () => {
        await memoModule()
        localStorage.setItem('stubEnrichStrikes', '2')
        const db: Record<string, unknown> = {}

        archiveEntry().setValue(db, false)
        archiveEntry().setValue(db, true)

        expect(localStorage.getItem('stubEnrichStrikes')).toBeNull()
    })

    test('guard: turning the setting off still clears the archive memo and the strike count beside the stub-enrichment count', async () => {
        await memoModule()
        localStorage.setItem('archivePassTooLarge', '1')
        localStorage.setItem('archivePassStrikes', '2')
        localStorage.setItem('stubEnrichStrikes', '1')

        archiveEntry().setValue({}, false)

        expect(localStorage.getItem('archivePassTooLarge')).toBeNull()
        expect(localStorage.getItem('archivePassStrikes')).toBeNull()
    })
})
