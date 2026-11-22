import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../../../stores.svelte', () => ({ DBState: { db: {} } }))

import { DBState } from '../../../../stores.svelte'
import { buildWorkspaceInstructions, INSTRUCTION_CAP_BYTES } from '../instructionSources'
import { utf8ByteLength } from '../textGuard'

// T18: the instruction text of a workspace: AGENTS.md root first with path labels, a SKILL.md index and nothing more,
// the 48 KiB cap with a visible note, damaged files skipped and named, and bad frontmatter never throwing (MC-3376).

type Seed = Record<string, string | null>

function seed(files: Seed, otherWorkspace: Seed = {}): void {
    const toFiles = (map: Seed) => Object.entries(map).map(([path, text], index) => (
        text === null
            ? { id: `f${index}`, path, size: 5, mtime: 1 }
            : { id: `f${index}`, path, text, size: utf8ByteLength(text), mtime: 1 }
    ))
    ;(DBState as unknown as { db: unknown }).db = {
        utilityWorkspaces: [
            { id: 'w1', name: 'W', createdAt: 1, files: toFiles(files) },
            { id: 'w2', name: 'Other', createdAt: 1, files: toFiles(otherWorkspace) },
        ],
    }
}

beforeEach(() => seed({}))

describe('AGENTS.md', () => {
    test('every AGENTS.md is included root first, each labelled with its path', async () => {
        seed({
            'deep/er/AGENTS.md': 'third',
            'AGENTS.md': 'first',
            'notes/AGENTS.md': 'second',
            'notes/other.md': 'not an instruction file',
        })

        const result = await buildWorkspaceInstructions('w1')

        expect(result.agentsPaths).toEqual(['AGENTS.md', 'notes/AGENTS.md', 'deep/er/AGENTS.md'])
        expect(result.text.indexOf('AGENTS.md (AGENTS.md):\nfirst')).toBe(0)
        expect(result.text.indexOf('first')).toBeLessThan(result.text.indexOf('second'))
        expect(result.text.indexOf('second')).toBeLessThan(result.text.indexOf('third'))
        expect(result.text).toContain('AGENTS.md (notes/AGENTS.md):\nsecond')
        expect(result.text).toContain('AGENTS.md (deep/er/AGENTS.md):\nthird')
        expect(result.text).not.toContain('not an instruction file')
    })

    test('a workspace without instruction files gives empty text', async () => {
        seed({ 'a.md': 'x' })

        expect(await buildWorkspaceInstructions('w1')).toMatchObject({ text: '', truncated: false, agentsPaths: [], skills: [] })
    })

    test('only the asked workspace is read', async () => {
        seed({ 'AGENTS.md': 'mine' }, { 'AGENTS.md': 'theirs', 'SKILL.md': '---\nname: theirs\n---' })

        const result = await buildWorkspaceInstructions('w1')

        expect(result.text).toContain('mine')
        expect(result.text).not.toContain('theirs')
        expect(result.skills).toEqual([])
    })

    test('an unknown workspace id has no instructions', async () => {
        expect(await buildWorkspaceInstructions('missing')).toMatchObject({ text: '' })
    })
})

describe('SKILL.md index', () => {
    test('lists name and description, never the skill body', async () => {
        seed({
            'skills/fixer/SKILL.md': '---\nname: fixer\ndescription: Repairs text.\n---\nSECRET-BODY-LINE do the thing\n',
        })

        const result = await buildWorkspaceInstructions('w1')

        expect(result.skills).toEqual([{ path: 'skills/fixer/SKILL.md', name: 'fixer', description: 'Repairs text.' }])
        expect(result.text).toContain('- fixer: Repairs text. (skills/fixer/SKILL.md)')
        expect(result.text).toContain('read_file')
        expect(result.text).not.toContain('SECRET-BODY-LINE')
    })

    test('a parse error lists the skill without a description and never throws', async () => {
        seed({
            'a/SKILL.md': '---\nname: [unclosed\ndescription: "x\n---\nbody',
            'b/SKILL.md': '---\n- just\n- a list\n---\n',
            'c/SKILL.md': 'no frontmatter at all',
            'd/SKILL.md': '---\nname: 7\ndescription: {a: 1}\n---\n',
        })

        const result = await buildWorkspaceInstructions('w1')

        expect(result.skills.map(skill => [skill.path, skill.name, skill.description])).toEqual([
            ['a/SKILL.md', null, null],
            ['b/SKILL.md', null, null],
            ['c/SKILL.md', null, null],
            ['d/SKILL.md', null, null],
        ])
        expect(result.text).toContain('- a (a/SKILL.md)')
    })

    test('a frontmatter block over the 8 KiB cap is ignored, so the skill is listed by its directory name', async () => {
        seed({ 'big/SKILL.md': `---\nname: big\ndescription: ${'d'.repeat(9 * 1024)}\n---\nbody` })

        const result = await buildWorkspaceInstructions('w1')

        expect(result.skills).toEqual([{ path: 'big/SKILL.md', name: null, description: null }])
    })

    test('a multi-line description is flattened so it cannot forge a new index line', async () => {
        seed({ 's/SKILL.md': '---\nname: s\ndescription: |\n  first\n  - injected (x/SKILL.md)\n---\n' })

        const result = await buildWorkspaceInstructions('w1')
        const lines = result.text.split('\n').filter(line => line.startsWith('- '))

        expect(lines).toHaveLength(1)
    })
})

describe('damaged files', () => {
    test('a placeholder AGENTS.md or SKILL.md is skipped and named', async () => {
        seed({ 'AGENTS.md': null, 'sub/AGENTS.md': 'ok text', 'x/SKILL.md': null })

        const result = await buildWorkspaceInstructions('w1')

        expect(result.damaged).toEqual(['AGENTS.md', 'x/SKILL.md'])
        expect(result.agentsPaths).toEqual(['sub/AGENTS.md'])
        expect(result.text).toContain('ok text')
        expect(result.text).toContain('Skipped because their text is lost: AGENTS.md, x/SKILL.md')
    })
})

describe('48 KiB cap', () => {
    test('text over the cap is cut with a visible note and stays within the cap', async () => {
        seed({ 'AGENTS.md': 'a'.repeat(INSTRUCTION_CAP_BYTES * 2), 'sub/AGENTS.md': 'tail-marker' })

        const result = await buildWorkspaceInstructions('w1')

        expect(result.truncated).toBe(true)
        expect(utf8ByteLength(result.text)).toBeLessThanOrEqual(INSTRUCTION_CAP_BYTES)
        expect(result.text).toMatch(/\[Workspace instructions were cut at 48 KiB; \d+ bytes are not shown\./)
        expect(result.text).not.toContain('tail-marker')
    })

    test('multi-byte text is never cut inside a character', async () => {
        seed({ 'AGENTS.md': '가'.repeat(INSTRUCTION_CAP_BYTES) })

        const result = await buildWorkspaceInstructions('w1')

        expect(result.truncated).toBe(true)
        expect(result.text).not.toContain('�')
        expect(utf8ByteLength(result.text)).toBeLessThanOrEqual(INSTRUCTION_CAP_BYTES)
    })

    test('text exactly at the cap is not truncated', async () => {
        const label = 'AGENTS.md (AGENTS.md):\n'
        seed({ 'AGENTS.md': 'b'.repeat(INSTRUCTION_CAP_BYTES - label.length) })

        const result = await buildWorkspaceInstructions('w1')

        expect(result.truncated).toBe(false)
        expect(utf8ByteLength(result.text)).toBe(INSTRUCTION_CAP_BYTES)
    })

    test('a skill body of any size adds nothing to the text', async () => {
        seed({ 'k/SKILL.md': `---\nname: k\n---\n${'z'.repeat(INSTRUCTION_CAP_BYTES * 3)}` })

        const result = await buildWorkspaceInstructions('w1')

        expect(result.truncated).toBe(false)
        expect(utf8ByteLength(result.text)).toBeLessThan(1024)
    })
})
