import type { SideRecord } from 'src/ts/drive/rtb/rtbWriter'

/**
 * The records of the frozen golden `v1-settings-small.rtb`: explicit values, sorted by key, so the golden does not follow
 * the database defaults. Changing a value here changes what a future generator would write, never the frozen file.
 */
export const SETTINGS_GOLDEN_RECORDS: readonly SideRecord[] = [
    { key: 'botPresets', value: [
        { id: 'golden-a', name: 'Golden A', temperature: 0.7, aiModel: 'gpt-4o', maxContext: 8000, ooba: { max_new_tokens: 300 } },
        { id: 'golden-b', name: 'Golden B', temperature: 1.1, promptTemplate: null },
    ] },
    { key: 'botPresetsId', value: 1 },
    { key: 'colorScheme', value: { bgcolor: '#282a36', darkbg: '#21222c' } },
    { key: 'hypaV3Presets', value: [{ id: 'golden-mem', name: 'Golden memory', settings: { recentMemoryRatio: 0.4 } }] },
    { key: 'hypaV3PresetId', value: 0 },
    { key: 'language', value: 'en' },
    { key: 'presetFolders', value: [{ id: 'folder-1', name: 'Folder 1' }] },
    { key: 'sendWithEnter', value: true },
    { key: 'textTheme', value: 'standard' },
    { key: 'theme', value: 'waifu' },
    { key: 'translatorPresets', value: [{ name: 'Golden translator', prompt: 'Translate to {{slot}}', maxResponse: 1000 }] },
    { key: 'translatorPresetId', value: 0 },
    { key: 'zoomsize', value: 100 },
]

export const SETTINGS_GOLDEN_UI_PREFS: readonly SideRecord[] = [
    { key: 'risutanium.grid.sort', value: 'name' },
]
