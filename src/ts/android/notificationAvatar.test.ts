// @vitest-environment happy-dom

/**
 * The page side of the notification identity (`./notificationAvatar`): which images may become a large
 * icon, how the speaker of a chat is resolved, and the production wiring of `startKeepAliveService` that
 * uses both. The thumbnail module is replaced by a small stand-in of its memo (`peekAvatarThumb` answers
 * undefined until a lookup finished, null for none); `chatOrigin` and `activeStreams` are real, over a
 * plain `DBState`. MOCKED: the thumbnail generation, the Android transport and the host bridge. A passing
 * test says nothing about the Kotlin service or the notification.
 *
 * Labels: "NC" is new code with no pre-fix base; its red evidence is the mutant named in the report.
 */
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'

const thumb = vi.hoisted(() => ({
    /** The memo the peek reads: a string is a thumbnail, null is none, a missing key is not known yet. */
    memo: new Map<string, string | null>(),
    /** What a lookup finds, by image location; a location without an entry finds none. */
    found: new Map<string, string | null>(),
    lookups: [] as string[],
}))

vi.mock('../media/avatarThumb', () => ({
    isThumbEligible: (loc: string) => loc.startsWith('assets/'),
    peekAvatarThumb: (loc: string) => (thumb.memo.has(loc) ? thumb.memo.get(loc) : undefined),
    getAvatarThumbSrc: vi.fn(async (loc: string) => {
        thumb.lookups.push(loc)
        const value = thumb.found.get(loc) ?? null
        thumb.memo.set(loc, value)
        return value
    }),
}))

vi.mock('../stores.svelte', () => ({
    DBState: { db: { characters: [], hideAllImages: false } },
    selectedCharID: { subscribe: () => () => { } },
}))

vi.mock('../storage/tauriByteTransport', () => ({
    isAndroidTransport: () => true,
}))

vi.mock('../process/composerActions.svelte', () => ({ abortChat: vi.fn() }))
vi.mock('../process/tts', () => ({ stopTTS: vi.fn() }))

import { DBState } from '../stores.svelte'
import { getAvatarThumbSrc } from '../media/avatarThumb'
import { addActiveStream, noteStreamText, resetActiveStreamsForTest } from '../process/activeStreams'
import { beginInFlight, resetInFlightForTest } from '../process/inFlightWork'
import { startKeepAliveService, type KeepAliveConsumer, type KeepAlivePayload } from './keepAliveService'
import { NOTIFICATION_AVATAR_MAX_DATA_CHARS, notificationAvatarOf, notificationSubjectOf, warmNotificationAvatar } from './notificationAvatar'
import type { Database } from '../storage/database.svelte'

type CharacterFixture = Database['characters'][number]

const ALICE_SRC = 'data:image/webp;base64,QUxJQ0U='
const GROUP_SRC = 'data:image/webp;base64,R1JPVVA='
const MEMBER_SRC = 'data:image/webp;base64,TUVNQkVS'

function makeChat(id: string): Database['characters'][number]['chats'][number] {
    return { id, message: [], note: '', name: '', localLore: [] } as unknown as CharacterFixture['chats'][number]
}

function makeCharacter(chaId: string, name: string, image: string | undefined): CharacterFixture {
    return { chaId, name, image, type: 'character', chatPage: 0, chats: [makeChat('c1')] } as unknown as CharacterFixture
}

function makeGroup(chaId: string, name: string, image: string | undefined, members: string[]): CharacterFixture {
    return { chaId, name, image, type: 'group', chatPage: 0, chats: [makeChat('c1')], characters: members } as unknown as CharacterFixture
}

function installCharacters(characters: CharacterFixture[], hideAllImages = false): void {
    DBState.db = { characters, hideAllImages } as unknown as Database
}

beforeEach(() => {
    thumb.memo.clear()
    thumb.found.clear()
    thumb.lookups.length = 0
    vi.mocked(getAvatarThumbSrc).mockClear()
    installCharacters([])
    resetActiveStreamsForTest()
})

describe('notificationAvatarOf: which image may be a large icon', () => {
    // NC. R3-2 (chosen): this function returns `string | null | undefined`, so the consumer sees undefined and warms.
    test('answers the memo: a thumbnail, null for none, and undefined for not known yet', () => {
        thumb.memo.set('assets/a.png', 'data:a')
        thumb.memo.set('assets/none.png', null)

        expect(notificationAvatarOf('assets/a.png')).toBe('data:a')
        expect(notificationAvatarOf('assets/none.png')).toBeNull()
        expect(notificationAvatarOf('assets/unknown.png')).toBeUndefined()
    })

    test('an empty image and an image that is not a local asset get no icon, whatever the memo holds (MC-1377)', () => {
        thumb.memo.set('https://example.test/a.png', 'data:remote')
        thumb.memo.set('', 'data:empty')

        expect(notificationAvatarOf('')).toBeNull()
        expect(notificationAvatarOf('https://example.test/a.png')).toBeNull()
    })

    test('hideAllImages gives no icon even for a known thumbnail', () => {
        thumb.memo.set('assets/a.png', 'data:a')
        installCharacters([], true)

        expect(notificationAvatarOf('assets/a.png')).toBeNull()
    })

    // The start Intent carries the avatar, so a data URL past native's own cap is dropped before it is sent.
    test('a thumbnail longer than the native cap gives no icon, and one at the cap is kept', () => {
        const header = 'data:image/webp;base64,'
        const atCap = header + 'A'.repeat(NOTIFICATION_AVATAR_MAX_DATA_CHARS - header.length)
        thumb.memo.set('assets/at-cap.png', atCap)
        thumb.memo.set('assets/over-cap.png', atCap + 'A')

        expect(notificationAvatarOf('assets/at-cap.png')).toBe(atCap)
        expect(notificationAvatarOf('assets/over-cap.png')).toBeNull()
    })

    test('holds no state of its own: it follows the memo at every call', () => {
        expect(notificationAvatarOf('assets/a.png')).toBeUndefined()
        thumb.memo.set('assets/a.png', 'data:a')
        expect(notificationAvatarOf('assets/a.png')).toBe('data:a')
        thumb.memo.clear()
        expect(notificationAvatarOf('assets/a.png')).toBeUndefined()
    })
})

describe('warmNotificationAvatar', () => {
    test('looks the image up once, and the memo then answers it', async () => {
        thumb.found.set('assets/a.png', 'data:a')

        await warmNotificationAvatar('assets/a.png')

        expect(getAvatarThumbSrc).toHaveBeenCalledTimes(1)
        expect(getAvatarThumbSrc).toHaveBeenCalledWith('assets/a.png')
        expect(notificationAvatarOf('assets/a.png')).toBe('data:a')
    })

    test('starts no lookup for an empty image, a remote image or while hideAllImages is on', async () => {
        await warmNotificationAvatar('')
        await warmNotificationAvatar('https://example.test/a.png')
        installCharacters([], true)
        await warmNotificationAvatar('assets/a.png')

        expect(getAvatarThumbSrc).not.toHaveBeenCalled()
    })

    test('never rejects', async () => {
        vi.mocked(getAvatarThumbSrc).mockRejectedValueOnce(new Error('store failed'))

        await expect(warmNotificationAvatar('assets/a.png')).resolves.toBeUndefined()
    })
})

describe('notificationSubjectOf: who speaks, and which images belong to the chat', () => {
    test('a character is its own speaker and owner', () => {
        installCharacters([makeCharacter('alice', 'Alice', 'assets/alice.png')])

        expect(notificationSubjectOf({ chaId: 'alice', chatId: 'c1' })).toEqual({
            identity: { key: 'alice', name: 'Alice' },
            image: 'assets/alice.png',
            ownerImage: 'assets/alice.png',
        })
    })

    test('a group with a member writing is spoken by that member, with the group image kept as the owner image', () => {
        installCharacters([
            makeGroup('group', 'The Group', 'assets/group.png', ['member']),
            makeCharacter('member', 'Member', 'assets/member.png'),
        ])
        addActiveStream({ chaId: 'group', memberChaId: 'member', replyChatId: 'r1' })

        expect(notificationSubjectOf({ chaId: 'group', chatId: 'c1' })).toEqual({
            identity: { key: 'member', name: 'Member' },
            image: 'assets/member.png',
            ownerImage: 'assets/group.png',
        })
    })

    test('a group with no member stream, or a stream of another owner, is spoken by the group itself', () => {
        installCharacters([
            makeGroup('group', 'The Group', 'assets/group.png', ['member']),
            makeCharacter('member', 'Member', 'assets/member.png'),
            makeCharacter('other', 'Other', 'assets/other.png'),
        ])
        expect(notificationSubjectOf({ chaId: 'group', chatId: 'c1' })?.identity).toEqual({ key: 'group', name: 'The Group' })

        addActiveStream({ chaId: 'other', memberChaId: 'member', replyChatId: 'r9' })

        expect(notificationSubjectOf({ chaId: 'group', chatId: 'c1' })?.identity).toEqual({ key: 'group', name: 'The Group' })
    })

    test('the latest stream of the group decides when several write', () => {
        installCharacters([
            makeGroup('group', 'The Group', undefined, ['m1', 'm2']),
            makeCharacter('m1', 'First', undefined),
            makeCharacter('m2', 'Second', undefined),
        ])
        addActiveStream({ chaId: 'group', memberChaId: 'm1', replyChatId: 'r1' })
        addActiveStream({ chaId: 'group', memberChaId: 'm2', replyChatId: 'r2' })

        expect(notificationSubjectOf({ chaId: 'group', chatId: 'c1' })?.identity.key).toBe('m2')
    })

    test('a speaker that is gone falls back to the group, and a chat that is gone gives no subject', () => {
        installCharacters([makeGroup('group', 'The Group', undefined, ['member'])])
        addActiveStream({ chaId: 'group', memberChaId: 'member', replyChatId: 'r1' })

        expect(notificationSubjectOf({ chaId: 'group', chatId: 'c1' })?.identity.key).toBe('group')
        expect(notificationSubjectOf({ chaId: 'group', chatId: 'missing' })).toBeNull()
        expect(notificationSubjectOf({ chaId: 'nobody', chatId: 'c1' })).toBeNull()
    })

    test('the name is capped at 100 code points without splitting one, and an empty name reads as unnamed', () => {
        installCharacters([
            makeCharacter('long', '😀'.repeat(150), undefined),
            makeCharacter('blank', '', undefined),
        ])

        const long = notificationSubjectOf({ chaId: 'long', chatId: 'c1' })?.identity.name ?? ''
        expect(Array.from(long)).toHaveLength(100)
        expect(long).toBe('😀'.repeat(100))
        expect(notificationSubjectOf({ chaId: 'blank', chatId: 'c1' })?.identity.name).toBe('Unnamed')
    })

    test('a character with no image has an empty image', () => {
        installCharacters([makeCharacter('plain', 'Plain', undefined)])

        expect(notificationSubjectOf({ chaId: 'plain', chatId: 'c1' })).toEqual({
            identity: { key: 'plain', name: 'Plain' },
            image: '',
            ownerImage: '',
        })
    })
})

interface WiredHost {
    startState: Mock<(json: string) => void>
    updateState: Mock<(json: string) => void>
    stopAfterWithOutcome: Mock<(ms: number, json: string) => void>
    stop: Mock<() => void>
    start: Mock<() => void>
    update: Mock<() => void>
    stopAfter: Mock<() => void>
    requestNotificationPermissionOnce: Mock<() => void>
}

let consumer: KeepAliveConsumer | null = null

/** The page's production wiring over a fake v2 host; its identity code is loaded on demand, so the load is awaited. */
async function startWired(): Promise<WiredHost> {
    const host: WiredHost = {
        startState: vi.fn(),
        updateState: vi.fn(),
        stopAfterWithOutcome: vi.fn(),
        stop: vi.fn(),
        start: vi.fn(),
        update: vi.fn(),
        stopAfter: vi.fn(),
        requestNotificationPermissionOnce: vi.fn(),
    }
    window.__risuTaniumKeepAlive = host
    consumer = startKeepAliveService()
    await vi.dynamicImportSettled()
    return host
}

function payloads(host: WiredHost): KeepAlivePayload[] {
    return [
        ...host.startState.mock.calls.map((call) => JSON.parse(call[0]) as KeepAlivePayload),
        ...host.updateState.mock.calls.map((call) => JSON.parse(call[0]) as KeepAlivePayload),
    ]
}

describe('the production wiring of the keep-alive notice (identity, avatar, count)', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        resetInFlightForTest()
        resetActiveStreamsForTest()
    })

    afterEach(() => {
        consumer?.dispose()
        consumer = null
        resetInFlightForTest()
        resetActiveStreamsForTest()
        delete window.__risuTaniumKeepAlive
        document.documentElement.classList.remove('nexus-low-power')
        vi.useRealTimers()
    })

    // R4, the part that belongs to this stage: the avatar must outlive the all-ended sync, because the reply notice
    // reads it right after the chat ended with nothing else in flight.
    test('the avatar of a chat survives the all-ended sync: the next run and the reply notice read it from the memo with no new lookup', async () => {
        installCharacters([makeCharacter('alice', 'Alice', 'assets/alice.png')])
        thumb.found.set('assets/alice.png', ALICE_SRC)
        const host = await startWired()
        host.stop.mockClear()

        const endChat = beginInFlight('chat', { target: { chaId: 'alice', chatId: 'c1' } })
        expect(JSON.parse(host.startState.mock.calls[0][0])).toEqual(expect.objectContaining({
            state: 'generating',
            identity: { key: 'alice', name: 'Alice' },
            avatar: null,
            target: { chaId: 'alice', chatId: 'c1' },
        }))
        await vi.advanceTimersByTimeAsync(0)
        expect(host.updateState).toHaveBeenCalledTimes(1)
        expect((JSON.parse(host.updateState.mock.calls[0][0]) as KeepAlivePayload).avatar).toBe(ALICE_SRC)

        endChat('reply')
        expect(host.stopAfterWithOutcome).toHaveBeenCalledTimes(1)
        expect(notificationAvatarOf('assets/alice.png')).toBe(ALICE_SRC)

        beginInFlight('chat', { target: { chaId: 'alice', chatId: 'c1' } })
        expect(host.startState).toHaveBeenCalledTimes(2)
        expect((JSON.parse(host.startState.mock.calls[1][0]) as KeepAlivePayload).avatar).toBe(ALICE_SRC)
        expect(getAvatarThumbSrc).toHaveBeenCalledTimes(1)
    })

    test('an animated or failed image (null in the memo) gives the name only', async () => {
        installCharacters([makeCharacter('alice', 'Alice', 'assets/alice.png')])
        thumb.found.set('assets/alice.png', null)
        const host = await startWired()

        beginInFlight('chat', { target: { chaId: 'alice', chatId: 'c1' } })
        await vi.advanceTimersByTimeAsync(0)
        vi.advanceTimersByTime(3000)

        expect(payloads(host).every((payload) => payload.avatar === null)).toBe(true)
        expect(payloads(host)[0].identity).toEqual({ key: 'alice', name: 'Alice' })
        expect(host.updateState).not.toHaveBeenCalled()
    })

    test('hideAllImages sends no avatar and starts no lookup', async () => {
        installCharacters([makeCharacter('alice', 'Alice', 'assets/alice.png')], true)
        thumb.found.set('assets/alice.png', ALICE_SRC)
        const host = await startWired()

        beginInFlight('chat', { target: { chaId: 'alice', chatId: 'c1' } })
        await vi.advanceTimersByTimeAsync(0)

        expect(payloads(host).every((payload) => payload.avatar === null)).toBe(true)
        expect(getAvatarThumbSrc).not.toHaveBeenCalled()
    })

    test('a group run names the member, keeps the group as the target, and warms both images', async () => {
        installCharacters([
            makeGroup('group', 'The Group', 'assets/group.png', ['member']),
            makeCharacter('member', 'Member', 'assets/member.png'),
        ])
        thumb.found.set('assets/member.png', MEMBER_SRC)
        thumb.found.set('assets/group.png', GROUP_SRC)
        addActiveStream({ chaId: 'group', memberChaId: 'member', replyChatId: 'r1' })
        const host = await startWired()

        beginInFlight('chat', { target: { chaId: 'group', chatId: 'c1' } })
        await vi.advanceTimersByTimeAsync(0)

        const [start, ...updates] = payloads(host)
        expect(start.identity).toEqual({ key: 'member', name: 'Member' })
        expect(start.target).toEqual({ chaId: 'group', chatId: 'c1' })
        expect([...thumb.lookups].sort()).toEqual(['assets/group.png', 'assets/member.png'])
        expect(updates.map((payload) => payload.avatar)).toEqual([MEMBER_SRC])
        expect(notificationAvatarOf('assets/group.png')).toBe(GROUP_SRC)
    })

    test('the speaker of a group is found when the stream is added after the chat began, at the next count tick', async () => {
        installCharacters([
            makeGroup('group', 'The Group', undefined, ['member']),
            makeCharacter('member', 'Member', undefined),
        ])
        const host = await startWired()
        beginInFlight('chat', { target: { chaId: 'group', chatId: 'c1' } })
        expect(payloads(host)[0].identity).toEqual({ key: 'group', name: 'The Group' })

        addActiveStream({ chaId: 'group', memberChaId: 'member', replyChatId: 'r1' })
        noteStreamText('r1', 'x'.repeat(1234))
        vi.advanceTimersByTime(1000)

        expect(host.updateState).toHaveBeenCalledTimes(1)
        expect(JSON.parse(host.updateState.mock.calls[0][0])).toEqual(expect.objectContaining({
            identity: { key: 'member', name: 'Member' },
            text: `${new Intl.NumberFormat().format(1234)} characters`,
        }))
    })

    test('the count is the characters written so far, once a second at most, and none in low-power mode', async () => {
        installCharacters([makeCharacter('alice', 'Alice', undefined)])
        addActiveStream({ chaId: 'alice', replyChatId: 'r1' })
        const host = await startWired()
        beginInFlight('chat', { target: { chaId: 'alice', chatId: 'c1' } })

        noteStreamText('r1', 'abcde')
        vi.advanceTimersByTime(1000)
        expect(JSON.parse(host.updateState.mock.calls[0][0]).text).toBe('5 characters')

        document.documentElement.classList.add('nexus-low-power')
        noteStreamText('r1', 'abcdefghij')
        vi.advanceTimersByTime(5000)
        expect(host.updateState).toHaveBeenCalledTimes(1)
    })
})
