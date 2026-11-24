// @vitest-environment node
// Popups' critical closure (MC-3244, MC-3245, MC-3246): every part at or under a protected popup element is critical, whatever the
// registry lists by hand. The census reads the real popup components; the pinned constants are printed on mismatch.
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHAT_PARTS } from './areaParts'
import { censusOfFiles, censusOfParts, enclosingPartsOfRoots } from './fixtures/criticalClosure'
import {
    POPUPS_CRITICAL, POPUPS_CRITICAL_CLOSURE, POPUPS_FILES, POPUPS_HOLDERS, POPUPS_NAMED_CRITICAL, POPUPS_PARTS, POPUPS_REACH, POPUPS_SAFE, POPUPS_SHARED_TOKENS_ONLY,
} from './registries/popups'
import { STUDIO_CRITICAL, STUDIO_SAFE } from './registries/studio'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const patternDir = path.join(root, 'src/lib/Nexus/pattern')
// The two test harness components render no part and are not part of the app.
const HARNESSES = new Set(['TaskToastHarness.svelte', 'TaskYieldHarness.svelte'])
const OTHERS = ['AlertComp', 'ParkedReplyPrompt', 'PasswordPrompt', 'PeerConflicts', 'PresetBundlePrompt', 'SelectCharCard', 'SelectCharGrid', 'UpdateOfferPrompt']
// Overlay components of the modal vocabulary (modal-*, memory-progress*, save-status-*); each stage that adds an overlay extends this list.
const OVERLAY_FILES = ['src/lib/Others/PopupEditor.svelte', 'src/lib/Others/HypaV3Progress.svelte', 'src/lib/Others/SavePopupIcon.svelte', 'src/lib/Setting/listedPersona.svelte']
const relative = (file: string): string => path.relative(root, file).split(path.sep).join('/')
const files = [
    ...readdirSync(patternDir).filter((name) => name.endsWith('.svelte') && !HARNESSES.has(name)).map((name) => path.join(patternDir, name)),
    ...OTHERS.map((name) => path.join(root, 'src/lib/Others', `${name}.svelte`)),
    ...OVERLAY_FILES.map((name) => path.join(root, name)),
].sort((a, b) => (relative(a) < relative(b) ? -1 : 1))

/** An in-memory source tree: paths are resolved against `/t`. */
function tree(entries: Readonly<Record<string, string>>): { files: string[]; read: (file: string) => string | null } {
    const resolved = new Map(Object.entries(entries).map(([name, source]) => [path.resolve('/t', name), source]))
    return { files: [...resolved.keys()], read: (file) => resolved.get(file) ?? null }
}

describe('A15 the lucide leaf rule of the census scan', () => {
    const marked = (imports: string, body: string) => tree({ 'A.svelte': `<script>${imports}</script><div data-part="root" data-part-critical>${body}</div>` })

    it('a named lucide icon without data-* or a spread is a leaf: no problem, no name', () => {
        const t = marked('import { XIcon } from "@lucide/svelte"', '<XIcon size={20} aria-hidden="true" />')
        const census = censusOfFiles(t.files, t.read)
        expect(census.problems).toEqual([])
        expect(census.names).toEqual(['root'])
    })

    it('a lucide icon carrying a data-* attribute is a problem', () => {
        const t = marked('import { XIcon } from "@lucide/svelte"', '<XIcon data-part="x" />')
        expect(censusOfFiles(t.files, t.read).problems).toHaveLength(1)
    })

    it('a lucide icon with a spread is a problem', () => {
        const t = marked('import { XIcon } from "@lucide/svelte"; let rest = {}', '<XIcon {...rest} />')
        expect(censusOfFiles(t.files, t.read).problems).toHaveLength(1)
    })

    it('a named import from another package is not a leaf', () => {
        const t = marked('import { XIcon } from "other-icons"', '<XIcon />')
        expect(censusOfFiles(t.files, t.read).problems).toHaveLength(1)
    })
})

describe('A1 the closure of the real popup components', () => {
    const census = censusOfFiles(files)

    it('follows every construct under the marked roots', () => {
        expect(census.problems).toEqual([])
        expect([...census.roots].sort()).toEqual(['password-prompt-root', 'pattern-alert-bundle', 'pattern-alert-stack', 'pattern-alert-stack', 'pattern-prompt-root', 'pattern-task-root',
            'pattern-warn-root', 'pattern-warn-root', 'save-status-alert', 'save-status-alert', 'save-status-alert', 'save-status-alert', 'task-toast', 'toast-undo'])
    })

    it('the pinned file list equals the popup components', () => {
        expect(POPUPS_FILES, `regenerate: ${JSON.stringify(files.map(relative))}`).toEqual(files.map(relative))
    })

    it('the pinned POPUPS_CRITICAL_CLOSURE equals the census', () => {
        expect(POPUPS_CRITICAL_CLOSURE, `regenerate: ${JSON.stringify(census.names)}`).toEqual(census.names)
    })

    it('the dialog frame and the live regions are critical by name and carry no marker of their own', () => {
        for (const name of POPUPS_NAMED_CRITICAL) {
            expect(POPUPS_PARTS, name).toContain(name)
            expect(census.roots, name).not.toContain(name)
        }
        expect(POPUPS_NAMED_CRITICAL).toEqual(['pattern-layer', 'pattern-scrim', 'pattern-dialog', 'pattern-dialog-announce', 'toast-live-polite', 'toast-live-assertive'])
    })
})

describe('A2 and A12 the toasts', () => {
    const census = censusOfFiles(files)

    it('a plain toast is not critical; the Undo toast and its parts are', () => {
        for (const name of ['toast', 'toast-text', 'toast-sub', 'toast-dismiss']) expect(census.names, name).not.toContain(name)
        for (const name of ['toast-undo', 'toast-undo-text', 'toast-undo-sub', 'toast-undo-dismiss', 'toast-action']) expect(census.names, name).toContain(name)
    })

    it('the task toast root is marked, so its parts are critical', () => {
        expect(census.roots).toContain('task-toast')
        for (const name of ['task-toast', 'task-toast-title', 'task-toast-line', 'task-toast-open', 'task-toast-dismiss']) expect(census.names, name).toContain(name)
        expect(census.names).not.toContain('task-toast-more')
    })
})

describe('A8 holders, reach and safe', () => {
    const census = censusOfFiles(files)
    const parts = censusOfParts(files)
    const enclosing = enclosingPartsOfRoots(files)
    const holders = enclosing.names.filter((name) => !POPUPS_CRITICAL.includes(name))

    it('the holders are the toast containers, and the pinned list equals the census', () => {
        expect(enclosing.problems).toEqual([])
        expect(holders).toEqual(['task-toasts', 'toast-host'])
        expect(POPUPS_HOLDERS, `regenerate: ${JSON.stringify(holders)}`).toEqual(holders)
    })

    it('the pinned POPUPS_PARTS equals the census', () => {
        expect(POPUPS_PARTS, `regenerate: ${JSON.stringify(parts.parts)}`).toEqual(parts.parts)
    })

    it('the pinned POPUPS_REACH is the holders, the non-critical interactive parts and the alert close button', () => {
        const reach = [...new Set([...holders, ...parts.interactive, 'pattern-alert-close'])].filter((name) => !POPUPS_CRITICAL.includes(name)).sort()
        expect(POPUPS_REACH, `regenerate: ${JSON.stringify(reach)}`).toEqual(reach)
    })

    it('a safe part holds no interactive element and is neither critical nor reach', () => {
        expect(POPUPS_SAFE.length).toBeGreaterThan(0)
        for (const name of POPUPS_SAFE) {
            expect(parts.interactive, name).not.toContain(name)
            expect(POPUPS_CRITICAL, name).not.toContain(name)
            expect(POPUPS_REACH, name).not.toContain(name)
        }
        expect([...POPUPS_CRITICAL, ...POPUPS_REACH, ...POPUPS_SAFE].sort()).toEqual([...new Set([...POPUPS_PARTS, ...POPUPS_CRITICAL])].sort())
    })

    it('the critical set is the named parts and the closure, and every closure name is a listed part', () => {
        expect([...POPUPS_CRITICAL].sort()).toEqual([...new Set([...POPUPS_NAMED_CRITICAL, ...census.names])].sort())
        for (const name of census.names) expect(POPUPS_PARTS, name).toContain(name)
    })
})

describe('A9 the popup parts belong to no other area', () => {
    it('are disjoint from the chat parts and from Studio', () => {
        expect(POPUPS_PARTS.filter((name) => CHAT_PARTS.has(name))).toEqual([])
        expect(POPUPS_PARTS.filter((name) => STUDIO_CRITICAL.includes(name) || STUDIO_SAFE.includes(name))).toEqual([])
    })
})

describe('A10 names shared between critical and plain places', () => {
    it('the pinned list equals the parts that sit both inside a critical root and outside every marked subtree', () => {
        const census = censusOfFiles(files)
        const outside = censusOfParts(files).outsideRoots
        const shared = census.names.filter((name) => outside.includes(name))
        expect(POPUPS_SHARED_TOKENS_ONLY, `regenerate: ${JSON.stringify(shared)}`).toEqual(shared)
        for (const name of shared) expect(POPUPS_CRITICAL, name).toContain(name)
    })
})

describe('A11 tool-dialog parts are not critical', () => {
    it('tiles, tree nodes, the close button, field labels and tabs stay outside the critical set', () => {
        for (const name of ['pattern-alert-tile', 'pattern-alert-tree-node', 'pattern-alert-close', 'pattern-alert-field-label', 'pattern-alert-tab']) {
            expect(POPUPS_CRITICAL, name).not.toContain(name)
        }
    })
})
