import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as path from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { alertClear, alertConfirm, alertError, alertWait } from "src/ts/alert";
import { language } from "src/lang";
import { fillLang } from "src/lang/fill";
import { getDatabase } from "src/ts/storage/database.svelte";
import { sleep } from "src/ts/util";

let initPython = false

async function installPython():Promise<boolean>{
    try{
        const unsupportedReason = await invoke<string | null>("local_inference_unsupported_reason")
        if(unsupportedReason){
            alertClear()
            alertError(unsupportedReason)
            return false
        }
    }
    catch(error){
        alertClear()
        alertError(fillLang(language.errors.localInferenceCheckFailed, { error: `${error}` }))
        return false
    }
    if(initPython){
        return true
    }
    initPython = true
    const appDir = await path.appDataDir()
    const completedPath = await path.join(appDir, 'python', 'completed.txt')
    if(await exists(completedPath)){
        // completed.txt is written only after Python, pip and every dependency are installed.
        alertWait(language.alerts.pythonAlreadyInstalled)
    }
    else{
        if(!await alertConfirm(language.alerts.localPythonInstallConsent)){
            initPython = false
            alertClear()
            return false
        }
        alertWait(language.alerts.installingPython)
        const installed = await invoke<boolean>("install_python")
        if(!installed){
            initPython = false
            alertClear()
            alertError(language.errors.pythonInstallFailed)
            return false
        }
        alertWait(language.alerts.installingPip)
        try{
            const pipInstalled = await invoke<boolean>("install_pip")
            if(!pipInstalled){
                initPython = false
                alertClear()
                alertError(language.errors.pipInstallFailed)
                return false
            }
        }
        catch(error){
            initPython = false
            alertClear()
            alertError(fillLang(language.errors.pipInstallError, { error: `${error}` }))
            return false
        }
        alertWait(language.alerts.rewritingRequirements)
        try{
            const postInstalled = await invoke<boolean>('post_py_install')
            if(!postInstalled){
                initPython = false
                alertClear()
                alertError(language.errors.pythonFinalizeFailed)
                return false
            }
        }
        catch(error){
            initPython = false
            alertClear()
            alertError(fillLang(language.errors.pythonFinalizeError, { error: `${error}` }))
            return false
        }

        // The native side installs the fixed dependency list and announces each name.
        let currentDependency = ''
        let unlisten: (() => void) | undefined
        try{
            unlisten = await listen<string>('py_dependency_installing', (event) => {
                currentDependency = event.payload
                alertWait(fillLang(language.alerts.installingPythonDependency, { dependency: currentDependency }))
            })
            await invoke('install_py_dependencies')
        }
        catch(error){
            initPython = false
            alertClear()
            alertError(fillLang(language.errors.pythonDependencyFailed, { dependency: currentDependency, error: `${error}` }))
            return false
        }
        finally{
            unlisten?.()
        }
        alertClear()
    }

    try{
        await invoke('run_py_server')
    }
    catch(error){
        initPython = false
        alertClear()
        alertError(fillLang(language.errors.localServerStartFailed, { error: `${error}` }))
        return false
    }
    await sleep(4000)
    alertClear()
    return true

}

async function getLocalKey(retry = true) {
    try {
        const ft = await fetch("http://localhost:10026/")
        const keyJson = await ft.json()
        const keyPath = keyJson.dir
        const key = await readTextFile(keyPath)
        return key
    } catch (error) {
        if(!retry){
            throw fillLang(language.errors.localKeyFailed, { error: `${error}` })
        }
        //if is cors error
        if(
            error.message.includes("NetworkError when attempting to fetch resource.")
            || error.message.includes("Failed to fetch")
        ){
            const installed = await installPython()
            if(!installed){
                throw language.errors.localSidecarNotStarted
            }
            return await getLocalKey(false)
        }
        else{
            throw fillLang(language.errors.localKeyFailed, { error: `${error}` })
        }
    }
}

export async function tokenizeGGUFModel(prompt:string):Promise<number[]> {
    const key = await getLocalKey()
    const db = getDatabase()
    const modelPath = db.aiModel.replace('local_', '')
    const b = await fetch("http://localhost:10026/llamacpp/tokenize", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-risu-auth": key
        },
        body: JSON.stringify({
            prompt: prompt,
            n_ctx: db.maxContext,
            model_path: modelPath
        })
    })

    return await b.json()
}