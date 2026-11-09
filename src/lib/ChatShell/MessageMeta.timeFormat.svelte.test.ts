// @vitest-environment jsdom
// Every mounted row shows its time through one formatter built once for the module, not one per row.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

vi.mock('../../lang', () => ({ language: { edit: 'Edit', remove: 'Delete', chatShellMoreActions: 'More actions', chatShellStopAndDelete: 'Stop and delete' } }))
// The module-level formatter is built by this import, before the counting wrapper below is installed.
import MessageMeta from './MessageMeta.svelte'

const NativeDateTimeFormat = Intl.DateTimeFormat
let targets: HTMLElement[] = []
let apps: ReturnType<typeof MessageMeta>[] = []
afterEach(async () => {
    Intl.DateTimeFormat = NativeDateTimeFormat
    for (const app of apps) await unmount(app)
    for (const target of targets) target.remove()
    apps = []; targets = []
    localStorage.removeItem('risuChatShell.actionSlots')
})

describe('the time of a message row', () => {
    test('rows mounted over time build at most one formatter between them, and show the same text a fresh formatter gives', () => {
        const expected = (time: number): string => new NativeDateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(time)
        let constructions = 0
        Intl.DateTimeFormat = new Proxy(NativeDateTimeFormat, {
            construct(target, args, newTarget) {
                constructions += 1
                return Reflect.construct(target, args, newTarget)
            },
        })
        const times = [1_700_000_000_000, 1_700_003_600_000, 1_700_007_200_000, 1_700_010_800_000, 1_700_014_400_000]
        for (const time of times) {
            const target = document.createElement('div')
            document.body.appendChild(target)
            targets.push(target)
            apps.push(mount(MessageMeta, { target, props: { name: 'Ari', time, available: ['edit'], onaction: vi.fn(), onmore: vi.fn() } }))
        }
        flushSync()
        expect(constructions).toBeLessThanOrEqual(1)
        times.forEach((time, i) => {
            expect(targets[i].querySelector('time')!.textContent).toBe(expected(time))
        })
    })
})
