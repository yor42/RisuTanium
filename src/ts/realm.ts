import { exportCharacterCard, preflightCardExport } from "./characterCards";
import { refuseExport } from "./drive/exportPreflight";
import { VirtualWriter } from "./globalApi.svelte";
import { getCurrentCharacter, type character } from "./storage/database.svelte";
import { alertStore } from "./alert";
import { asBuffer } from "./util";

let pong = false;

window.addEventListener("message", (event) => {
    if (event.origin === "https://realm.risuai.net") {
        if (event.data === "pong") {
            pong = true;
        }
    }
});

export async function shareRealmCardData():Promise<{ name: ArrayBuffer; data: ArrayBuffer; } | null> {
    const char = safeStructuredClone(getCurrentCharacter({snapshot:true})) as character
    const trimedName = char.name.replace(/[^a-zA-Z0-9]/g, '') || 'character';
    // Before anything is built: a card with a large asset is not shared, and Realm's notice does not suggest CharX.
    const checked = await preflightCardExport(char, 'png', 'v3', {realm: true})
    if (checked.kind !== 'ok') {
        await refuseExport(checked, true)
        return null
    }
    const writer = new VirtualWriter()
    const namebuf = new TextEncoder().encode(trimedName + '.png')
    const exported = await exportCharacterCard(char, 'png', {writer: writer, spec: 'v3', checked})
    if(!exported){
        //the export already showed its error; the buffer is partial
        return null
    }
    alertStore.set({
        type: 'none',
        msg: ''
    })
    return {
        name: asBuffer(namebuf.buffer),
        data: asBuffer(writer.buf.buffer.buffer)
    }
}

