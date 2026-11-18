import type { Database } from '../../database.svelte'

/**
 * The database of the sweep parity tests: every owner kind that refers to a stored asset, written the way the application
 * writes it, each on an owner that a stored tree holds (a character, a trashed character, a group, a module, a persona with
 * its embedded module, the config root, the loadouts, the installed theme packs, the character-order folder image). The
 * tests commit it through the real encoder and the real list derivation, so a stored owner lists exactly the assets the
 * codec derives from it, and read it back with the resident database empty: the keep-set of the sweep must hold what
 * `getUncleanablesSync` keeps for the same database.
 */

/** A stored asset name of the hashed form the application's `saveAsset` makes. */
function hashed(seed: string, extension: string): string {
    return `${seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64)}.${extension}`
}

/** One asset name per field kind, as the field holds it (`assets/<name>`, or a custom id) and as the store keys it. */
export interface ParityAsset {
    kind: string
    /** The value the owner's field holds. */
    ref: string
    /** The basename the store holds it under (`assets/<name>`). */
    name: string
}

function asset(kind: string, name: string, prefix = 'assets/'): ParityAsset {
    return { kind, ref: `${prefix}${name}`, name }
}

export const PARITY_ASSETS = {
    characterImage: asset('character.image', hashed('0a1b2c3d', 'png')),
    emotion: asset('character.emotionImages', hashed('1b2c3d4e', 'webp')),
    additional: asset('character.additionalAssets', hashed('2c3d4e5f', 'mp3')),
    vits: asset('character.vits.files', 'Custom-Voice-ID.WAV', ''),
    gptSoVits: asset('character.gptSoVitsConfig', 'RefAudio_Custom.OGG', ''),
    cc: asset('character.ccAssets', hashed('3d4e5f60', 'png')),
    characterRetained: asset('character.retained', hashed('4e5f6071', 'png')),
    trashedImage: asset('trashed character.image', hashed('5f607182', 'png')),
    groupAdditional: asset('group.additionalAssets', hashed('60718293', 'mp3')),
    groupRetained: asset('group.retained', hashed('718293a4', 'png')),
    moduleAsset: asset('module.assets', hashed('8293a4b5', 'png')),
    moduleIcon: asset('module.icon', 'ModuleIcon.GIF', ''),
    moduleRetained: asset('module.retained', hashed('93a4b5c6', 'png')),
    personaIcon: asset('persona.icon', hashed('a4b5c6d7', 'png')),
    personaModuleAsset: asset('persona.embeddedModule.assets', 'Embedded-Asset.PNG', ''),
    personaModuleIcon: asset('persona.embeddedModule.icon', hashed('b5c6d7e8', 'png')),
    personaModuleRetained: asset('persona.embeddedModule.retained', hashed('c6d7e8f9', 'png')),
    background: asset('customBackground', hashed('d7e8f90a', 'png')),
    userIcon: asset('userIcon', 'UserIcon.PNG', ''),
    naiImage: asset('NAIImgConfig.image', hashed('e8f90a1b', 'png')),
    naiCharacter: asset('NAIImgConfig.character_image', hashed('f90a1b2c', 'png')),
    wavespeed: asset('wavespeedImage.reference_image', 'Wave_Ref.JPG', ''),
    folderImage: asset('characterOrder.imgFile', hashed('0a1b2c3e', 'png')),
    themePack: { kind: 'themePacks', ref: `assets/tp-${'a1b2c3d4'.repeat(8)}.risutheme`, name: `tp-${'a1b2c3d4'.repeat(8)}.risutheme` },
    loadoutIcon: asset('loadouts.icons', hashed('1b2c3e4f', 'png')),
} satisfies Record<string, ParityAsset>

/** Assets nothing in the database refers to. */
export const PARITY_ORPHANS = ['orphan-one.png', 'orphan-two.webp', hashed('deadbeef', 'png')]

export function parityLoadoutIcons(): string[] {
    return [PARITY_ASSETS.loadoutIcon.ref]
}

function chatsOf(chaId: string): unknown[] {
    return [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }]
}

const A = PARITY_ASSETS

/** The whole database, as the page would hold it before the encoder splits it. */
export function parityDatabase(): Database {
    const db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [{ name: 'test-preset' }],
        plugins: [],
        pluginCustomStorage: {},
        mainPrompt: 'parity',
        customBackground: A.background.ref,
        userIcon: A.userIcon.ref,
        NAIImgConfig: { image: A.naiImage.ref, character_image: A.naiCharacter.ref },
        wavespeedImage: { reference_image: A.wavespeed.ref },
        themePacks: [{ id: 'pack-one', version: 1, archive: A.themePack.ref }],
        loadouts: [{ id: 'loadout-one', icons: parityLoadoutIcons() }],
        characterOrder: [{ imgFile: A.folderImage.ref, data: [], name: 'folder' }, 'cha-main', 'cha-trashed', 'grp-main'],
        characters: [
            {
                chaId: 'cha-main', name: 'cha-main', type: 'character', chatPage: 0, chats: chatsOf('cha-main'),
                image: A.characterImage.ref,
                emotionImages: [['happy', A.emotion.ref]],
                additionalAssets: [['bgm', A.additional.ref, 'mp3']],
                vits: { files: { a: A.vits.ref } },
                gptSoVitsConfig: { ref_audio_data: { assetId: A.gptSoVits.ref } },
                ccAssets: [{ name: 'icon', uri: A.cc.ref, ext: 'png', type: 'icon' }],
                risutanium_asset_retained: [['previous', A.characterRetained.ref]],
            },
            {
                chaId: 'cha-trashed', name: 'cha-trashed', type: 'character', chatPage: 0, chats: chatsOf('cha-trashed'),
                image: A.trashedImage.ref, trashTime: 1_700_000_000_000,
            },
            {
                chaId: 'grp-main', name: 'grp-main', type: 'group', chatPage: 0, chats: chatsOf('grp-main'), characters: [],
                additionalAssets: [['bgm', A.groupAdditional.ref, 'mp3']],
                risutanium_asset_retained: [['previous', A.groupRetained.ref]],
            },
        ],
        modules: [{
            id: 'module-one', name: 'module-one',
            assets: [['x', A.moduleAsset.ref, 'png']],
            icon: A.moduleIcon.ref,
            risutanium_asset_retained: [['previous', A.moduleRetained.ref]],
        }],
        personas: [{
            id: 'persona-one', name: 'persona-one', personaPrompt: '', note: '',
            icon: A.personaIcon.ref,
            embeddedModule: {
                id: 'persona-module', name: 'persona-module',
                assets: [['y', A.personaModuleAsset.ref, 'png']],
                icon: A.personaModuleIcon.ref,
                risutanium_asset_retained: [['previous', A.personaModuleRetained.ref]],
            },
        }],
    }
    return db as unknown as Database
}

/** The store key of an asset the database holds under the name `ref`. */
export function assetBasename(ref: string): string {
    return ref.split(/[\\/]/).pop() as string
}
