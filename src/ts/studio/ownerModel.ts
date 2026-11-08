// The read-only owner model of one Studio visit: the bound character, its chat, the modules, presets and plugins,
// each with the kinds it supports and lazy item lists. Pure: every input is a plain reader handed in by
// `ownerSource.svelte.ts`, the only file that reads the database. Nothing here writes, loads or acquires a module.
import type { StudioOwnerType } from './studioTarget'
import { scriptModeOf, type ScriptListEntry, type ScriptMode } from './scriptMode'
import {
    boundPersonaOf,
    classifyModules,
    isStubRow,
    type ModuleBadge,
    type ModuleLister,
} from './studioModules'
import type { RisuModule } from '../process/modules'

export type StudioKind = 'basic' | 'display' | 'lore' | 'regex' | 'scripts' | 'toggles' | 'html' | 'advanced' | 'plugin'

export type OwnerTag = 'notLoaded' | 'notApplied' | 'off' | 'retired' | 'private'

/** A lorebook entry as far as the model reads it. */
export interface LoreLike {
    comment?: string
    key?: string
    mode?: string
}

/** A regex script as far as the model reads it. */
export interface RegexLike {
    comment?: string
}

export interface ChatSource {
    id?: string
    name: string
    localLore?: readonly LoreLike[]
    modules?: readonly string[]
    bindedPersona?: string
}

export interface CharacterSource {
    chaId: string
    name: string
    chats?: readonly ChatSource[]
    chatPage: number
    globalLore?: readonly LoreLike[]
    customscript?: readonly RegexLike[]
    triggerscript?: readonly ScriptListEntry[]
    license?: string
    modules?: readonly string[]
    customModuleToggle?: string
    backgroundHTML?: string
    additionalAssets?: readonly unknown[]
    emotionImages?: readonly unknown[]
}

export interface PersonaSource {
    id?: string
    embeddedModule?: { id: string }
}

export interface PresetSource {
    name?: string
    regex?: readonly RegexLike[]
    toggles?: string
}

export interface PluginSource {
    name: string
    displayName?: string
    version?: number | string
}

export interface OwnerModelInput {
    character: CharacterSource
    presets: readonly PresetSource[]
    /** Index into `presets` of the active preset, or a value outside the list when none is. */
    activePreset: number
    plugins: readonly PluginSource[]
    /** The database module list, in load order. */
    modules: readonly RisuModule[]
    enabledModules: readonly string[] | undefined
    moduleIntergration: string | undefined
    personas: readonly PersonaSource[] | undefined
    lister: ModuleLister
}

export interface StudioItem {
    /** `<ownerId>/<kind>:<index>`; valid for the visit only. */
    id: string
    ownerKey: string
    kind: StudioKind
    /** Position in the owner's own list for the kind (0 for single-item kinds). */
    index: number
    /** The entry's own name; empty for a kind that has one item and is named by the kind or its mode. */
    name: string
    /** A lorebook folder row. */
    folder: boolean
    /** Set on the scripts item only. */
    mode?: ScriptMode
}

export interface KindNode {
    kind: StudioKind
    /** Items that are not folder rows. */
    count: number
    /** Lorebook folder rows, counted apart. */
    folderCount: number
    /** Builds the item list on demand; reads the entries' names. */
    items(): StudioItem[]
    /**
     * The first `end` items, reading only those entries' names, and the live length of the list (folder rows
     * included). Equals `items().slice(0, end)` and `items().length`.
     */
    itemsUpTo(end: number): { items: StudioItem[], total: number }
    /** The item with this id, reading only that entry; undefined unless `items()` would list exactly that id. */
    itemById(id: string): StudioItem | undefined
}

export interface OwnerNode {
    key: string
    type: StudioOwnerType
    id: string
    readonly name: string
    /** Active for the visit: the character, the chat, an active module, the active preset. */
    active: boolean
    badges: ModuleBadge[]
    tags: OwnerTag[]
    /** Set with the `retired` tag. */
    retiredVersion?: string
    /** The body is not resident. Such an owner has no kinds. */
    readonly stub: boolean
    /** Its content must not be shown (private character and its chat). Such an owner has no kinds. */
    restricted: boolean
    /** Built on first call and kept. Empty for a stub or a restricted owner. */
    kinds(): KindNode[]
}

export interface OwnerModel {
    character: OwnerNode
    /** Only with a context chat. */
    chat: OwnerNode | null
    modules: OwnerNode[]
    otherModules: OwnerNode[]
    /** The active preset alone, or empty. */
    presets: OwnerNode[]
    otherPresets: OwnerNode[]
    plugins: OwnerNode[]
    /** Every owner, in tree order. */
    owners: readonly OwnerNode[]
    ownerOf(type: StudioOwnerType, id: string): OwnerNode | undefined
    ownerByKey(key: string): OwnerNode | undefined
}

/** The context chat of a character: the page it is on now, as the engine reads it. */
export function contextChatOf(character: Pick<CharacterSource, 'chats' | 'chatPage'>): ChatSource | undefined {
    return character.chats?.[character.chatPage]
}

export function ownerKeyOf(type: StudioOwnerType, id: string): string {
    return `${type}:${id}`
}

function itemId(ownerId: string, kind: StudioKind, index: number): string {
    return `${ownerId}/${kind}:${index}`
}

function countFolders(list: readonly LoreLike[]): number {
    let folders = 0
    for (let i = 0; i < list.length; i++) {
        if (list[i]?.mode === 'folder') folders++
    }
    return folders
}

/** The list index an item id names, or undefined unless the id is `<ownerId>/<kind>:<canonical decimal index>`. */
function indexOfItemId(owner: { id: string }, kind: StudioKind, id: string): number | undefined {
    const prefix = `${owner.id}/${kind}:`
    if (!id.startsWith(prefix)) return undefined
    const digits = id.slice(prefix.length)
    return /^(0|[1-9][0-9]*)$/.test(digits) ? Number(digits) : undefined
}

/** `itemsUpTo` and `itemById` of a kind whose list is built whole by `items`. */
function overItems(items: () => StudioItem[], owner: { id: string }, kind: StudioKind): Pick<KindNode, 'itemsUpTo' | 'itemById'> {
    return {
        itemsUpTo: (end) => {
            const all = items()
            return { items: all.slice(0, Math.max(0, end)), total: all.length }
        },
        itemById: (id) => {
            if (indexOfItemId(owner, kind, id) === undefined) return undefined
            return items().find((candidate) => candidate.id === id)
        },
    }
}

/** `items`, `itemsUpTo` and `itemById` of a kind whose entries each build one item by index. */
function overEntries<T>(
    owner: { id: string },
    kind: StudioKind,
    source: readonly T[],
    build: (entry: T, index: number) => StudioItem,
): Pick<KindNode, 'items' | 'itemsUpTo' | 'itemById'> {
    return {
        items: () => source.map(build),
        itemsUpTo: (end) => {
            const shown = Math.min(Math.max(0, end), source.length)
            const items: StudioItem[] = []
            for (let index = 0; index < shown; index++) items.push(build(source[index], index))
            return { items, total: source.length }
        },
        itemById: (id) => {
            const index = indexOfItemId(owner, kind, id)
            return index === undefined || index >= source.length ? undefined : build(source[index], index)
        },
    }
}

function loreKind(owner: { key: string, id: string }, list: readonly LoreLike[] | undefined): KindNode {
    const source = list ?? []
    const folderCount = countFolders(source)
    return {
        kind: 'lore',
        count: source.length - folderCount,
        folderCount,
        ...overEntries(owner, 'lore', source, (entry, index) => ({
            id: itemId(owner.id, 'lore', index),
            ownerKey: owner.key,
            kind: 'lore' as const,
            index,
            name: entry?.comment || entry?.key || '',
            folder: entry?.mode === 'folder',
        })),
    }
}

function regexKind(owner: { key: string, id: string }, list: readonly RegexLike[] | undefined): KindNode {
    const source = list ?? []
    return {
        kind: 'regex',
        count: source.length,
        folderCount: 0,
        ...overEntries(owner, 'regex', source, (entry, index) => ({
            id: itemId(owner.id, 'regex', index),
            ownerKey: owner.key,
            kind: 'regex' as const,
            index,
            name: entry?.comment ?? '',
            folder: false,
        })),
    }
}

function scriptsKind(owner: { key: string, id: string }, list: readonly ScriptListEntry[] | undefined): KindNode {
    const mode = scriptModeOf(list)
    const items = (): StudioItem[] => mode === 'empty' ? [] : [{
        id: itemId(owner.id, 'scripts', 0), ownerKey: owner.key, kind: 'scripts', index: 0, name: '', folder: false, mode,
    }]
    return {
        kind: 'scripts',
        count: mode === 'empty' ? 0 : 1,
        folderCount: 0,
        items,
        ...overItems(items, owner, 'scripts'),
    }
}

/** A kind with one item when `present`, none otherwise. */
function singleKind(owner: { key: string, id: string }, kind: StudioKind, present: boolean): KindNode {
    const items = (): StudioItem[] => present
        ? [{ id: itemId(owner.id, kind, 0), ownerKey: owner.key, kind, index: 0, name: '', folder: false }]
        : []
    return {
        kind,
        count: present ? 1 : 0,
        folderCount: 0,
        items,
        ...overItems(items, owner, kind),
    }
}

function textKind(owner: { key: string, id: string }, kind: StudioKind, text: string | undefined): KindNode {
    return singleKind(owner, kind, typeof text === 'string' && text.trim() !== '')
}

function listLength(list: readonly unknown[] | undefined): number {
    return list ? list.length : 0
}

function assetKind(owner: { key: string, id: string }, count: number): KindNode {
    const items = (): StudioItem[] => count === 0 ? [] : [{ id: itemId(owner.id, 'display', 0), ownerKey: owner.key, kind: 'display', index: 0, name: '', folder: false }]
    return {
        kind: 'display',
        count,
        folderCount: 0,
        items,
        ...overItems(items, owner, 'display'),
    }
}

interface OwnerInit {
    type: StudioOwnerType
    id: string
    name: () => string
    active: boolean
    badges?: ModuleBadge[]
    tags?: OwnerTag[]
    retiredVersion?: string
    stub?: () => boolean
    restricted?: boolean
    buildKinds: (owner: { key: string, id: string }) => KindNode[]
}

function makeOwner(init: OwnerInit): OwnerNode {
    const key = ownerKeyOf(init.type, init.id)
    const identity = { key, id: init.id }
    let kinds: KindNode[] | null = null
    const restricted = init.restricted ?? false
    const stubOf = init.stub ?? (() => false)
    return {
        key,
        type: init.type,
        id: init.id,
        get name() { return init.name() },
        active: init.active,
        badges: init.badges ?? [],
        tags: init.tags ?? [],
        retiredVersion: init.retiredVersion,
        get stub() { return stubOf() },
        restricted,
        kinds() {
            if (restricted || stubOf()) return []
            kinds ??= init.buildKinds(identity)
            return kinds
        },
    }
}

function modulesKinds(module: RisuModule): (owner: { key: string, id: string }) => KindNode[] {
    return (owner) => [
        loreKind(owner, module.lorebook),
        regexKind(owner, module.regex),
        scriptsKind(owner, module.trigger),
        textKind(owner, 'toggles', module.customModuleToggle),
        textKind(owner, 'html', module.backgroundEmbedding),
        singleKind(owner, 'advanced', true),
        assetKind(owner, listLength(module.assets)),
    ]
}

function retiredVersionOf(version: number | string | undefined): string | undefined {
    if (version === 1) return '1'
    if (version === '2.1') return '2.1'
    return undefined
}

/**
 * Builds the model for the bound character. The context chat is read from the character on every call
 * (`chats[chatPage]`), so a rebuild after a page change follows the new chat, and the active module set is
 * `lister(referencedModuleIds(...))` over the explicit origin.
 */
export function buildOwnerModel(input: OwnerModelInput): OwnerModel {
    const { character } = input
    const restricted = character.license === 'private'
    const contextChat = contextChatOf(character)
    const persona = boundPersonaOf(contextChat, input.personas)

    const characterOwner = makeOwner({
        type: 'character',
        id: character.chaId,
        name: () => character.name,
        active: true,
        tags: restricted ? ['private'] : [],
        restricted,
        buildKinds: (owner) => [
            singleKind(owner, 'basic', true),
            assetKind(owner, listLength(character.additionalAssets) + listLength(character.emotionImages)),
            loreKind(owner, character.globalLore),
            regexKind(owner, character.customscript),
            scriptsKind(owner, character.triggerscript),
            textKind(owner, 'toggles', character.customModuleToggle),
            textKind(owner, 'html', character.backgroundHTML),
            singleKind(owner, 'advanced', true),
        ],
    })

    const chatOwner = contextChat
        ? makeOwner({
            type: 'chat',
            id: contextChat.id || String(character.chatPage),
            name: () => contextChat.name,
            active: true,
            tags: restricted ? ['private'] : [],
            restricted,
            buildKinds: (owner) => [loreKind(owner, contextChat.localLore)],
        })
        : null

    const classification = classifyModules(
        {
            enabledModules: input.enabledModules,
            chat: contextChat ?? null,
            character,
            persona,
            moduleIntergration: input.moduleIntergration,
        },
        input.modules,
        input.lister,
    )

    // The first row holding an id keeps it; a later row with the same id gets a row-suffixed owner id.
    const usedIds = new Set<string>()
    const moduleIds = new Map<RisuModule, string>()
    input.modules.forEach((row, rowIndex) => {
        const id = usedIds.has(row.id) ? `${row.id}#${rowIndex}` : row.id
        usedIds.add(id)
        moduleIds.set(row, id)
    })
    const moduleOwner = (row: RisuModule, active: boolean, badges: ModuleBadge[], tags: OwnerTag[]): OwnerNode =>
        makeOwner({
            type: 'module',
            id: moduleIds.get(row) ?? row.id,
            name: () => row.name,
            active,
            badges,
            tags: isStubRow(row) ? ['notLoaded', ...tags] : tags,
            stub: () => isStubRow(row),
            buildKinds: modulesKinds(row),
        })

    const modules = classification.active.map((entry) => moduleOwner(entry.module, true, entry.badges, []))
    const otherModules = [
        ...classification.notApplied.map((row) => moduleOwner(row, false, [], ['notApplied'])),
        ...classification.others.map((row) => moduleOwner(row, false, [], ['off'])),
    ]

    const presetOwners = input.presets.map((preset, index) => makeOwner({
        type: 'preset',
        id: String(index),
        name: () => preset.name ?? '',
        active: index === input.activePreset,
        tags: index === input.activePreset ? [] : ['off'],
        buildKinds: (owner) => [
            regexKind(owner, preset.regex),
            textKind(owner, 'toggles', preset.toggles),
            singleKind(owner, 'advanced', true),
        ],
    }))
    const presets = presetOwners.filter((owner) => owner.active)
    const otherPresets = presetOwners.filter((owner) => !owner.active)

    const usedPluginIds = new Set<string>()
    const plugins = input.plugins.map((plugin, index) => {
        const id = usedPluginIds.has(plugin.name) ? `${plugin.name}#${index}` : plugin.name
        usedPluginIds.add(id)
        const retiredVersion = retiredVersionOf(plugin.version)
        return makeOwner({
            type: 'plugin',
            id,
            name: () => plugin.displayName || plugin.name,
            active: false,
            tags: retiredVersion ? ['retired'] : [],
            retiredVersion,
            buildKinds: (owner) => [singleKind(owner, 'plugin', true)],
        })
    })

    const owners: OwnerNode[] = [
        characterOwner,
        ...(chatOwner ? [chatOwner] : []),
        ...modules,
        ...otherModules,
        ...presets,
        ...otherPresets,
        ...plugins,
    ]
    const byKey = new Map(owners.map((owner) => [owner.key, owner]))
    return {
        character: characterOwner,
        chat: chatOwner,
        modules,
        otherModules,
        presets,
        otherPresets,
        plugins,
        owners,
        ownerOf: (type, id) => byKey.get(ownerKeyOf(type, id)),
        ownerByKey: (key) => byKey.get(key),
    }
}
