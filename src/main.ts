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
import { createProductionBootUi } from "./ts/storage/store2/ui/productionBootUi";
import { installMotionPrefs } from "./ts/chatShell/motionPrefs.svelte";
import { installCardAnimationVisibilityHold } from "./ts/gui/cardAnimationHold";
import { installTauriLinkRouter } from "./ts/tauriLinkRouter";

window.addEventListener('vite:preloadError', (event) => {
    console.error("Chunk load error detected:", event);
    alert("The server has been updated or the network connection has been lost. Please refresh the page.");
});
// The device's low-power and reduced-motion marks are on the root before anything paints.
installMotionPrefs()
// Card animations are held while the page is hidden.
installCardAnimationVisibilityHold()
// On Tauri, external links open through the app's scoped opener; the shell plugin's own click listener is neutralised.
installTauriLinkRouter()

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
    markerOwnerProbe: (kind) => markerOwnerProbeFor(kind),
    importBackup: async (target) => (await import("./ts/drive/backuplocal")).loadBackupAtBoot(target),
}))
loadData()
initHotkey()
startKeepAliveService()
startSaveOnHide()
document.getElementById('preloading').remove()

export default app;