import { language } from 'src/lang'
import { alertError, alertNormal } from '../../alert'
import { DBState } from '../../stores.svelte'
import { selectSingleFile } from '../../util'
import { parseHypaV3PresetFile } from './hypaV3Presets'

/**
 * Lets the user choose an exported HypaV3 preset file and adds it as a new
 * preset, selected. Choosing nothing does nothing: no error, no message, no
 * change. A file that does not parse, or that is not a RisuAI preset export
 * with usable HypaV3 settings, is refused with a message and adds nothing; the
 * imported ratios are clamped and the file's id is never used.
 */
export async function importHypaV3PresetFile(): Promise<void> {
    try {
        const picked = await selectSingleFile(['json'])
        const bytesImport = picked?.data

        if(!bytesImport) return

        const parsed = parseHypaV3PresetFile(bytesImport)

        if(parsed.ok === false){
            alertError(parsed.reason === 'broken'
                ? language.hypaV3Settings.presetImportBrokenError
                : language.hypaV3Settings.presetImportForeignError)
            return
        }

        const presets = DBState.db.hypaV3Presets

        presets.push(parsed.preset)
        DBState.db.hypaV3Presets = presets
        DBState.db.hypaV3PresetId = DBState.db.hypaV3Presets.length - 1

        alertNormal(language.successImport)
    } catch (error) {
        alertError(`${error}`)
    }
}
