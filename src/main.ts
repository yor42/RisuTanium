import "./ts/polyfill";
import "core-js/actual"
import "./ts/storage/database.svelte"
import App from "./App.svelte";
import { loadData } from "./ts/bootstrap";
import { initHotkey } from "./ts/hotkey";
import { preLoadCheck } from "./preload";
import { startKeepAliveService } from "./ts/android/keepAliveService";
import { startSaveOnHide } from "./ts/process/saveOnHide";
import { mount } from "svelte";
import { installBackGuard } from "./ts/backHandlers";
import { alertToast } from "./ts/alert";
import { language } from "./lang";
import { registerStore2Boot } from "./ts/storage/store2/bootActive";
import { dispatchStore2Boot } from "./ts/storage/store2/bootDispatch";
import { createProductionBootUi } from "./ts/storage/store2/ui/productionBootUi";

window.addEventListener('vite:preloadError', (event) => {
    console.error("Chunk load error detected:", event);
    alert("The server has been updated or the network connection has been lost. Please refresh the page.");
});

preLoadCheck()
let app = mount(App, {
    target: document.getElementById("app"),
});
installBackGuard({ showToast: () => alertToast(language.alerts.pressBackAgainToQuit) })
registerStore2Boot((env) => dispatchStore2Boot(env, { ui: createProductionBootUi() }))
loadData()
initHotkey()
startKeepAliveService()
startSaveOnHide()
document.getElementById('preloading').remove()

export default app;