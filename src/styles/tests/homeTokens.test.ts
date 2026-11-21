// @vitest-environment jsdom
import postcss from 'postcss'
import { afterEach, describe, expect, test } from 'vitest'
import { CascadeModel, compileRules, readRepoFile as read } from './cascadeModel'

const APP_FILE = 'src/styles/home-tokens.css'
const REGISTRY_FILE = 'docs/design/home/home-tokens.css'

/** The registry names the landing reads, with the colour roles aliased to the app's scheme-derived roles. */
const ALIAS_TABLE: Readonly<Record<string, string>> = {
    '--home-ink': 'var(--nexus-text)',
    '--home-ink-2': 'var(--nexus-text-secondary)',
    '--home-ink-3': 'var(--nexus-text-muted)',
    '--home-accent-solid': 'var(--nexus-accent)',
    '--home-accent-fill': 'var(--color-accent-tint-strong)',
    '--home-danger-solid': 'var(--nexus-danger)',
}

const BAND_SELECTORS = ['phone', 'mid', 'wide'].map((band) => `.home-root[data-layout="${band}"]`)
const ALLOWED_SELECTORS = [':root', ':root:lang(ko)', ...BAND_SELECTORS]

const norm = (value: string) => value.replace(/\s+/g, ' ').trim()

/** Custom-property declarations per top-level selector, in source order. */
function declarationsBySelector(css: string): Map<string, Map<string, string>> {
    const result = new Map<string, Map<string, string>>()
    postcss.parse(css).walkRules((rule) => {
        if (rule.parent?.type !== 'root') return
        const own = result.get(norm(rule.selector)) ?? new Map<string, string>()
        rule.walkDecls((decl) => {
            if (decl.prop.startsWith('--')) own.set(decl.prop, norm(decl.value))
        })
        result.set(norm(rule.selector), own)
    })
    return result
}

const allNames = (css: string) => {
    const names: string[] = []
    postcss.parse(css).walkDecls((decl) => { if (decl.prop.startsWith('--')) names.push(decl.prop) })
    return names
}

const appCss = read(APP_FILE)
const registryCss = read(REGISTRY_FILE)
const app = declarationsBySelector(appCss)
const registry = declarationsBySelector(registryCss)

describe('home tokens file (S1-G1)', () => {
    test('the only rules carrying custom properties are :root, :root:lang(ko) and the landing band blocks; plain .home-root declares none', () => {
        const selectors = [...app.entries()].filter(([, decls]) => decls.size > 0).map(([selector]) => selector)
        expect(selectors.filter((selector) => !ALLOWED_SELECTORS.includes(selector))).toEqual([])
        expect(selectors).toContain(':root')
        expect(app.get('.home-root')?.size ?? 0).toBe(0)
    })

    test('every declared name is a registry name or carries the internal prefix, and the registry has no internal prefix', () => {
        const registryNames = new Set(allNames(registryCss))
        const own = allNames(appCss)
        expect(own.filter((name) => !registryNames.has(name) && !name.startsWith('--homeapp-'))).toEqual([])
        expect([...registryNames].filter((name) => name.startsWith('--homeapp-'))).toEqual([])
    })

    test('the :root block: alias-table names carry the table value, every other name the registry first :root value', () => {
        const rootBlock = app.get(':root')!
        const registryRoot = registry.get(':root')!
        const wrong: string[] = []
        for (const [name, value] of rootBlock) {
            const expected = name in ALIAS_TABLE ? ALIAS_TABLE[name] : registryRoot.get(name)
            if (expected === undefined || norm(expected) !== value) wrong.push(`${name}: ${value} (expected ${expected})`)
        }
        expect(wrong).toEqual([])
        for (const name of Object.keys(ALIAS_TABLE)) expect(rootBlock.has(name), name).toBe(true)
    })

    test('each band block restates the registry html[data-layout] block and the ko block restates html[data-lang="ko"]', () => {
        const wrong: string[] = []
        const restate = (appSelector: string, registrySelector: string) => {
            const own = app.get(appSelector)
            const reference = registry.get(registrySelector)
            if (!own) return
            for (const [name, value] of own) {
                if (reference?.get(name) !== value) wrong.push(`${appSelector} ${name}: ${value} (registry ${reference?.get(name)})`)
            }
        }
        for (const band of ['phone', 'mid', 'wide']) restate(`.home-root[data-layout="${band}"]`, `html[data-layout="${band}"]`)
        restate(':root:lang(ko)', 'html[data-lang="ko"]')
        expect(wrong).toEqual([])
        expect(app.get('.home-root[data-layout="phone"]')?.get('--home-h1-size')).toBe('24px')
        expect(app.get(':root:lang(ko)')?.get('--home-tracking-h1')).toBe('0')
    })

    test('no custom property overlaps the shared token files', () => {
        const own = new Set(allNames(appCss))
        const shared = [
            'src/styles/nexus-tokens.css', 'src/styles/nexus.css', 'src/styles/pattern-tokens.css',
            'src/styles/chat-tokens.css', 'src/styles/chat-light-base.css', 'src/styles/studio-tokens.css',
        ].flatMap((file) => allNames(read(file)))
        expect(shared.filter((name) => own.has(name))).toEqual([])
    })

    test('the file holds no color-mix, no raw scheme name and no color-scheme', () => {
        expect(appCss).not.toContain('color-mix(')
        expect(appCss).not.toContain('--risu-theme-')
        expect(appCss).not.toContain('color-scheme')
    })

    test('styles.css does not load the file and HomeShell imports it', () => {
        expect(read('src/styles.css')).not.toContain('home-tokens.css')
        expect(read('src/lib/UI/Home/HomeShell.svelte')).toContain("import '../../../styles/home-tokens.css'")
    })
})

describe('a pack value reaches the landing (S1-G5)', () => {
    afterEach(() => {
        document.documentElement.removeAttribute('lang')
        document.documentElement.removeAttribute('style')
        document.body.innerHTML = ''
    })

    function h1Under(band: string, lang: string): HTMLElement {
        document.documentElement.setAttribute('lang', lang)
        document.documentElement.style.setProperty('--risu-theme-textcolor', '#f8f8f2')
        document.documentElement.style.setProperty('--risu-theme-textcolor2', '#64748b')
        document.body.innerHTML = `<div class="home-root" data-part="home-landing" data-layout="${band}"><header data-part="home-greeting"><h1></h1></header></div>`
        return document.querySelector('h1')!
    }

    function modelWith(packCss: string): CascadeModel {
        const sheets = [
            { name: 'nexus-tokens', css: read('src/styles/nexus-tokens.css') },
            { name: 'home-tokens', css: appCss },
            { name: 'pack', css: packCss },
        ]
        return new CascadeModel(compileRules(sheets))
    }

    test('(a) without a pack the landing h1 size is the registry value', () => {
        const h1 = h1Under('wide', 'en')
        expect(modelWith('').custom(h1, '--home-h1-size')).toBe('30px')
    })

    test('(b) a plain :root pack value wins at wide and mid and yields to the registry phone value', () => {
        const pack = ':root{--home-h1-size:36px;--home-ink-2:#123456}'
        for (const [band, size] of [['wide', '36px'], ['mid', '36px'], ['phone', '24px']] as const) {
            const h1 = h1Under(band, 'en')
            const model = modelWith(pack)
            expect(model.custom(h1, '--home-h1-size'), band).toBe(size)
            expect(model.custom(h1, '--home-ink-2'), band).toBe('#123456')
        }
    })

    test('(c) a chat role set by a pack reaches the home role that aliases it', () => {
        const h1 = h1Under('wide', 'en')
        expect(modelWith(':root{--nexus-text-secondary:#abcdef}').custom(h1, '--home-ink-2')).toBe('#abcdef')
    })

    test('(d) a pack ladder value flows through the h1 size chain', () => {
        const h1 = h1Under('wide', 'en')
        expect(modelWith(':root{--home-text-2xl:40px}').custom(h1, '--home-h1-size')).toBe('40px')
    })

    test('(f) the side block row tokens resolve to the registry values under the wide band', () => {
        const h1 = h1Under('wide', 'en')
        const model = modelWith('')
        expect(model.custom(h1, '--home-text-md')).toBe('14px')
        expect(model.custom(h1, '--home-text-xs')).toBe('12px')
        expect(model.custom(h1, '--home-radius-1')).toBe('4px')
        expect(model.custom(h1, '--home-radius-3')).toBe('8px')
    })

    test('(g) S2b2-G5: the page and Realm tokens resolve per band on a landing child, and the S2b-2 band blocks restate the registry', () => {
        const expected = {
            wide: { '--home-realm-min-height': '380px', '--home-realm-list-max': '200px', '--home-main-pad-x': '32px' },
            mid: { '--home-realm-min-height': '296px', '--home-realm-list-max': '150px', '--home-main-pad-x': '24px' },
            phone: { '--home-realm-min-height': '296px', '--home-realm-list-max': '150px', '--home-main-pad-x': '16px' },
        } as const
        for (const [band, values] of Object.entries(expected)) {
            document.body.innerHTML = `<div class="home-root" data-layout="${band}"><section></section></div>`
            const section = document.querySelector('section')!
            const model = modelWith('')
            for (const [name, value] of Object.entries(values)) expect(model.custom(section, name), `${band} ${name}`).toBe(value)
        }
        document.body.innerHTML = '<div class="home-root" data-layout="phone"><section></section></div>'
        const phone = document.querySelector('section')!
        const phoneModel = modelWith('')
        expect(phoneModel.custom(phone, '--home-main-pad-top')).toBe('16px')
        expect(phoneModel.custom(phone, '--home-main-pad-bottom')).toBe('96px')
        expect(app.get(':root')?.get('--home-text-lg')).toBe('17px')
        expect(app.get(':root')?.get('--home-card-pad-lg')).toBe('var(--home-space-10)')
    })

    test('(h) S3b-G1: the story shelf tokens resolve per band and language on a landing child', () => {
        const expected = {
            wide: { '--home-text-quote': '19px', '--home-avatar-lg': '72px', '--home-lead-portrait': '168px' },
            mid: { '--home-text-quote': '19px', '--home-avatar-lg': '72px', '--home-lead-portrait': '168px' },
            phone: { '--home-text-quote': '16px', '--home-avatar-lg': '56px', '--home-lead-portrait-phone': '88px' },
        } as const
        for (const [band, values] of Object.entries(expected)) {
            document.body.innerHTML = `<div class="home-root" data-layout="${band}"><section></section></div>`
            const section = document.querySelector('section')!
            const model = modelWith('')
            for (const [name, value] of Object.entries(values)) expect(model.custom(section, name), `${band} ${name}`).toBe(value)
        }
        expect(app.get(':root')?.get('--home-leading-quote')).toBe('1.55')
        expect(app.get(':root')?.get('--home-card-radius')).toBe('var(--home-radius-7)')
        document.documentElement.setAttribute('lang', 'ko')
        document.body.innerHTML = '<div class="home-root" data-layout="wide"><section></section></div>'
        const ko = modelWith('')
        expect(ko.unmodelled.filter((entry) => entry.includes(':lang'))).toEqual([])
        expect(ko.custom(document.querySelector('section')!, '--home-leading-quote')).toBe('1.7')
    })

    test('(e) the Korean block outranks a pack plain :root value', () => {
        const h1 = h1Under('wide', 'ko')
        const model = modelWith(':root{--home-tracking-h1:0.05em}')
        expect(model.unmodelled.filter((entry) => entry.includes(':lang'))).toEqual([])
        expect(model.custom(h1, '--home-tracking-h1')).toBe('0')
    })
})
