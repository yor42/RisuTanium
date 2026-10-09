import { language } from 'src/lang'
import { alertError, alertNormal } from '../../alert'
import { DBState } from '../../stores.svelte'
import { selectSingleFile } from '../../util'
import { createHypaV3Preset } from './hypav3'

/**
 * Lets the user choose an exported HypaV3 preset file and adds it as a new
 * preset, selected. Choosing nothing does nothing: no error, no message, no
 * change. A file that is not a RisuAI preset export is ignored; a file that
 * cannot be read or parsed shows its error.
 */
export async function importHypaV3PresetFile(): Promise<void> {
    try {
        const picked = await selectSingleFile(['json'])
        const bytesImport = picked?.data

        if(!bytesImport) return

        const objImport = JSON.parse(Buffer.from(bytesImport).toString('utf-8'))

        if(objImport.type !== 'risu' || !objImport.data) return

        const newPreset = createHypaV3Preset(
            objImport.data.name || "Imported Preset",
            objImport.data.settings || {}
        );
        const presets = DBState.db.hypaV3Presets

        presets.push(newPreset)
        DBState.db.hypaV3Presets = presets
        DBState.db.hypaV3PresetId = DBState.db.hypaV3Presets.length - 1

        alertNormal(language.successImport)
    } catch (error) {
        alertError(`${error}`)
    }
}
