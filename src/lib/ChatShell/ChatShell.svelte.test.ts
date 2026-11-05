// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'

const state = $state({ db: { characters: [{ chaId: 'c', name: 'Seraphina', chatPage: 0, chats: [{ id: 'chat', message: [] }] }] } })
const selection = $state({ selId: 0 })
const floating = $state<{ name: string, callback: () => void }[]>([])
const menus = $state<{ name: string, callback: () => void }[]>([])
const panel = $state({ open: false })

vi.mock('../../ts/stores.svelte', () => ({ DBState: state, selIdState: selection, additionalChatMenu: menus, additionalFloatingActionButtons: floating, easyPanelStore: panel }))
vi.mock('../../ts/process/index.svelte', () => ({ doingChat: writable(false), chatProcessStage: writable(0) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { hidden: false } }))
vi.mock('../../ts/parser/parser.svelte', () => ({ hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../../lang', () => ({ language: { chatShellMessages: 'Messages', chatShellMoreActions: 'More actions' } }))
vi.mock('./ShellHeader.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellComposer.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PersonaSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellMessageList.svelte', () => ({ default: () => ({}) }))
vi.mock('./ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ isComposerBusy: () => false, branchAt: vi.fn() }))

describe('ChatShell Stage 2a layout', () => {
    test('mounts header and composer hosts around the empty list placeholder', async () => {
        const { default: ChatShell } = await import('./ChatShell.svelte')
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(ChatShell, { target })
        await tick()
        flushSync()
        const root = target.querySelector('[data-testid="chat-shell-stub"]')
        expect(root).not.toBeNull()
        expect(root?.querySelector('[data-part="chat-header-host"]')).not.toBeNull()
        expect(root?.querySelector('[data-part="chat-transcript"]')?.children.length).toBe(0)
        expect(root?.querySelector('[data-part="chat-composer-host"]')).not.toBeNull()
        await unmount(app)
        target.remove()
    })

    test('the shell canvas is transparent so the shared background shows through', () => {
        const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'ChatShell.svelte'), 'utf8')
        const style = /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? ''
        let background: string | undefined
        postcss.parse(style).walkRules('[data-part="chat-shell"]', (rule) => {
            rule.walkDecls('background', (decl) => { background = decl.value })
        })
        expect(background).toBe('transparent')
    })
})
