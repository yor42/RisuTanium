/**
 * The desktop atomic write cleans up its temp file through the app's own
 * remove command, with the bare key. The temp path the plugin write and rename
 * use carries the plugin's `./` prefix; the JS wrapper (`appFs.ts`) refuses a
 * key that has it before any command is sent, and the cleanup swallows every failure, so the leftover temp is observable
 * only in the file system. The assertions are therefore on the fake's files and
 * on the recorded command arguments. A pass says nothing about the native shell.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { installTauriWire, type TauriWire } from './tauriWireFake'

const TEMP_KEY = /^database\/risu-write-[0-9a-f]{16}\.tmp$/

let wire: TauriWire

beforeEach(() => {
    wire = installTauriWire({ os: 'windows' })
    wire.fs.plant('database/database.bin', Uint8Array.of(1, 2, 3))
})

afterEach(() => {
    wire.uninstall()
})

function leftoverTemps(): string[] {
    return Array.from(wire.fs.files.keys()).filter((key) => TEMP_KEY.test(key))
}

function removedKeys(): string[] {
    return wire.callsOf('app_fs_remove').map((call) => String((call.args as { key?: unknown }).key))
}

describe('writeFileAtomic on desktop removes its temp file after a failure', () => {
    test('a write that failed halfway leaves no temp and the old file', async () => {
        const { writeFileAtomic } = await import('src/ts/storage/tauriAtomicWrite')
        wire.fs.failWritesOf((data) => data.length === 5, 1)

        await expect(writeFileAtomic('./database/database.bin', Uint8Array.of(9, 9, 9, 9, 9))).rejects.toBeDefined()

        expect(leftoverTemps()).toEqual([])
        expect(Array.from(wire.fs.files.get('database/database.bin') ?? [])).toEqual([1, 2, 3])
        const removed = removedKeys()
        expect(removed).toHaveLength(1)
        expect(removed[0]).toMatch(TEMP_KEY)
    })

    test('a rename that failed leaves no temp and the old file', async () => {
        const { writeFileAtomic } = await import('src/ts/storage/tauriAtomicWrite')
        wire.fs.failRenames('Invalid argument (os error 22)', 1)

        await expect(writeFileAtomic('./database/database.bin', Uint8Array.of(9, 9, 9, 9, 9))).rejects.toBeDefined()

        expect(leftoverTemps()).toEqual([])
        expect(Array.from(wire.fs.files.get('database/database.bin') ?? [])).toEqual([1, 2, 3])
        const removed = removedKeys()
        expect(removed).toHaveLength(1)
        expect(removed[0]).toMatch(TEMP_KEY)
    })

    test('guard: a write that succeeds replaces the file and removes nothing', async () => {
        const { writeFileAtomic } = await import('src/ts/storage/tauriAtomicWrite')

        await writeFileAtomic('./database/database.bin', Uint8Array.of(7, 7))

        expect(Array.from(wire.fs.files.get('database/database.bin') ?? [])).toEqual([7, 7])
        expect(leftoverTemps()).toEqual([])
        expect(removedKeys()).toEqual([])
    })
})
