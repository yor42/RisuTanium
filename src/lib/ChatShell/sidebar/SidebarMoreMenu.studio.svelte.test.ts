// @vitest-environment jsdom
/**
 * The Studio row of the sidebar's More menu. With the switch off the menu is exactly the old list
 * (compatibility guard); with it on the row closes More first and opens the selected character.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

interface TestCharacter {
    chaId: string
    type: string
    chatPage: number
    chats: { id: string }[]
}

const db = $state({ db: { enableDevTools: false, characters: [] as TestCharacter[] } })
const selection = $state({ selId: 0 })
const MobileGUI = writable(false)
const settingsOpen = writable(false)

vi.mock('src/ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    PlaygroundStore: writable(0),
    additionalHamburgerMenu: [],
    alertStore: writable({ type: 'none', msg: '' }),
    bookmarkListOpen: writable(false),
    selectedCharID: writable(0),
}))
const charConfigProps = vi.hoisted(() => ({ received: [] as Record<string, unknown>[] }))
vi.mock('../../SideBars/CharConfig.svelte', () => ({
    default: (_anchor: unknown, props: Record<string, unknown>) => {
        charConfigProps.received.push(props)
        return {}
    },
}))
vi.mock('../../SideBars/DevTool.svelte', () => ({ default: () => ({}) }))
vi.mock('../../Others/PluginDefinedIcon.svelte', () => ({ default: () => ({}) }))
const languageMock = vi.hoisted(() => ({
    language: new Proxy({ settingsPage: { back: 'Back' }, playground: { playground: 'Playground' } } as Record<string, unknown>, {
        get: (target, key) => key in target ? target[key as string] : String(key),
    }),
}))
vi.mock('src/lang', () => languageMock)
vi.mock('../../../lang', () => languageMock)

import SidebarMoreMenu from './SidebarMoreMenu.svelte'
import { resetStudioScreenForTests, studioScreen } from '../../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../../ts/studio/studioSwitch.svelte'
import { studioOpen } from '../../../ts/studio/studioOpen'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined
let calls: string[]

function show(): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(SidebarMoreMenu, {
        target: host,
        props: {
            reseter: vi.fn(),
            onclose: () => { calls.push(`close:${get(studioOpen)}`) },
            afterAction: vi.fn(),
        },
    })
    flushSync()
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-part="more-list"] > button'))

beforeEach(() => {
    calls = []
    localStorage.clear()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    db.db.enableDevTools = false
    db.db.characters = [{ chaId: 'char-a', type: 'character', chatPage: 0, chats: [{ id: 'c' }] }]
    selection.selId = 0
    setStudioEnabled(false)
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    resetStudioScreenForTests()
    setStudioEnabled(false)
    localStorage.clear()
})

describe('2l switch off', () => {
    test('More lists exactly the old rows and no Studio row', () => {
        show()
        expect(document.querySelector('[data-part="more-studio"]')).toBeNull()
        expect(rows().length).toBe(4)
    })
})

describe('2l the embedded Character settings', () => {
    test('they are opened without their own Studio entry, since More has the row', () => {
        setStudioEnabled(true)
        charConfigProps.received = []
        show()
        rows()[0].click()
        flushSync()
        expect(charConfigProps.received.length).toBeGreaterThan(0)
        expect(charConfigProps.received.every((props) => props.studioEntry === false)).toBe(true)
    })
})

describe('2m switch on', () => {
    test('the row follows Character settings, closes More first, then opens the selected character', () => {
        setStudioEnabled(true)
        show()
        const list = rows()
        expect(list.length).toBe(5)
        const row = document.querySelector<HTMLElement>('[data-part="more-studio"]')
        expect(row).not.toBeNull()
        expect(list.indexOf(row as HTMLElement)).toBe(1)

        row?.click()
        flushSync()
        expect(calls).toEqual(['close:false'])
        expect(get(studioOpen)).toBe(true)
        expect(studioScreen.chaId).toBe('char-a')
        expect(studioScreen.target).toEqual({ owner: { type: 'character', id: 'char-a' }, from: 'chat' })
        expect(studioScreen.opener?.selector).toBe('[data-part="sidebar-more"]')
    })

    test('an ineligible selection or the Beta Mobile GUI shows no row', () => {
        setStudioEnabled(true)
        db.db.characters[0].type = 'group'
        show()
        expect(document.querySelector('[data-part="more-studio"]')).toBeNull()
        db.db.characters[0].type = 'character'
        flushSync()
        expect(document.querySelector('[data-part="more-studio"]')).not.toBeNull()
        MobileGUI.set(true)
        flushSync()
        expect(document.querySelector('[data-part="more-studio"]')).toBeNull()
    })
})
