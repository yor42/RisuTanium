// The app-language formatter cache: one formatter per language and option set, reactive in the app language.
import { afterEach, describe, expect, test } from 'vitest'
import { flushSync } from 'svelte'
import { appDateFormat, appIntlTag, appRelativeFormat, setAppLanguage } from './appIntl.svelte'

afterEach(() => {
    setAppLanguage('en')
})

describe('appIntl', () => {
    test('equal options under one language give the same formatter, a language change gives another', () => {
        setAppLanguage('ko')
        const first = appDateFormat({ hour: '2-digit', minute: '2-digit' })
        expect(appDateFormat({ hour: '2-digit', minute: '2-digit' })).toBe(first)
        expect(appDateFormat({ hour: 'numeric' })).not.toBe(first)
        setAppLanguage('de')
        const german = appDateFormat({ hour: '2-digit', minute: '2-digit' })
        expect(german).not.toBe(first)
        expect(german.resolvedOptions().locale).toBe(new Intl.DateTimeFormat('de').resolvedOptions().locale)
        setAppLanguage('ko')
        expect(appDateFormat({ hour: '2-digit', minute: '2-digit' })).toBe(first)
    })

    test('the relative-time formatter is cached per language and option set', () => {
        setAppLanguage('ko')
        const first = appRelativeFormat({ style: 'short' })
        expect(appRelativeFormat({ style: 'short' })).toBe(first)
        expect(appRelativeFormat({ style: 'long' })).not.toBe(first)
    })

    test("setAppLanguage maps 'cn' to zh-Hans and an unknown code to en", () => {
        expect(setAppLanguage('cn')).toBe('zh-Hans')
        expect(appIntlTag()).toBe('zh-Hans')
        expect(setAppLanguage('xx')).toBe('en')
        expect(appIntlTag()).toBe('en')
    })

    test('a reactive reader of a formatter re-runs when the app language changes', () => {
        const seen: string[] = []
        const stop = $effect.root(() => {
            $effect(() => {
                seen.push(appDateFormat({ hour: 'numeric' }).resolvedOptions().locale)
            })
        })
        try {
            flushSync()
            setAppLanguage('ko')
            flushSync()
            setAppLanguage('de')
            flushSync()
            expect(seen).toEqual(['en', 'ko', 'de'].map((tag) => new Intl.DateTimeFormat(tag).resolvedOptions().locale))
        } finally {
            stop()
        }
    })
})
