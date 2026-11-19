// @vitest-environment jsdom
// `changeLanguage` keeps `<html lang>` on the app language, so assistive technology and the browser pick the right voice and hyphenation.
import { afterEach, describe, expect, test } from 'vitest'
import { changeLanguage } from './index'

afterEach(() => {
    changeLanguage('en')
    document.documentElement.removeAttribute('lang')
})

describe('document language', () => {
    test('a known language code becomes the html lang', () => {
        changeLanguage('ko')
        expect(document.documentElement.lang).toBe('ko')
    })

    test("'cn' becomes the Simplified Chinese tag", () => {
        changeLanguage('cn')
        expect(document.documentElement.lang).toBe('zh-Hans')
    })

    test.each(['xx', ''])('an unknown code %j becomes en', (code) => {
        changeLanguage('ko')
        changeLanguage(code)
        expect(document.documentElement.lang).toBe('en')
    })
})
