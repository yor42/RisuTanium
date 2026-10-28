/**
 * The card shapes that carry no spec: TavernAI v1 (`name`, `description`, `first_mes`, ...), Pygmalion (`char_name`,
 * `char_persona`, `char_greeting`, ...) and a v2 wrapper (`spec_version: '2.0'` with a `data` object) that lacks `spec`.
 * One reader decides whether a parsed JSON value is such a card and what it carries; the importers build the character
 * from the result, so the JSON and the PNG route agree on what a card is.
 */

/** What an old card carries. Every text field is a string (empty when the card has none); only the name is required. */
export type OldCardFields = {
    name: string
    desc: string
    personality: string
    scenario: string
    firstMessage: string
    exampleMessage: string
    creatorNotes: string
    creator: string
    tags: string[]
    /** From a v2 wrapper's `data` only. */
    systemPrompt: string
    postHistoryInstructions: string
    /** A v2 wrapper's `character_book` as given; its validity is decided by the conversion. */
    characterBook: unknown
}

type TextFields = Pick<OldCardFields, 'desc' | 'personality' | 'scenario' | 'firstMessage' | 'exampleMessage' | 'creatorNotes' | 'creator' | 'tags'>

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isName(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== ''
}

function textOf(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

function tagsOf(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : []
}

/**
 * A card with a `name` is TavernAI v1 and its `char_` keys are ignored. Otherwise a Pygmalion key is taken when it holds
 * text, and the v1 key stands in when it does not, so a card that mixes both keeps what each carries.
 */
function textFieldsOf(body: Record<string, unknown>): TextFields {
    const pygmalion = !isName(body.name)
    const pick = (pygmalionKey: string, v1Key: string): string => {
        const preferred = pygmalion ? textOf(body[pygmalionKey]) : ''
        return preferred !== '' ? preferred : textOf(body[v1Key])
    }
    const creatorNotes = pygmalion && textOf(body.creator_notes) !== '' ? textOf(body.creator_notes) : pygmalion ? textOf(body.creatorcomment) : ''
    return {
        desc: pick('char_persona', 'description'),
        personality: textOf(body.personality),
        scenario: pick('world_scenario', 'scenario'),
        firstMessage: pick('char_greeting', 'first_mes'),
        exampleMessage: pick('example_dialogue', 'mes_example'),
        creatorNotes,
        creator: pygmalion ? textOf(body.creator) : '',
        tags: pygmalion ? tagsOf(body.tags) : [],
    }
}

function nameOf(body: Record<string, unknown>): string | null {
    if (isName(body.name)) {
        return body.name
    }
    return isName(body.char_name) ? body.char_name : null
}

/** `primary`'s value where it holds one, else `fallback`'s. */
function fill(primary: TextFields, fallback: TextFields): TextFields {
    return {
        desc: primary.desc !== '' ? primary.desc : fallback.desc,
        personality: primary.personality !== '' ? primary.personality : fallback.personality,
        scenario: primary.scenario !== '' ? primary.scenario : fallback.scenario,
        firstMessage: primary.firstMessage !== '' ? primary.firstMessage : fallback.firstMessage,
        exampleMessage: primary.exampleMessage !== '' ? primary.exampleMessage : fallback.exampleMessage,
        creatorNotes: primary.creatorNotes !== '' ? primary.creatorNotes : fallback.creatorNotes,
        creator: primary.creator !== '' ? primary.creator : fallback.creator,
        tags: primary.tags.length > 0 ? primary.tags : fallback.tags,
    }
}

/**
 * Reads a parsed JSON value as an old card; null when it is not one. A card needs a name (text that is not blank, under
 * `name` or `char_name`) and nothing else. A v2 wrapper is read through its `data`; when `data` gives no name the top
 * level supplies it, and fills every text field `data` leaves empty. The input is not changed.
 */
export function readOldCard(value: unknown): OldCardFields | null {
    if (!isObject(value)) {
        return null
    }
    const data = value.spec_version === '2.0' && isObject(value.data) ? value.data : null
    const extras = {
        systemPrompt: data ? textOf(data.system_prompt) : '',
        postHistoryInstructions: data ? textOf(data.post_history_instructions) : '',
        characterBook: data?.character_book ?? null,
    }
    const dataName = data ? nameOf(data) : null
    if (data && dataName !== null) {
        return { name: dataName, ...textFieldsOf(data), ...extras }
    }
    const topName = nameOf(value)
    if (topName === null) {
        return null
    }
    const top = textFieldsOf(value)
    return { name: topName, ...(data ? fill(textFieldsOf(data), top) : top), ...extras }
}
