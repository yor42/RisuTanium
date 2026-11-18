import { isTauri } from "./ts/platform";
import { isAppInitiatedReload, consumeExternalHandoffAllowance } from "./ts/reloadGuard";

export function preLoadCheck(){
    if(!isTauri && !import.meta.env.DEV) {
        // Every non-Tauri build (risuai.xyz, a static self-host, the node
        // server) prompts before an accidental close or reload, since a lost
        // tab there loses unsaved state the same way regardless of hostname.
        // The Vite dev server is excluded: its own full reload calls
        // `location.reload()` directly, so this guard would otherwise prompt
        // on every dev reload. Tauri is excluded because the guard protects a
        // browser tab, which a desktop window is not.
        window.addEventListener('beforeunload', (e) => {
            // App-initiated reloads (e.g. after a save conflict) must never be
            // cancellable -- code right after `location.reload()` assumes the
            // reload happens and parks itself forever waiting for it. A
            // pending mailto:/tel: handoff (see openUrlWeb.ts) must also pass
            // uncancelled, but only once: `consumeExternalHandoffAllowance`
            // clears it, so a later leave/close attempt still prompts.
            if(isAppInitiatedReload() || consumeExternalHandoffAllowance()) {
                return
            }
            e.preventDefault()
            //legacy browser
            e.returnValue = true
        })
    }
    
    return true;
}