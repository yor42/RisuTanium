// @vitest-environment happy-dom

/**
 * The page module of the Android reply notifications against a fake host channel. A passing test
 * says nothing about the native side or the system's permission and channel state.
 *
 * Every test names a rule a mutation of `replyNotifications.svelte.ts` must break. The module
 * keeps its state at module level, so each test loads a fresh copy.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createHostChannelFake } from './hostChannelFake'

afterEach(() => {
    delete window.__risuTaniumHost
    delete window.__risuTaniumReplyNotificationsHost
    delete window.__risuTaniumReplyNotificationsState
    vi.restoreAllMocks()
})

async function loadModule() {
    vi.resetModules()
    return await import('./replyNotifications.svelte')
}

/** A fake channel with the module installed and the host's state delivered. */
async function ready(host: { optedIn: boolean; enabled: boolean } | null = { optedIn: true, enabled: true }) {
    const fake = createHostChannelFake()
    window.__risuTaniumHost = fake.channel
    const module = await loadModule()
    module.installReplyNotifications()
    if (host !== null) {
        window.__risuTaniumReplyNotificationsState?.(JSON.stringify(host))
    }
    return { fake, module }
}

describe('installing', () => {
    test('the state hook is set and the host is asked for the state once', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const module = await loadModule()
        module.installReplyNotifications()
        expect(typeof window.__risuTaniumReplyNotificationsState).toBe('function')
        expect(fake.postedTo('replyNotifications', 'refresh')).toEqual([{ bridge: 'replyNotifications', method: 'refresh', args: [] }])
        expect(module.state).toEqual({ known: false, optedIn: false, enabled: false })
    })

    test('without a host nothing throws and the state stays unknown', async () => {
        const module = await loadModule()
        expect(() => module.installReplyNotifications()).not.toThrow()
        expect(module.state.known).toBe(false)
    })
})

describe('notifyReply is harmless until the host reports opted in and enabled', () => {
    test('with the state unknown no host call is made', async () => {
        const { fake, module } = await ready(null)
        module.notifyReply('cha/chat', 'Title', 'Body', false)
        expect(fake.postedTo('replyNotifications', 'notify')).toEqual([])
    })

    test('not opted in makes no host call', async () => {
        const { fake, module } = await ready({ optedIn: false, enabled: true })
        module.notifyReply('cha/chat', 'Title', 'Body', false)
        expect(fake.postedTo('replyNotifications', 'notify')).toEqual([])
    })

    test('opted in but disabled by the system makes no host call', async () => {
        const { fake, module } = await ready({ optedIn: true, enabled: false })
        module.notifyReply('cha/chat', 'Title', 'Body', false)
        expect(fake.postedTo('replyNotifications', 'notify')).toEqual([])
    })

    test('opted in and enabled posts the notification with its silent flag', async () => {
        const { fake, module } = await ready()
        module.notifyReply('cha/chat', 'Title', 'Body', true)
        module.notifyReply('cha/chat', 'Title', 'Body', false)
        expect(fake.postedTo('replyNotifications', 'notify')).toEqual([
            { bridge: 'replyNotifications', method: 'notify', args: ['cha/chat', 'Title', 'Body', true] },
            { bridge: 'replyNotifications', method: 'notify', args: ['cha/chat', 'Title', 'Body', false] },
        ])
    })

    test('a later state that turns it off stops the notifications', async () => {
        const { fake, module } = await ready()
        window.__risuTaniumReplyNotificationsState?.({ optedIn: true, enabled: false })
        module.notifyReply('cha/chat', 'Title', 'Body', false)
        expect(fake.postedTo('replyNotifications', 'notify')).toEqual([])
        expect(module.state).toEqual({ known: true, optedIn: true, enabled: false })
    })

    test('a key that is empty or longer than 200 characters is never sent', async () => {
        const { fake, module } = await ready()
        module.notifyReply('', 'Title', 'Body', false)
        module.notifyReply('k'.repeat(201), 'Title', 'Body', false)
        module.cancelReplyNotification('')
        module.cancelReplyNotification('k'.repeat(201))
        expect(fake.postedTo('replyNotifications', 'notify')).toEqual([])
        expect(fake.postedTo('replyNotifications', 'cancel')).toEqual([])
        module.notifyReply('k'.repeat(200), 'Title', 'Body', false)
        expect(fake.postedTo('replyNotifications', 'notify')).toHaveLength(1)
    })
})

describe('the state from the host', () => {
    test.each([
        ['text that is not JSON', '{not json'],
        ['JSON null', 'null'],
        ['a JSON array', '[]'],
        ['a number', 42],
        ['undefined', undefined],
        ['a missing flag', '{"optedIn":true}'],
        ['a flag that is not a boolean', '{"optedIn":"yes","enabled":true}'],
        ['a flag that is a number', '{"optedIn":true,"enabled":1}'],
    ])('%s is ignored', async (_label, value) => {
        const { fake, module } = await ready(null)
        window.__risuTaniumReplyNotificationsState?.(value)
        expect(module.state).toEqual({ known: false, optedIn: false, enabled: false })
        module.notifyReply('cha/chat', 'Title', 'Body', false)
        expect(fake.postedTo('replyNotifications', 'notify')).toEqual([])
    })

    test('a malformed value leaves the last good state in place', async () => {
        const { module } = await ready()
        window.__risuTaniumReplyNotificationsState?.('{not json')
        expect(module.state).toEqual({ known: true, optedIn: true, enabled: true })
    })

    test('an object with both flags is accepted as well as its JSON text', async () => {
        const { module } = await ready(null)
        window.__risuTaniumReplyNotificationsState?.({ optedIn: true, enabled: false })
        expect(module.state).toEqual({ known: true, optedIn: true, enabled: false })
    })
})

describe('calls to the host', () => {
    test('enable, disable and cancel go out as one message each', async () => {
        const { fake, module } = await ready()
        module.enable()
        module.disable()
        module.cancelReplyNotification('cha/chat')
        expect(fake.postedTo('replyNotifications', 'enable')).toHaveLength(1)
        expect(fake.postedTo('replyNotifications', 'disable')).toHaveLength(1)
        expect(fake.postedTo('replyNotifications', 'cancel')).toEqual([
            { bridge: 'replyNotifications', method: 'cancel', args: ['cha/chat'] },
        ])
    })

    test('a host without the methods is skipped and nothing throws', async () => {
        window.__risuTaniumReplyNotificationsHost = {}
        const module = await loadModule()
        module.installReplyNotifications()
        window.__risuTaniumReplyNotificationsState?.('{"optedIn":true,"enabled":true}')
        expect(() => {
            module.enable()
            module.disable()
            module.notifyReply('cha/chat', 'Title', 'Body', false)
            module.cancelReplyNotification('cha/chat')
        }).not.toThrow()
    })

    test('a host call that throws is logged and does not escape', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => { })
        window.__risuTaniumReplyNotificationsHost = {
            notify: () => { throw new Error('host failed') },
        }
        const module = await loadModule()
        module.installReplyNotifications()
        window.__risuTaniumReplyNotificationsState?.('{"optedIn":true,"enabled":true}')
        expect(() => module.notifyReply('cha/chat', 'Title', 'Body', false)).not.toThrow()
        expect(error).toHaveBeenCalledTimes(1)
    })

    test('the separate object is called as a method with its receiver', async () => {
        const host = {
            seen: [] as unknown[],
            notify(this: { seen: unknown[] }, ...args: unknown[]) {
                this.seen.push(args)
            },
        }
        window.__risuTaniumReplyNotificationsHost = host
        const module = await loadModule()
        module.installReplyNotifications()
        window.__risuTaniumReplyNotificationsState?.('{"optedIn":true,"enabled":true}')
        module.notifyReply('cha/chat', 'Title', 'Body', true)
        expect(host.seen).toEqual([['cha/chat', 'Title', 'Body', true]])
    })
})

const NOTICE = {
    v: 2 as const,
    key: 'cha/chat',
    name: 'Ada',
    text: 'Replied',
    publicTitle: 'New reply',
    chaId: 'cha',
    chatId: 'chat',
    avatar: null,
    silent: true,
}

describe('notifyReplyState (contract v2) is gated like notifyReply', () => {
    test('new API: opted in and enabled posts the notice as one JSON string, key included', async () => {
        const { fake, module } = await ready()
        module.notifyReplyState(NOTICE)
        const posts = fake.postedTo('replyNotifications', 'notifyState')
        expect(posts).toHaveLength(1)
        expect(posts[0]).toEqual({ bridge: 'replyNotifications', method: 'notifyState', args: [JSON.stringify(NOTICE)] })
    })

    test.each([
        ['the state is unknown', null],
        ['the user is not opted in', { optedIn: false, enabled: true }],
        ['the system blocks notifications', { optedIn: true, enabled: false }],
    ] as const)('new API: %s makes no host call', async (_label, host) => {
        const { fake, module } = await ready(host === null ? null : { ...host })
        module.notifyReplyState(NOTICE)
        expect(fake.postedTo('replyNotifications', 'notifyState')).toEqual([])
    })

    test('new API: a key that is empty or longer than 200 characters is never sent', async () => {
        const { fake, module } = await ready()
        module.notifyReplyState({ ...NOTICE, key: '' })
        module.notifyReplyState({ ...NOTICE, key: 'k'.repeat(201) })
        expect(fake.postedTo('replyNotifications', 'notifyState')).toEqual([])
        module.notifyReplyState({ ...NOTICE, key: 'k'.repeat(200) })
        expect(fake.postedTo('replyNotifications', 'notifyState')).toHaveLength(1)
    })

    test('new API: the channel has the v2 method, an old separate object has not', async () => {
        const { module } = await ready()
        expect(module.hasReplyStateHost()).toBe(true)
        delete window.__risuTaniumHost
        window.__risuTaniumReplyNotificationsHost = { notify: vi.fn() }
        expect(module.hasReplyStateHost()).toBe(false)
        window.__risuTaniumReplyNotificationsHost = { notify: vi.fn(), notifyState: vi.fn() }
        expect(module.hasReplyStateHost()).toBe(true)
    })
})

describe('the notification key', () => {
    test('is the character and chat ids joined, whatever the group member', async () => {
        const module = await loadModule()
        expect(module.replyNotificationKey({ chaId: 'cha', chatId: 'chat' })).toBe('cha/chat')
        expect(module.replyNotificationKey({ chaId: 'cha', chatId: 'chat', memberChaId: 'member' })).toBe('cha/chat')
    })
})
