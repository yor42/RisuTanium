// @vitest-environment node
// The overlay vocabulary of the popups area: `modal-*`, `memory-progress*` and `save-status-*` (#438 W3-1). Acceptance rows fail on the base
// by assertion: W1-T4 (every name is in no set there), W1-T5a (each sheet is refused as "is not a part of the popups screen"), the W1-T5b
// protected-part row and the accepted `display:none` on a safe name (the base refuses both by membership). The W1-T5b reach-hiding row passes
// on the base (display:none never yields the membership reason) and is acceptance on head: it kills a reach demotion. The census guards W1-T6a,
// W1-T6b and W1-T6c pass before and after: they pin rules over names that the base does not have yet.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isAreaPart } from './areaParts'
import { censusOfParts, svelteFilesUnder, TEST_ONLY_COMPONENTS } from './fixtures/criticalClosure'
import { judgeAreaSheet } from './index'
import { POPUPS_CRITICAL, POPUPS_FILES, POPUPS_PARTS, POPUPS_REACH, POPUPS_SAFE, POPUPS_SHARED_TOKENS_ONLY, isPopupsPart } from './registries/popups'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

type NameClass = 'safe' | 'reach' | 'critical'
const OVERLAY_NAMES: Readonly<Record<string, NameClass>> = {
    'modal-popup-editor': 'reach', 'modal-listed-persona': 'reach', 'modal-frame': 'reach', 'modal-header': 'reach', 'modal-title': 'safe', 'modal-controls': 'reach',
    'modal-field': 'reach', 'modal-action': 'reach', 'modal-close': 'reach', 'modal-body': 'reach', 'modal-text': 'safe', 'modal-footer': 'reach', 'modal-row': 'reach',
    'memory-progress': 'reach', 'memory-progress-card': 'reach', 'memory-progress-text': 'safe', 'memory-progress-bar': 'safe', 'memory-progress-bar-fill': 'safe',
    'memory-progress-subtext': 'safe', 'memory-progress-pill': 'reach', 'memory-progress-mini': 'safe',
    'save-status-alert': 'critical', 'save-status-note': 'safe', 'save-status-saving': 'safe',
}
const OVERLAY_NAME = /^(modal-|memory-progress|save-status-)/

const verdict = (css: string): { ok: boolean; why: string[] } => {
    const judged = judgeAreaSheet('popups', css, undefined, 'popups')
    return { ok: judged.result.ok, why: judged.result.errors.map((e) => e.why) }
}

describe('W1-T4 every overlay name sits in exactly its expected set', () => {
    it.each(Object.entries(OVERLAY_NAMES))('%s is %s', (name, expected) => {
        expect(POPUPS_PARTS).toContain(name)
        expect(POPUPS_CRITICAL.includes(name), 'critical').toBe(expected === 'critical')
        expect(POPUPS_REACH.includes(name), 'reach').toBe(expected === 'reach')
        expect(POPUPS_SAFE.includes(name), 'safe').toBe(expected === 'safe')
    })

    it('the table lists every overlay name the registry has', () => {
        expect(POPUPS_PARTS.filter((name) => OVERLAY_NAME.test(name)).sort()).toEqual(Object.keys(OVERLAY_NAMES).sort())
    })
})

describe('W1-T5a a popups sheet may restyle the safe and reach overlay names', () => {
    it.each([
        '[data-part="modal-frame"]{border-radius:12px;background:#223344}',
        '[data-part="modal-popup-editor"] [data-part="modal-title"]{letter-spacing:1px}',
        '[data-part="memory-progress-bar-fill"]{background:#7a1f5c}',
        '[data-part="save-status-note"]{padding:4px}',
    ])('%s is accepted', (css) => {
        const { ok, why } = verdict(css)
        expect(ok, `${css} -> ${JSON.stringify(why)}`).toBe(true)
    })
})

describe('W1-T5b a popups sheet can neither hide a reach overlay name nor style the save-problem button', () => {
    it('hiding a reach name is refused with the declaration-allowlist reason', () => {
        const { ok, why } = verdict('[data-part="modal-close"]{display:none}')
        expect(ok).toBe(false)
        expect(why.some((w) => /display: is not on the declaration allowlist for a surface that can contain or be a protected element/.test(w)), JSON.stringify(why)).toBe(true)
    })

    it('hiding a safe name is accepted', () => {
        const { ok, why } = verdict('[data-part="modal-title"]{display:none}')
        expect(ok, JSON.stringify(why)).toBe(true)
    })

    it('styling save-status-alert is refused as a protected part', () => {
        const { ok, why } = verdict('[data-part="save-status-alert"]{background:#ff0000}')
        expect(ok).toBe(false)
        expect(why.some((w) => /names the protected part save-status-alert/.test(w)), JSON.stringify(why)).toBe(true)
    })
})

describe('W1-T6a the critical subtree never uses the shared modal vocabulary (guard)', () => {
    it('no modal-* name is critical or tokens-only', () => {
        expect(POPUPS_CRITICAL.filter((name) => name.startsWith('modal-'))).toEqual([])
        expect(POPUPS_SHARED_TOKENS_ONLY.filter((name) => name.startsWith('modal-'))).toEqual([])
    })
})

describe('W1-T6b the overlay vocabulary is rendered only by files the census reads (guard)', () => {
    it('every product component that renders a modal-*, memory-progress* or save-status-* name is in POPUPS_FILES', () => {
        const skipped = new Set(TEST_ONLY_COMPONENTS.map((file) => path.resolve(root, file)))
        const listed = new Set(POPUPS_FILES.map((file) => path.resolve(root, file)))
        const outside: string[] = []
        for (const file of svelteFilesUnder(path.join(root, 'src/lib'))) {
            if (skipped.has(file) || listed.has(file)) continue
            const names = censusOfParts([file]).parts.filter((name) => OVERLAY_NAME.test(name))
            if (names.length > 0) outside.push(`${path.relative(root, file).split(path.sep).join('/')}: ${names.join(', ')}`)
        }
        expect(outside).toEqual([])
    })
})

describe('W1-T6c popups names belong to no other area, and membership stays exact (guard)', () => {
    it('no popups part is a chat, studio, settings or home part', () => {
        for (const area of ['chat', 'studio', 'settings', 'home'] as const) {
            expect(POPUPS_PARTS.filter((name) => isAreaPart(area, name)), area).toEqual([])
        }
    })

    it('isPopupsPart is false for a name that only shares a prefix', () => {
        for (const name of ['modal-unknown', 'memory-progress-x', 'save-status-x']) expect(isPopupsPart(name), name).toBe(false)
    })
})
