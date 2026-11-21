import { encode as encodeMsgpack, decode as decodeMsgpack } from 'msgpackr/index-no-eval'
import * as fflate from 'fflate'
import { language } from '../../lang'
import { fillLang } from '../../lang/fill'
import { alertError, alertNormal } from '../alert'
import { askPrompt } from '../alertPrompts'
import { downloadNotice } from '../exportNotice'
import { downloadFile } from '../globalApi.svelte'
import { encodeRPack } from '../rpack/rpack_js'
import { decryptBuffer, encryptBuffer } from '../util'
import { getDatabase, saveCurrentPreset, type Database } from './database.svelte'
import {
    MAX_BUNDLE_PRESETS,
    PRESET_BUNDLE_TYPE,
    PresetBundleError,
    buildPresetBundlePayload,
    commitPresetBundle,
    parsePresetBundleAnswer,
    parsePresetBundlePayload,
    type PresetBundleIntake,
    type PresetBundlePayload,
} from './presetBundle'

/** The envelope keeps `presetVersion` at 2: a value of 3 or more reads as a NovelAI preset in `importPreset`. */
const BUNDLE_ENVELOPE_VERSION = 2

/** The `.risup` bytes of a bundle: the single-preset container with the payload under `bundle`. */
export async function encodePresetBundle(payload: PresetBundlePayload): Promise<Uint8Array> {
    const compressed = fflate.compressSync(encodeMsgpack({
        presetVersion: BUNDLE_ENVELOPE_VERSION,
        type: PRESET_BUNDLE_TYPE,
        bundle: await encryptBuffer(encodeMsgpack(payload), 'risupreset'),
    }))
    return await encodeRPack(compressed)
}

/** The untrusted payload inside a decoded envelope. A damaged or foreign `bundle` field is the invalid-bundle refusal. */
export async function decodePresetBundleEnvelope(decoded: { bundle?: unknown }): Promise<unknown> {
    const bundle = decoded.bundle
    if (!(bundle instanceof Uint8Array)) {
        throw new PresetBundleError(language.errors.presetBundleInvalid)
    }
    try {
        return decodeMsgpack(Buffer.from(await decryptBuffer(bundle, 'risupreset')))
    } catch {
        throw new PresetBundleError(language.errors.presetBundleInvalid)
    }
}

type BundleDb = Pick<Database, 'botPresets' | 'presetFolders'>

/**
 * Imports a decoded bundle envelope: validates the whole payload, shows the preview, and on an answer adds the ticked
 * presets through `intake`. Returns `{cancelled: true}` when nothing was imported by the person's choice. `getDb` is
 * read after the answer, never before the preview.
 */
export async function importPresetBundle(
    decoded: { bundle?: unknown },
    intake: PresetBundleIntake,
    getDb: () => BundleDb,
): Promise<{ cancelled: true } | void> {
    const parsed = parsePresetBundlePayload(await decodePresetBundleEnvelope(decoded))
    const existingNames = (getDb().botPresets ?? [])
        .map((p) => p?.name)
        .filter((name): name is string => typeof name === 'string')
    const answer = await askPrompt({
        type: 'presetBundle',
        msg: '',
        presetBundle: {
            rows: parsed.rows.map((row) => ({ name: row.name, folder: row.folder, aiModel: row.aiModel })),
            existingNames,
        },
    })
    const indices = parsePresetBundleAnswer(answer, parsed.rows.length)
    if (indices === null) {
        return { cancelled: true }
    }
    const ticked = parsed.rows.map((_, i) => indices.includes(i))
    await commitPresetBundle(getDb, parsed, ticked, intake)
}

/** `<folder>_presets.risup` when every exported preset sits in one folder, otherwise `RisuTanium_presets.risup`. */
export function bundleFileName(payload: PresetBundlePayload): string {
    const folders = payload.presets.map((entry) => entry.folder)
    const first = folders[0]
    const stem = first !== undefined && folders.every((folder) => folder === first) ? first : 'RisuTanium'
    return `${stem}_presets.risup`
}

/**
 * Exports the presets with these ids, in list order, as one bundle. Nothing happens for an empty selection. The notice
 * that keys and endpoint URLs were left out comes after the file is saved, as for a single export.
 */
export async function downloadPresetBundle(ids: readonly string[]): Promise<void> {
    saveCurrentPreset()
    const db = getDatabase()
    const wanted = new Set(ids)
    const presets = db.botPresets.filter((p) => typeof p?.id === 'string' && wanted.has(p.id))
    if (presets.length === 0) {
        return
    }
    if (presets.length > MAX_BUNDLE_PRESETS) {
        alertError(fillLang(language.errors.presetBundleTooMany, { max: MAX_BUNDLE_PRESETS }))
        return
    }
    const payload = buildPresetBundlePayload(db, presets)
    const saved = await downloadFile(bundleFileName(payload), await encodePresetBundle(payload))
    if (!saved) {
        return
    }
    alertNormal(downloadNotice(language.successExport) + '\n\n' + language.shareExportKeysLeftOut)
}
