// @vitest-environment jsdom
/**
 * The colour-consumption contract (H-7) in docs/design/THEMING.md: its ids exist, the code comments that cite it name ids that
 * exist, and the ordering rule H-7.3 states holds in the cascade model (a later area base block wins over a shared chat base
 * block only when it is imported after it).
 */
import { afterEach, describe, expect, test } from 'vitest'
import { CascadeModel, compileRules, readRepoFile as read } from '../../styles/tests/cascadeModel'

const THEMING = read('docs/design/THEMING.md')
const IDS = ['H-7.1', 'H-7.2', 'H-7.3', 'H-7.4', 'H-7.5', 'H-7.6', 'H-7.7', 'H-7.8', 'H-7.9', 'H-7a']

describe('H-7 in THEMING.md (T2, guard)', () => {
    test('the section and each of its ids exist', () => {
        expect(THEMING).toContain('## Colour-consumption contract (H-7)')
        for (const id of IDS) {
            expect(THEMING, id).toContain(`**${id} `)
        }
    })

    test('every H-7 id cited in the code names an id that exists', () => {
        const cited = ['src/ts/themePack/colourReady.ts', 'src/ts/themePack/shapeMode.ts', 'src/ts/themePack/colourAreas.ts', 'src/ts/themePack/apply.ts']
            .flatMap((file) => [...read(file).matchAll(/H-7(?:\.\d)?a?/g)].map((match) => match[0]))
        expect(cited.length).toBeGreaterThan(0)
        for (const id of cited) {
            expect(id === 'H-7' || IDS.includes(id), id).toBe(true)
        }
        expect(read('src/ts/themePack/shapeMode.ts')).toContain('H-7a')
    })

    test('H-7.3 states the import-order rule and H-7.8 names the chat-owned readers', () => {
        expect(THEMING).toMatch(/imported after `chat-pack-base\.css`/)
        for (const reader of ['ChatScreen.svelte', 'ChatShell.svelte', 'ShellMessage.svelte']) {
            expect(THEMING).toContain(reader)
            expect(read(`src/lib/${reader === 'ChatScreen.svelte' ? 'ChatScreens' : 'ChatShell'}/${reader}`)).toContain(':root')
        }
    })
})

describe('area base block ordering (H-7.3)', () => {
    afterEach(() => {
        document.documentElement.removeAttribute('data-theme-pack-base')
        document.documentElement.removeAttribute('data-theme-pack-area')
    })

    const CHAT_BASE = read('src/styles/chat-pack-base.css')
    // A test-local block: a later area base block overriding a name the chat base block also sets.
    const HOME_BASE = ':root:where([data-theme-pack-base][data-theme-pack-area="home"]){--surface-pack-backdrop:#123456}'
    const valueWith = (order: string[], area: string | null): string => {
        const css: Record<string, string> = { chat: CHAT_BASE, home: HOME_BASE }
        document.documentElement.setAttribute('data-theme-pack-base', '')
        if (area !== null) document.documentElement.setAttribute('data-theme-pack-area', area)
        const model = new CascadeModel(compileRules(order.map((name) => ({ name, css: css[name] }))))
        return model.custom(document.documentElement, '--surface-pack-backdrop')
    }

    test('imported after chat-pack-base.css, the home block wins under the home area and not under chat', () => {
        expect(valueWith(['chat', 'home'], 'home')).toBe('#123456')
        expect(valueWith(['chat', 'home'], 'chat')).toBe('#000')
    })

    test('imported before chat-pack-base.css, the presence-only chat block wins at equal specificity', () => {
        expect(valueWith(['home', 'chat'], 'home')).toBe('#000')
    })

    test('an inactive area never matches', () => {
        expect(valueWith(['chat', 'home'], null)).toBe('#000')
    })
})
