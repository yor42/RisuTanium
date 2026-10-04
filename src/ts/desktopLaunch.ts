import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { downloadRisuHub, importOpenedFiles } from "./characterCards"

interface LaunchInputs {
    files: string[]
    urls: string[]
}

//Drains run one at a time, in arrival order; a failed drain never stops the next one.
let chain: Promise<void> = Promise.resolve()

function openRealmLink(url: string) {
    const segments = url.replace(/\/+$/, '').split('/')
    if(segments[segments.length - 2] !== 'realm'){
        return
    }
    const id = segments[segments.length - 1].split(/[?#]/)[0]
    if(/^[\w-]+$/.test(id)){
        void downloadRisuHub(id)
    }
}

async function drain():Promise<void> {
    let inputs:LaunchInputs
    try {
        inputs = await invoke<LaunchInputs>('take_launch_inputs')
    } catch (error) {
        console.warn('Launch inputs are not available', error)
        return
    }
    if(inputs.files.length > 0){
        await importOpenedFiles(inputs.files)
    }
    for(const url of inputs.urls){
        openRealmLink(url)
    }
}

function scheduleDrain():Promise<void> {
    chain = chain.then(drain).catch((error) => {
        console.warn('Launch inputs were not handled', error)
    })
    return chain
}

//Files and deep links reach the page only through the app's own queue and its notification. The listener is registered before the first drain, so an input queued between the two is taken by one of them.
export async function desktopLaunchImport():Promise<void> {
    try {
        await listen('risu-launch-inputs', () => {
            void scheduleDrain()
        })
        await scheduleDrain()
    } catch (error) {
        console.warn('Launch inputs are not handled', error)
    }
}
