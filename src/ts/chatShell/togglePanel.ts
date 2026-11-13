import { parseToggleSyntax, type sidebarToggle } from '../util'

/**
 * The toggles panel model (TOGGLES_SPEC §3-§4): the toggle text of each source (the active prompt, every module in
 * use, the character) is parsed on its own, so the source of a toggle is kept and an unclosed group ends with its
 * source. Pure: values come in through a reader, and nothing here writes.
 *
 * Meaning of a value, as the old sidebar stored it in `toggle_<key>`: a check is '1' or '0', a select holds the option
 * index, a text holds the string, and an unset value reads 'null'. The panel claims only "on", never "changed"
 * (DD-083): there is no author default to compare with.
 */

export type ToggleKind = 'check' | 'select' | 'text' | 'textarea'
export type PanelSourceKind = 'prompt' | 'module' | 'character'

export type PanelValueRow = { type: 'row', uid: string, key: string, label: string, kind: ToggleKind, options: string[] }
export type PanelCaption = { type: 'caption', uid: string, label: string }
export type PanelDivider = { type: 'divider', uid: string, label: string }
export type PanelGroupItem = PanelValueRow | PanelCaption | PanelDivider
export type PanelGroup = { type: 'group', uid: string, label: string, children: PanelGroupItem[] }
export type PanelItem = PanelGroupItem | PanelGroup

export type PanelSource = { id: string, kind: PanelSourceKind, name: string, detail: string, items: PanelItem[] }
export type PanelModel = { sources: PanelSource[] }

/**
 * What one source contributes: its identity, the name the panel shows for it, an optional muted detail (the preset or
 * character name) and its raw toggle text.
 */
export type SourceInput = { id: string, kind: PanelSourceKind, name: string, detail?: string, text: string | undefined }

/** The variable a toggle key is stored under. */
export const toggleVarKey = (key: string): string => `toggle_${key}`

function kindOf(toggle: sidebarToggle): ToggleKind {
    if (toggle.type === 'select' || toggle.type === 'text' || toggle.type === 'textarea') {
        return toggle.type
    }
    return 'check'
}

function itemsOf(sourceId: string, text: string | undefined): PanelItem[] {
    const items: PanelItem[] = []
    let open: PanelGroup | null = null
    let counter = 0
    const next = () => `${sourceId}#${counter++}`
    for (const toggle of parseToggleSyntax(text ?? '')) {
        if (toggle.type === 'group') {
            open = { type: 'group', uid: next(), label: toggle.value ?? toggle.key ?? '', children: [] }
            items.push(open)
            continue
        }
        if (toggle.type === 'groupEnd') {
            open = null
            continue
        }
        const target: PanelItem[] = open ? open.children : items
        if (toggle.type === 'caption') {
            target.push({ type: 'caption', uid: next(), label: toggle.value ?? '' })
        } else if (toggle.type === 'divider') {
            // A repeated divider with the same label is shown once, as the old sidebar did.
            const before = target.at(-1)
            if (!(before?.type === 'divider' && before.label === (toggle.value ?? ''))) {
                target.push({ type: 'divider', uid: next(), label: toggle.value ?? '' })
            }
        } else {
            target.push({ type: 'row', uid: next(), key: toggle.key, label: toggle.value, kind: kindOf(toggle), options: toggle.type === 'select' ? toggle.options : [] })
        }
    }
    // A group without a toggle in it is not shown, and a same-label divider that it separated is then adjacent to its twin: shown once.
    // Group children are never removed, so their own collapse at push time is already final.
    const shown: PanelItem[] = []
    for (const item of items) {
        if (item.type === 'group' && !item.children.some((child) => child.type === 'row')) {
            continue
        }
        const before = shown.at(-1)
        if (item.type === 'divider' && before?.type === 'divider' && before.label === item.label) {
            continue
        }
        shown.push(item)
    }
    return shown
}

/** Each source parsed on its own; a source whose text holds nothing still appears with no items (callers hide it). */
export function buildPanelModel(inputs: readonly SourceInput[]): PanelModel {
    return { sources: inputs.map((input) => ({ id: input.id, kind: input.kind, name: input.name, detail: input.detail ?? '', items: itemsOf(input.id, input.text) })) }
}

/** The value rows of a source in display order, the ones inside author groups included. */
export function valueRowsOf(source: PanelSource): PanelValueRow[] {
    const rows: PanelValueRow[] = []
    for (const item of source.items) {
        if (item.type === 'row') {
            rows.push(item)
        } else if (item.type === 'group') {
            for (const child of item.children) {
                if (child.type === 'row') {
                    rows.push(child)
                }
            }
        }
    }
    return rows
}

/** `toggle_<key>` of every distinct key of the panel, in display order; the scope engine's key source reads the same texts. */
export function panelKeys(model: PanelModel): string[] {
    const keys = new Set<string>()
    for (const source of model.sources) {
        for (const row of valueRowsOf(source)) {
            keys.add(toggleVarKey(row.key))
        }
    }
    return Array.from(keys)
}

/** Whether a toggle of `kind` with stored `value` is on. 'null' and '' are off for every kind; a select at index 0 is off. */
export function isOn(kind: ToggleKind, value: string): boolean {
    if (kind === 'check') {
        return value === '1'
    }
    if (kind === 'select') {
        return value !== '' && value !== 'null' && value !== '0'
    }
    return value !== '' && value !== 'null'
}

/** The value a Reset writes: off, the first option, or empty. It is not an author default. */
export function resetValue(kind: ToggleKind): string {
    return kind === 'check' ? '0' : kind === 'select' ? '0' : ''
}

/** The shown option of a select: the stored index when it is in range, else the first. */
export function selectedIndex(value: string, options: readonly string[]): number {
    const index = Number(value)
    return Number.isInteger(index) && index >= 0 && index < options.length && value.trim() !== '' ? index : 0
}

/** The text a text row shows: the stored string, with the unset marker read as empty. */
export function shownText(value: string): string {
    return value === 'null' ? '' : value
}

export type Counts = { n: number, on: number }

/** Counts of the rows of one source (group rows included), each row counted on its own. */
export function sourceCounts(source: PanelSource, valueOf: (key: string) => string): Counts {
    const rows = valueRowsOf(source)
    return { n: rows.length, on: rows.filter((row) => isOn(row.kind, valueOf(row.key))).length }
}

/** Counts of distinct keys over the whole panel: a key defined by two sources counts once, by its first definition. */
export function uniqueCounts(model: PanelModel, valueOf: (key: string) => string): Counts {
    const first = new Map<string, PanelValueRow>()
    for (const source of model.sources) {
        for (const row of valueRowsOf(source)) {
            if (!first.has(row.key)) {
                first.set(row.key, row)
            }
        }
    }
    let on = 0
    for (const [key, row] of first) {
        if (isOn(row.kind, valueOf(key))) {
            on++
        }
    }
    return { n: first.size, on }
}

const DEFAULT_OPEN_ALL_UP_TO = 20
const DEFAULT_OPEN_ROW_CAP = 25

/**
 * The sections that start open (DD-084, DD-085). With up to 20 toggles in all, every section. Above that the first
 * section, then each section that has a toggle on, in order, while fewer than about 25 rows show; rows inside author
 * groups do not count because groups start folded. The caller computes it once when the panel opens and keeps it.
 */
export function defaultOpenSections(model: PanelModel, valueOf: (key: string) => string): Set<string> {
    const open = new Set<string>()
    const total = model.sources.reduce((sum, source) => sum + valueRowsOf(source).length, 0)
    if (total <= DEFAULT_OPEN_ALL_UP_TO) {
        for (const source of model.sources) {
            open.add(source.id)
        }
        return open
    }
    let shown = 0
    model.sources.forEach((source, index) => {
        const hasOn = valueRowsOf(source).some((row) => isOn(row.kind, valueOf(row.key)))
        if ((index === 0 || hasOn) && shown < DEFAULT_OPEN_ROW_CAP) {
            open.add(source.id)
            shown += source.items.filter((item) => item.type === 'row').length
        }
    })
    return open
}

export type DuplicateBadge = { sourceName: string, mismatch: boolean }

/** Control classes that share a variable meaningfully: a text and a textarea are the same kind, a check and a select are not. */
const sameVariableKind = (kind: ToggleKind): string => (kind === 'textarea' ? 'text' : kind)

/** The other sources that define `row.key`, each marked as a kind mismatch or a shared value. */
export function duplicateBadges(model: PanelModel, sourceId: string, row: PanelValueRow): DuplicateBadge[] {
    const badges: DuplicateBadge[] = []
    for (const source of model.sources) {
        if (source.id === sourceId) {
            continue
        }
        const other = valueRowsOf(source).find((candidate) => candidate.key === row.key)
        if (other) {
            badges.push({ sourceName: source.name, mismatch: sameVariableKind(other.kind) !== sameVariableKind(row.kind) })
        }
    }
    return badges
}

export type SelectControl = 'inline' | 'stacked' | 'list'

// Width in "narrow characters": Hangul, kana and CJK count 1.5, so the limits hold in either script whatever the UI language.
function weight(text: string): number {
    let total = 0
    for (const char of text) {
        total += /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-鿿가-힯＀-￯]/.test(char) ? 1.5 : 1
    }
    return total
}

/**
 * How a select row is drawn (TOGGLES §4): two short options on the label's line, two or three short options under the
 * label, anything else as a value that opens a list. Decided from the option text itself, never from the UI language.
 */
export function selectControl(label: string, options: readonly string[]): SelectControl {
    if (options.length < 2 || options.length > 3) {
        return 'list'
    }
    if (options.length === 2 && options.every((option) => weight(option) <= 7) && weight(label) <= 16) {
        return 'inline'
    }
    return options.every((option) => weight(option) <= 12) ? 'stacked' : 'list'
}

/**
 * The panel's memory for one app session: the section a user opened or folded is remembered per source and always wins
 * over the default, and the "saved to" flash is shown once.
 */
const sourceChoice = new Map<string, boolean>()
let savedFlashShown = false

export function sourceOpenChoice(sourceId: string): boolean | undefined {
    return sourceChoice.get(sourceId)
}

export function rememberSourceOpen(sourceId: string, open: boolean): void {
    sourceChoice.set(sourceId, open)
}

/** True the first time it is asked in a session, false afterwards. */
export function takeSavedFlash(): boolean {
    if (savedFlashShown) {
        return false
    }
    savedFlashShown = true
    return true
}

export function resetTogglePanelSession(): void {
    sourceChoice.clear()
    savedFlashShown = false
}
