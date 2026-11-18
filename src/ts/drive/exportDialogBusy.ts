/**
 * The one helper every export entry point wraps its save-dialog open in. A leaf module on purpose: the export shell
 * (`exportShell.ts`) re-exports it, while callers that only need this helper must not load the shell's module graph.
 */
import { isTauri } from "src/ts/platform"
import { isAndroidTransport } from "../storage/tauriByteTransport";
import { beginDialogWait, type BusyHandle } from "../process/memory/busyActions";

/**
 * Runs `open`, the step that opens the system save dialog, with `busy` marked as waiting on it when the page is the
 * Android app: that dialog can be lost without ever answering, and its entry must not then refuse the person's own
 * load, cleanup or install. The mark ends when `open` settles, however it settles, so every reader counts the entry
 * again before the first write. Elsewhere (the web writer's open is bounded and cancellable, the desktop dialog is modal)
 * nothing is marked. The result is returned and a rejection rethrown unchanged; nothing on screen is touched.
 */
export async function openOutsideBusy<T>(busy: BusyHandle | undefined, open: () => Promise<T>): Promise<T> {
    if (busy === undefined || !isTauri || !isAndroidTransport()) {
        return await open()
    }
    const unmark = beginDialogWait(busy)
    try {
        return await open()
    } finally {
        unmark()
    }
}
