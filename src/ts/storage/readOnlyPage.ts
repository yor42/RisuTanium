import { alertError } from '../alert'
import { language } from 'src/lang'
import { getPageStorageMode } from './pageStorageMode'
import { pageStoreIsOpfsTransitional } from './store/appStore'

/**
 * A page that runs from OPFS this time (the copy back into IndexedDB could not
 * run), and a page whose boot set the read-only mode on any other store, are
 * read-only for their session. The writers that replace or delete
 * whole classes of data (the `.bin` restore, the internal-backup load and the
 * manual clean-up) call this first, before their first write and before any
 * asset or unit is read for them: it tells the person why and answers `true`,
 * and the caller returns.
 *
 * An answer that cannot be had (the store selection failed, a test double
 * without the selection) is not "read-only": those writers fail on their own
 * terms. The page mode is held by the page itself, so it decides first.
 *
 * The words depend on the cause. The OPFS page is read-only for a reason that
 * a restart can fix, and it also sets the read-only mode, so the store is
 * asked first and the OPFS notice wins; any other read-only page (opened
 * read-only by the store2 boot) gets the neutral refusal.
 */
export async function refuseOnReadOnlyPage(): Promise<boolean> {
    const modeReadOnly = getPageStorageMode().kind === 'read-only'
    let opfs: boolean
    try {
        opfs = await pageStoreIsOpfsTransitional()
    } catch {
        opfs = false
    }
    if (opfs) {
        alertError(language.opfsReadOnlyNotice)
        return true
    }
    if (modeReadOnly) {
        alertError(language.store2Boot.readOnlyRefusal)
    }
    return modeReadOnly
}
