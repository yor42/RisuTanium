// @vitest-environment jsdom

/**
 * `DropList.svelte`: the move-up and move-down buttons of every row are named and their glyphs are
 * hidden. Mounts the REAL component; nothing is mocked.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'

import { language } from 'src/lang'
import { controlName, exposedIcons, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import DropList from './DropList.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountList(list: string[]): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(DropList, { target, props: { list } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('DropList accessible names', () => {
    test('regression reproducer: each row has a named move-up and move-down button', () => {
        const target = mountList(['main', 'description', 'jailbreak'])
        const buttons = Array.from(target.querySelectorAll('button'))
        expect(buttons).toHaveLength(6)
        expect(buttons.map(controlName)).toEqual([
            language.chatShellMoveUp, language.chatShellMoveDown,
            language.chatShellMoveUp, language.chatShellMoveDown,
            language.chatShellMoveUp, language.chatShellMoveDown,
        ])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the chevron glyphs are hidden from the accessibility tree', () => {
        const target = mountList(['main', 'description'])
        expect(exposedIcons(target)).toEqual([])
    })
})
