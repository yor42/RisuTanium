// The manifest.json of a theme pack (format 1): the discriminator, the version gate and the display and licence fields.
// Every field is read by name from an own property and written by name into the result; nothing is spread or copied
// wholesale from the parsed JSON.
export type PackMode = 'light' | 'dark'
export interface PackFontLicense { readonly file: string; readonly license: string; readonly attribution?: string }
export interface PackManifest {
    readonly format: 1
    /**
     * The manifest's optional author pack id (JSON key "id"), the Replace? key. A required key whose value is undefined
     * when the manifest has no "id": the installer's input type declares the same required key, so renaming it on either
     * side is a compile error at the pass-through.
     */
    readonly packId: string | undefined
    readonly name: string
    readonly version: string
    readonly license: string
    readonly attribution: string
    readonly modes: readonly PackMode[]
    readonly fonts: readonly PackFontLicense[]
}
export type ManifestRefusal =
    | { code: 'manifestUnreadable' }
    | { code: 'notThisKind' }
    | { code: 'newerFormat' }
    | { code: 'manifestField'; field: string }
export type ManifestResult = { ok: true; manifest: PackManifest } | { ok: false; refusal: ManifestRefusal }

export const MANIFEST_LIMITS = { name: 80, version: 32, license: 4000, attribution: 4000, fonts: 512 } as const
export const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/
/** Characters `name` and `version` may not hold: C0 and C1 controls (DEL included), U+2028, U+2029, and the bidi embedding, override and isolate characters. */
export const DISPLAY_FIELD_FORBIDDEN = /[\u{0}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u

type Refusal = { ok: false; refusal: ManifestRefusal }

function field(name: string): Refusal {
    return { ok: false, refusal: { code: 'manifestField', field: name } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function own(record: Record<string, unknown>, key: string): unknown {
    return Object.hasOwn(record, key) ? record[key] : undefined
}

/** A non-blank string within `limit` UTF-16 units; `display` also refuses the display-field characters. */
function textField(value: unknown, limit: number, display: boolean): string | null {
    if (typeof value !== 'string' || value.trim() === '' || value.length > limit) {
        return null
    }
    if (display && DISPLAY_FIELD_FORBIDDEN.test(value)) {
        return null
    }
    return value
}

/** Parses manifest text (already UTF-8 decoded); reads every field explicitly, never spreads, and writes every PackManifest member (packId included). */
export function parseManifest(text: string): ManifestResult {
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return { ok: false, refusal: { code: 'manifestUnreadable' } }
    }
    if (!isRecord(parsed)) {
        return { ok: false, refusal: { code: 'manifestUnreadable' } }
    }
    if (own(parsed, 'kind') !== 'risutheme') {
        return { ok: false, refusal: { code: 'notThisKind' } }
    }
    const format = own(parsed, 'format')
    if (typeof format !== 'number' || !Number.isSafeInteger(format) || format < 1) {
        return field('format')
    }
    if (format > 1) {
        return { ok: false, refusal: { code: 'newerFormat' } }
    }
    const idValue = own(parsed, 'id')
    let packId: string | undefined
    if (Object.hasOwn(parsed, 'id')) {
        if (typeof idValue !== 'string' || !PACK_ID_PATTERN.test(idValue)) {
            return field('id')
        }
        packId = idValue
    }
    const name = textField(own(parsed, 'name'), MANIFEST_LIMITS.name, true)
    if (name === null) return field('name')
    const version = textField(own(parsed, 'version'), MANIFEST_LIMITS.version, true)
    if (version === null) return field('version')
    const license = textField(own(parsed, 'license'), MANIFEST_LIMITS.license, false)
    if (license === null) return field('license')
    const attribution = textField(own(parsed, 'attribution'), MANIFEST_LIMITS.attribution, false)
    if (attribution === null) return field('attribution')

    const modesValue = own(parsed, 'modes')
    if (!Array.isArray(modesValue) || modesValue.length === 0) {
        return field('modes')
    }
    const modes: PackMode[] = []
    for (const mode of modesValue) {
        if ((mode !== 'light' && mode !== 'dark') || modes.includes(mode)) {
            return field('modes')
        }
        modes.push(mode)
    }

    const fontsValue = own(parsed, 'fonts')
    const fonts: PackFontLicense[] = []
    if (fontsValue !== undefined) {
        if (!Array.isArray(fontsValue) || fontsValue.length > MANIFEST_LIMITS.fonts) {
            return field('fonts')
        }
        for (let i = 0; i < fontsValue.length; i++) {
            const member: unknown = fontsValue[i]
            if (!isRecord(member)) {
                return field(`fonts[${i}]`)
            }
            const file = own(member, 'file')
            if (typeof file !== 'string') {
                return field(`fonts[${i}].file`)
            }
            const fontLicense = textField(own(member, 'license'), MANIFEST_LIMITS.license, false)
            if (fontLicense === null) {
                return field(`fonts[${i}].license`)
            }
            if (Object.hasOwn(member, 'attribution')) {
                const fontAttribution = textField(own(member, 'attribution'), MANIFEST_LIMITS.attribution, false)
                if (fontAttribution === null) {
                    return field(`fonts[${i}].attribution`)
                }
                fonts.push({ file, license: fontLicense, attribution: fontAttribution })
            } else {
                fonts.push({ file, license: fontLicense })
            }
        }
    }
    return { ok: true, manifest: { format: 1, packId, name, version, license, attribution, modes, fonts } }
}
