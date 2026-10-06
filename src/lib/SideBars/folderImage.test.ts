import { describe, expect, test } from 'vitest'
import type { folder } from 'src/ts/storage/database.svelte'
import { applyFolderImage } from './folderImage'

function folderEntry(): folder {
    return { name: 'Group', data: [], color: '', id: 'folder-1', imgFile: 'assets/old.png', img: 'data:image/png;base64,AAAA' }
}

describe('applyFolderImage', () => {
    test('stores the asset key and leaves the derived src empty', () => {
        const entry = folderEntry()
        applyFolderImage(entry, 'assets/new.png')
        expect(entry.imgFile).toBe('assets/new.png')
        expect(entry.img).toBe('')
    })

    test('resetting to the default image clears both fields', () => {
        const entry = folderEntry()
        applyFolderImage(entry, null)
        expect(entry.imgFile).toBeNull()
        expect(entry.img).toBe('')
    })
})
