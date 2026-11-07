// The read-only text of one Studio item. Pure: it reads plain fields of the bound character, its context chat, a
// resident module or a preset, and nothing else. It never writes, never loads or acquires a module, and never reads
// the body of a module that is not resident. Content that must stay hidden (the private licence) yields null.
import type { StudioItem } from './ownerModel'
import { isStubRow } from './studioModules'
import type { StudioOwnerType } from './studioTarget'
import type { RisuModule } from '../process/modules'

export interface LoreText {
    content?: string
}

export interface RegexText {
    in?: string
    out?: string
}

export interface TriggerText {
    effect?: readonly { type?: string, code?: string }[]
}

export interface ChatText {
    localLore?: readonly LoreText[]
}

/** The fields of the bound character that the detail reads. */
export interface CharacterText {
    license?: string
    desc?: string
    firstMessage?: string
    exampleMessage?: string
    systemPrompt?: string
    personality?: string
    scenario?: string
    creatorNotes?: string
    globalLore?: readonly LoreText[]
    customscript?: readonly RegexText[]
    triggerscript?: readonly TriggerText[]
    customModuleToggle?: string
    backgroundHTML?: string
    chats?: readonly ChatText[]
    chatPage: number
}

export interface PresetText {
    regex?: readonly RegexText[]
    toggles?: string
}

export interface ItemTextSources {
    character: CharacterText
    /** The database module list as the app holds it; a stub row is never read beyond its marker and id. */
    modules: readonly RisuModule[]
    presets: readonly PresetText[]
}

/** The part of an owner node the reader needs. */
export interface ItemTextOwner {
    type: StudioOwnerType
    id: string
    restricted: boolean
    stub: boolean
}

/** A named character field; the detail turns the name into its label. */
export type TextField = 'description' | 'firstMessage' | 'exampleMessage' | 'systemPrompt' | 'personality' | 'scenario' | 'creatorNotes'

export interface TextSection {
    /** Null when the text needs no label. */
    field: TextField | null
    text: string
}

/** The preset list as the engine merges it: the active preset's stored entry lags the working settings. */
export interface WorkingPresetDb {
    botPresets?: readonly { regex?: readonly RegexText[], customPromptTemplateToggle?: string }[]
    botPresetsId: number
    presetRegex?: readonly RegexText[]
    customPromptTemplateToggle?: string
}

export function workingPresetsOf(db: WorkingPresetDb): PresetText[] {
    const stored = Array.isArray(db.botPresets) ? db.botPresets : []
    return stored.map((preset, index) => index === db.botPresetsId
        ? { regex: db.presetRegex, toggles: db.customPromptTemplateToggle }
        : { regex: preset.regex, toggles: preset.customPromptTemplateToggle })
}

/**
 * The module row behind an owner id: the first row holding the id, or `<id>#<row>` for a later duplicate, as the
 * owner model names them.
 */
export function moduleRowOf(ownerId: string, rows: readonly RisuModule[]): RisuModule | undefined {
    const first = rows.find((row) => row.id === ownerId)
    if (first) return first
    const cut = ownerId.lastIndexOf('#')
    if (cut < 0) return undefined
    const rowIndex = Number(ownerId.slice(cut + 1))
    const row = Number.isInteger(rowIndex) ? rows[rowIndex] : undefined
    return row && row.id === ownerId.slice(0, cut) ? row : undefined
}

function section(field: TextField | null, text: string | undefined): TextSection[] {
    return typeof text === 'string' && text !== '' ? [{ field, text }] : []
}

function loreText(list: readonly LoreText[] | undefined, index: number): TextSection[] {
    return section(null, list?.[index]?.content)
}

function regexText(list: readonly RegexText[] | undefined, index: number): TextSection[] {
    const entry = list?.[index]
    if (!entry) return []
    const pattern = entry.in ?? ''
    const replacement = entry.out ?? ''
    if (pattern === '' && replacement === '') return []
    return [{ field: null, text: `${pattern}\n→\n${replacement}` }]
}

/** A Lua script reads as its code; any other trigger list reads as its definition. */
function scriptText(list: readonly TriggerText[] | undefined): TextSection[] {
    if (!list || list.length === 0) return []
    const first = list[0]?.effect?.[0]
    if (first && (first.type === 'triggerlua' || first.type === 'triggercode')) return section(null, first.code)
    return section(null, JSON.stringify(list, null, 2))
}

function characterText(item: StudioItem, character: CharacterText): TextSection[] {
    switch (item.kind) {
        case 'basic':
            return [...section('description', character.desc), ...section('firstMessage', character.firstMessage)]
        case 'lore': return loreText(character.globalLore, item.index)
        case 'regex': return regexText(character.customscript, item.index)
        case 'scripts': return scriptText(character.triggerscript)
        case 'toggles': return section(null, character.customModuleToggle)
        case 'html': return section(null, character.backgroundHTML)
        case 'advanced':
            return [
                ...section('exampleMessage', character.exampleMessage),
                ...section('systemPrompt', character.systemPrompt),
                ...section('personality', character.personality),
                ...section('scenario', character.scenario),
                ...section('creatorNotes', character.creatorNotes),
            ]
        default: return []
    }
}

function moduleText(item: StudioItem, row: RisuModule): TextSection[] {
    switch (item.kind) {
        case 'lore': return loreText(row.lorebook, item.index)
        case 'regex': return regexText(row.regex, item.index)
        case 'scripts': return scriptText(row.trigger)
        case 'toggles': return section(null, row.customModuleToggle)
        case 'html': return section(null, row.backgroundEmbedding)
        default: return []
    }
}

function presetText(item: StudioItem, preset: PresetText): TextSection[] {
    switch (item.kind) {
        case 'regex': return regexText(preset.regex, item.index)
        case 'toggles': return section(null, preset.toggles)
        default: return []
    }
}

/**
 * The sections of text an item shows, or null when its text cannot be shown: the owner is private or not
 * resident. An empty list means the item is readable and has no text of its own.
 */
export function itemSectionsOf(owner: ItemTextOwner, item: StudioItem, sources: ItemTextSources): TextSection[] | null {
    if (owner.restricted || owner.stub) return null
    switch (owner.type) {
        case 'character':
            if (sources.character.license === 'private') return null
            return characterText(item, sources.character)
        case 'chat': {
            if (sources.character.license === 'private') return null
            const chat = sources.character.chats?.[sources.character.chatPage]
            return item.kind === 'lore' ? loreText(chat?.localLore, item.index) : []
        }
        case 'module': {
            const row = moduleRowOf(owner.id, sources.modules)
            if (!row || isStubRow(row)) return null
            return moduleText(item, row)
        }
        case 'preset': {
            const preset = sources.presets[Number(owner.id)]
            return preset ? presetText(item, preset) : null
        }
        default: return []
    }
}
