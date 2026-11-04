// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'
import type { RisuModule } from 'src/ts/process/modules'

type ModuleRow = { id: string, name: string, namespace: string, [MODULE_STUB_KEY]?: number }

const h = vi.hoisted(() => ({
    state: { db: { modules: [] as ModuleRow[], enabledModules: ['m1'], characters: [], personas: [], moduleIntergration: '' } },
    alerts: [] as string[],
    parse: vi.fn((input: string) => input.includes('moduleassetlist')
        ? (h.state.db.modules[0]?.[MODULE_STUB_KEY] === 1 ? '[]' : '["pic"]')
        : input),
}))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: h.state,
    selectedCharID: writable(-1),
    ReloadGUIPointer: writable(0),
}))
vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => h.state.db,
    getCurrentCharacter: () => null,
    getCurrentChat: () => null,
}))
vi.mock('src/ts/util', () => ({
    checkPersonaBinded: () => false,
    sleep: async () => {},
}))
vi.mock('src/ts/alert', () => ({
    alertError: (message: string) => { h.alerts.push(message) },
}))
vi.mock('src/ts/parser/parser.svelte', () => ({
    risuChatParser: h.parse,
}))
vi.mock('../UI/GUI/TextAreaInput.svelte', () => ({
    default: (anchor: Comment, props: { value: string, onInput?: () => void }) => {
        const area = document.createElement('textarea')
        anchor.before(area)
        $effect(() => { area.value = props.value })
        area.addEventListener('input', () => {
            props.value = area.value
            props.onInput?.()
        })
    },
}))

import { moduleLoadFailedText } from 'src/ts/process/moduleRefList'
import { registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import PlaygroundSyntax from './PlaygroundSyntax.svelte'

let target: HTMLElement
let app: ReturnType<typeof mount>
let calls: string[]
let release: () => void
let fail: boolean

function stub(): ModuleRow {
    return { id: 'm1', name: 'Alpha', namespace: 'ns', [MODULE_STUB_KEY]: 1 }
}

function resident(): ModuleRow {
    return { id: 'm1', name: 'Alpha', namespace: 'ns' }
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
}

async function input(value: string): Promise<void> {
    const area = target.querySelector('textarea') as HTMLTextAreaElement
    area.value = value
    area.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
}

function output(): string {
    return (target.querySelectorAll('textarea')[1] as HTMLTextAreaElement).value
}

beforeEach(() => {
    calls = []
    release = () => {}
    fail = false
    h.alerts.length = 0
    h.parse.mockClear()
    h.state.db.modules = [stub()]
    h.state.db.enabledModules = ['m1']
    registerModuleLoader(async (handle) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        calls.push(id)
        await new Promise<void>((resolve) => { release = resolve })
        if(fail) throw new Error('load failed')
        const row = resident()
        h.state.db.modules[0] = row
        return row as RisuModule
    })
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(PlaygroundSyntax, { target, props: {} })
    flushSync()
})

afterEach(async () => {
    await unmount(app)
    target.remove()
    unregisterModuleLoader()
})

describe('no-selection Syntax module wait', () => {
    test('Y1 a gated stub load parses only after installation', async () => {
        await input('{{moduleassetlist::ns}}')
        expect(calls).toEqual(['m1'])
        expect(h.parse).not.toHaveBeenCalled()
        expect(output()).toBe('')
        release()
        await settle()
        expect(h.parse).toHaveBeenCalledTimes(1)
        expect(output()).toBe('["pic"]')
    })

    test('Y2 two inputs during a failing wait share one load and one alert', async () => {
        fail = true
        await input('{{moduleassetlist::ns}}')
        await input('{{moduleassetlist::ns}}')
        expect(calls).toEqual(['m1'])
        expect(h.parse).not.toHaveBeenCalled()
        release()
        await settle()
        expect(h.alerts).toEqual([moduleLoadFailedText(['Alpha'])])
        expect(output()).toBe('')
    })

    test('Y3 an unloaded stub stays suppressed after a failed wait', async () => {
        fail = true
        await input('{{moduleassetlist::ns}}')
        release()
        await settle()
        await input('{{moduleassetlist::ns}}')
        expect(calls).toEqual(['m1'])
        expect(h.alerts).toEqual([moduleLoadFailedText(['Alpha'])])
        expect(h.parse).not.toHaveBeenCalled()
        expect(output()).toBe('')
    })

    test('Y4 a later wait keeps the previous preview visible', async () => {
        h.state.db.modules = [resident()]
        await input('{{moduleassetlist::ns}}')
        expect(output()).toBe('["pic"]')
        h.state.db.modules = [stub()]
        await input('{{moduleassetlist::ns}}')
        expect(calls).toEqual(['m1'])
        expect(output()).toBe('["pic"]')
        release()
        await settle()
        expect(output()).toBe('["pic"]')
    })

    test('Y5 guard passes before and after with a resident module', async () => {
        h.state.db.modules = [resident()]
        await input('{{moduleassetlist::ns}}')
        expect(calls).toEqual([])
        expect(h.parse).toHaveBeenCalledTimes(1)
        expect(output()).toBe('["pic"]')
    })

    test('Y6 a failed wait is rechecked against referenced stubs only', async () => {
        fail = true
        await input('{{moduleassetlist::ns}}')
        release()
        await settle()
        expect(calls).toEqual(['m1'])
        expect(h.alerts).toEqual([moduleLoadFailedText(['Alpha'])])
        expect(output()).toBe('')

        h.state.db.modules.push({ id: 'm2', name: 'Beta', namespace: 'other', [MODULE_STUB_KEY]: 1 })
        h.state.db.modules[0] = resident()
        await input('{{moduleassetlist::ns}}')
        expect(calls).toEqual(['m1'])
        expect(h.alerts).toEqual([moduleLoadFailedText(['Alpha'])])
        expect(h.parse).toHaveBeenCalledTimes(1)
        expect(output()).toBe('["pic"]')
    })
})
