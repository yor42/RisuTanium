// @vitest-environment happy-dom

/**
 * `ModuleChatMenu.svelte` (the chat's module picker): rows follow the array order of
 * `db.modules` (the search only filters), and each row's toggle acts on that row's own
 * module whatever its position.
 *
 * Mounts the REAL `ModuleChatMenu.svelte` over a real `$state` database. Titles beginning
 * "guard:" pin behaviour that must be preserved; "regression reproducer:" titles fail
 * against a picker that sorts by name.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
        SettingsMenuIndex: writable(0),
        settingsOpen: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import ModuleChatMenu from './ModuleChatMenu.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

function makeModule(name: string): RisuModule {
    return { name, description: '', id: 'id-' + name } as RisuModule
}

function installDb(modules: RisuModule[]): void {
    DBState.db = {
        modules,
        enabledModules: [],
        characters: [{ modules: [], chatPage: 0, chats: [{ modules: [] }] }],
    } as unknown as Database
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function mountMenu(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModuleChatMenu, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

/** Each row is a `div.pl-3`; its name is the first span and its toggle the last button. */
const rows = (target: HTMLElement) => Array.from(target.querySelectorAll('div.pl-3.py-3')) as HTMLElement[]
const rowNames = (target: HTMLElement) => rows(target).map((r) => r.querySelector('span')?.textContent?.trim())

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('the chat module picker order', () => {
    test('regression reproducer: rows follow the array order, not the name order', () => {
        installDb([makeModule('B'), makeModule('A'), makeModule('C')])
        const target = mountMenu()
        expect(rowNames(target)).toEqual(['B', 'A', 'C'])
    })

    test('guard: the search filters the rows and keeps the array order', async () => {
        installDb([makeModule('Bx'), makeModule('A'), makeModule('Cx')])
        const target = mountMenu()
        const search = target.querySelector('input') as HTMLInputElement
        search.value = 'x'
        search.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        expect(rowNames(target)).toEqual(['Bx', 'Cx'])
    })

    test('regression reproducer: toggling the second row in array order toggles that row\'s module', async () => {
        installDb([makeModule('B'), makeModule('A'), makeModule('C')])
        const target = mountMenu()
        const toggle = rows(target)[1].querySelectorAll('button')
        ;(toggle[toggle.length - 1] as HTMLButtonElement).click()
        await settle()
        expect(DBState.db.characters[0].chats[0].modules).toEqual(['id-A'])
    })

    test('guard: the picker never reorders db.modules', () => {
        installDb([makeModule('B'), makeModule('A')])
        mountMenu()
        expect(DBState.db.modules.map((m) => m.name)).toEqual(['B', 'A'])
    })
})
