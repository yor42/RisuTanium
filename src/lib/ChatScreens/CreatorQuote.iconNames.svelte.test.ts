// @vitest-environment jsdom

/**
 * The REAL `CreatorQuote.svelte`: the remove button is named Close and its glyph is hidden from
 * assistive technology. MOCKED: `MultiLangDisplay.svelte`, which renders the quote markup only.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

vi.mock('../UI/GUI/MultiLangDisplay.svelte', () => ({ default: () => ({ destroy: () => {} }) }))

import { language } from 'src/lang'
import { controlName, exposedIcons, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import CreatorQuote from './CreatorQuote.svelte'

let target: HTMLElement | null = null
let instance: ReturnType<typeof mount> | null = null

afterEach(async () => {
    if (instance) await unmount(instance)
    target?.remove()
    instance = null
    target = null
})

describe('CreatorQuote accessible names', () => {
    test('regression reproducer: the remove button is named Close, calls onRemove and hides its glyph', () => {
        const onRemove = vi.fn()
        target = document.createElement('div')
        document.body.appendChild(target)
        instance = mount(CreatorQuote, { target, props: { quote: 'Hi', onRemove } })
        flushSync()
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
        const button = target.querySelector('button')!
        expect(controlName(button)).toBe(language.uiCommon.close)
        button.click()
        expect(onRemove).toHaveBeenCalledTimes(1)
    })
})
