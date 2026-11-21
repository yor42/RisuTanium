import { describe, expect, test } from 'vitest'
import { MAX_PATH_BYTES, MAX_PATH_DEPTH, MAX_SEGMENT_BYTES, normalizeWorkspacePath, workspacePathKey } from '../paths'

// T9: the path rules of a workspace (new-rule tests, proven by the scratch mutants named in the stage result).

function accepted(raw: string): string {
    const result = normalizeWorkspacePath(raw)
    if (result.ok === false) {
        throw new Error(`${JSON.stringify(raw)} refused: ${result.reason}`)
    }
    return result.path
}

function refusal(raw: string): string | null {
    const result = normalizeWorkspacePath(raw)
    return result.ok === false ? result.reason : null
}

describe('normalizeWorkspacePath', () => {
    test('plain nested paths and one leading ./ or / are accepted and stripped', () => {
        expect(accepted('AGENTS.md')).toBe('AGENTS.md')
        expect(accepted('docs/guide/a.md')).toBe('docs/guide/a.md')
        expect(accepted('./a.md')).toBe('a.md')
        expect(accepted('/a/b.md')).toBe('a/b.md')
        expect(accepted('dir/.hidden')).toBe('dir/.hidden')
        expect(accepted('한글/메모.md')).toBe('한글/메모.md')
    })

    test('the path is stored in NFC', () => {
        expect(accepted('café.md')).toBe('café.md')
    })

    test('dot segments are refused, however they are spelled', () => {
        for (const raw of ['..', '../x', 'a/../b', 'a/..', '.', 'a/./b', './.', '/../x']) {
            expect(refusal(raw), raw).not.toBeNull()
        }
        expect(refusal('../x')).toBe('dot-segment')
    })

    test('empty paths, doubled and trailing slashes', () => {
        expect(refusal('')).toBe('empty')
        expect(refusal('/')).toBe('empty')
        expect(refusal('./')).toBe('empty')
        expect(refusal('a/')).toBe('trailing-slash')
        expect(refusal('a//b')).toBe('empty-segment')
        expect(refusal('//a')).toBe('empty-segment')
    })

    test('backslash, NUL, controls, DEL and the Windows-forbidden characters', () => {
        for (const raw of ['a\\b', 'a\u0000b', 'a\u0001b', 'a\tb', 'a\nb', 'a\u007fb', 'a<b', 'a>b', 'a:b', 'a"b', 'a|b', 'a?b', 'a*b']) {
            expect(refusal(raw), JSON.stringify(raw)).toBe('forbidden-character')
        }
    })

    test('a segment ending in a dot or a space is refused', () => {
        expect(refusal('a./b')).toBe('segment-ends-with-dot-or-space')
        expect(refusal('a/b ')).toBe('segment-ends-with-dot-or-space')
        expect(refusal('a/b.')).toBe('segment-ends-with-dot-or-space')
    })

    test('Windows reserved names are refused with or without an extension, in any case', () => {
        for (const raw of ['CON', 'con', 'Prn.txt', 'a/AUX.md', 'nul', 'COM1', 'com9.x', 'LPT1', 'lpt9.tar.gz']) {
            expect(refusal(raw), raw).toBe('reserved-name')
        }
        expect(refusal('COM0')).toBeNull()
        expect(refusal('console.md')).toBeNull()
        expect(refusal('com10')).toBeNull()
    })

    test('length and depth limits are on UTF-8 bytes and segments', () => {
        expect(refusal('a'.repeat(MAX_SEGMENT_BYTES))).toBeNull()
        expect(refusal('a'.repeat(MAX_SEGMENT_BYTES + 1))).toBe('segment-too-long')
        // 86 Korean letters are 258 bytes: under a character count of 255, over the byte limit.
        expect(refusal('가'.repeat(86))).toBe('segment-too-long')
        expect(refusal('가'.repeat(85))).toBeNull()
        const deepOk = Array.from({ length: MAX_PATH_DEPTH }, () => 'd').join('/')
        expect(refusal(deepOk)).toBeNull()
        expect(refusal(`${deepOk}/d`)).toBe('too-deep')
        const longPath = Array.from({ length: 5 }, () => 'a'.repeat(250)).join('/')
        expect(longPath.length).toBeGreaterThan(MAX_PATH_BYTES)
        expect(refusal(longPath)).toBe('path-too-long')
    })

    test('lone surrogates are refused', () => {
        expect(refusal('a\ud800b')).toBe('malformed-text')
        expect(refusal('a\udc00')).toBe('malformed-text')
        expect(refusal('a😀b')).toBeNull()
    })
})

describe('workspacePathKey', () => {
    test('paths equal under NFC and case folding share one key', () => {
        expect(workspacePathKey('Readme.MD')).toBe(workspacePathKey('readme.md'))
        expect(workspacePathKey('café')).toBe(workspacePathKey('CAFÉ'))
        expect(workspacePathKey('a/b')).not.toBe(workspacePathKey('a/c'))
    })
})
