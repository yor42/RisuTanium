import { DBState } from 'src/ts/stores.svelte'
import { language } from '../../lang'
import { folderEntryAt, folderMemberIds, editFolder, ungroupFolder, type FolderRef } from './sidebarOrder'
import { trashFolderMembers, untrashedMembersOf, visibleCharacterIds } from '../../ts/characters'
import { getCharacterIndexObject, selectSingleFileObject } from 'src/ts/util'
import { pickedAssetLimitBytes, saveAssetFromBlob } from 'src/ts/globalApi.svelte'
import { reportRefusedAssets } from 'src/ts/storage/pickedAssetLimit'
import { beginBusy } from 'src/ts/process/memory/busyActions'
import { alertInput, alertSelect } from 'src/ts/alert'
import { applyFolderImage } from './folderImage'
import { getFolderColorLabels, getFolderColorValue } from './folderColors'
import type { folder } from 'src/ts/storage/database.svelte'

type OrderChange = (order: typeof DBState.db.characterOrder) => typeof DBState.db.characterOrder

export interface FolderMenuTarget {
    ref: FolderRef
    id: string
    name: string
}

/**
 * What the folder menu needs from the surface that opened it. `applyOrderChange` assigns the
 * result to `DBState.db.characterOrder` and repairs it (`checkCharOrder`); `closeFolder` forgets
 * the folder in that surface's open-folder list. The menu itself never repairs the order, so a
 * rename, colour or picture edit stays a plain assignment.
 *
 * `beforeFilePicker` runs just before the native file chooser opens, and only then.
 * `wrapFieldWrite` receives the one assignment of each field edit (rename, colour, picture); the
 * menu calls it once per edit that actually writes, never for a no-op edit, Ungroup, Delete or
 * Cancel, and the wrapper must call `write()` exactly once.
 */
export interface FolderMenuHost {
    applyOrderChange(change: OrderChange): void
    closeFolder(id: string): void
    beforeFilePicker?(): void
    wrapFieldWrite?(write: () => void): void
}

// Finds the folder by id at the moment of writing, so an edit that waited
// on a dialog or a file picker never lands on a different entry.
const editFolderById = (host: FolderMenuHost, id: string, edit: (copy: folder) => void) => {
    const next = editFolder(DBState.db.characterOrder, id, edit)
    if(next){
        const write = () => {
            DBState.db.characterOrder = next
        }
        if(host.wrapFieldWrite){
            host.wrapFieldWrite(write)
        }
        else{
            write()
        }
    }
}

const folderExists = (id: string) => editFolder(DBState.db.characterOrder, id, () => {}) !== null

// The folder's own entry goes and its members take its place. Resolved against the live
// order by the menu's ref at the moment of the choice; a folder that is gone changes nothing.
const ungroup = (host: FolderMenuHost, ref: FolderRef) => {
    let changed = false
    host.applyOrderChange((order) => {
        const next = ungroupFolder(order, ref)
        changed = next !== null
        return next ?? order
    })
    if(changed){
        host.closeFolder(ref.id)
    }
}

async function deleteFolderMenu(host: FolderMenuHost, ref: FolderRef, folderName: string) {
    const before = folderMemberIds(DBState.db.characterOrder, ref)
    if(before === null){
        return
    }
    // Only visible members count: a hidden character is never offered for the trash. Both lookups
    // are built once, here, and the choice below does not read them again.
    const idObject = getCharacterIndexObject()
    const visible = visibleCharacterIds()
    const isVisible = (id: string) => Object.hasOwn(idObject, id) && visible.has(id)
    const count = untrashedMembersOf(before.filter(isVisible)).length
    const labels = count > 0
        ? [language.deleteFolderKeep, language.deleteFolderTrash(count), language.cancel]
        : [language.deleteFolderKeep, language.cancel]
    const sel = parseInt(await alertSelect(labels))
    if(sel === 0){
        ungroup(host, ref)
    }
    else if(sel === 1 && count > 0){
        // The folder as it is now: it may have changed while the choice was open. The order's own
        // object is passed, so the trash finds the same entry again and not a same-id twin.
        const entry = folderEntryAt(DBState.db.characterOrder, ref)
        if(entry !== null){
            await trashFolderMembers(entry, folderName)
        }
    }
}

/**
 * The folder menu shared by the surfaces that show folders. Every write is resolved against the
 * live order by id (field edits) or by the target's ref (Ungroup, Delete) when it happens, so an
 * answer that arrives late never lands on a different entry.
 */
export async function runFolderMenu(target: FolderMenuTarget, host: FolderMenuHost) {
    const { ref, id: folderId, name: folderName } = target
    const sel = parseInt(await alertSelect([language.renameFolder,language.changeFolderColor,language.changeFolderImage,language.ungroupFolder,language.deleteFolder,language.cancel]))
    if(sel === 3){
        ungroup(host, ref)
    }
    else if(sel === 4){
        await deleteFolderMenu(host, ref, folderName)
    }
    else if(sel === 0){
        const v = await alertInput(language.changeFolderName, [], folderName)
        if(v){
            editFolderById(host, folderId, (entry) => { entry.name = v })
        }
    }
    else if(sel === 1){
        const sel = parseInt(await alertSelect(getFolderColorLabels()))
        const colorValue = getFolderColorValue(sel)
        if(colorValue === undefined){
            return
        }
        editFolderById(host, folderId, (entry) => { entry.color = colorValue })
    }
    else if(sel === 2) {
        const sel = parseInt(await alertSelect([language.alerts.resetToDefaultImage, language.alerts.selectImageFile]))

        switch (sel) {
            case 0:
                editFolderById(host, folderId, (entry) => { applyFolderImage(entry, null) })
                break;

            case 1:
                host.beforeFilePicker?.()
                const folderImage = await selectSingleFileObject([
                    'png',
                    'jpg',
                    'webp',
                ])

                if(!folderImage) {
                    return
                }

                // A folder that is gone, or whose id is not unique, has no safe target: no asset is saved for it.
                if(!folderExists(folderId)) {
                    return
                }

                const limit = await pickedAssetLimitBytes()
                if(folderImage.size > limit) {
                    reportRefusedAssets([folderImage], limit)
                    return
                }

                const busy = beginBusy('imageAdd')
                try {
                    const folderImageData = await saveAssetFromBlob(folderImage)

                    editFolderById(host, folderId, (entry) => { applyFolderImage(entry, folderImageData) })
                } finally {
                    busy.end()
                }
                break;
        }
    }
}
