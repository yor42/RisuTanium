import "./ts/polyfill";
import "core-js/actual"
import "./ts/storage/database.svelte"
import App from "./App.svelte";
import { loadData } from "./ts/bootstrap";
import { initHotkey } from "./ts/hotkey";
import { preLoadCheck } from "./preload";
import { startKeepAliveService } from "./ts/android/keepAliveService";
import { flushPageBeforeLeaving, startSaveOnHide } from "./ts/process/saveOnHide";
import { mount } from "svelte";
import { installBackGuard } from "./ts/backHandlers";
import QuitPill from "./lib/Nexus/pattern/QuitPill.svelte";
import { hideQuitPill, showQuitPill } from "./ts/quitPill.svelte";
import { registerStore2Boot } from "./ts/storage/store2/bootActive";
import { dispatchStore2Boot } from "./ts/storage/store2/bootDispatch";
import { markerOwnerProbeFor } from "./ts/storage/store2/abandonedMarker";
import { holdsOwnTabPresence } from "./ts/globalApi.svelte";
import { createProductionBootUi } from "./ts/storage/store2/ui/productionBootUi";
import { installMotionPrefs } from "./ts/chatShell/motionPrefs.svelte";

window.addEventListener('vite:preloadError', (event) => {
    console.error("Chunk load error detected:", event);
    alert("The server has been updated or the network connection has been lost. Please refresh the page.");
});
// The device's low-power and reduced-motion marks are on the root before anything paints.
installMotionPrefs()

preLoadCheck()
let app = mount(App, {
    target: document.getElementById("app"),
});
// A second root, so the quit pill's live region is mounted for the page's whole life without touching the app root.
mount(QuitPill, { target: document.body });
installBackGuard({
    showToast: showQuitPill,
    hideToast: hideQuitPill,
    flush: flushPageBeforeLeaving,
})
// The import flow is loaded on first use: a boot that never imports does not load the backup code.
registerStore2Boot((env) => dispatchStore2Boot(env, {
    ui: createProductionBootUi(),
    markerOwnerProbe: (kind) => {
        // Plain HTTP has no navigator.locks at all, so the query is read defensively.
        const locks = navigator.locks
        const query = typeof locks?.query === 'function' ? () => locks.query() : undefined
        return markerOwnerProbeFor(kind, { query, holdsOwnPresence: holdsOwnTabPresence })
    },
    importBackup: async (target) => (await import("./ts/drive/backuplocal")).loadBackupAtBoot(target),
}))
loadData()
initHotkey()
startKeepAliveService()
startSaveOnHide()
document.getElementById('preloading').remove()

export default app;