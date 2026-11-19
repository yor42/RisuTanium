import { language } from "src/lang"
import { importCharacterFile } from "./characterCards"
import { checkCharOrder } from "./globalApi.svelte"
import { readModule } from "./process/modules"
import { confirmRisumLowLevel } from "./process/moduleImportStop"
import { markBootWrite } from "./bootWindow"
import { DBState } from "./stores.svelte"
import { importPreset } from "./storage/database.svelte"
import { importSourceOfFile } from "./importSource"
import { refuseImportWhileRestoring } from "./drive/backupWorkGuard"
import { outcomeOfError, runImportBatch, type ImportOutcome } from "./importBatch"
import { IMPORT_STEPS, type ImportProgress } from "./importProgress"

/**
 * Imports the one file dropped on the app, by its name: a preset, a module, or otherwise a character card, on one task
 * card. A failure shows its reason on the card and never rejects, so a drop has no unhandled rejection.
 */
export async function importDroppedFile(file:File):Promise<void>{
    //A restore replaces the whole database under an import, so a drop during one is refused and nothing is read.
    if(refuseImportWhileRestoring()){
        return
    }
    await runImportBatch([{name: file.name, run: (progress) => importDropped(file, progress)}], {
        task: {title: language.importTaskFilesTitle, steps: IMPORT_STEPS},
        afterImported: (outcome) => {
            if(outcome.kind === 'imported' && outcome.index !== null){
                try {
                    checkCharOrder()
                } catch (error) {
                    console.error(error)
                }
            }
        },
    })
}

async function importDropped(file:File, progress:ImportProgress):Promise<ImportOutcome>{
    const name = file.name.toLowerCase()

    try {
        if (name.endsWith('.risup')) {
            progress.step('read')
            const data = new Uint8Array(await file.arrayBuffer())
            progress.throwIfCancelled()
            progress.step('add')
            progress.beforeWrite()
            await importPreset({ name: file.name, data })
            progress.committed()
            progress.notice(language.successImport)
            return {kind: 'imported', index: null}
        } else if (name.endsWith('.risum')) {
            const source = importSourceOfFile(file)
            try {
                //The low-level-access question comes before any asset is saved; a decline saves nothing and shows nothing.
                const module = await readModule(source, {progress, beforeAssets: (m) => confirmRisumLowLevel(m)})
                progress.step('add')
                progress.beforeWrite()
                markBootWrite()
                DBState.db.modules.push(module)
                progress.committed()
            } finally {
                await source.close()
            }
            progress.notice(language.successImport)
            return {kind: 'imported', index: null}
        } else {
            return await importCharacterFile({
                name: file.name,
                data: file,
                archive: true
            }, undefined, progress)
        }
    } catch (error) {
        console.error(error)
        return outcomeOfError(error)
    }
}
