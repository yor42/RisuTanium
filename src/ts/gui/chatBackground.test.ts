import { describe, expect, test } from 'vitest'
import { canvasYieldDeclaration, hasUserChatBackground, type ChatBackgroundInputs } from './chatBackground'

const NONE: ChatBackgroundInputs = { customImageStyle: '', backgroundHTML: '', moduleEmbedding: '', selected: true }
const IMAGE = 'background: url("blob:wall"); background-size: cover;'

describe('hasUserChatBackground', () => {
    test('B15: a resolved image, a non-blank card or a non-blank module embedding counts; a missing one, blanks or no selection do not', () => {
        expect(hasUserChatBackground(NONE)).toBe(false)
        expect(hasUserChatBackground({ ...NONE, customImageStyle: 'x' })).toBe(false)
        expect(hasUserChatBackground({ ...NONE, customImageStyle: 'xy' })).toBe(false)
        expect(hasUserChatBackground({ ...NONE, customImageStyle: IMAGE })).toBe(true)
        expect(hasUserChatBackground({ ...NONE, backgroundHTML: '  \n ' })).toBe(false)
        expect(hasUserChatBackground({ ...NONE, backgroundHTML: '<div></div>' })).toBe(true)
        expect(hasUserChatBackground({ ...NONE, moduleEmbedding: ' \t' })).toBe(false)
        expect(hasUserChatBackground({ ...NONE, moduleEmbedding: '<div></div>' })).toBe(true)
        expect(hasUserChatBackground({ ...NONE, backgroundHTML: undefined, moduleEmbedding: null })).toBe(false)
    })

    test('B15: no selection hides a card and an embedding but not the image', () => {
        expect(hasUserChatBackground({ ...NONE, selected: false, backgroundHTML: '<div></div>' })).toBe(false)
        expect(hasUserChatBackground({ ...NONE, selected: false, moduleEmbedding: '<div></div>' })).toBe(false)
        expect(hasUserChatBackground({ ...NONE, selected: false, customImageStyle: IMAGE })).toBe(true)
    })
})

describe('canvasYieldDeclaration', () => {
    test('B15b: nothing is an important none', () => {
        expect(canvasYieldDeclaration(null)).toBe('background: none !important;')
    })

    test('B15b: a valid overlay colour is an important background', () => {
        expect(canvasYieldDeclaration('#ff000080')).toBe('background: #ff000080 !important;')
        expect(canvasYieldDeclaration('rgba(0,0,0,0.8)')).toBe('background: rgba(0,0,0,0.8) !important;')
    })

    test('B15c: an overlay that is not a valid colour is an important none, never an invalid declaration', () => {
        expect(canvasYieldDeclaration('red80')).toBe('background: none !important;')
        expect(canvasYieldDeclaration('#fff80')).toBe('background: none !important;')
        expect(canvasYieldDeclaration('#ff0000; color: red80')).toBe('background: none !important;')
        expect(canvasYieldDeclaration('')).toBe('background: none !important;')
    })
})
