/**
 * The non-pruning lister of numbered backups (`backupList.ts`), shared by the boot, the restore picker and the offer screens.
 * It must list every well-formed `database/dbbackup-<n>.bin`, newest first, and write or delete nothing: the damage prompt and a
 * read-only page list before the person has chosen anything.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'

const holder = vi.hoisted(() => ({ store: null as unknown }))

vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStore: async () => holder.store,
}))

import { listBackupTimes, NUMBERED_BACKUP_PREFIX } from '../backupList'

let store: MemoryByteStore

beforeEach(() => {
    store = createMemoryByteStore()
    holder.store = store
})

const plant = (name: string) => store.files.set(`${NUMBERED_BACKUP_PREFIX}${name}`, new Uint8Array([1]))

describe('listBackupTimes', () => {
    // New behaviour: the lister is one function; the order is the one the boot's damage prompt shows.
    test('lists the numbers of the well-formed backups, newest first', async () => {
        plant('100.bin')
        plant('3000.bin')
        plant('250.bin')

        expect(await listBackupTimes()).toEqual([3000, 250, 100])
    })

    test('ignores keys that are not a number and the .bin suffix', async () => {
        plant('100.bin')
        plant('abc.bin')
        plant('12.txt')
        plant('12.bin.tmp')
        plant('.bin')
        store.files.set('database/database.bin', new Uint8Array([1]))

        expect(await listBackupTimes()).toEqual([100])
    })

    // Guard: unlike the legacy boot's pruning lister, this one keeps every backup.
    test('does not prune: every backup is listed however many there are', async () => {
        for (let n = 1; n <= 30; n++) {
            plant(`${n}.bin`)
        }

        expect(await listBackupTimes()).toHaveLength(30)
    })

    test('writes and deletes nothing', async () => {
        plant('100.bin')
        plant('200.bin')

        await listBackupTimes()

        expect(store.writes).toEqual([])
        expect(store.deletes).toEqual([])
        expect(store.lists).toEqual([NUMBERED_BACKUP_PREFIX])
    })

    test('an empty store lists nothing', async () => {
        expect(await listBackupTimes()).toEqual([])
    })
})
