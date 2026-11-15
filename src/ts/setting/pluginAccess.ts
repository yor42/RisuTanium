import { fillLang } from '../../lang/fill'
import type { RisuPlugin } from '../plugins/plugins.svelte'

/**
 * What the Plugins page says about a plugin's API version and whether its switch may be used.
 * Only API 3.0 plugins run; every other version is retired data that stays in the database untouched.
 */

export type PluginApiLabel = '3.0' | '2.1' | '2' | '1'

export type PluginAccess =
    | { kind: 'limited', ipcCount: number }
    | { kind: 'retired', apiLabel: PluginApiLabel }

export type PluginSwitchMode = 'direct' | 'disabled'

type VersionSource = Pick<RisuPlugin, 'version'>

/** An entry saved without a version counts as API 1: older entries lack the field and never run. */
export function pluginApiLabel(version: RisuPlugin['version']): PluginApiLabel {
    if (version === '3.0') return '3.0'
    if (version === '2.1') return '2.1'
    if (version === 2) return '2'
    return '1'
}

export function pluginAccess(plugin: Pick<RisuPlugin, 'version' | 'allowedIPC'>): PluginAccess {
    const apiLabel = pluginApiLabel(plugin.version)
    if (apiLabel === '3.0') {
        return { kind: 'limited', ipcCount: plugin.allowedIPC?.length ?? 0 }
    }
    return { kind: 'retired', apiLabel }
}

/** The switch works only for a plugin that can run; a retired entry's saved `enabled` is never written. */
export function pluginSwitchMode(plugin: VersionSource): PluginSwitchMode {
    return pluginApiLabel(plugin.version) === '3.0' ? 'direct' : 'disabled'
}

/** "v{version} · API {api}", or only the API part when the plugin declares no version of its own. */
export function pluginVersionLine(
    plugin: Pick<RisuPlugin, 'version' | 'versionOfPlugin'>,
    text: { versionLine: string, apiLine: string },
): string {
    const api = pluginApiLabel(plugin.version)
    if (!plugin.versionOfPlugin) {
        return fillLang(text.apiLine, { api })
    }
    return fillLang(text.versionLine, { version: plugin.versionOfPlugin, api })
}
