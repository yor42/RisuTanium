import { alertError } from '../alert'
import { language } from 'src/lang'
import { pageStoreIsOpfsTransitional } from './store/appStore'

/**
 * A page that runs from OPFS this time (the copy back into IndexedDB could not
 * run) is read-only for its session. The writers that replace or delete
 * whole classes of data (the `.bin` restore, the internal-backup load and the
 * manual clean-up) call this first, before their first write and before any
 * asset or unit is read for them: it tells the person why and answers `true`,
 * and the caller returns.
 *
 * An answer that cannot be had (the store selection failed, a test double
 * without the selection) is not "read-only": those writers fail on their own
 * terms.
 */
export async function refuseOnReadOnlyPage(): Promise<boolean> {
    let readOnly = false
    try {
        readOnly = await pageStoreIsOpfsTransitional()
    } catch {
        readOnly = false
    }
    if (readOnly) {
        alertError(language.opfsReadOnlyNotice)
    }
    return readOnly
}
