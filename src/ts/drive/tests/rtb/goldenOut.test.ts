import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { goldenOutDir, writeGoldenFile } from './goldenOut'

let scratch: string
let savedOut: string | undefined

beforeEach(() => {
    scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rtb-genout-')))
    savedOut = process.env.RTB_GOLDENS_OUT
    delete process.env.RTB_GOLDENS_OUT
})

afterEach(() => {
    if (savedOut === undefined) {
        delete process.env.RTB_GOLDENS_OUT
    } else {
        process.env.RTB_GOLDENS_OUT = savedOut
    }
    fs.rmSync(scratch, { recursive: true, force: true })
})

describe('T-genout writeGoldenFile', () => {
    test('creates a file once and refuses to overwrite it', () => {
        const file = writeGoldenFile(scratch, 'a.bin', Uint8Array.of(1, 2, 3))
        expect(Array.from(fs.readFileSync(file))).toEqual([1, 2, 3])
        expect(() => writeGoldenFile(scratch, 'a.bin', Uint8Array.of(9))).toThrow()
        expect(Array.from(fs.readFileSync(file))).toEqual([1, 2, 3])
    })

    test('refuses a name that is not a plain file name', () => {
        expect(() => writeGoldenFile(scratch, path.join('sub', 'a.bin'), Uint8Array.of(1))).toThrow(/plain file name/)
        expect(() => writeGoldenFile(scratch, '..', Uint8Array.of(1))).toThrow(/plain file name/)
    })

    test('refuses a directory under a repository marker', () => {
        fs.mkdirSync(path.join(scratch, '.git'))
        expect(() => writeGoldenFile(scratch, 'a.bin', Uint8Array.of(1))).toThrow(/repository/)
        expect(fs.existsSync(path.join(scratch, 'a.bin'))).toBe(false)
    })
})

describe('T-genout goldenOutDir', () => {
    test('the default directory is fresh and under the OS temp folder', () => {
        const dir = goldenOutDir()
        const second = goldenOutDir()
        try {
            expect(fs.statSync(dir).isDirectory()).toBe(true)
            expect(fs.readdirSync(dir)).toEqual([])
            const relative = path.relative(fs.realpathSync.native(os.tmpdir()), fs.realpathSync.native(dir))
            expect(relative.startsWith('..')).toBe(false)
            expect(path.isAbsolute(relative)).toBe(false)
            expect(second).not.toBe(dir)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
            fs.rmSync(second, { recursive: true, force: true })
        }
    })

    test('RTB_GOLDENS_OUT outside every repository is created and used', () => {
        const target = path.join(scratch, 'out', 'nested')
        process.env.RTB_GOLDENS_OUT = target
        expect(goldenOutDir()).toBe(target)
        expect(fs.statSync(target).isDirectory()).toBe(true)
    })

    test('refuses a directory inside a tree holding a .git directory, creating nothing', () => {
        fs.mkdirSync(path.join(scratch, '.git'))
        const target = path.join(scratch, 'sub', 'out')
        process.env.RTB_GOLDENS_OUT = target
        expect(() => goldenOutDir()).toThrow(/repository/)
        expect(fs.existsSync(path.join(scratch, 'sub'))).toBe(false)
        process.env.RTB_GOLDENS_OUT = scratch
        expect(() => goldenOutDir()).toThrow(/repository/)
    })

    test('refuses a directory inside a linked worktree whose .git is a file, creating nothing', () => {
        fs.writeFileSync(path.join(scratch, '.git'), 'gitdir: elsewhere\n')
        fs.mkdirSync(path.join(scratch, 'child'))
        const existing = path.join(scratch, 'child')
        process.env.RTB_GOLDENS_OUT = existing
        expect(() => goldenOutDir()).toThrow(/repository/)
        const missing = path.join(scratch, 'child', 'later', 'out')
        process.env.RTB_GOLDENS_OUT = missing
        expect(() => goldenOutDir()).toThrow(/repository/)
        expect(fs.existsSync(path.join(scratch, 'child', 'later'))).toBe(false)
    })

    test('refuses a junction whose target is inside a repository, judged on the real path', () => {
        const repo = path.join(scratch, 'repo')
        fs.mkdirSync(path.join(repo, '.git'), { recursive: true })
        fs.mkdirSync(path.join(repo, 'inside'))
        const free = path.join(scratch, 'free')
        fs.mkdirSync(free)
        const link = path.join(free, 'link')
        fs.symlinkSync(path.join(repo, 'inside'), link, 'junction')
        process.env.RTB_GOLDENS_OUT = link
        expect(() => goldenOutDir()).toThrow(/repository/)
        process.env.RTB_GOLDENS_OUT = path.join(link, 'new')
        expect(() => goldenOutDir()).toThrow(/repository/)
        expect(fs.readdirSync(path.join(repo, 'inside'))).toEqual([])
    })

    test('refuses a directory inside the checkout derived from the module URL even without a .git marker', () => {
        const root = path.join(scratch, 'checkout')
        const moduleDir = path.join(root, 'src', 'ts', 'drive', 'tests', 'rtb')
        fs.mkdirSync(moduleDir, { recursive: true })
        const moduleUrl = pathToFileURL(path.join(moduleDir, 'goldenOut.ts')).href
        process.env.RTB_GOLDENS_OUT = path.join(root, 'src', 'ts', 'drive', 'tests', 'rtbGoldens')
        expect(() => goldenOutDir({ moduleUrl })).toThrow(/inside the checkout/)
        expect(fs.existsSync(path.join(root, 'src', 'ts', 'drive', 'tests', 'rtbGoldens'))).toBe(false)
        process.env.RTB_GOLDENS_OUT = root
        expect(() => goldenOutDir({ moduleUrl })).toThrow(/inside the checkout/)
        // A sibling of the checkout is allowed, so the rule is the checkout and not the whole scratch tree.
        const sibling = path.join(scratch, 'elsewhere')
        process.env.RTB_GOLDENS_OUT = sibling
        expect(goldenOutDir({ moduleUrl })).toBe(sibling)
    })
})
