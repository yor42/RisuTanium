// @vitest-environment happy-dom

/**
 * The avatar of a reply notice survives the end of the work that warmed it (S9b, R4): the keep-alive consumer
 * looks the owner's thumbnail up when the chat begins, the chat ends with nothing else in flight (the consumer's
 * all-ended sync runs), and the notice that `announceReply` posts afterwards still carries that thumbnail.
 *
 * Real: `inFlightWork`, `startKeepAliveService` with its `createKeepAliveConsumer`, `notificationAvatar`,
 * `avatarThumb` (over a fake store that holds the record `persistRecord` writes), `replyNotifications`, the host
 * bridge shim and `announceReply`. MOCKED: the Android channel (a fake that records what the page posts), the
 * transport flag, the thumbnail store and the modules the thumbnail code imports for generating images. A passing
 * test says nothing about the Kotlin service or the notification.
 *
 * Label: NC, new code with no pre-fix base. Its red evidence is the mutants "a per-run avatar map cleared at
 * all-ended" and "the thumbnail memo reset at all-ended".
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
            iterate: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('../../stores.svelte', () => ({
    DBState: { db: { characters: [], hideAllImages: false } },
    selectedCharID: { subscribe: () => () => { } },
    DynamicGUI: { subscribe: () => () => { } },
    ShowRealmFrameStore: { subscribe: () => () => { } },
    sideBarStore: { subscribe: () => () => { } },
}))

vi.mock('../../storage/tauriByteTransport', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../storage/tauriByteTransport')>()
    return { ...actual, isAndroidTransport: () => true }
})

vi.mock('../../globalApi.svelte', () => ({
    readImage: vi.fn(async () => undefined),
}))

vi.mock('../../util', () => ({
    asBuffer: vi.fn(),
}))

// The page's byte store is not used: the thumbnail records come from the fake store set below.
vi.mock('../../storage/store/appStore', () => ({
    getAppStore: vi.fn(),
}))

vi.mock('../composerActions.svelte', () => ({ abortChat: vi.fn() }))
vi.mock('../tts', () => ({ stopTTS: vi.fn() }))

import { DBState } from '../../stores.svelte'
import { __avatarThumbTestHooks, peekAvatarThumb, THUMB_VERSION } from '../../media/avatarThumb'
import { createHostChannelFake, type HostChannelFake } from '../../android/hostChannelFake'
import { startKeepAliveService, type KeepAliveConsumer } from '../../android/keepAliveService'
import { state as replyNotificationState } from '../../android/replyNotifications.svelte'
import { resetActiveStreamsForTest } from '../activeStreams'
import { beginInFlight, resetInFlightForTest } from '../inFlightWork'
import { announceReply, prepareReplyNoticeAvatar } from '../replyNotice'
import { resetToastHostForTests } from '../../toast/toastHost.svelte'
import type { Database } from '../../storage/database.svelte'

type CharacterFixture = Database['characters'][number]

const IMAGE = 'assets/c1.png'
// The record `persistRecord` writes for a thumbnail: `{v: THUMB_VERSION, src}`.
const STORED_SRC = 'data:image/webp;base64,UklGRg=='

let fake: HostChannelFake
let consumer: KeepAliveConsumer | null = null

function installCharacter(): void {
    const character = {
        chaId: 'c1',
        name: 'Ada',
        image: IMAGE,
        type: 'character',
        chatPage: 0,
        chats: [{ id: 'chat1', name: '', message: [], note: '', localLore: [] }],
    } as unknown as CharacterFixture
    DBState.db = { characters: [character], hideAllImages: false } as unknown as Database
}

async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function until(condition: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
        if (condition()) {
            return
        }
        await settle()
    }
    throw new Error(`timed out waiting for: ${what}`)
}

beforeEach(() => {
    fake = createHostChannelFake()
    window.__risuTaniumHost = fake.channel
    replyNotificationState.known = true
    replyNotificationState.optedIn = true
    replyNotificationState.enabled = true
    resetInFlightForTest()
    resetActiveStreamsForTest()
    resetToastHostForTests()
    __avatarThumbTestHooks.reset()
    __avatarThumbTestHooks.setStore({
        getItem: vi.fn(async (key: string) => (key === IMAGE ? { v: THUMB_VERSION, src: STORED_SRC } : null)),
        setItem: vi.fn(async () => {}),
        removeItem: vi.fn(async () => {}),
        iterate: vi.fn(async () => {}),
    } as never)
    installCharacter()
})

afterEach(() => {
    consumer?.dispose()
    consumer = null
    resetInFlightForTest()
    __avatarThumbTestHooks.setStore(null)
    __avatarThumbTestHooks.reset()
    replyNotificationState.known = false
    replyNotificationState.optedIn = false
    replyNotificationState.enabled = false
    delete window.__risuTaniumHost
    resetToastHostForTests()
})

describe('the avatar the chat begin warmed is still there when the reply notice is posted (S9b)', () => {
    test('NC (R4): begin the chat, let the thumbnail resolve, end the chat with nothing else in flight, then announce: the payload carries the stored thumbnail', async () => {
        consumer = startKeepAliveService()
        expect(consumer).not.toBeNull()
        // The identity code is loaded by the service start; the first notice names nobody until it has.
        await until(() => fake.postedTo('keepAlive', 'stop').length > 0, 'the start-up stop')
        await import('../../android/notificationAvatar')
        await prepareReplyNoticeAvatar()
        await settle()

        const end = beginInFlight('chat', { target: { chaId: 'c1', chatId: 'chat1' } })
        await until(() => peekAvatarThumb(IMAGE) !== undefined, 'the owner thumbnail to resolve')
        expect(peekAvatarThumb(IMAGE)).toBe(STORED_SRC)

        end('reply')
        expect(fake.postedTo('keepAlive', 'stopAfterWithOutcome')).toHaveLength(1)

        announceReply({ origin: { chaId: 'c1', chatId: 'chat1' }, outcome: 'reply' }, undefined)

        const posts = fake.postedTo('replyNotifications', 'notifyState')
        expect(posts).toHaveLength(1)
        const payload = JSON.parse((posts[0].args as string[])[0]) as { key: string, name: string, avatar: string | null }
        expect(payload.key).toBe('c1/chat1')
        expect(payload.name).toBe('Ada')
        expect(payload.avatar).toBe(STORED_SRC)
    })
})
