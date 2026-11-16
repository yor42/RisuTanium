import { getDatabase, saveImage, setDatabase } from "./storage/database.svelte"
import { selectMultipleFile, selectSingleFile, selectSingleFileObject, sleep } from "./util"
import { alertClear, alertError, alertNormal, alertStore } from "./alert"
import { AppendableBuffer, downloadFile, pickedAssetLimitBytes, readImage, saveAssetFromBlob } from "./globalApi.svelte"
import { reportRefusedAssets } from "./storage/pickedAssetLimit"
import { language } from "src/lang"
import { downloadNotice } from "src/ts/exportNotice"
import { reencodeImage } from "./process/files/inlays"
import { PngChunk } from "./pngChunk"
import { v4 } from "uuid"
import { DBState } from "./stores.svelte"
import { beginBusy, type BusyHandle } from "./process/memory/busyActions"
import { postToast } from "./toast/toastHost.svelte"
import { adoptMirror } from "./personaList"
import { buildPersonaCard, hasEmptyExportField, parsePersonaCard, type ParsedPersonaCard, type PersonaCardSource } from "./personaCard"

/**
 * Picks a new image for one persona: the one with this id, or without an argument the one in use.
 * The target is captured before the picker opens and found again after the last await, so a
 * selection change during the pick cannot redirect the icon. The persona keeps its id; the mirror
 * is written only when the target is the one in use at the moment of the write.
 */
export async function selectUserImg(id?: string) {
    const target = id === undefined
        ? DBState.db.personas[DBState.db.selectedPersona]
        : DBState.db.personas.find((entry) => entry.id === id)
    if (!target) {
        return
    }
    const targetId = target.id
    const selected = await selectSingleFileObject(['png'])
    if (!selected) {
        return
    }
    const limit = await pickedAssetLimitBytes()
    if (selected.size > limit) {
        reportRefusedAssets([selected], limit)
        return
    }
    const busy = beginBusy('imageAdd')
    try {
        const imgp = await saveAssetFromBlob(selected)
        const index = typeof targetId === 'string' && targetId !== ''
            ? DBState.db.personas.findIndex((entry) => entry.id === targetId)
            : DBState.db.personas.indexOf(target)
        if (index < 0) {
            return
        }
        const entry = DBState.db.personas[index]
        entry.id ??= v4()
        if (index === DBState.db.selectedPersona) {
            adoptMirror(DBState.db)
            entry.icon = imgp
            DBState.db.userIcon = imgp
        } else {
            entry.icon = imgp
        }
    } finally {
        busy.end()
    }
}

export function saveUserPersona() {
    DBState.db.personas[DBState.db.selectedPersona].name = DBState.db.username
    DBState.db.personas[DBState.db.selectedPersona].icon = DBState.db.userIcon
    DBState.db.personas[DBState.db.selectedPersona].personaPrompt = DBState.db.personaPrompt
    DBState.db.personas[DBState.db.selectedPersona].note = DBState.db.userNote
}

export function changeUserPersona(id: number, save: 'save' | 'noSave' = 'save') {
    if (save === 'save') {
        saveUserPersona()
    }
    const pr = DBState.db.personas[id]
    DBState.db.personaPrompt = pr.personaPrompt
    DBState.db.username = pr.name
    DBState.db.userIcon = pr.icon
    DBState.db.userNote = pr.note
    DBState.db.selectedPersona = id
}

/** Exports the persona in use, built from the mirror plus the entry's large-portrait flag. */
export async function exportUserPersona() {
    const db = getDatabase({ snapshot: true })
    await exportPersona({
        name: db.username,
        personaPrompt: db.personaPrompt,
        icon: db.userIcon,
        note: db.userNote,
        largePortrait: db.personas?.[db.selectedPersona]?.largePortrait,
    })
}

/** Exports one persona as a PNG. An empty name or description is left out of the card and warned about. */
export async function exportPersona(p: PersonaCardSource) {
    if (hasEmptyExportField(p)) {
        postToast({ kind: 'warning', text: language.settingsShellPersonaExportEmpty })
    }

    let img: Uint8Array
    if (!p.icon) {
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 256
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'rgb(100, 116, 139)'
        ctx.fillRect(0, 0, 256, 256)
        const dataUrl = canvas.toDataURL('image/png')
        const base64 = dataUrl.split(',')[1]
        img = new Uint8Array(Buffer.from(base64, 'base64'))
    } else {
        img = await readImage(p.icon)
    }

    const card = buildPersonaCard(p)

    alertStore.set({
        type: 'wait',
        msg: language.alerts.writingExif
    })

    await sleep(10)

    img = (await PngChunk.write(await reencodeImage(img), {
        "persona": Buffer.from(JSON.stringify(card)).toString('base64')
    })) as Uint8Array

    alertStore.set({
        type: 'wait',
        msg: language.alerts.writingPng
    })

    await sleep(10)
    const saved = await downloadFile(`${p.name.replace(/[<>:"/\\|?*\.\,]/g, "")}_export.png`, img)
    if(!saved){
        alertClear()
        return
    }

    alertNormal(downloadNotice(language.successExport))
}

export async function importUserPersona() {
    let busy: BusyHandle | null = null
    try {
        const v = await selectSingleFile(['png'])
        if (!v) {
            return
        }
        busy = beginBusy('import')
        const decoded = await readPersonaChunk(v.data)

        if (!decoded) {
            alertError(language.errors.noData)
            return
        }
        const data = parsePersonaCard(decoded)
        if (data) {
            DBState.db.personas.push({
                name: data.name,
                icon: await saveImage(await reencodeImage(v.data)),
                personaPrompt: data.personaPrompt,
                note: data.note,
                id: v4(),
                ...(data.largePortrait ? { largePortrait: true } : {}),
            })
            alertNormal(language.successImport)
        } else {
            alertError(language.errors.noData)
        }
    } catch (error) {
        alertError(error)
        return
    } finally {
        busy?.end()
    }
}

async function readPersonaChunk(data: Uint8Array): Promise<string | undefined> {
    for await (const chunk of PngChunk.readGenerator(data)) {
        if (chunk && !(chunk instanceof AppendableBuffer) && chunk.key === 'persona') {
            return chunk.value
        }
    }
    return undefined
}

/** One picked PNG: its parsed card, or null when it holds no persona data. */
export interface PersonaImportItem {
    fileName: string
    card: ParsedPersonaCard | null
    bytes: Uint8Array
}

/** Lets the user pick several PNGs and reads the persona card of each. An empty list when nothing was picked. */
export async function readPersonaFiles(): Promise<PersonaImportItem[]> {
    const picked = await selectMultipleFile(['png'])
    if (!picked) {
        return []
    }
    const items: PersonaImportItem[] = []
    for (const file of picked) {
        const decoded = await readPersonaChunk(file.data)
        items.push({ fileName: file.name, card: decoded ? parsePersonaCard(decoded) : null, bytes: file.data })
    }
    return items
}

/**
 * Adds one persona per item that has a card. Every icon is saved first and the entries are pushed in
 * one synchronous block afterwards, so a failing save rejects with nothing added. Icons saved before
 * the failure are unreferenced. Returns the new ids; none becomes the persona in use.
 */
export async function addPersonasFromPng(items: PersonaImportItem[]): Promise<string[]> {
    const busy = beginBusy('import')
    try {
        const icons: string[] = []
        for (const item of items) {
            icons.push(item.card ? await saveImage(await reencodeImage(item.bytes)) : '')
        }
        adoptMirror(DBState.db)
        const ids: string[] = []
        items.forEach((item, index) => {
            if (!item.card) {
                return
            }
            const id = v4()
            DBState.db.personas.push({
                name: item.card.name,
                icon: icons[index],
                personaPrompt: item.card.personaPrompt,
                note: item.card.note,
                id,
                ...(item.card.largePortrait ? { largePortrait: true } : {}),
            })
            ids.push(id)
        })
        return ids
    } finally {
        busy.end()
    }
}