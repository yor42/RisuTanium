/**
 * Backyard archive (`.byaf`) character import: the decisions, with no reading and no saving.
 *
 * A Backyard archive is a zip whose `manifest.json` lists the character file (`characters/<id>/character.json`) and the
 * scenario files (`scenarios/<name>.json`) by path. `planByaf` validates the JSON the importer retained and decides
 * every refusal, the card text and the ordered list of image entries to save; `buildByafCard` turns the plan and the
 * ids the saved images got into the card the app imports.
 *
 * Every field read from the archive is untrusted: JSON enters as `unknown` and is narrowed by `isObject` and `textOf`,
 * so a value of the wrong type becomes an empty one and never throws.
 */
import type { CharacterCardV3, LorebookEntry } from '@risuai/ccardlib'

export const BYAF_MANIFEST = 'manifest.json'

const CHARACTER_ENTRY = /^characters\/[^/]+\/character\.json$/
const SCENARIO_ENTRY = /^scenarios\/[^/]+\.json$/
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']

/** Whether an archive entry name is one of the JSON files the import reads: the manifest, a character file or a scenario file. */
export function isByafJsonEntry(name: string): boolean {
    return name === BYAF_MANIFEST || CHARACTER_ENTRY.test(name) || SCENARIO_ENTRY.test(name)
}

/** An image the character lists and the import saves. `key` is its entry name in the archive. */
export type ByafImage = { key: string, label: string, ext: string }

export type ByafRefusal = 'invalid' | 'version' | 'severalCharacters'

/** `order` is the item's position in the character's `loreItems`, counting the items that were skipped. */
type ByafLoreItem = { order: number, rawKey: string, keys: string[], content: string }

export type ByafCardFields = {
    name: string
    nickname: string
    description: string
    scenario: string
    systemPrompt: string
    exampleMessage: string
    firstMessage: string
    alternateGreetings: string[]
    tags: string[]
    creator: string
    creatorNotes: string
    creationDate: number
    modificationDate: number
    lore: ByafLoreItem[]
}

export type ByafPlan = { card: ByafCardFields, images: ByafImage[] }

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

function arrayOf(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
}

/** The JSON object in `bytes`, or null when there are no bytes, they are not JSON or the value is not an object. */
function objectOf(bytes: Uint8Array | undefined): JsonObject | null {
    if (!bytes) {
        return null
    }
    try {
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
        return isObject(value) ? value : null
    } catch {
        return null
    }
}

/**
 * Converts the placeholders of Backyard text to the app's: `{user}` and `{character}` with a single brace on each side
 * become `{{user}}` and `{{char}}`, and a leading `#` before a trailing colon is dropped (`#{user}:` is `{{user}}:`), so a
 * speaker line starts the way the example-message parser expects. A run of two or more braces is already the app's
 * syntax (or not a placeholder) and stays as it is.
 */
export function convertByafPlaceholders(text: string): string {
    return text.replace(/(#?)(\{+)(user|character)(\}+)(:?)/gi, (match, hash: string, open: string, word: string, close: string, colon: string) => {
        if (open.length !== 1 || close.length !== 1) {
            return match
        }
        const placeholder = word.toLowerCase() === 'character' ? '{{char}}' : '{{user}}'
        return (colon ? '' : hash) + placeholder + colon
    })
}

/**
 * The entry name of a listed image, or null when the path is unsafe or the extension is not supported: the path must
 * stay inside `base` (the character's own directory), use forward slashes only and name a file with a supported
 * extension.
 */
function imageKeyOf(base: string, path: string): { key: string, ext: string } | null {
    if (path === '' || path.includes('\\') || path.startsWith('/')) {
        return null
    }
    const kept: string[] = []
    for (const segment of path.split('/')) {
        if (segment === '') {
            return null
        }
        if (segment === '.') {
            continue
        }
        if (segment === '..') {
            if (kept.length === 0) {
                return null
            }
            kept.pop()
            continue
        }
        kept.push(segment)
    }
    if (kept.length === 0) {
        return null
    }
    const file = kept[kept.length - 1]
    const dot = file.lastIndexOf('.')
    const ext = dot < 0 ? '' : file.slice(dot + 1).toLowerCase()
    if (!IMAGE_EXTENSIONS.includes(ext)) {
        return null
    }
    return { key: base + kept.join('/'), ext }
}

function planImages(base: string, character: JsonObject): ByafImage[] {
    const images: ByafImage[] = []
    const seen = new Set<string>()
    for (const item of arrayOf(character.images)) {
        if (!isObject(item)) {
            continue
        }
        const found = imageKeyOf(base, textOf(item.path))
        if (found === null || seen.has(found.key)) {
            continue
        }
        seen.add(found.key)
        images.push({ key: found.key, label: textOf(item.label), ext: found.ext })
    }
    return images
}

function planLore(character: JsonObject): ByafLoreItem[] {
    const lore: ByafLoreItem[] = []
    arrayOf(character.loreItems).forEach((item, order) => {
        if (!isObject(item)) {
            return
        }
        const rawKey = textOf(item.key)
        lore.push({
            order,
            rawKey,
            keys: convertByafPlaceholders(rawKey).split(',').map((key) => key.trim()).filter((key) => key !== ''),
            content: convertByafPlaceholders(textOf(item.value)),
        })
    })
    return lore
}

function planExamples(scenario: JsonObject): string {
    const parts: string[] = []
    for (const item of arrayOf(scenario.exampleMessages)) {
        if (!isObject(item)) {
            continue
        }
        const text = convertByafPlaceholders(textOf(item.text))
        if (text.trim() !== '') {
            parts.push('<START>\n' + text)
        }
    }
    return parts.join('\n')
}

function firstMessageOf(scenario: JsonObject): string | null {
    const first = arrayOf(scenario.firstMessages)[0]
    if (!isObject(first)) {
        return null
    }
    const text = convertByafPlaceholders(textOf(first.text))
    return text.trim() === '' ? null : text
}

function secondsOf(value: unknown): number {
    if (typeof value !== 'string') {
        return 0
    }
    const seconds = Math.floor(Date.parse(value) / 1000)
    return Number.isNaN(seconds) ? 0 : seconds
}

/**
 * Validates the retained JSON and plans the import. Structure and every `schemaVersion` are checked before the
 * character count and the names, so a version refusal wins over a count or name refusal; within a phase the first
 * failure wins. Past those checks every field is total: a value of the wrong type is an empty one.
 */
export function planByaf(texts: { [name: string]: Uint8Array }): { ok: true, plan: ByafPlan } | { ok: false, refusal: ByafRefusal } {
    const refuse = (refusal: ByafRefusal) => ({ ok: false, refusal }) as const

    const manifest = objectOf(texts[BYAF_MANIFEST])
    if (manifest === null) {
        return refuse('invalid')
    }
    if (manifest.schemaVersion !== 1) {
        return refuse('version')
    }

    const characters = manifest.characters
    if (!Array.isArray(characters) || characters.length === 0 || typeof characters[0] !== 'string') {
        return refuse('invalid')
    }
    const characterPath: string = characters[0]
    const character = CHARACTER_ENTRY.test(characterPath) ? objectOf(texts[characterPath]) : null
    if (character === null) {
        return refuse('invalid')
    }
    if (character.schemaVersion !== 1) {
        return refuse('version')
    }

    const listed = manifest.scenarios
    if (!Array.isArray(listed) || listed.length === 0) {
        return refuse('invalid')
    }
    const scenarios: Array<JsonObject | null> = listed.map((path) => typeof path === 'string' && SCENARIO_ENTRY.test(path) ? objectOf(texts[path]) : null)
    for (const scenario of scenarios) {
        if (scenario !== null && scenario.schemaVersion !== 1) {
            return refuse('version')
        }
    }
    const first = scenarios[0]
    if (first === null) {
        return refuse('invalid')
    }

    if (characters.length > 1) {
        return refuse('severalCharacters')
    }
    const display = textOf(character.displayName)
    const short = textOf(character.name)
    const name = display.trim() !== '' ? display : short
    if (name.trim() === '') {
        return refuse('invalid')
    }

    const candidates: string[] = []
    for (const scenario of scenarios) {
        const message = scenario === null ? null : firstMessageOf(scenario)
        if (message !== null) {
            candidates.push(message)
        }
    }
    const firstMessage = candidates[0] ?? ''
    const alternateGreetings: string[] = []
    for (const message of candidates.slice(1)) {
        if (message !== firstMessage && !alternateGreetings.includes(message)) {
            alternateGreetings.push(message)
        }
    }

    const author = isObject(manifest.author) ? manifest.author : {}
    return {
        ok: true,
        plan: {
            card: {
                name,
                nickname: short.trim() !== '' && short !== name ? short : '',
                description: convertByafPlaceholders(textOf(character.persona)),
                scenario: convertByafPlaceholders(textOf(first.narrative)),
                systemPrompt: convertByafPlaceholders(textOf(first.formattingInstructions)),
                exampleMessage: planExamples(first),
                firstMessage,
                alternateGreetings,
                tags: character.isNSFW === true ? ['nsfw'] : [],
                creator: textOf(author.name),
                creatorNotes: textOf(author.backyardURL),
                creationDate: secondsOf(character.createdAt),
                modificationDate: secondsOf(character.updatedAt),
                lore: planLore(character),
            },
            images: planImages(characterPath.slice(0, characterPath.lastIndexOf('/') + 1), character),
        },
    }
}

/**
 * The card for a plan. `saved` maps an archive entry name to the id the saved image got; only images that were saved
 * are referenced. The first saved image is the avatar and the others are icon assets named by their label (a label of
 * `main` would replace the avatar, so it is stored empty).
 */
export function buildByafCard(plan: ByafPlan, saved: { [key: string]: string }): CharacterCardV3 {
    const { card } = plan
    const usable = plan.images.filter((image) => saved[image.key] !== undefined)
    const assets = usable.map((image, index) => ({
        type: 'icon',
        uri: '__asset:' + image.key,
        name: index === 0 ? 'main' : image.label === 'main' ? '' : image.label,
        ext: image.ext,
    }))
    const entries: LorebookEntry[] = card.lore.map((item) => ({
        keys: item.keys,
        content: item.content,
        extensions: {},
        enabled: true,
        insertion_order: item.order,
        use_regex: false,
        constant: false,
        comment: item.rawKey,
    }))
    const data: CharacterCardV3['data'] = {
        name: card.name,
        nickname: card.nickname,
        description: card.description,
        personality: '',
        scenario: card.scenario,
        system_prompt: card.systemPrompt,
        post_history_instructions: '',
        mes_example: card.exampleMessage,
        first_mes: card.firstMessage,
        alternate_greetings: card.alternateGreetings,
        group_only_greetings: [],
        tags: card.tags,
        creator: card.creator,
        creator_notes: card.creatorNotes,
        character_version: '',
        creation_date: card.creationDate,
        modification_date: card.modificationDate,
        source: [],
        extensions: {},
    }
    if (assets.length > 0) {
        data.assets = assets
    }
    if (entries.length > 0) {
        data.character_book = { entries, extensions: {} }
    }
    return { spec: 'chara_card_v3', spec_version: '3.0', data }
}
