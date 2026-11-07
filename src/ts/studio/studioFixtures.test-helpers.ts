// Synthetic fixtures for the Studio owner model tests, shaped like the real producers: a module stub is
// minted by `moduleStubOf` from an index entry as the encoder carries it, resident assets are an `AssetList`, and
// the persona carries an `embeddedModule` the way a persona with an embedded module does.
import { toAssetList } from '../storage/assetList'
import { moduleStubOf } from '../storage/store2/moduleStubMatch'
import type { ModuleEntry } from '../storage/store2/format'
import { matchesModuleRef } from '../process/moduleRefs'
import type { RisuModule } from '../process/modules'
import type {
    CharacterSource,
    ChatSource,
    LoreLike,
    OwnerModelInput,
    PersonaSource,
    PluginSource,
    PresetSource,
    RegexLike,
} from './ownerModel'
import type { ScriptListEntry } from './scriptMode'
import type { ModuleLister } from './studioModules'

export function loreEntries(count: number, prefix = 'lore'): LoreLike[] {
    return Array.from({ length: count }, (_, index) => ({ comment: `${prefix} ${index}`, key: `${prefix}-key-${index}`, mode: 'normal' }))
}

export function regexEntries(count: number, prefix = 'regex'): RegexLike[] {
    return Array.from({ length: count }, (_, index) => ({ comment: `${prefix} ${index}` }))
}

/** A lorebook entry with a body; the owner model's own type names only the fields the tree lists. */
export function loreBody(comment: string, content: string): LoreLike & { content: string } {
    return { comment, key: `${comment}-key`, mode: 'normal', content }
}

/** A regex script with its pattern and replacement. */
export function regexBody(comment: string, pattern: string, replacement: string): RegexLike & { in: string, out: string } {
    return { comment, in: pattern, out: replacement }
}

/** The character fields the detail reads that the owner model does not list. */
export type CharacterTextFixture = Partial<CharacterSource> & { desc?: string, firstMessage?: string, systemPrompt?: string }

export function makeTextCharacter(overrides: CharacterTextFixture): CharacterSource {
    return makeCharacter(overrides)
}

export const luaScripts: ScriptListEntry[] =[{ effect: [{ type: 'triggerlua' }] }]
export const v2Scripts: ScriptListEntry[] = [{ effect: [{ type: 'v2Header' }, { type: 'v2SetVar' }] }]
export const v1Scripts: ScriptListEntry[] = [{ effect: [{ type: 'setvar' }] }]

export function makeChat(overrides: Partial<ChatSource> = {}): ChatSource {
    return { name: 'Chat', localLore: [], ...overrides }
}

export function makeCharacter(overrides: Partial<CharacterSource> = {}): CharacterSource {
    return {
        chaId: 'cha-1',
        name: 'Alice',
        chats: [makeChat({ id: 'chat-1', name: 'First chat' })],
        chatPage: 0,
        globalLore: [],
        customscript: [],
        triggerscript: [],
        ...overrides,
    }
}

export function makePersona(id: string, moduleId?: string): PersonaSource {
    return moduleId === undefined ? { id } : { id, embeddedModule: { id: moduleId } }
}

export function makePlugin(name: string, version?: number | string): PluginSource {
    return version === undefined ? { name } : { name, version }
}

export function makePreset(name: string, overrides: Partial<PresetSource> = {}): PresetSource {
    return { name, regex: [], toggles: '', ...overrides }
}

/** A resident module as the installer holds it. */
export function residentModule(id: string, overrides: Partial<RisuModule> = {}): RisuModule {
    return { id, name: `Module ${id}`, description: `about ${id}`, ...overrides }
}

/** The index entry the encoder carries for a module, with the four-element unit and the entry-fields version. */
export function moduleEntry(id: string, overrides: Partial<ModuleEntry> = {}): ModuleEntry {
    return {
        id,
        unit: ['unit-' + id, 1200, 7, 1],
        al: ['al-' + id, 0, 0, 1],
        il: null,
        name: `Module ${id}`,
        description: `about ${id}`,
        hasToggle: false,
        dsp: true,
        ...overrides,
    }
}

/**
 * An unloaded module slot: the entry's fields plus the stub marker and no body key. `db.modules` is typed
 * `RisuModule[]`, so the slot is typed as one, exactly as the app holds it.
 */
export function stubModule(id: string, overrides: Partial<ModuleEntry> = {}): RisuModule {
    return moduleStubOf(moduleEntry(id, overrides)) as unknown as RisuModule
}

/** Keys of a module that its index entry does not carry: a stub must never be asked for any of them. */
export const STUB_BODY_KEYS = [
    'lorebook', 'regex', 'cjs', 'trigger', 'backgroundEmbedding', 'assets', 'customModuleToggle',
] as const satisfies readonly Exclude<keyof RisuModule, keyof ModuleEntry>[]

// Fails to compile if a body key is added to RisuModule and not listed above.
type UnlistedBodyKey = Exclude<Exclude<keyof RisuModule, keyof ModuleEntry>, typeof STUB_BODY_KEYS[number]>
export const bodyKeyListIsComplete: [UnlistedBodyKey] extends [never] ? true : false = true

/**
 * Wraps a stub so that every `get` or `has` of a body key is recorded. Marker, entry fields, symbols and
 * `constructor` pass through untouched, so a correct reader records nothing.
 */
export function watchBodyKeys<T extends object>(row: T, reads: string[]): T {
    const bodyKeys: ReadonlySet<string | symbol> = new Set<string | symbol>(STUB_BODY_KEYS)
    return new Proxy(row, {
        get(target, key, receiver) {
            if (bodyKeys.has(key)) reads.push(String(key))
            return Reflect.get(target, key, receiver)
        },
        has(target, key) {
            if (bodyKeys.has(key)) reads.push(String(key))
            return Reflect.has(target, key)
        },
    })
}

/** The engine's selection over a row list: rows matching a reference, first holder of an id winning. */
export function listerOver(rows: readonly RisuModule[]): ModuleLister {
    return (ids) => {
        const idSet = new Set(ids)
        const seen = new Set<string>()
        const picked: RisuModule[] = []
        for (const row of rows) {
            if (!matchesModuleRef(row, idSet) || seen.has(row.id)) continue
            seen.add(row.id)
            picked.push(row)
        }
        return picked
    }
}

export function makeInput(overrides: Partial<OwnerModelInput> = {}): OwnerModelInput {
    const modules = overrides.modules ?? []
    return {
        character: makeCharacter(),
        presets: [],
        activePreset: -1,
        plugins: [],
        modules,
        enabledModules: [],
        moduleIntergration: '',
        personas: [],
        lister: listerOver(modules),
        ...overrides,
    }
}

/** The database fields the owner source reads, laid out as the app holds them for a model input. */
export function studioDbOf(input: OwnerModelInput) {
    const active = input.presets[input.activePreset]
    return {
        characters: [{ ...input.character, type: 'character' }],
        botPresets: input.presets.map((preset) => ({ name: preset.name, regex: preset.regex, customPromptTemplateToggle: preset.toggles })),
        botPresetsId: input.activePreset,
        presetRegex: active?.regex ?? [],
        customPromptTemplateToggle: active?.toggles ?? '',
        plugins: input.plugins,
        modules: input.modules,
        enabledModules: input.enabledModules ?? [],
        moduleIntergration: input.moduleIntergration ?? '',
        personas: input.personas ?? [],
    }
}

/**
 * A stand-in for the locale object of component tests: strings answer with their own key, so assertions do not
 * depend on English, and the keys that take an argument answer with the key and the argument.
 */
export function studioLanguageMock(): Record<string, unknown> {
    const withArgument = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = {
        settingsPage: { back: 'Back' },
        sidebarUi: { notAllowed: 'notAllowed' },
    }
    for (const key of [
        'studioOwnerOtherModules', 'studioOwnerOtherPresets', 'studioMergedPartial', 'studioPluginRetired', 'studioItemCount',
        'studioShowMore', 'studioTruncated', 'studioDeepKindFallback', 'studioDeepItemMissing', 'studioSearchMore', 'studioSearchUnloaded',
    ]) table[key] = withArgument(key)
    return new Proxy(table, {
        get: (target, key) => typeof key === 'symbol' ? undefined : key in target ? target[key] : key,
    })
}

export interface ScaleFixture {
    input: OwnerModelInput
    reads: string[]
    stubCount: number
    residentCount: number
}

/** 2,000 lore entries, 150 modules (every second one a stub, watched for body reads) and 20 presets. */
export function makeScaleFixture(): ScaleFixture {
    const reads: string[] = []
    const modules: RisuModule[] = []
    for (let index = 0; index < 150; index++) {
        const id = `scale-${index}`
        modules.push(index % 2 === 0
            ? residentModule(id, {
                lorebook: [{
                    key: 'k', secondkey: '', insertorder: 1, comment: `m${index}`, content: 'body', mode: 'normal',
                    alwaysActive: false, selective: false,
                }],
                assets: toAssetList([['a', 'path', 'png']]),
                customModuleToggle: '',
            })
            : watchBodyKeys(stubModule(id), reads))
    }
    const character = makeCharacter({
        globalLore: loreEntries(2000),
        customscript: regexEntries(30),
        triggerscript: v2Scripts,
        modules: ['scale-0', 'scale-1'],
    })
    const presets = Array.from({ length: 20 }, (_, index) => makePreset(`Preset ${index}`, { regex: regexEntries(3, `p${index}`) }))
    return {
        input: makeInput({
            character,
            presets,
            activePreset: 0,
            modules,
            enabledModules: ['scale-2', 'scale-4'],
        }),
        reads,
        stubCount: 75,
        residentCount: 75,
    }
}
