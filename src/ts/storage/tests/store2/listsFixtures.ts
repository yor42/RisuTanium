import type { Database } from '../../database.svelte'
import { assetRefKey, hexStemToBase64url, splitHashStems, type AssetList } from '../../store2/format'

/**
 * Fixtures of the list tests: one owner per asset field kind, so a derivation
 * that forgets a kind fails exactly the case of that kind.
 */

export type Obj = Record<string, unknown>

export function asDatabase(value: Obj): Database {
    return value as unknown as Database
}

export const HEX_A = 'a'.repeat(63) + '1'
export const HEX_B = 'b'.repeat(63) + '2'
export const HEX_C = 'c'.repeat(63) + '3'
export const HEX_D = 'd'.repeat(63) + '4'
export const HEX_E = 'e'.repeat(63) + '5'
export const HEX_F = 'f'.repeat(63) + '6'
export const HEX_G = '0123456789abcdef'.repeat(4)
export const HEX_H = 'fedcba9876543210'.repeat(4)
export const HEX_I = '1111222233334444'.repeat(4)
export const HEX_J = '5555666677778888'.repeat(4)
export const HEX_K = '9999aaaabbbbcccc'.repeat(4)
export const HEX_L = 'ddddeeeeffff0000'.repeat(4)

export const UUID_A = '0a1b2c3d-1111-4222-8333-444455556666'
export const UUID_B = 'f0e1d2c3-aaaa-4bbb-8ccc-ddddeeeeffff'

export interface AssetKind {
    /** Name of the getter field the kind stands for. */
    kind: string
    scope: 'character' | 'module' | 'config'
    /** An owner that holds one asset, only in this kind's field. */
    owner: (name: string) => Obj
    /** Whether the getter's reference name is reported in this exact form. */
    name: string
}

const upperPng = (hex: string) => `assets/${hex.toUpperCase()}.PNG`

export const ASSET_KINDS: AssetKind[] = [
    { kind: 'character.image', scope: 'character', name: upperPng(HEX_A), owner: n => ({ image: n }) },
    { kind: 'character.emotionImages', scope: 'character', name: `assets/${HEX_B}.webp`, owner: n => ({ emotionImages: [['happy', n]] }) },
    { kind: 'character.additionalAssets', scope: 'character', name: `assets\\${HEX_C}.Mp3`, owner: n => ({ additionalAssets: [['bgm', n, 'mp3']] }) },
    { kind: 'character.vits.files', scope: 'character', name: 'Custom-Voice-ID.WAV', owner: n => ({ vits: { files: { a: n } } }) },
    { kind: 'character.gptSoVitsConfig', scope: 'character', name: 'RefAudio_Custom.OGG', owner: n => ({ gptSoVitsConfig: { ref_audio_data: { assetId: n } } }) },
    { kind: 'character.ccAssets', scope: 'character', name: `assets/${HEX_D}.PnG`, owner: n => ({ ccAssets: [{ uri: n }] }) },
    { kind: 'module.assets', scope: 'module', name: `assets/${HEX_E}.jpg`, owner: n => ({ assets: [['x', n]] }) },
    { kind: 'module.icon', scope: 'module', name: 'ModuleIcon.GIF', owner: n => ({ icon: n }) },
    { kind: 'config.customBackground', scope: 'config', name: upperPng(HEX_F), owner: n => ({ customBackground: n }) },
    { kind: 'config.userIcon', scope: 'config', name: 'UserIcon.PNG', owner: n => ({ userIcon: n }) },
    { kind: 'config.NAIImgConfig.image', scope: 'config', name: `assets/${HEX_G}.png`, owner: n => ({ NAIImgConfig: { image: n } }) },
    { kind: 'config.NAIImgConfig.character_image', scope: 'config', name: `assets/${HEX_H}.png`, owner: n => ({ NAIImgConfig: { character_image: n } }) },
    { kind: 'config.wavespeedImage', scope: 'config', name: 'Wave_Ref.JPG', owner: n => ({ wavespeedImage: { reference_image: n } }) },
    { kind: 'config.personas.icon', scope: 'config', name: `assets/${HEX_I}.png`, owner: n => ({ personas: [{ icon: n }] }) },
    { kind: 'config.personas.embeddedModule.assets', scope: 'config', name: 'Embedded-Asset.PNG', owner: n => ({ personas: [{ embeddedModule: { assets: [['y', n]] } }] }) },
    { kind: 'config.personas.embeddedModule.icon', scope: 'config', name: `assets/${HEX_J}.png`, owner: n => ({ personas: [{ embeddedModule: { icon: n } }] }) },
]

/** The character-order folder image is a config-level kind held outside the config object. */
export const ORDER_KIND = { kind: 'characterOrder.imgFile', name: `assets/${HEX_K}.png` }

/** A database holding every asset kind at once, for comparison with today's getter. */
export function richDatabase(): Obj {
    const merged = (scope: AssetKind['scope']): Obj => {
        const out: Obj = {}
        for (const kind of ASSET_KINDS.filter(k => k.scope === scope)) {
            const owner = kind.owner(kind.name)
            for (const key of Object.keys(owner)) {
                const value = owner[key]
                const existing = out[key]
                if (Array.isArray(value) && Array.isArray(existing)) {
                    out[key] = [...existing, ...value]
                } else if (typeof value === 'object' && value !== null && !Array.isArray(value) && typeof existing === 'object' && existing !== null) {
                    out[key] = { ...(existing as Obj), ...(value as Obj) }
                } else {
                    out[key] = value
                }
            }
        }
        return out
    }
    return {
        ...merged('config'),
        characterOrder: [{ imgFile: ORDER_KIND.name, data: [] }, 'chaA'],
        characters: [{ chaId: 'chaA', type: 'character', ...merged('character') }],
        modules: [{ id: 'm1', ...merged('module') }],
    }
}

/** Whether a derived list holds the asset `name`, by the same comparison key the sweep uses. */
export function listHolds(list: Pick<AssetList, 'h' | 'l'>, name: string): boolean {
    const key = assetRefKey(name.replace(/\\/g, '/'))
    if (/^[0-9a-f]{64}$/.test(key)) {
        return splitHashStems(list.h).includes(hexStemToBase64url(key))
    }
    return list.l.includes(key)
}

export function inlayToken(id: string): string {
    return `{{inlay::${id}}}`
}

export function chatWith(text: string): Obj {
    return { id: 'c1', name: 'chat', message: [{ role: 'user', data: text }] }
}

/** The value of a parsed unit body; a damaged or unreadable parse fails the test. */
export function parsedValue<T>(parsed: { value: T } | { status: string }): T {
    if ('value' in parsed) {
        return parsed.value
    }
    throw new Error('The unit body did not parse: ' + parsed.status)
}
