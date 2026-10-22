/**
 * `othersUi.editFolderRemoveConfirm` is the consent text of the Grid drag (a dragged folder is
 * removed and its characters join the drop): it must name every folder it asks about, in all three
 * forms, and say what is lost. `othersUi.editMoved` is the live-region text after a drop.
 */
import { describe, expect, test } from 'vitest'
import { languageEnglish } from './en'

const { editFolderRemoveConfirm, editMoved } = languageEnglish.othersUi

describe('R-lang-1 othersUi.editFolderRemoveConfirm (English, exact text)', () => {
    test('one folder', () => {
        expect(editFolderRemoveConfirm(['Alpha'])).toBe(
            'Remove the folder "Alpha" and move its characters here? Its name, colour and picture are not kept.',
        )
    })

    test('two folders', () => {
        expect(editFolderRemoveConfirm(['Alpha', 'Beta'])).toBe(
            'Remove the folders "Alpha" and "Beta" and move their characters here? Their names, colours and pictures are not kept.',
        )
    })

    test('three folders are all named', () => {
        expect(editFolderRemoveConfirm(['Alpha', 'Beta', 'Gamma'])).toBe(
            'Remove the folders "Alpha", "Beta" and "Gamma" and move their characters here? Their names, colours and pictures are not kept.',
        )
    })

    test('four folders name three and count the rest', () => {
        expect(editFolderRemoveConfirm(['Alpha', 'Beta', 'Gamma', 'Delta'])).toBe(
            'Remove the folders "Alpha", "Beta", "Gamma" and 1 more, and move their characters here? Their names, colours and pictures are not kept.',
        )
    })

    test('five folders', () => {
        expect(editFolderRemoveConfirm(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])).toBe(
            'Remove the folders "Alpha", "Beta", "Gamma" and 2 more, and move their characters here? Their names, colours and pictures are not kept.',
        )
    })

    test('two folders with the same name are both listed', () => {
        expect(editFolderRemoveConfirm(['Same', 'Same'])).toContain('"Same" and "Same"')
    })
})

describe('R-lang-1 othersUi.editMoved', () => {
    test('singular and plural', () => {
        expect(editMoved(1)).toBe('Moved 1 item')
        expect(editMoved(2)).toBe('Moved 2 items')
        expect(editMoved(11)).toBe('Moved 11 items')
    })
})
