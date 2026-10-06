import type { folder } from 'src/ts/storage/database.svelte'

/**
 * Points a folder entry at the asset `imgFile`, or at none (`null`, the default
 * image). Only `imgFile` names the image: what displays it is resolved from
 * `imgFile` when the folder is drawn, so `img` stays empty rather than hold a
 * URL (or a data URL) that would be saved with the entry.
 */
export function applyFolderImage(entry: folder, imgFile: string | null): void {
    entry.imgFile = imgFile
    entry.img = ''
}
