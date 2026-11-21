// @vitest-environment jsdom

/**
 * With `labelId`, every `KeyListInput` row is named by the caller's visible label through
 * `aria-labelledby`: the label alone for the sole row, the label plus the row position for key rows
 * and the label plus the add-another text for the trailing empty row. The description leads with the
 * label. Without `labelId` the numbered `aria-label` names stay. Names are computed from the DOM the
 * way a browser resolves `aria-labelledby`.
 *
 * MOCKED: nothing; the real component, language table and splitter run.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { unnamedControls } from 'src/lib/a11yNames.test-helpers'
import KeyListInput from './KeyListInput.svelte'

const LABEL_ID = 'field-label'
const LABEL = 'OpenAI API key'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function setup(initial: string, labelId?: string): HTMLElement {
    const box = $state({ value: initial })
    const target = document.createElement('div')
    document.body.appendChild(target)
    const label = document.createElement('span')
    label.id = LABEL_ID
    label.textContent = LABEL
    target.appendChild(label)
    const holder = document.createElement('div')
    target.appendChild(holder)
    const app = mount(KeyListInput, {
        target: holder,
        props: {
            get value() { return box.value },
            set value(next: string) { box.value = next },
            labelId,
        },
    }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function rowsOf(target: HTMLElement): HTMLInputElement[] {
    return Array.from(target.querySelectorAll('input'))
}

function textOfIds(row: Element, attribute: string): string {
    return (row.getAttribute(attribute) ?? '')
        .split(/\s+/)
        .filter((id) => id !== '')
        .map((id) => (document.getElementById(id)?.textContent ?? '').trim())
        .join(' ')
}

const nameOf = (row: Element) => textOfIds(row, 'aria-labelledby')
const namesOf = (target: HTMLElement) => rowsOf(target).map(nameOf)

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('KeyListInput rows named by a caller label', () => {
    test('the sole row is named by the label alone', () => {
        const target = setup('', LABEL_ID)
        const [row] = rowsOf(target)
        expect(rowsOf(target)).toHaveLength(1)
        expect(row.getAttribute('aria-label')).toBeNull()
        expect(nameOf(row)).toBe(LABEL)
    })

    test('two keys: label with position for each key row, label with add-another for the empty row', () => {
        const target = setup('sk-A\nsk-B', LABEL_ID)
        expect(rowsOf(target)).toHaveLength(3)
        for (const row of rowsOf(target)) {
            expect(row.getAttribute('aria-label')).toBeNull()
        }
        expect(namesOf(target)).toEqual([`${LABEL} 1`, `${LABEL} 2`, `${LABEL} ${language.settingsPage.addAnotherKey}`])
    })

    test('the description leads with the label and then the separator hint', () => {
        const target = setup('sk-A\nsk-B', LABEL_ID)
        for (const row of rowsOf(target)) {
            const described = (row.getAttribute('aria-describedby') ?? '').split(/\s+/)
            expect(described[0]).toBe(LABEL_ID)
            // The description repeats the whole name (label and position) before the hint.
            expect(textOfIds(row, 'aria-describedby')).toBe(`${textOfIds(row, 'aria-labelledby')} ${language.settingsPage.keySeparatorHint}`)
        }
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('names re-number after an emptied middle row is removed on focusout', () => {
        const target = setup('sk-A\nsk-B\nsk-C', LABEL_ID)
        expect(namesOf(target)).toEqual([
            `${LABEL} 1`, `${LABEL} 2`, `${LABEL} 3`, `${LABEL} ${language.settingsPage.addAnotherKey}`,
        ])
        const middle = rowsOf(target)[1]
        middle.focus()
        middle.value = ''
        middle.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward' }))
        middle.dispatchEvent(new FocusEvent('focusout'))
        flushSync()
        expect(namesOf(target)).toEqual([`${LABEL} 1`, `${LABEL} 2`, `${LABEL} ${language.settingsPage.addAnotherKey}`])
    })

    test('naming ids are unique per instance and per row', () => {
        const first = setup('sk-A', LABEL_ID)
        const second = setup('sk-A', LABEL_ID)
        const ids = [...Array.from(first.querySelectorAll('span.sr-only[id]')), ...Array.from(second.querySelectorAll('span.sr-only[id]'))].map((el) => el.id)
        expect(ids).toHaveLength(4)
        expect(new Set(ids).size).toBe(4)
    })
})

describe('KeyListInput without a caller label', () => {
    test('keeps the numbered aria-label names and the hint-only description', () => {
        const target = setup('sk-A\nsk-B')
        const rows = rowsOf(target)
        expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
            fillLang(language.settingsPage.keyRowLabel, { n: 1 }),
            fillLang(language.settingsPage.keyRowLabel, { n: 2 }),
            language.settingsPage.addAnotherKey,
        ])
        for (const row of rows) {
            expect(row.hasAttribute('aria-labelledby')).toBe(false)
            expect(textOfIds(row, 'aria-describedby')).toBe(language.settingsPage.keySeparatorHint)
        }
        expect(target.querySelectorAll('span.sr-only[id]')).toHaveLength(0)
    })
})
