import { getDatabase } from "./database.svelte";
import { downloadFile } from "../globalApi.svelte";
import { alertNormal } from "../alert";
import { language } from "src/lang";
import { readColdCharacterCopy } from "../process/coldCharacterRestore";
import { withBusy } from "../process/memory/busyActions";

/**
 * Downloads one dataset row per chat of every character. An archived
 * character (a placeholder in `db.characters`) is read from a copy of its
 * cold-storage unit, one at a time; the copy is dropped after its rows are
 * taken, the placeholder stays in its slot and nothing is marked for save. A
 * unit that cannot be read is left out, and the notice at the end names it. A
 * unit that reads fine but holds a group yields no rows, like any group, and is
 * not named.
 */
export function exportAsDataset(){
    return withBusy('export', writeDataset)
}

async function writeDataset(){
    const db = getDatabase()

    let dataset = []
    const skipped: string[] = []
    // A snapshot: the list can change while a unit is being read.
    for(const slot of Array.from(db.characters)){
        if(slot.type === 'group'){
            continue
        }
        let char = slot
        if(slot.coldstorage){
            const copy = await readColdCharacterCopy(slot)
            if(copy.status !== 'ok'){
                skipped.push(slot.name || language.errors.coldStorageUnknownCharacterName)
                continue
            }
            if(copy.character.type === 'group'){
                continue
            }
            char = copy.character
        }
        for(const chat of char.chats){
            
            dataset.push({
                name: char.name,
                description: char.desc,
                chats: chat.message,
                lorebook: char.globalLore
            })
        }
    }

    await downloadFile('dataset.json',Buffer.from(JSON.stringify(dataset, null,4), 'utf-8'))

    alertNormal(skipped.length > 0
        ? `${language.successExport}\n\n${language.errors.coldStorageDatasetExportSkipped(skipped.join(', '))}`
        : language.successExport)

}