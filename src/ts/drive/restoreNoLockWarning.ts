import { alertConfirm } from '../alert'
import { language } from 'src/lang'

/**
 * Asks whether to restore on a page that cannot check for other open tabs. Every restore path that raises this
 * warning goes through here, so each one carries the save-guard flag and none can drop it alone.
 */
export function confirmRestoreWithoutTabCheck(): Promise<boolean> {
    return alertConfirm(language.restoreNoLockWarningConfirm, { ownScheme: 'saveGuard' })
}
