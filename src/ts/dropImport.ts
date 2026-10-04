import { language } from "src/lang"
import { alertError, alertNormal } from "./alert"
import { importCharacterProcess } from "./characterCards"
import { checkCharOrder } from "./globalApi.svelte"
import { readModule } from "./process/modules"
import { importErrorMessage } from "./process/moduleRefusal"
import { DBState } from "./stores.svelte"
import { importPreset } from "./storage/database.svelte"

/**
 * Imports the one file dropped on the app, by its name: a preset, a module, or otherwise a character card.
 * A failure shows its reason and never rejects, so a drop has no unhandled rejection.
 */
export async function importDroppedFile(file:File){
    const name = file.name.toLowerCase()

    try {
        if (name.endsWith('.risup')) {
            const data = new Uint8Array(await file.arrayBuffer())
            await importPreset({ name: file.name, data })
            alertNormal(language.successImport)
        } else if (name.endsWith('.risum')) {
            const data = new Uint8Array(await file.arrayBuffer())
            const module = await readModule(Buffer.from(data))
            DBState.db.modules.push(module)
            alertNormal(language.successImport)
        } else {
            await importCharacterProcess({
                name: file.name,
                data: file
            })
            checkCharOrder()
        }
    } catch (error) {
        console.error(error)
        alertError(importErrorMessage(error))
    }
}
