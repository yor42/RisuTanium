/**
 * Locale parity. `src/lang/index.ts` deep-merges every locale over English, so a key a locale
 * lacks (or a placeholder a translation drops) renders English or broken text silently. The
 * seven locale modules are imported directly, never the merged `language`, so a missing key
 * cannot be masked by the merge.
 *
 * Counting rules: objects are flattened to dotted paths; an array contributes one entry per
 * element (`path[i]`) plus a `path.length` entry, so a locale with a shorter or longer array
 * fails on the length and on the missing or extra indices.
 */
import { describe, test, expect } from 'vitest'
import { languageEnglish } from './en'
import { languageKorean } from './ko'
import { languageChinese } from './cn'
import { languageChineseTraditional } from './zh-Hant'
import { languageVietnamese } from './vi'
import { languageGerman } from './de'
import { languageSpanish } from './es'

type Kind = 'string' | 'function' | 'array-length' | 'other'

interface Leaf {
    kind: Kind
    /** Function parameter count; array length; undefined otherwise. */
    size?: number
    /** `{name}` tokens of a string value, as a sorted set. */
    tokens?: string[]
}

// `{{...}}` (CBS) text also matches; the set comparison keeps that harmless.
const PLACEHOLDER = /\{[A-Za-z0-9_]*\}/g

function leafOf(value: unknown): Leaf {
    if (typeof value === 'string') {
        return { kind: 'string', tokens: [...new Set(value.match(PLACEHOLDER) ?? [])].sort() }
    }
    if (typeof value === 'function') {
        return { kind: 'function', size: value.length }
    }
    return { kind: 'other' }
}

function flatten(value: unknown, path: string, out: Map<string, Leaf>): Map<string, Leaf> {
    if (Array.isArray(value)) {
        out.set(`${path}.length`, { kind: 'array-length', size: value.length })
        value.forEach((item, i) => flatten(item, `${path}[${i}]`, out))
    }
    else if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            flatten(child, path ? `${path}.${key}` : key, out)
        }
    }
    else {
        out.set(path, leafOf(value))
    }
    return out
}

const english = flatten(languageEnglish, '', new Map())

const locales: Array<[string, unknown]> = [
    ['ko', languageKorean],
    ['cn', languageChinese],
    ['zh-Hant', languageChineseTraditional],
    ['vi', languageVietnamese],
    ['de', languageGerman],
    ['es', languageSpanish],
]

describe('guard: every locale mirrors the English locale structure', () => {
    test.each(locales)('%s has the same keys, value kinds, arities and placeholders as en', (_name, locale) => {
        const other = flatten(locale, '', new Map())
        const missing = [...english.keys()].filter((k) => !other.has(k))
        const extra = [...other.keys()].filter((k) => !english.has(k))
        const kindMismatch: string[] = []
        const sizeMismatch: string[] = []
        const tokenMismatch: string[] = []
        for (const [key, en] of english) {
            const loc = other.get(key)
            if (!loc) continue
            if (loc.kind !== en.kind) {
                kindMismatch.push(`${key}: en ${en.kind}, locale ${loc.kind}`)
                continue
            }
            if (en.size !== loc.size) {
                sizeMismatch.push(`${key}: en ${en.size}, locale ${loc.size}`)
            }
            if (en.kind === 'string' && JSON.stringify(en.tokens) !== JSON.stringify(loc.tokens)) {
                tokenMismatch.push(`${key}: en ${JSON.stringify(en.tokens)}, locale ${JSON.stringify(loc.tokens)}`)
            }
        }
        expect({ missing, extra, kindMismatch, sizeMismatch, tokenMismatch }).toEqual({
            missing: [],
            extra: [],
            kindMismatch: [],
            sizeMismatch: [],
            tokenMismatch: [],
        })
    })
})
