import { exportCharacterCard, preflightCardExport } from "./characterCards";
import { refuseExport } from "./drive/exportPreflight";
import { createExportTask } from "./exportTask";
import { VirtualWriter } from "./globalApi.svelte";
import { language } from "../lang";
import { getCurrentCharacter, type character } from "./storage/database.svelte";
import { asBuffer } from "./util";

export async function shareRealmCardData():Promise<{ name: ArrayBuffer; data: ArrayBuffer; } | null> {
    const char = safeStructuredClone(getCurrentCharacter({snapshot:true})) as character
    const trimedName = char.name.replace(/[^a-zA-Z0-9]/g, '') || 'character';
    // One card for the whole share; the nested export runs on it and never opens, ends or closes it.
    const task = createExportTask({title: language.realmShareTaskTitle, subtitle: char.name})
    try {
        // Before anything is built: a card with a large asset is not shared, and Realm's notice does not suggest CharX.
        const checked = await preflightCardExport(char, 'png', 'v3', {realm: true})
        if (checked.kind !== 'ok') {
            await refuseExport(checked, true)
            return null
        }
        const writer = new VirtualWriter()
        const namebuf = new TextEncoder().encode(trimedName + '.png')
        task.useToken(null)
        task.open()
        const exported = await exportCharacterCard(char, 'png', {writer: writer, spec: 'v3', checked, progress: task})
        if(!exported){
            //the export already ended the card as failed; the buffer is partial
            return null
        }
        // Success leaves no result card: the Realm frame takes over.
        task.close()
        return {
            name: asBuffer(namebuf.buffer),
            data: asBuffer(writer.buf.buffer.buffer)
        }
    } catch (error) {
        task.endOnError(error, undefined)
        return null
    } finally {
        task.close()
    }
}

