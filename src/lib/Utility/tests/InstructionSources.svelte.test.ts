// @vitest-environment jsdom

/**
 * The instruction-sources view of the Utility screen. (R) = regression reproducer; (G) = guard.
 *
 * REAL: the component and the language table, fed the shape `buildWorkspaceInstructions` ships
 * (`truncated`, `damaged`, `agentsPaths`, `skills`; the text is not passed).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { language } from 'src/lang'
import type { InstructionSummary } from 'src/ts/process/utility/utilityConversation.svelte'
import InstructionSources from '../InstructionSources.svelte'

const RLO = String.fromCharCode(0x202E)
const mounted: Array<{ instance: object, target: HTMLElement }> = []

function open(sources: InstructionSummary | null): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(InstructionSources, { target, props: { sources } })
    mounted.push({ instance, target })
    flushSync()
    return target
}

afterEach(() => {
    for (const { instance, target } of mounted.splice(0)) {
        void unmount(instance)
        target.remove()
    }
})

const q = (root: HTMLElement, id: string) => root.querySelector(`[data-testid="${id}"]`)
const all = (root: HTMLElement, id: string) => [...root.querySelectorAll(`[data-testid="${id}"]`)]

const FULL: InstructionSummary = {
    truncated: true,
    damaged: ['docs/AGENTS.md'],
    agentsPaths: ['AGENTS.md', 'sub/AGENTS.md'],
    skills: [
        { path: 'skills/a/SKILL.md', name: 'alpha', description: 'Does alpha.' },
        { path: 'skills/b/SKILL.md', name: null, description: null },
    ],
}

describe('InstructionSources', () => {
    test('(G) a run without a workspace shows nothing', () => {
        expect(q(open(null), 'instruction-sources')).toBeNull()
    })

    test('(G) the view is collapsed by default and its summary counts the sources', () => {
        const root = open(FULL)

        expect((q(root, 'instruction-sources') as HTMLDetailsElement).open).toBe(false)
        expect(q(root, 'instruction-sources-summary')?.textContent).toContain(language.utility.sources.summary(2, 2))
    })

    test('(G) it lists the AGENTS.md paths, the skill entries, the truncated note and the skipped damaged files', () => {
        const root = open(FULL)

        expect(all(root, 'instruction-agents-path').map(node => node.textContent)).toEqual(['AGENTS.md', 'sub/AGENTS.md'])
        expect(all(root, 'instruction-skill-name').map(node => node.textContent)).toEqual(['alpha', language.utility.sources.skillUnnamed])
        expect(all(root, 'instruction-skill-path').map(node => node.textContent)).toEqual(['skills/a/SKILL.md', 'skills/b/SKILL.md'])
        expect(all(root, 'instruction-skill-description').map(node => node.textContent)).toEqual(['Does alpha.'])
        expect(q(root, 'instruction-truncated')?.textContent).toBe(language.utility.sources.truncatedNote)
        expect(q(root, 'instruction-damaged')?.textContent).toContain('docs/AGENTS.md')
    })

    test('(G) no truncated note and no damaged block when nothing was cut or skipped', () => {
        const root = open({ truncated: false, damaged: [], agentsPaths: ['AGENTS.md'], skills: [] })

        expect(q(root, 'instruction-truncated')).toBeNull()
        expect(q(root, 'instruction-damaged')).toBeNull()
        expect(q(root, 'instruction-sources-none')).toBeNull()
    })

    test('(G) a workspace without instruction files says so', () => {
        const root = open({ truncated: false, damaged: [], agentsPaths: [], skills: [] })

        expect(q(root, 'instruction-sources-none')?.textContent).toBe(language.utility.sources.none)
    })

    test('(R) hostile paths, skill names and descriptions render as text in isolation elements', () => {
        const hostile = `<img src=x onerror="window.pwned=1">${RLO}`
        const root = open({
            truncated: false,
            damaged: [`<b>${hostile}</b>`],
            agentsPaths: [`<i>${hostile}</i>`],
            skills: [{ path: `<u>${hostile}</u>`, name: `<s>${hostile}</s>`, description: `<script>${hostile}</script>` }],
        })

        for (const tag of ['img', 'b', 'i', 'u', 's', 'script']) {
            expect(root.querySelector(tag), tag).toBeNull()
        }
        const shown = hostile.replace(RLO, '\\u202e')
        expect(all(root, 'instruction-agents-path')[0].textContent).toBe(`<i>${shown}</i>`)
        expect(all(root, 'instruction-skill-name')[0].textContent).toBe(`<s>${shown}</s>`)
        expect(all(root, 'instruction-skill-path')[0].textContent).toBe(`<u>${shown}</u>`)
        expect(all(root, 'instruction-skill-description')[0].textContent).toBe(`<script>${shown}</script>`)
        expect(root.textContent).not.toContain(RLO)
        for (const id of ['instruction-agents-path', 'instruction-skill-name', 'instruction-skill-path', 'instruction-skill-description']) {
            expect(all(root, id)[0].tagName, id).toBe('BDI')
        }
    })
})