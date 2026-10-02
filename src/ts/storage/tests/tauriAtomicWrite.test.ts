/**
 * `writeFileAtomic` and `sweepAtomicWriteTemps` (`src/ts/storage/tauriAtomicWrite.ts`)
 * against the in-memory Tauri file system in `tauriFsFake.ts`: the target is
 * never opened for writing, a rejection means the target was not replaced, the
 * temp name can never be read as a numbered backup, and only temp names are
 * swept. A passing test here is not evidence about the native plugin or about
 * Windows rename semantics.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { OS_ERROR_ACCESS_DENIED, OS_ERROR_DISK_FULL } from './tauriFsFake'

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs())

vi.mock('@tauri-apps/plugin-fs', () => fakeFs.module)

import { ATOMIC_TEMP_NAME_PATTERN, sweepAtomicWriteTemps, writeFileAtomic } from 'src/ts/storage/tauriAtomicWrite'

const MAIN = 'database/database.bin'
const BACKUP = 'database/dbbackup-17909517188.bin'
const OLD = new TextEncoder().encode('old-bytes')
const NEW = new TextEncoder().encode('new-bytes-that-are-longer')

function text(bytes: Uint8Array | undefined): string | undefined {
    return bytes ? new TextDecoder().decode(bytes) : undefined
}

function tempFiles(): string[] {
    return fakeFs.listing('database').filter((name) => ATOMIC_TEMP_NAME_PATTERN.test(name))
}

/** Settles a write that retries on timers, advancing the clock past every wait. */
async function settleWithTimers(promise: Promise<void>): Promise<unknown> {
    const outcome = promise.then(() => undefined, (error: unknown) => error)
    await vi.advanceTimersByTimeAsync(2000)
    return await outcome
}

beforeEach(() => {
    fakeFs.reset()
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('writeFileAtomic replaces the target', () => {
    test('puts the new bytes at the target, leaves no temp file, and never opens the target for writing', async () => {
        fakeFs.files.set(MAIN, OLD.slice())

        await writeFileAtomic(MAIN, NEW)

        expect(text(fakeFs.files.get(MAIN))).toBe(text(NEW))
        expect(tempFiles()).toEqual([])
        expect(fakeFs.listing('database')).toEqual(['database.bin'])
        expect(fakeFs.writesTo(MAIN)).toHaveLength(0)
    })

    test('creates the target when it was absent', async () => {
        await writeFileAtomic(MAIN, NEW)

        expect(text(fakeFs.files.get(MAIN))).toBe(text(NEW))
        expect(fakeFs.listing('database')).toEqual(['database.bin'])
    })

    test('writes the temp file with createNew and renames it with both base directories set', async () => {
        await writeFileAtomic(MAIN, NEW)

        expect(fakeFs.writeLog).toHaveLength(1)
        expect(fakeFs.writeLog[0].options).toEqual({ baseDir: 0, createNew: true })
        expect(fakeFs.renameLog).toHaveLength(1)
        expect(fakeFs.renameLog[0].from).toBe(fakeFs.writeLog[0].path)
        expect(fakeFs.renameLog[0].to).toBe(MAIN)
        expect(fakeFs.renameLog[0].options).toEqual({ oldPathBaseDir: 0, newPathBaseDir: 0 })
    })

    test('a path with no directory part gets a temp file with no directory part', async () => {
        await writeFileAtomic('target.bin', NEW)

        expect(fakeFs.writeLog[0].path).toMatch(ATOMIC_TEMP_NAME_PATTERN)
        expect(text(fakeFs.files.get('target.bin'))).toBe(text(NEW))
    })
})

describe('writeFileAtomic temp names (a temp file is never a numbered backup)', () => {
    for (const target of [MAIN, BACKUP]) {
        test(`the temp file for ${target} is in the target's directory, matches the temp pattern, contains no dbbackup- and does not start with a dot`, async () => {
            await writeFileAtomic(target, NEW)

            const tempPath = fakeFs.writeLog[0].path
            const slash = tempPath.lastIndexOf('/')
            expect(tempPath.slice(0, slash)).toBe('database')
            const name = tempPath.slice(slash + 1)
            expect(name).toMatch(ATOMIC_TEMP_NAME_PATTERN)
            expect(name).not.toContain('dbbackup-')
            expect(name.startsWith('.')).toBe(false)
        })
    }

    test('two writes use different temp names', async () => {
        await writeFileAtomic(MAIN, NEW)
        await writeFileAtomic(MAIN, OLD)

        expect(fakeFs.writeLog[0].path).not.toBe(fakeFs.writeLog[1].path)
    })

    test('the temp pattern matches no real name in database/ and no dotted or suffixed variant of a temp name', () => {
        for (const name of ['database.bin', 'dbbackup-17909517188.bin', '.risu-write-0123456789abcdef.tmp', 'risu-write-0123456789abcdef.tmp.bin', 'risu-write-0123456789abcde.tmp', 'risu-write-0123456789abcdeg.tmp']) {
            expect(ATOMIC_TEMP_NAME_PATTERN.test(name)).toBe(false)
        }
        expect(ATOMIC_TEMP_NAME_PATTERN.test('risu-write-0123456789abcdef.tmp')).toBe(true)
    })
})

describe('writeFileAtomic failure leaves the target as it was', () => {
    test('a temp write that fails part-way rejects with the original error, keeps the old target and removes the temp file', async () => {
        fakeFs.files.set(MAIN, OLD.slice())
        const fault = fakeFs.failWritesOf(() => true)

        const error = await settleWithTimers(writeFileAtomic(MAIN, NEW))

        expect(fault.fired).toBe(1)
        expect(error).toContain(OS_ERROR_DISK_FULL)
        expect(text(fakeFs.files.get(MAIN))).toBe(text(OLD))
        expect(tempFiles()).toEqual([])
        expect(fakeFs.renameLog).toHaveLength(0)
    })

    test('a rename that fails without a retryable code rejects with the original error after one attempt, keeps the old target and removes the temp file', async () => {
        fakeFs.files.set(MAIN, OLD.slice())
        const fault = fakeFs.failRenames('The system cannot find the path specified. (os error 3)')

        const error = await settleWithTimers(writeFileAtomic(MAIN, NEW))

        expect(fault.fired).toBe(1)
        expect(String(error)).toContain('(os error 3)')
        expect(fakeFs.renameLog).toHaveLength(1)
        expect(text(fakeFs.files.get(MAIN))).toBe(text(OLD))
        expect(tempFiles()).toEqual([])
    })

    test('an error whose os code is not at the end of the message is not retried', async () => {
        const fault = fakeFs.failRenames('(os error 5) but the message goes on')

        const error = await settleWithTimers(writeFileAtomic(MAIN, NEW))

        expect(fault.fired).toBe(1)
        expect(String(error)).toContain('but the message goes on')
        expect(fakeFs.renameLog).toHaveLength(1)
    })

    test('a temp file that cannot be removed does not replace the original error', async () => {
        fakeFs.files.set(MAIN, OLD.slice())
        fakeFs.failWritesOf(() => true)
        const removeFault = fakeFs.failRemoves(OS_ERROR_ACCESS_DENIED)

        const error = await settleWithTimers(writeFileAtomic(MAIN, NEW))

        expect(removeFault.fired).toBe(1)
        expect(String(error)).toContain(OS_ERROR_DISK_FULL)
        expect(text(fakeFs.files.get(MAIN))).toBe(text(OLD))
    })

    test('a rename that fails and a temp file that cannot be removed reject with the rename error and leave the old target', async () => {
        fakeFs.files.set(MAIN, OLD.slice())
        fakeFs.failRenames('Invalid. (os error 87)')
        fakeFs.failRemoves(OS_ERROR_ACCESS_DENIED)

        const error = await settleWithTimers(writeFileAtomic(MAIN, NEW))

        expect(String(error)).toContain('(os error 87)')
        expect(text(fakeFs.files.get(MAIN))).toBe(text(OLD))
    })

    test('a temp name that already exists is left alone and the write rejects without touching the target', async () => {
        fakeFs.files.set(MAIN, OLD.slice())
        vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
            (array as unknown as Uint8Array).fill(0xab)
            return array
        })
        const foreign = 'database/risu-write-abababababababab.tmp'
        fakeFs.files.set(foreign, new TextEncoder().encode('somebody-elses-bytes'))

        const error = await settleWithTimers(writeFileAtomic(MAIN, NEW))

        expect(String(error)).toContain('(os error 80)')
        expect(text(fakeFs.files.get(foreign))).toBe('somebody-elses-bytes')
        expect(text(fakeFs.files.get(MAIN))).toBe(text(OLD))
        expect(fakeFs.removeLog).toEqual([])
    })
})

describe('writeFileAtomic retries a rename that another handle blocked', () => {
    for (const code of [5, 32]) {
        test(`a rename that fails once with os error ${code} is retried and lands one complete write with no temp file`, async () => {
            fakeFs.files.set(MAIN, OLD.slice())
            const fault = fakeFs.failRenames(`Blocked. (os error ${code})`, 1)

            const error = await settleWithTimers(writeFileAtomic(MAIN, NEW))

            expect(error).toBeUndefined()
            expect(fault.fired).toBe(1)
            expect(fakeFs.renameLog).toHaveLength(2)
            expect(fakeFs.writeLog).toHaveLength(1)
            expect(text(fakeFs.files.get(MAIN))).toBe(text(NEW))
            expect(tempFiles()).toEqual([])
        })
    }

    test('waits between attempts and gives up after four retries, rejecting with the original error, keeping the old target and removing the temp file', async () => {
        fakeFs.files.set(MAIN, OLD.slice())
        const fault = fakeFs.failRenames(OS_ERROR_ACCESS_DENIED)

        const outcome = writeFileAtomic(MAIN, NEW).then(() => undefined, (error: unknown) => error)
        await vi.advanceTimersByTimeAsync(0)
        expect(fakeFs.renameLog).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(49)
        expect(fakeFs.renameLog).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(fakeFs.renameLog).toHaveLength(2)
        await vi.advanceTimersByTimeAsync(2000)
        const error = await outcome

        expect(fault.fired).toBe(5)
        expect(String(error)).toContain(OS_ERROR_ACCESS_DENIED)
        expect(text(fakeFs.files.get(MAIN))).toBe(text(OLD))
        expect(tempFiles()).toEqual([])
    })

    test('an Error object whose message ends in the code is retried too', async () => {
        let calls = 0
        const original = fakeFs.module.rename
        vi.spyOn(fakeFs.module, 'rename').mockImplementation(async (from, to, options) => {
            calls++
            if (calls === 1) {
                throw new Error('Blocked. (os error 5)')
            }
            await original(from, to, options)
        })

        const error = await settleWithTimers(writeFileAtomic(MAIN, NEW))

        expect(error).toBeUndefined()
        expect(calls).toBe(2)
        expect(text(fakeFs.files.get(MAIN))).toBe(text(NEW))
    })
})

describe('sweepAtomicWriteTemps', () => {
    test('removes the files whose name is a temp name and nothing else', async () => {
        fakeFs.files.set(MAIN, OLD.slice())
        fakeFs.files.set(BACKUP, OLD.slice())
        fakeFs.files.set('database/notes.txt', OLD.slice())
        fakeFs.files.set('database/risu-write-0123456789abcdef.tmp', OLD.slice())
        fakeFs.files.set('database/risu-write-fedcba9876543210.tmp', OLD.slice())
        fakeFs.files.set('database/.risu-write-0123456789abcdef.tmp', OLD.slice())
        fakeFs.files.set('assets/risu-write-0123456789abcdef.tmp', OLD.slice())

        await sweepAtomicWriteTemps('database')

        expect(fakeFs.listing('database')).toEqual(['.risu-write-0123456789abcdef.tmp', 'database.bin', 'dbbackup-17909517188.bin', 'notes.txt'])
        expect(fakeFs.files.has('assets/risu-write-0123456789abcdef.tmp')).toBe(true)
    })

    test('does not reject when the listing fails', async () => {
        fakeFs.failReadDirs(OS_ERROR_ACCESS_DENIED)
        vi.spyOn(console, 'error').mockImplementation(() => { })

        await expect(sweepAtomicWriteTemps('database')).resolves.toBeUndefined()
    })

    test('does not reject when a removal fails and still tries the other leftovers', async () => {
        fakeFs.files.set('database/risu-write-0123456789abcdef.tmp', OLD.slice())
        fakeFs.files.set('database/risu-write-fedcba9876543210.tmp', OLD.slice())
        const fault = fakeFs.failRemoves(OS_ERROR_ACCESS_DENIED)
        vi.spyOn(console, 'error').mockImplementation(() => { })

        await expect(sweepAtomicWriteTemps('database')).resolves.toBeUndefined()

        expect(fault.fired).toBe(2)
    })
})
