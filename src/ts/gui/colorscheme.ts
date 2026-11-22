import { downloadFile } from "../globalApi.svelte";
import { BufferToText, selectSingleFile } from "../util";
import { alertError } from "../alert";
import { language } from "../../lang";
import { DBState } from "../stores.svelte";
import { updateCustomColorScheme, updateTextThemeAndCSS, type ColorScheme } from "./colorschemeCore";

// The light colour code lives in colorschemeCore.ts so the boot escape path does not reach the file and download code.
export * from "./colorschemeCore";

export function exportColorScheme(){
    let json = JSON.stringify(DBState.db.customColorScheme)
    downloadFile('colorScheme.json', json)
}

export async function importColorScheme(){
    const uarray = await selectSingleFile(['json'])
    if(uarray == null){
        return
    }
    const string = BufferToText(uarray.data)
    let colorScheme: ColorScheme
    try{
        colorScheme = JSON.parse(string)
        if(
            typeof colorScheme.bgcolor !== 'string' ||
            typeof colorScheme.darkbg !== 'string' ||
            typeof colorScheme.borderc !== 'string' ||
            typeof colorScheme.selected !== 'string' ||
            typeof colorScheme.draculared !== 'string' ||
            typeof colorScheme.textcolor !== 'string' ||
            typeof colorScheme.textcolor2 !== 'string' ||
            typeof colorScheme.darkBorderc !== 'string' ||
            typeof colorScheme.darkbutton !== 'string' ||
            typeof colorScheme.type !== 'string'
        ){
            alertError(language.errors.invalidColorScheme)
            return
        }
        DBState.db.customColorScheme = colorScheme
        updateCustomColorScheme()
        // The text theme's font colours depend on the scheme type, so they follow the import.
        updateTextThemeAndCSS()
    }
    catch(e){
        alertError(language.errors.invalidColorScheme)
        return
    
    }
}
