import { alertError } from '../alert'
import { language } from 'src/lang'
import { getPageStorageMode } from './pageStorageMode'

/**
 * A page whose boot set the read-only mode is read-only for its session. The
 * writers that replace or delete whole classes of data (the `.bin` restore, the
 * internal-backup load and the manual clean-up) call this first, before their
 * first write and before any asset or unit is read for them: it tells the
 * person why and answers `true`, and the caller returns.
 *
 * The page mode is held by the page itself, so the answer needs no store
 * selection and cannot fail on one.
 */
export async function refuseOnReadOnlyPage(): Promise<boolean> {
    const modeReadOnly = getPageStorageMode().kind === 'read-only'
    if (modeReadOnly) {
        alertError(language.store2Boot.readOnlyRefusal)
    }
    return modeReadOnly
}
