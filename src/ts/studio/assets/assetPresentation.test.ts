import { describe, expect, test } from 'vitest'
import { assetPresentationOf, assetRowExt, assetSizeText } from './assetPresentation'

describe('assetPresentationOf', () => {
    test.each([
        ['png', 'thumb', 'image'],
        ['webp', 'thumb', 'image'],
        ['jpeg', 'thumb', 'image'],
        ['jpg', 'thumb', 'image'],
        ['gif', 'thumb', 'image'],
        ['svg', 'thumb', 'image'],
        ['avif', 'thumb', 'image'],
        ['mp3', 'audio', 'audio'],
        ['mp4', 'video', 'video'],
        ['webm', 'video', 'video'],
        ['ttf', 'tile', 'none'],
        ['css', 'tile', 'none'],
        ['xyz', 'tile', 'none'],
        ['', 'tile', 'none'],
    ] as const)('%s is shown as %s and decides its URL by the %s element', (ext, shown, element) => {
        expect(assetPresentationOf(ext)).toEqual({ shown, element })
    })

    test('the extension is compared in lower case', () => {
        expect(assetPresentationOf('PNG')).toEqual({ shown: 'thumb', element: 'image' })
        expect(assetPresentationOf('Mp3')).toEqual({ shown: 'audio', element: 'audio' })
        expect(assetPresentationOf('WEBM')).toEqual({ shown: 'video', element: 'video' })
    })

    test('an absent extension is a tile', () => {
        expect(assetPresentationOf(undefined)).toEqual({ shown: 'tile', element: 'none' })
    })
})

describe('assetRowExt', () => {
    test('the stored extension wins over the path', () => {
        expect(assetRowExt(['a', 'assets/x.png', 'webp'])).toBe('webp')
    })

    test('a row without a stored extension takes the path\'s', () => {
        expect(assetRowExt(['a', 'assets/x.mp3'])).toBe('mp3')
        expect(assetRowExt(['a', 'assets/x.mp3', ''])).toBe('mp3')
    })

    test('a path without a dot has no extension', () => {
        expect(assetRowExt(['a', 'assets/x'])).toBe('')
    })
})

describe('assetSizeText', () => {
    test.each([
        [0, '0 B'],
        [1023, '1023 B'],
        [1024, '1.0 KB'],
        [1536, '1.5 KB'],
        [5 * 1024 * 1024, '5.0 MB'],
        [3 * 1024 * 1024 * 1024, '3.0 GB'],
    ])('%d bytes read as %s', (bytes, text) => {
        expect(assetSizeText(bytes)).toBe(text)
    })
})
