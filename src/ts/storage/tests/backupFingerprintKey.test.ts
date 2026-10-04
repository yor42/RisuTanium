/**
 * The persisted backup fingerprint's key can be created under every store's key
 * rules and lies outside every prefix the app enumerates, so no listing,
 * pruning, export or asset, remote-block or cold-storage enumeration sees it.
 * The key is written out here on purpose: a rename is a change of a persisted
 * name and must be deliberate.
 */
import { describe, expect, test } from 'vitest'
import {
    indexedDbCreatableViolation,
    nodeCreatableViolation,
    tauriCreatableViolation,
    NODE_MAX_WRITE_KEY_BYTES,
    utf8ByteLength,
} from '../store/keyRules'

const BACKUP_FINGERPRINT_KEY = 'database/backupfingerprint'

describe('the backup fingerprint key', () => {
    test('is creatable under the desktop, Node server and IndexedDB key rules', () => {
        expect(tauriCreatableViolation(BACKUP_FINGERPRINT_KEY)).toBeNull()
        expect(nodeCreatableViolation(BACKUP_FINGERPRINT_KEY)).toBeNull()
        expect(indexedDbCreatableViolation(BACKUP_FINGERPRINT_KEY)).toBeNull()
        expect(utf8ByteLength(BACKUP_FINGERPRINT_KEY)).toBeLessThanOrEqual(NODE_MAX_WRITE_KEY_BYTES)
    })

    test.each(['database/dbbackup-', 'assets/', 'remotes/', 'coldstorage/'])('does not start with the enumerated prefix %s', (prefix) => {
        expect(BACKUP_FINGERPRINT_KEY.startsWith(prefix)).toBe(false)
    })

    test('is not the main file and is not a numbered backup name', () => {
        expect(BACKUP_FINGERPRINT_KEY).not.toBe('database/database.bin')
        expect(/^database\/dbbackup-\d+\.bin$/.test(BACKUP_FINGERPRINT_KEY)).toBe(false)
    })
})
