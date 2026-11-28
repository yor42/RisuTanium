// @vitest-environment node
// Stage P (#654, MC-4702, H-7): the overlay host's colour roles. The dialogs, alerts, toasts and overlays mount from App.svelte outside every
// screen root, so one host element re-points the Tailwind scheme names at --overlay-* roles (overlay-roles.css). These rows fail when a role
// default drifts from the scheme (a visible change with no pack), when the remap loses a name (a role nothing reads), or when an overlay
// host mounts outside the overlay host (a popup unreadable once a pack recolours the roles).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COLOUR_READY_AREAS } from './colourReady'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8')

/** Tailwind scheme name and the overlay role that replaces it inside the overlay host. */
const ROLES = [
    { scheme: 'textcolor', role: '--overlay-fg' },
    { scheme: 'textcolor2', role: '--overlay-fg-2' },
    { scheme: 'bgcolor', role: '--overlay-canvas' },
    { scheme: 'darkbg', role: '--overlay-surface' },
    { scheme: 'darkbutton', role: '--overlay-surface-raised' },
    { scheme: 'selected', role: '--overlay-selected' },
    { scheme: 'borderc', role: '--overlay-edge' },
    { scheme: 'darkborderc', role: '--overlay-edge-strong' },
    { scheme: 'draculared', role: '--overlay-danger' },
] as const

/** Custom-property declarations of the first rule whose selector equals `selector`, comments and whitespace normalised. */
function declarations(css: string, selector: string): Map<string, string> {
    const out = new Map<string, string>()
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].replace(/\s+/g, ' ').trim() === selector)
    if (!rule) return out
    for (const d of rule[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(d[1], d[2].trim())
    return out
}

const rolesCss = read('src/styles/overlay-roles.css')

describe('H-7.1 overlay role tokens', () => {
    it('each role aliases the scheme role its Tailwind name read, at the root and on an own-scheme island', () => {
        const app = declarations(rolesCss, ':root, [data-own-scheme]')
        expect(app.size).toBe(ROLES.length)
        for (const { scheme, role } of ROLES) expect(app.get(role), role).toBe(`var(--risu-theme-${scheme})`)
    })

    it('overlay-roles.css re-points exactly the nine scheme names at their roles, on the overlay host only', () => {
        const map = declarations(rolesCss, '.overlay-host')
        const expected = ROLES.map(({ scheme, role }) => [`--color-${scheme}`, `var(${role})`])
        expect([...map.entries()].sort()).toEqual(expected.sort())
    })

    it('src/styles.css maps each scheme name to its scheme role, so the remap is the identity with no pack', () => {
        const theme = read('src/styles.css')
        for (const { scheme } of ROLES) expect(theme, scheme).toMatch(new RegExp(`--color-${scheme}:\\s*var\\(--risu-theme-${scheme}\\)`))
    })

    it('the host sets the inherited text colour from the text role, so text with no own class follows it', () => {
        expect(rolesCss.replace(/\/\*[\s\S]*?\*\//g, '')).toMatch(/\.overlay-host\s*\{[^}]*\bcolor:\s*var\(--overlay-fg\);/)
    })

    it('every role is read by the remap, so none is a colour nothing reads', () => {
        const remap = [...declarations(rolesCss, '.overlay-host').values()].join(' ')
        for (const { role } of ROLES) expect(remap, role).toContain(`var(${role})`)
    })
})

describe('the overlay host in App.svelte', () => {
    const app = read('src/App.svelte').replace(/\r\n/g, '\n')
    const open = app.indexOf('<div class="overlay-host" style="display: contents">')
    const close = app.indexOf('</div>\n</main>')
    const inside = app.slice(open, close)

    it('imports the roles and does not change layout (display: contents)', () => {
        expect(app).toContain("import './styles/overlay-roles.css'")
        expect(open).toBeGreaterThan(0)
        expect(close).toBeGreaterThan(open)
    })

    it('holds every popup, alert, task and toast host, and none of the screens or the boot escape', () => {
        for (const tag of ['<AlertComp />', '<TaskHost', '<RealmPopUp', '<RealmFrame', '<Botpreset', '<ListedPersona', '<BookmarkList', '<MemoryModalHost', '<SavePopupIconComp', '<HypaV3Progress', '<PopupList', '<EasyPanel', '<PopupEditor', '<LoadoutModal', '<IrisModal', '<CustomSidebarConfig', '<ToastHost'])
            expect(inside, tag).toContain(tag)
        for (const tag of ['<BootPackEscape', '<SettingsSurface', '<ChatScreen', '<GridChars', '<WelcomeRisu'])
            expect(inside, tag).not.toContain(tag)
    })
})

describe('MC-4707 timing', () => {
    it('popups roles ship invisible: the colour-ready set is unchanged', () => {
        expect([...COLOUR_READY_AREAS]).toEqual(['chat'])
    })
})
