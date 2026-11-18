import { BaseDirectory } from "@tauri-apps/plugin-fs"
import { save } from "@tauri-apps/plugin-dialog"
import { isTauri } from "./platform"
import { isAndroidTransport } from "./storage/tauriByteTransport"
import { TauriWriter, withFileIncompleteSentence } from "./exportWriters"
import { writeUserFile } from "./storage/tauriUserFile"

export interface DownloadFileOptions {
    /** Runs the Android save picker's open through the caller; the desktop and web routes never call it. */
    aroundPicker?: <T>(open: () => Promise<T>) => Promise<T>
}

/**
 * Android has no writable public Download folder for the app, so the file goes where the user picks. The picked
 * document exists as soon as the picker returns, so a failed write aborts the writer and reports the file as incomplete.
 * `aroundPicker` wraps only the picker call, never the write, so a caller can mark its own state while the picker is open.
 */
async function saveThroughPicker(name: string, data: Uint8Array, aroundPicker: DownloadFileOptions['aroundPicker']): Promise<boolean> {
    const dot = name.lastIndexOf('.')
    const ext = dot > 0 ? name.slice(dot + 1) : ''
    const openPicker = () => save({
        defaultPath: name,
        filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : []
    })
    const path = aroundPicker ? await aroundPicker(openPicker) : await openPicker()
    if (!path) {
        return false
    }
    const writer = new TauriWriter(path)
    try {
        await writer.write(data)
        await writer.close()
    } catch (error) {
        await writer.abort(error)
        throw withFileIncompleteSentence(error)
    }
    return true
}

/**
 * Hands a finished file to the user. Resolves `false` only when the Android save picker returned no location, in which
 * case nothing was written; every other success resolves `true`, and a failed write rejects.
 */
export async function downloadFile(name: string, dat: Uint8Array | ArrayBuffer | string, options?: DownloadFileOptions): Promise<boolean> {
    if (typeof (dat) === 'string') {
        dat = Buffer.from(dat, 'utf-8')
    }
    const data = new Uint8Array(dat)
    const downloadURL = (data: string, fileName: string) => {
        const a = document.createElement('a')
        a.href = data
        a.download = fileName
        document.body.appendChild(a)
        a.style.display = 'none'
        a.click()
        a.remove()
    }

    if (isTauri) {
        if (isAndroidTransport()) {
            return saveThroughPicker(name, data, options?.aroundPicker)
        }
        await writeUserFile(name, data, BaseDirectory.Download)
        return true
    }
    else {
        const blob = new Blob([data], { type: 'application/octet-stream' })
        const url = URL.createObjectURL(blob)

        downloadURL(url, name)

        setTimeout(() => {
            URL.revokeObjectURL(url)
        }, 10000)

        return true
    }
}
