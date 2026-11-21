/**
 * Key names of pre-store2 data that boot import and old-data deletion still
 * recognise. No save writes these keys; the OPFS copy-back only moves existing
 * ones into IndexedDB, and a profile that ran an older build may still hold them.
 *
 * - `blocks/`                         the prefix of the old block store, `blocks/head` its head pointer
 * - `database/database.bin`           the old main file
 * - `database/database.pre-blocks...` the copies the old block-store conversion renamed the main file to
 * - `database/dbbackup-...`           the numbered backups
 */

export const BLOCKS_PREFIX = 'blocks/'
export const HEAD_KEY = 'blocks/head'

export const LEGACY_MAIN_FILE_KEY = 'database/database.bin'
export const PRE_BLOCKS_PREFIX = 'database/database.pre-blocks'
export const NUMBERED_BACKUP_PREFIX = 'database/dbbackup-'
