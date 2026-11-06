// Streaming writer for the card JSON export.
//
// Invariant: the concatenation of the bytes written by streamCardJson equals
// Buffer.from(JSON.stringify(card, null, 4), 'utf-8') for the card with every
// slot's uri filled with the data-URI prefix plus the asset's base64.
//
// Preconditions of buildCardJsonTemplate:
// - the slot entries of the assets array are distinct objects (an object shared
//   by two slots would keep only the last placeholder);
// - a token candidate free of user text exists among the first
//   MAX_TOKEN_CANDIDATES candidates, otherwise the build throws.

export const CARD_JSON_URI_PREFIX = 'data:application/octet-stream;base64,'
export const DEFAULT_SLICE_BYTES = 3 * 1024 * 1024
const MAX_TOKEN_CANDIDATES = 64

export interface CardJsonAssetEntry {
    uri?: string
}

export interface CardJsonTemplate {
    // pieces.length === slotCount + 1; asset j's base64 goes between pieces[j] and pieces[j+1]
    pieces: string[]
}

function countOccurrences(text: string, token: string): number {
    let count = 0
    let from = text.indexOf(token)
    while (from !== -1) {
        count++
        from = text.indexOf(token, from + token.length)
    }
    return count
}

// `card` must already be a private clone: the slot entries are mutated in place so key order stays as it is.
export function buildCardJsonTemplate(
    card: object,
    assets: CardJsonAssetEntry[],
    slots: number[],
    maxCandidates: number = MAX_TOKEN_CANDIDATES
): CardJsonTemplate {
    const seen = new Set<object>()
    for (const index of slots) {
        const entry = assets[index]
        if (seen.has(entry)) {
            throw new Error('cardJsonStream: two slots share the same asset object')
        }
        seen.add(entry)
    }

    for (let candidate = 0; candidate < maxCandidates; candidate++) {
        const token = 'RISUJSONASSET' + candidate + 'Z'
        for (let j = 0; j < slots.length; j++) {
            assets[slots[j]].uri = CARD_JSON_URI_PREFIX + token + j + '_'
        }
        const text = JSON.stringify(card, null, 4)
        // The token cannot overlap itself (R occurs once), so a count of n means every occurrence is a placeholder.
        if (countOccurrences(text, token) !== slots.length) {
            continue
        }
        const split = text.split(token)
        const pieces: string[] = [split[0]]
        for (let j = 0; j < slots.length; j++) {
            const marker = j + '_'
            const part = split[j + 1]
            if (!part.startsWith(marker)) {
                throw new Error('cardJsonStream: placeholder order mismatch')
            }
            pieces.push(part.slice(marker.length))
        }
        return { pieces }
    }
    throw new Error('cardJsonStream: no collision-free placeholder token within ' + maxCandidates + ' candidates')
}

export async function streamCardJson(
    pieces: string[],
    produceAsset: (slot: number) => Promise<Uint8Array>,
    write: (chunk: Uint8Array) => Promise<void>,
    sliceBytes: number = DEFAULT_SLICE_BYTES
): Promise<void> {
    // Base64 of 3-aligned slices concatenates to the base64 of the whole.
    if (!Number.isInteger(sliceBytes) || sliceBytes <= 0 || sliceBytes % 3 !== 0) {
        throw new Error('cardJsonStream: slice size must be a positive multiple of 3')
    }
    const writeNonEmpty = async (chunk: Uint8Array) => {
        if (chunk.length > 0) {
            await write(chunk)
        }
    }
    await writeNonEmpty(Buffer.from(pieces[0], 'utf-8'))
    for (let slot = 0; slot < pieces.length - 1; slot++) {
        const bytes = await produceAsset(slot)
        for (let offset = 0; offset < bytes.length; offset += sliceBytes) {
            const slice = Buffer.from(bytes.subarray(offset, offset + sliceBytes))
            await writeNonEmpty(Buffer.from(slice.toString('base64'), 'ascii'))
        }
        await writeNonEmpty(Buffer.from(pieces[slot + 1], 'utf-8'))
    }
}
