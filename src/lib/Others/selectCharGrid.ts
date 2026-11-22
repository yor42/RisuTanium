import { isHiddenSystemCharacter } from '../../ts/hiddenCharacters'

interface PickableFields {
    type?: string
    trashTime?: number
    chaId?: string
}

/**
 * The positions in `characters` that the selectChar dialog offers, in array order: every character
 * that is not a group, not in the trash and not a hidden system character.
 */
export function pickableCharacterPositions(characters: readonly (PickableFields | null | undefined)[]): number[] {
    const positions: number[] = []
    characters.forEach((char, i) => {
        if (char && char.type !== 'group' && !char.trashTime && !isHiddenSystemCharacter(char)) {
            positions.push(i)
        }
    })
    return positions
}

export interface SelectCharRow {
    /** Unique among the rows of one call: the column count and the first position of the row. */
    key: string
    positions: number[]
}

/**
 * `positions` cut into rows of `columns` cards, in order; the last row may be shorter.
 * A key changes when the column count changes, so a row measured at one width is never
 * reused at another.
 */
export function selectCharRows(positions: readonly number[], columns: number): SelectCharRow[] {
    const perRow = Math.max(1, Math.floor(columns))
    const rows: SelectCharRow[] = []
    for (let start = 0; start < positions.length; start += perRow) {
        const slice = positions.slice(start, start + perRow)
        rows.push({ key: JSON.stringify([perRow, slice[0]]), positions: slice })
    }
    return rows
}

/**
 * The number of tracks in a computed `grid-template-columns` value (`"112px 112px 112px"` is 3),
 * or 0 when the element is not laid out as a grid (`none`, empty).
 */
export function gridTrackCount(template: string): number {
    const value = template.trim()
    if (value === '' || value === 'none') {
        return 0
    }
    return value.split(/\s+/).length
}
