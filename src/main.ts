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
import { alertToast } from "./ts/alert";
import { language } from "./lang";
import { registerStore2Boot } from "./ts/storage/store2/bootActive";
import { dispatchStore2Boot } from "./ts/storage/store2/bootDispatch";
import { markerOwnerProbeFor } from "./ts/storage/store2/abandonedMarker";
import { holdsOwnTabPresence } from "./ts/globalApi.svelte";
import { createProductionBootUi } from "./ts/storage/store2/ui/productionBootUi";

window.addEventListener('vite:preloadError', (event) => {
    console.error("Chunk load error detected:", event);
    alert("The server has been updated or the network connection has been lost. Please refresh the page.");
});

preLoadCheck()
let app = mount(App, {
    target: document.getElementById("app"),
});
installBackGuard({
    showToast: () => alertToast(language.alerts.pressBackAgainToQuit),
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