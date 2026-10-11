import type { RisuPlugin } from './plugins.svelte'

const fallbackBaseName = 'plugin'
const reservedWindowsName = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/**
 * File name for an exported plugin script: the plugin name with every character that is invalid
 * on Windows or Android file systems, and every path separator, removed, ending in `.js`.
 * A name with nothing left, or one Windows reserves, still yields a usable name.
 */
export function pluginExportFileName(name: string | undefined): string {
    let base = (name ?? '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
        .trim()
        .replace(/[. ]+$/, '')
    if (base === '') {
        base = fallbackBaseName
    }
    else if (reservedWindowsName.test(base)) {
        base = '_' + base
    }
    return base + '.js'
}

/**
 * What the per-plugin export button downloads: the stored script string unchanged, so the file
 * re-imports through `importPlugin`. Saved setting values (`realArg`) can hold API keys and are
 * never part of it.
 */
export function pluginExportFile(plugin: Pick<RisuPlugin, 'name' | 'script'>): { fileName: string, content: string } {
    return { fileName: pluginExportFileName(plugin.name), content: plugin.script }
}
