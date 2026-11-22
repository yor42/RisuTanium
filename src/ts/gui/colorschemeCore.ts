import { get } from "svelte/store";
import { getDatabase, setDatabase, type Database } from "../storage/database.svelte";
import { isLite } from "../lite";
import { CustomCSSStore, DBState, SafeModeStore } from "../stores.svelte";
import { syncSystemBars } from "./systemBars";
import { nexusColorScheme } from "./nexusColorScheme";
import { deriveSchemeRoles } from "./schemeRoles";
import { ColorSchemeTypeStore } from "./surfaceTone";
import { packSafe } from "../themePack/packSafeFlag.svelte";

export interface ColorScheme{
    bgcolor: string;
    darkbg: string;
    borderc: string;
    selected: string;
    draculared: string;
    textcolor: string;
    textcolor2: string;
    darkBorderc: string;
    darkbutton: string;
    type:'light'|'dark';
}


export const defaultColorScheme: ColorScheme = {
    bgcolor: "#151836",
    darkbg: "#0f112a",
    borderc: "#6f7fc8",
    selected: "#2f3670",
    draculared: "#ff6b81",
    textcolor: "#eef0ff",
    textcolor2: "#a6b0d4",
    darkBorderc: "#3c4478",
    darkbutton: "#242a52",
    type:'dark'
}

const colorShemes = {
    "default": defaultColorScheme,
    "dark": {
        bgcolor: "#1a1a1a",
        darkbg: "#141414",
        borderc: "#525252",
        selected: "#3d3d3d",
        draculared: "#ff5555",
        textcolor: "#f5f5f5",
        textcolor2: "#a3a3a3",
        darkBorderc: "#404040",
        darkbutton: "#2e2e2e",
        type:'dark'
    },
    "light": {
        bgcolor: "#ffffff",
        darkbg: "#f0f0f0",
        borderc: "#0f172a",
        selected: "#e0e0e0",
        draculared: "#ff5555",
        textcolor: "#0f172a",
        textcolor2: "#525f73",
        darkBorderc: "#d1d5db",
        darkbutton: "#e5e7eb",
        type:'light'
    },
    "cherry": {
        bgcolor: "#450a0a",
        darkbg: "#7f1d1d",
        borderc: "#ea580c",
        selected: "#d97706",
        draculared: "#ff5555",
        textcolor: "#f8f8f2",
        textcolor2: "#fca5a5",
        darkBorderc: "#92400e",
        darkbutton: "#b45309",
        type:'dark'
    },
    "galaxy": {
        bgcolor: "#0f172a",
        darkbg: "#1f2a48",
        borderc: "#8be9fd",
        selected: "#457b9d",
        draculared: "#ff5555",
        textcolor: "#f8f8f2",
        textcolor2: "#8be9fd",
        darkBorderc: "#457b9d",
        darkbutton: "#1f2a48",
        type:'dark'
    },
    "nature": {
        bgcolor: "#1b4332",
        darkbg: "#2d6a4f",
        borderc: "#a8dadc",
        selected: "#4d908e",
        draculared: "#ff5555",
        textcolor: "#f8f8f2",
        textcolor2: "#4d908e",
        darkBorderc: "#457b9d",
        darkbutton: "#2d6a4f",
        type:'dark'
    },
    "ocean": {
        bgcolor: "#0b1f2a",
        darkbg: "#08202b",
        borderc: "#38bdf8",
        selected: "#164e63",
        draculared: "#fb7185",
        textcolor: "#e6f6fb",
        textcolor2: "#8fc7d5",
        darkBorderc: "#155e75",
        darkbutton: "#0f3a4a",
        type:'dark'
    },
    "aurora": {
        bgcolor: "#10201c",
        darkbg: "#152a24",
        borderc: "#5eead4",
        selected: "#315c52",
        draculared: "#fb7185",
        textcolor: "#ecfdf5",
        textcolor2: "#a7f3d0",
        darkBorderc: "#2f6f63",
        darkbutton: "#21443c",
        type:'dark'
    },
    "twilight": {
        bgcolor: "#171324",
        darkbg: "#201936",
        borderc: "#c084fc",
        selected: "#3b2a5a",
        draculared: "#f43f5e",
        textcolor: "#f8f5ff",
        textcolor2: "#c4b5fd",
        darkBorderc: "#4c3575",
        darkbutton: "#2e2348",
        type:'dark'
    },
    "realblack": {
        bgcolor: "#000000",
        darkbg: "#000000",
        borderc: "#6272a4",
        selected: "#44475a",
        draculared: "#ff5555",
        textcolor: "#f8f8f2",
        textcolor2: "#94a3b8",
        darkBorderc: "#4b5563",
        darkbutton: "#374151",
        type:'dark'
    },
    "monokai-light": {
        bgcolor: "#f8f8f2",
        darkbg: "#e8e8e3",
        borderc: "#75715e",
        selected: "#d8d8d0",
        draculared: "#f92672",
        textcolor: "#272822",
        textcolor2: "#75715e",
        darkBorderc: "#c0c0b8",
        darkbutton: "#d0d0c8",
        type:'light'
    },
    "monokai-black": {
        bgcolor: "#272822",
        darkbg: "#1e1f1a",
        borderc: "#75715e",
        selected: "#3e3d32",
        draculared: "#f92672",
        textcolor: "#f8f8f2",
        textcolor2: "#a6a68a",
        darkBorderc: "#3e3d32",
        darkbutton: "#3e3d32",
        type:'dark'
    },
    "sky-light": {
        bgcolor: "#f6fbff",
        darkbg: "#e8f3fb",
        borderc: "#0284c7",
        selected: "#d7ecf8",
        draculared: "#e11d48",
        textcolor: "#0f172a",
        textcolor2: "#516174",
        darkBorderc: "#b7d7ea",
        darkbutton: "#dbeafe",
        type:'light'
    },
    "sage-light": {
        bgcolor: "#f7faf5",
        darkbg: "#e8f0e6",
        borderc: "#3f6212",
        selected: "#d9e8d3",
        draculared: "#dc2626",
        textcolor: "#1f2933",
        textcolor2: "#586a52",
        darkBorderc: "#b7c9ad",
        darkbutton: "#dce8d6",
        type:'light'
    },
    "lavender-light": {
        bgcolor: "#f8f7ff",
        darkbg: "#ede9fe",
        borderc: "#6d28d9",
        selected: "#ddd6fe",
        draculared: "#e11d48",
        textcolor: "#1e1b4b",
        textcolor2: "#5b5680",
        darkBorderc: "#c4b5fd",
        darkbutton: "#e0e7ff",
        type:'light'
    },
    "slate-light": {
        bgcolor: "#f8fafc",
        darkbg: "#e2e8f0",
        borderc: "#334155",
        selected: "#cbd5e1",
        draculared: "#dc2626",
        textcolor: "#020617",
        textcolor2: "#475569",
        darkBorderc: "#94a3b8",
        darkbutton: "#cbd5e1",
        type:'light'
    },
    "lite": {
        bgcolor: "#1f2937",
        darkbg: "#1C2533",
        borderc: "#475569",
        selected: "#475569",
        draculared: "#ff5555",
        textcolor: "#f8f8f2",
        textcolor2: "#94a3b8",
        darkBorderc: "#030712",
        darkbutton: "#374151",
        type:'dark'
    },
    "nexus": nexusColorScheme

} as const

// Defined in surfaceTone.ts so components that only need the tone do not import this module.
export { ColorSchemeTypeStore }

export const colorSchemePresets = colorShemes

export const colorSchemeList = Object.keys(colorShemes) as (keyof typeof colorShemes)[]

export function changeColorScheme(colorScheme: string){
    try {
        if(colorScheme === 'custom'){
            DBState.db.colorScheme = safeStructuredClone(DBState.db.customColorScheme ?? defaultColorScheme)
        }
        else{
            DBState.db.colorScheme = safeStructuredClone(colorShemes[colorScheme])
        }
        DBState.db.colorSchemeName = colorScheme
        updateColorScheme()
        // The text theme's font colours depend on the scheme type, so they follow a scheme change.
        updateTextThemeAndCSS()
    } catch (error) {}
}

export function updateCustomColorScheme(){
    try {
        DBState.db.colorScheme = safeStructuredClone(DBState.db.customColorScheme ?? defaultColorScheme)
        DBState.db.colorSchemeName = 'custom'
        updateColorScheme()
    } catch (error) {}
}

/**
 * The fork-only scheme name of an active theme pack's own colours. It is never a preset key and never `custom`, so
 * every pick, edit and import writer replaces it, and upstream paints the stored copy under it.
 */
export const PACK_SCHEME_NAME = 'theme-pack'

/** The scheme in effect before the theme-pack scheme was entered, kept so turning the pack off can restore it. */
export interface ThemePackSchemeSnapshot {
    name: string
    scheme: ColorScheme
}

const SCHEME_COLOUR_FIELDS = ['bgcolor', 'darkbg', 'borderc', 'selected', 'draculared', 'textcolor', 'textcolor2', 'darkBorderc', 'darkbutton'] as const

function isColorSchemeValue(value: unknown): value is ColorScheme{
    if(typeof value !== 'object' || value === null){
        return false
    }
    const record = value as Record<string, unknown>
    return SCHEME_COLOUR_FIELDS.every((field) => typeof record[field] === 'string') && (record.type === 'light' || record.type === 'dark')
}

/** The database fields the scheme readers use. The Custom slot and the snapshot are optional: a missing one reads as absent. */
export type SchemeSource = Pick<Database, 'colorSchemeName' | 'colorScheme'> & Partial<Pick<Database, 'customColorScheme' | 'themePackSchemeSnapshot'>>

/** Narrows a persisted snapshot: a non-empty name other than the pack scheme and a full scheme, else null. */
export function readSchemeSnapshot(value: unknown): ThemePackSchemeSnapshot | null{
    if(typeof value !== 'object' || value === null){
        return null
    }
    const record = value as Record<string, unknown>
    if(typeof record.name !== 'string' || record.name === '' || record.name === PACK_SCHEME_NAME || !isColorSchemeValue(record.scheme)){
        return null
    }
    return { name: record.name, scheme: record.scheme }
}

/**
 * The scheme that turning the pack off restores, from the snapshot: a preset name gives the current preset table entry,
 * `custom` gives the Custom slot, any other name gives its saved copy, and a missing or invalid snapshot gives `default`.
 * Pure: it never writes. The pack-off restore and the `.bin` export copy share it, so a `.bin` shows exactly the
 * scheme that turning the pack off restores.
 */
export function schemeWithoutPack(db: SchemeSource): { colorSchemeName: string, colorScheme: ColorScheme }{
    const snapshot = readSchemeSnapshot(db.themePackSchemeSnapshot)
    if(snapshot === null){
        return { colorSchemeName: 'default', colorScheme: safeStructuredClone(defaultColorScheme) }
    }
    if(Object.hasOwn(colorShemes, snapshot.name)){
        return { colorSchemeName: snapshot.name, colorScheme: safeStructuredClone(colorShemes[snapshot.name as keyof typeof colorShemes]) }
    }
    if(snapshot.name === 'custom'){
        return { colorSchemeName: 'custom', colorScheme: safeStructuredClone(db.customColorScheme ?? defaultColorScheme) }
    }
    return { colorSchemeName: snapshot.name, colorScheme: safeStructuredClone(snapshot.scheme) }
}

let packSchemeProvider: (() => ColorScheme | null) | null = null

/** The theme-pack driver registers the applied pack's live default here, so this module imports nothing from the pack code. */
export function setPackSchemeProvider(provider: (() => ColorScheme | null) | null): void{
    packSchemeProvider = provider
}

/**
 * The scheme that is painted. A built-in `colorSchemeName` reads the current preset table, so a
 * saved copy made by an older build never pins old colours; the saved copy stays as stored and is
 * never written here. Under `theme-pack` the applied pack's default paints live, and the stored
 * copy is the fallback before the pack is read, in Safe Mode, with a missing or broken pack, on a
 * downgrade and upstream. Custom, unknown and prototype names fall back to the saved copy, and lite
 * mode always reports the lite scheme. In pack safe mode the pack scheme name paints the scheme turning the pack off would
 * restore, before any live provider. The result may be a shared table object: callers must not
 * mutate it and must clone it before handing it out.
 */
export function effectiveColorScheme(db: SchemeSource): ColorScheme{
    if(get(isLite)){
        return colorShemes.lite
    }
    if(typeof db.colorSchemeName === 'string' && Object.hasOwn(colorShemes, db.colorSchemeName)){
        return colorShemes[db.colorSchemeName as keyof typeof colorShemes]
    }
    if(db.colorSchemeName === PACK_SCHEME_NAME && packSafe.on){
        return schemeWithoutPack(db).colorScheme
    }
    if(db.colorSchemeName === PACK_SCHEME_NAME){
        const live = packSchemeProvider?.()
        if(live){
            return live
        }
    }
    return db.colorScheme ?? defaultColorScheme
}

/**
 * Enters the theme-pack scheme: every value is computed first, then the snapshot (only when entering from another
 * scheme), the stored copy and, last, the name are written. A throw while computing writes nothing, and a throw between
 * the writes leaves the user's own name in place, so the one stale field is never consulted. `customColorScheme` is
 * never touched.
 */
export function enterPackScheme(scheme: ColorScheme): void{
    const copy = safeStructuredClone(scheme)
    const snapshot: ThemePackSchemeSnapshot | null = DBState.db.colorSchemeName !== PACK_SCHEME_NAME
        ? { name: DBState.db.colorSchemeName, scheme: safeStructuredClone(DBState.db.colorScheme ?? defaultColorScheme) }
        : null
    if(snapshot !== null){
        DBState.db.themePackSchemeSnapshot = snapshot
    }
    DBState.db.colorScheme = copy
    DBState.db.colorSchemeName = PACK_SCHEME_NAME
    updateColorScheme()
    updateTextThemeAndCSS()
}

/**
 * Leaves the theme-pack scheme. While the name is still `theme-pack` the snapshot scheme is restored; if the user picked
 * another scheme meanwhile, no scheme field is written and that pick wins. The snapshot key is always deleted.
 */
export function leavePackScheme(): void{
    if(DBState.db.colorSchemeName === PACK_SCHEME_NAME){
        const own = schemeWithoutPack(DBState.db)
        DBState.db.colorScheme = own.colorScheme
        DBState.db.colorSchemeName = own.colorSchemeName
        delete DBState.db.themePackSchemeSnapshot
        updateColorScheme()
        updateTextThemeAndCSS()
        return
    }
    delete DBState.db.themePackSchemeSnapshot
}

export function updateColorScheme(){
    try {
        let db = getDatabase()

        const colorScheme = effectiveColorScheme(db)

        //set css variables
        document.documentElement.style.setProperty("--risu-theme-bgcolor", colorScheme.bgcolor);
        document.documentElement.style.setProperty("--risu-theme-darkbg", colorScheme.darkbg);
        document.documentElement.style.setProperty("--risu-theme-borderc", colorScheme.borderc);
        document.documentElement.style.setProperty("--risu-theme-selected", colorScheme.selected);
        document.documentElement.style.setProperty("--risu-theme-draculared", colorScheme.draculared);
        document.documentElement.style.setProperty("--risu-theme-textcolor", colorScheme.textcolor);
        document.documentElement.style.setProperty("--risu-theme-textcolor2", colorScheme.textcolor2);
        document.documentElement.style.setProperty("--risu-theme-darkborderc", colorScheme.darkBorderc);
        document.documentElement.style.setProperty("--risu-theme-darkbutton", colorScheme.darkbutton);
        // Derived roles the new-screen tokens read; they are never stored.
        const roles = deriveSchemeRoles(colorScheme)
        document.documentElement.style.setProperty("--risu-theme-role-text-secondary", roles['text-secondary']);
        document.documentElement.style.setProperty("--risu-theme-role-text-muted", roles['text-muted']);
        document.documentElement.style.setProperty("--risu-theme-role-accent", roles['accent']);
        document.documentElement.style.setProperty("--risu-theme-role-accent-rgb", roles['accent-rgb']);
        document.documentElement.style.setProperty("--risu-theme-role-field-border", roles['field-border']);
        document.documentElement.style.setProperty("--risu-theme-role-danger", roles['danger']);
        document.documentElement.style.setProperty("--risu-theme-role-danger-rgb", roles['danger-rgb']);
        document.documentElement.style.setProperty("--risu-theme-role-warning-rgb", roles['warning-rgb']);
        document.documentElement.style.setProperty("--risu-theme-role-overlay-rgb", roles['overlay-rgb']);
        document.documentElement.style.setProperty("--risu-theme-role-switch-off-alpha", roles['switch-off-alpha']);
        document.documentElement.style.setProperty("--risu-theme-role-surface-toast", roles['surface-toast']);
        document.documentElement.style.setProperty("--risu-theme-role-color-scheme", roles['color-scheme']);
        document.documentElement.style.setProperty("--risu-theme-role-focus-ring", roles['focus-ring']);
        document.documentElement.style.setProperty("--risu-theme-role-on-selected", roles['on-selected']);
        document.documentElement.style.setProperty("--risu-theme-role-on-borderc", roles['on-borderc']);
        document.documentElement.style.setProperty("--risu-theme-role-state-amber", roles['state-amber']);
        document.documentElement.style.setProperty("--risu-theme-role-state-violet", roles['state-violet']);
        document.documentElement.style.setProperty("--risu-theme-role-on-danger", roles['on-danger']);
        ColorSchemeTypeStore.set(colorScheme.type)
        // The colour applied above, after the lite override; also reached at boot.
        syncSystemBars(colorScheme.bgcolor)
    } catch (error) {}
}

export function changeColorSchemeType(type: 'light'|'dark'){
    try {
        DBState.db.customColorScheme.type = type
        updateCustomColorScheme()
        updateTextThemeAndCSS()
    } catch (error) {}
}


const STANDARD_QUOTES = {
    dark: { FontColorQuote1: '#8BE9FD', FontColorQuote2: '#FFB86C' },
    light: { FontColorQuote1: '#0b5f7a', FontColorQuote2: '#8a4200' },
} as const

/**
 * The colour a Custom text theme paints for a quote. A stored string is painted verbatim; a null
 * or absent quote follows the scheme and paints the Standard quote for the painted scheme type.
 * Every non-'dark' scheme type counts as light, as in the standard branch, and lite is always
 * dark. Shared by the custom branch and the plugin getter so both report the same colour.
 */
export function paintedCustomQuote(
    db: Pick<Database, 'customTextTheme' | 'colorSchemeName' | 'colorScheme'>,
    key: 'FontColorQuote1' | 'FontColorQuote2'
): string{
    const stored = db.customTextTheme[key]
    if(typeof stored === 'string'){
        return stored
    }
    const type = get(isLite) ? 'dark' : effectiveColorScheme(db).type
    return STANDARD_QUOTES[type === 'dark' ? 'dark' : 'light'][key]
}

export function updateTextThemeAndCSS(){
    let db = DBState.db
    const root = document.querySelector(':root') as HTMLElement;
    if(!root){
        return
    }
    let textTheme = get(isLite) ? 'standard' : db.textTheme
    let colorScheme = get(isLite) ? 'dark' : effectiveColorScheme(db).type
    switch(textTheme){
        case "standard":{
            if(colorScheme === 'dark'){
                root.style.setProperty('--FontColorStandard', '#fafafa');
                root.style.setProperty('--FontColorItalic', '#9a9ba1');
                root.style.setProperty('--FontColorBold', '#fafafa');
                root.style.setProperty('--FontColorItalicBold', '#9a9ba1');
                root.style.setProperty('--FontColorQuote1', '#8BE9FD');
                root.style.setProperty('--FontColorQuote2', '#FFB86C');
            }else{
                root.style.setProperty('--FontColorStandard', '#0f172a');
                root.style.setProperty('--FontColorItalic', '#5f6066');
                root.style.setProperty('--FontColorBold', '#0f172a');
                root.style.setProperty('--FontColorItalicBold', '#5f6066');
                root.style.setProperty('--FontColorQuote1', '#0b5f7a');
                root.style.setProperty('--FontColorQuote2', '#8a4200');
            }
            break
        }
        case "highcontrast":{
            if(colorScheme === 'dark'){
                root.style.setProperty('--FontColorStandard', '#f8f8f2');
                root.style.setProperty('--FontColorItalic', '#F1FA8C');
                root.style.setProperty('--FontColorBold', '#8BE9FD');
                root.style.setProperty('--FontColorItalicBold', '#FFB86C');
                root.style.setProperty('--FontColorQuote1', '#8BE9FD');
                root.style.setProperty('--FontColorQuote2', '#FFB86C');
            }
            else{
                root.style.setProperty('--FontColorStandard', '#0f172a');
                root.style.setProperty('--FontColorItalic', '#5c4a00');
                root.style.setProperty('--FontColorBold', '#0b5f7a');
                root.style.setProperty('--FontColorItalicBold', '#8a4200');
                root.style.setProperty('--FontColorQuote1', '#0b5f7a');
                root.style.setProperty('--FontColorQuote2', '#8a4200');
            }
            break
        }
        case "custom":{
            root.style.setProperty('--FontColorStandard', db.customTextTheme.FontColorStandard);
            root.style.setProperty('--FontColorItalic', db.customTextTheme.FontColorItalic);
            root.style.setProperty('--FontColorBold', db.customTextTheme.FontColorBold);
            root.style.setProperty('--FontColorItalicBold', db.customTextTheme.FontColorItalicBold);
            root.style.setProperty('--FontColorQuote1', paintedCustomQuote(db, 'FontColorQuote1'));
            root.style.setProperty('--FontColorQuote2', paintedCustomQuote(db, 'FontColorQuote2'));
            break
        }
    }

    switch(db.font){
        case "default":{
            root.style.setProperty('--risu-font-family', 'Arial, sans-serif');
            break
        }
        case "timesnewroman":{
            root.style.setProperty('--risu-font-family', 'Times New Roman, serif');
            break
        }
        case "custom":{
            root.style.setProperty('--risu-font-family', db.customFont);
            break
        }
    }

    if(!get(SafeModeStore)){
        CustomCSSStore.set(db.customCSS ?? '')
    }
    else{
        CustomCSSStore.set('')
    }
}
