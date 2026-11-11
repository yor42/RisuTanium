// @vitest-environment happy-dom

/**
 * The page side of the Android keep-alive service (`./keepAliveService`)
 * against the REAL in-flight registry and a fake host bridge. A passing test
 * says nothing about the Kotlin service or the notification.
 */
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import {
    beginInFlight, inFlightChatTarget, inFlightKinds, inFlightSince, resetInFlightForTest, subscribeInFlight, takeRunOutcome,
} from '../process/inFlightWork'
import {
    createKeepAliveConsumer, KEEP_ALIVE_LINGER_MS, onKeepAliveHost, startKeepAliveService,
    type KeepAliveAvatarSource, type KeepAliveConsumer, type KeepAliveHost, type KeepAliveHostObject, type KeepAlivePayload,
    type KeepAliveStateLabels, type KeepAliveSubject, type KeepAliveV2Deps,
} from './keepAliveService'
import { createHostChannelFake } from './hostChannelFake'

const platform = vi.hoisted(() => ({ android: true }))

vi.mock('../storage/tauriByteTransport', () => ({
    isAndroidTransport: () => platform.android,
}))

const abortChatMock = vi.hoisted(() => vi.fn())
const stopTTSMock = vi.hoisted(() => vi.fn())

vi.mock('../process/composerActions.svelte', () => ({
    abortChat: abortChatMock,
}))

vi.mock('../process/tts', () => ({
    stopTTS: stopTTSMock,
}))

// The identity code is loaded by `startKeepAliveService`; it needs the app's database and thumbnail store, which
// this suite does not provide, so a stand-in that names nobody is loaded instead.
vi.mock('./notificationAvatar', () => ({
    notificationSubjectOf: () => null,
    notificationAvatarOf: () => null,
    warmNotificationAvatar: async () => { },
}))

const LABELS = { generating: 'Generating a reply…', working: 'Working…', finishing: 'Finishing up…', savePending: 'Reply ready. Open the app to finish saving.', stop: 'Stop' }

interface FakeHost extends KeepAliveHost {
    start: Mock<(title: string, stopLabel: string) => void>
    update: Mock<(title: string, stopLabel: string) => void>
    stop: Mock<() => void>
    stopAfter: Mock<(ms: number) => void>
    requestNotificationPermissionOnce: Mock<() => void>
}

function fakeHost(): FakeHost {
    return {
        start: vi.fn(),
        update: vi.fn(),
        stop: vi.fn(),
        stopAfter: vi.fn(),
        requestNotificationPermissionOnce: vi.fn(),
    }
}

/** A bridge from before `stopAfter`: the linger falls back to a page timer. */
function legacyHost(): Omit<FakeHost, 'stopAfter'> {
    const { stopAfter: _stopAfter, ...rest } = fakeHost()
    return rest
}

const V2_LABELS: KeepAliveStateLabels = {
    speaking: 'Reading the reply aloud',
    image: 'Generating an image…',
    translating: 'Translating…',
    stopping: 'Stopping…',
    failed: 'Reply failed',
    failedHint: 'Open the app to see why.',
    stopped: 'Stopped',
    characters: '{count} characters',
}

interface FakeHostV2 extends FakeHost {
    startState: Mock<(json: string) => void>
    updateState: Mock<(json: string) => void>
    stopAfterWithOutcome: Mock<(ms: number, json: string) => void>
}

/** A bridge with contract v2: the page then sends whole notices. */
function fakeHostV2(): FakeHostV2 {
    return {
        ...fakeHost(),
        startState: vi.fn(),
        updateState: vi.fn(),
        stopAfterWithOutcome: vi.fn(),
    }
}

const stopWork = vi.fn()
let consumer: KeepAliveConsumer | null = null

function attach(host: KeepAliveHostObject, v2: Partial<KeepAliveV2Deps> = {}): KeepAliveConsumer {
    consumer = createKeepAliveConsumer({
        host,
        kinds: inFlightKinds,
        subscribe: subscribeInFlight,
        labels: () => LABELS,
        stopWork,
        v2: {
            labels: () => V2_LABELS,
            takeRunOutcome,
            chatTarget: inFlightChatTarget,
            since: inFlightSince,
            ...v2,
        },
    })
    return consumer
}

/** Every notice a v2 host received, in call order, with the method that carried it. */
function sentNotices(host: FakeHostV2): Array<{ method: 'startState' | 'updateState' | 'stopAfterWithOutcome', ms?: number, payload: KeepAlivePayload }> {
    const sent: Array<{ order: number, method: 'startState' | 'updateState' | 'stopAfterWithOutcome', ms?: number, payload: KeepAlivePayload }> = []
    host.startState.mock.calls.forEach((call, index) => {
        sent.push({ order: host.startState.mock.invocationCallOrder[index], method: 'startState', payload: JSON.parse(call[0]) as KeepAlivePayload })
    })
    host.updateState.mock.calls.forEach((call, index) => {
        sent.push({ order: host.updateState.mock.invocationCallOrder[index], method: 'updateState', payload: JSON.parse(call[0]) as KeepAlivePayload })
    })
    host.stopAfterWithOutcome.mock.calls.forEach((call, index) => {
        sent.push({ order: host.stopAfterWithOutcome.mock.invocationCallOrder[index], method: 'stopAfterWithOutcome', ms: call[0], payload: JSON.parse(call[1]) as KeepAlivePayload })
    })
    return sent.sort((left, right) => left.order - right.order).map(({ order: _order, ...rest }) => rest)
}

/** The notice most recently sent by a start or an update. */
function liveNotice(host: FakeHostV2): KeepAlivePayload {
    const live = sentNotices(host).filter((sent) => sent.method !== 'stopAfterWithOutcome')
    return live[live.length - 1].payload
}

beforeEach(() => {
    vi.useFakeTimers()
    resetInFlightForTest()
    platform.android = true
    stopWork.mockReset()
    abortChatMock.mockReset()
    stopTTSMock.mockReset()
})

afterEach(() => {
    consumer?.dispose()
    consumer = null
    resetInFlightForTest()
    delete window.__risuTaniumKeepAlive
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('starting and stopping the service', () => {
    test('idle at init stops a service a previous page left running', () => {
        const host = fakeHost()
        attach(host)

        expect(host.stop).toHaveBeenCalledTimes(1)
        expect(host.start).not.toHaveBeenCalled()
    })

    test('work in flight at init starts the service without stopping it first', () => {
        const host = fakeHost()
        beginInFlight('chat')
        attach(host)

        expect(host.stop).not.toHaveBeenCalled()
        expect(host.start).toHaveBeenCalledWith(LABELS.generating, LABELS.stop)
    })

    test('the first unit of work asks for the notification permission once, then starts the service once', () => {
        const host = fakeHost()
        attach(host)
        host.stop.mockClear()

        const endChat = beginInFlight('chat')
        const endTts = beginInFlight('tts')

        expect(host.requestNotificationPermissionOnce).toHaveBeenCalledTimes(1)
        expect(host.start).toHaveBeenCalledTimes(1)
        expect(host.start).toHaveBeenCalledWith(LABELS.generating, LABELS.stop)
        expect(host.requestNotificationPermissionOnce.mock.invocationCallOrder[0]).toBeLessThan(host.start.mock.invocationCallOrder[0])
        endChat()
        endTts()
    })

    test('the end of all work hands the linger to the host, with no page timer', () => {
        const host = fakeHost()
        attach(host)
        host.stop.mockClear()
        const end = beginInFlight('chat')

        end()

        expect(host.stopAfter).toHaveBeenCalledTimes(1)
        expect(host.stopAfter).toHaveBeenCalledWith(KEEP_ALIVE_LINGER_MS)
        expect(vi.getTimerCount()).toBe(0)
        vi.advanceTimersByTime(KEEP_ALIVE_LINGER_MS * 5)
        expect(host.stop).not.toHaveBeenCalled()
    })

    test('a host without stopAfter stops after the page timer, and not before', () => {
        const host = legacyHost()
        attach(host)
        host.stop.mockClear()
        const end = beginInFlight('chat')

        end()
        vi.advanceTimersByTime(KEEP_ALIVE_LINGER_MS - 1)
        expect(host.stop).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)

        expect(host.stop).toHaveBeenCalledTimes(1)
    })

    test('a begin after the host was asked to stop later calls start again', () => {
        const host = fakeHost()
        attach(host)
        host.stop.mockClear()
        beginInFlight('chat')()
        vi.advanceTimersByTime(KEEP_ALIVE_LINGER_MS - 1)

        const endNext = beginInFlight('image')

        expect(host.start).toHaveBeenCalledTimes(2)
        expect(host.start).toHaveBeenLastCalledWith(LABELS.working, '')
        expect(host.stop).not.toHaveBeenCalled()
        endNext()
    })

    test('a begin during the page-timer linger cancels the stop and keeps the one service', () => {
        const host = legacyHost()
        attach(host)
        host.stop.mockClear()
        beginInFlight('chat')()
        vi.advanceTimersByTime(KEEP_ALIVE_LINGER_MS - 1)

        const endNext = beginInFlight('image')
        vi.advanceTimersByTime(KEEP_ALIVE_LINGER_MS * 5)

        expect(host.stop).not.toHaveBeenCalled()
        expect(host.start).toHaveBeenCalledTimes(1)
        endNext()
    })

    test('work that begins again after the service stopped starts it again', () => {
        const host = fakeHost()
        attach(host)
        beginInFlight('chat')()
        vi.advanceTimersByTime(KEEP_ALIVE_LINGER_MS)
        host.stop.mockClear()

        beginInFlight('tts')

        expect(host.start).toHaveBeenCalledTimes(2)
        expect(host.requestNotificationPermissionOnce).toHaveBeenCalledTimes(2)
    })
})

describe('the notification text', () => {
    test('says generating with a Stop label while a reply is in flight, otherwise working', () => {
        const host = fakeHost()
        attach(host)

        const endImage = beginInFlight('image')
        expect(host.start).toHaveBeenLastCalledWith(LABELS.working, '')

        const endChat = beginInFlight('chat')
        expect(host.update).toHaveBeenLastCalledWith(LABELS.generating, LABELS.stop)

        endChat()
        expect(host.update).toHaveBeenLastCalledWith(LABELS.working, '')
        endImage()
    })

    test('offers Stop for speech and withholds it for requests, images, translation, embeddings and busy work', () => {
        const host = fakeHost()
        attach(host)

        const endTts = beginInFlight('tts')
        expect(host.start).toHaveBeenLastCalledWith(LABELS.working, LABELS.stop)
        endTts()

        for (const kind of ['request', 'image', 'translate', 'embed', 'busy'] as const) {
            beginInFlight(kind)()
            vi.advanceTimersByTime(KEEP_ALIVE_LINGER_MS)
            const end = beginInFlight(kind)
            expect(host.start).toHaveBeenLastCalledWith(LABELS.working, '')
            end()
        }
    })

    test('updates only when the text changes', () => {
        const host = fakeHost()
        attach(host)

        beginInFlight('chat')
        beginInFlight('chat')
        beginInFlight('image')

        expect(host.start).toHaveBeenCalledTimes(1)
        expect(host.update).not.toHaveBeenCalled()
    })
})

describe('the notice while the service lingers', () => {
    test('host path: the end of all work shows Finishing up without Stop, and only then asks the host to stop later', () => {
        const host = fakeHost()
        attach(host)
        const end = beginInFlight('chat')
        host.update.mockClear()

        end()

        expect(host.update).toHaveBeenCalledTimes(1)
        expect(host.update).toHaveBeenCalledWith(LABELS.finishing, '')
        expect(host.stopAfter).toHaveBeenCalledWith(KEEP_ALIVE_LINGER_MS)
        // The host's update cancels a pending stop, so it must come first.
        expect(host.update.mock.invocationCallOrder[0]).toBeLessThan(host.stopAfter.mock.invocationCallOrder[0])
    })

    test('guard: host path: a begin during the linger starts the service again with the work title and Stop', () => {
        const host = fakeHost()
        attach(host)
        beginInFlight('chat')()
        vi.advanceTimersByTime(KEEP_ALIVE_LINGER_MS - 1)

        const endNext = beginInFlight('chat')

        expect(host.start).toHaveBeenCalledTimes(2)
        expect(host.start).toHaveBeenLastCalledWith(LABELS.generating, LABELS.stop)
        endNext()
    })

    test('page-timer path: Finishing up without Stop is shown before the timer is set, and the stop follows the linger', () => {
        const host = legacyHost()
        attach(host)
        host.stop.mockClear()
        const end = beginInFlight('chat')
        host.update.mockClear()

        end()

        expect(host.update).toHaveBeenCalledTimes(1)
        expect(host.update).toHaveBeenCalledWith(LABELS.finishing, '')
        expect(host.stop).not.toHaveBeenCalled()
        vi.advanceTimersByTime(KEEP_ALIVE_LINGER_MS)
        expect(host.stop).toHaveBeenCalledTimes(1)
    })

    test('page-timer path: a begin during the linger replaces Finishing up with the work notice on the one service', () => {
        const host = legacyHost()
        attach(host)
        host.stop.mockClear()
        beginInFlight('chat')()
        vi.advanceTimersByTime(KEEP_ALIVE_LINGER_MS - 1)

        const endNext = beginInFlight('chat')

        expect(host.update).toHaveBeenLastCalledWith(LABELS.generating, LABELS.stop)
        expect(host.start).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(KEEP_ALIVE_LINGER_MS * 5)
        expect(host.stop).not.toHaveBeenCalled()
        endNext()
    })

    test('page-timer path: a begin of stop-less work during the linger still replaces Finishing up', () => {
        const host = legacyHost()
        attach(host)
        beginInFlight('image')()

        const endNext = beginInFlight('image')

        expect(host.update).toHaveBeenLastCalledWith(LABELS.working, '')
        endNext()
    })
})

describe('the Stop action', () => {
    test('stops the reply and the speech when either is in flight', () => {
        const host = fakeHost()
        attach(host)
        const end = beginInFlight('chat')
        host.stop.mockClear()

        window.__risuTaniumKeepAliveStop?.()

        expect(stopWork).toHaveBeenCalledTimes(1)
        // The service stops through the linger once the aborted work ends.
        expect(host.stop).not.toHaveBeenCalled()
        end()
        expect(host.stopAfter).toHaveBeenCalledWith(KEEP_ALIVE_LINGER_MS)
        expect(host.stop).not.toHaveBeenCalled()
    })

    test('stops speech alone too', () => {
        attach(fakeHost())
        beginInFlight('tts')

        window.__risuTaniumKeepAliveStop?.()

        expect(stopWork).toHaveBeenCalledTimes(1)
    })

    test('with only other work in flight it aborts nothing and only stops the service', () => {
        const host = fakeHost()
        attach(host)
        beginInFlight('image')
        host.stop.mockClear()

        window.__risuTaniumKeepAliveStop?.()

        expect(stopWork).not.toHaveBeenCalled()
        expect(host.stop).toHaveBeenCalledTimes(1)
    })

    test('when nothing is in flight it stops the service', () => {
        const host = fakeHost()
        attach(host)
        host.stop.mockClear()

        window.__risuTaniumKeepAliveStop?.()

        expect(stopWork).not.toHaveBeenCalled()
        expect(host.stop).toHaveBeenCalledTimes(1)
    })

    test('Stop right after the host was asked to stop still stops immediately', () => {
        const host = fakeHost()
        attach(host)
        beginInFlight('image')()
        host.stop.mockClear()

        window.__risuTaniumKeepAliveStop?.()

        expect(host.stop).toHaveBeenCalledTimes(1)
    })

    test('after the service was stopped, later work starts it again', () => {
        const host = fakeHost()
        attach(host)
        beginInFlight('image')
        window.__risuTaniumKeepAliveStop?.()

        beginInFlight('chat')

        expect(host.start).toHaveBeenCalledTimes(2)
    })
})

describe('the system time limit', () => {
    test('a timeout resets the consumer so the next work starts the service again', () => {
        const host = fakeHost()
        attach(host)
        beginInFlight('chat')
        expect(host.start).toHaveBeenCalledTimes(1)

        window.__risuTaniumKeepAliveTimeout?.()
        beginInFlight('image')

        expect(host.start).toHaveBeenCalledTimes(2)
    })

    test('a timeout after the host was asked to stop makes the next work start the service', () => {
        const host = fakeHost()
        attach(host)
        beginInFlight('chat')()

        window.__risuTaniumKeepAliveTimeout?.()
        beginInFlight('image')

        expect(host.start).toHaveBeenCalledTimes(2)
    })

    test('a timeout during the page-timer linger cancels the pending stop', () => {
        const host = legacyHost()
        attach(host)
        beginInFlight('chat')()
        host.stop.mockClear()

        window.__risuTaniumKeepAliveTimeout?.()
        vi.advanceTimersByTime(KEEP_ALIVE_LINGER_MS * 2)

        expect(host.stop).not.toHaveBeenCalled()
    })
})

describe('a missing or failing host', () => {
    test('a host without methods is skipped silently', () => {
        attach({})

        expect(() => {
            beginInFlight('chat')()
            vi.advanceTimersByTime(KEEP_ALIVE_LINGER_MS)
            window.__risuTaniumKeepAliveStop?.()
        }).not.toThrow()
    })

    test('a host call that throws is logged and does not break the work or later calls', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const host = fakeHost()
        host.start.mockImplementation(() => { throw new Error('bridge failed') })
        attach(host)

        expect(() => beginInFlight('chat')).not.toThrow()
        expect(error).toHaveBeenCalled()
        beginInFlight('tts')
        expect(host.update).not.toHaveBeenCalled()
    })

    test('the host is called as a method, so a bridge that needs its receiver works', () => {
        const calls: string[] = []
        const host = {
            name: 'bridge',
            start(this: { name: string }) { calls.push(`start:${this.name}`) },
            requestNotificationPermissionOnce(this: { name: string }) { calls.push(`perm:${this.name}`) },
            stop(this: { name: string }) { calls.push(`stop:${this.name}`) },
        }
        attach(host)
        calls.length = 0

        beginInFlight('chat')

        expect(calls).toEqual(['perm:bridge', 'start:bridge'])
    })
})

describe('startKeepAliveService', () => {
    test('is a no-op outside the Android app', () => {
        platform.android = false
        window.__risuTaniumKeepAlive = fakeHost()

        expect(startKeepAliveService()).toBeNull()
        expect(window.__risuTaniumKeepAliveStop).toBeUndefined()
    })

    test('is a no-op in the Android app without the bridge', () => {
        expect(startKeepAliveService()).toBeNull()
        expect(window.__risuTaniumKeepAliveStop).toBeUndefined()
    })

    test('with the bridge, mirrors the registry and delivers Stop to the reply and the speech', async () => {
        const host = fakeHost()
        window.__risuTaniumKeepAlive = host
        consumer = startKeepAliveService()
        expect(consumer).not.toBeNull()
        host.stop.mockClear()

        beginInFlight('chat')
        expect(host.start).toHaveBeenCalledWith('Generating a reply…', 'Stop')
        window.__risuTaniumKeepAliveStop?.()

        await vi.waitFor(() => {
            expect(abortChatMock).toHaveBeenCalledTimes(1)
            expect(stopTTSMock).toHaveBeenCalledTimes(1)
        })
    })

    describe('the host listener (the launch target registers itself here)', () => {
        afterEach(() => {
            onKeepAliveHost(null)
        })

        test('with the bridge, the listener gets that host once, before any work', () => {
            const listener = vi.fn()
            onKeepAliveHost(listener)
            const host = fakeHost()
            window.__risuTaniumKeepAlive = host
            consumer = startKeepAliveService()

            expect(listener).toHaveBeenCalledTimes(1)
            expect(listener).toHaveBeenCalledWith(host)
            expect(host.start).not.toHaveBeenCalled()
        })

        test('outside the Android app and without the bridge, the listener is not called', () => {
            const listener = vi.fn()
            onKeepAliveHost(listener)
            platform.android = false
            window.__risuTaniumKeepAlive = fakeHost()
            startKeepAliveService()
            platform.android = true
            delete window.__risuTaniumKeepAlive
            startKeepAliveService()

            expect(listener).not.toHaveBeenCalled()
        })

        test('a listener that throws does not stop the consumer from starting', () => {
            const error = vi.spyOn(console, 'error').mockImplementation(() => { })
            onKeepAliveHost(() => { throw new Error('listener') })
            window.__risuTaniumKeepAlive = fakeHost()
            consumer = startKeepAliveService()

            expect(consumer).not.toBeNull()
            error.mockRestore()
        })
    })

    test('with the bridge, the end of the work shows the Finishing up title from the language table without Stop', () => {
        const host = fakeHost()
        window.__risuTaniumKeepAlive = host
        consumer = startKeepAliveService()

        beginInFlight('chat')()

        expect(host.update).toHaveBeenLastCalledWith('Finishing up…', '')
    })
})

describe('startKeepAliveService over the host channel', () => {
    afterEach(() => {
        delete window.__risuTaniumHost
    })

    test('(R) the service is driven by messages: a stop at start, then permission and startState for work, and one stopAfterWithOutcome at its end', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        consumer = startKeepAliveService()
        expect(consumer).not.toBeNull()
        expect(fake.postedTo('keepAlive', 'stop')).toEqual([{ bridge: 'keepAlive', method: 'stop', args: [] }])

        const end = beginInFlight('chat')
        expect(fake.postedTo('keepAlive', 'requestNotificationPermissionOnce')).toEqual([
            { bridge: 'keepAlive', method: 'requestNotificationPermissionOnce', args: [] },
        ])
        const started = fake.postedTo('keepAlive', 'startState')
        expect(started).toHaveLength(1)
        const [startJson] = started[0].args as [string]
        expect(JSON.parse(startJson)).toEqual(expect.objectContaining({ v: 2, state: 'generating', title: 'Generating a reply…', stopLabel: 'Stop' }))
        expect(fake.postedTo('keepAlive', 'start')).toEqual([])

        end()
        const closing = fake.postedTo('keepAlive', 'stopAfterWithOutcome')
        expect(closing).toHaveLength(1)
        const [lingerMs, closingJson] = closing[0].args as [number, string]
        expect(lingerMs).toBe(KEEP_ALIVE_LINGER_MS)
        expect(JSON.parse(closingJson)).toEqual(expect.objectContaining({ v: 2, state: 'finishing', title: 'Finishing up…', stopLabel: '' }))
        expect(fake.postedTo('keepAlive', 'update')).toEqual([])
        expect(fake.postedTo('keepAlive', 'updateState')).toEqual([])
        expect(fake.postedTo('keepAlive', 'stopAfter')).toEqual([])
    })

    test('(R) the channel wins over the separate host object, which is never called', () => {
        const fake = createHostChannelFake()
        const host = fakeHostV2()
        window.__risuTaniumHost = fake.channel
        window.__risuTaniumKeepAlive = host
        consumer = startKeepAliveService()
        beginInFlight('chat')

        expect(fake.postedTo('keepAlive', 'startState')).toHaveLength(1)
        for (const method of [host.start, host.update, host.stop, host.stopAfter, host.requestNotificationPermissionOnce, host.startState, host.updateState, host.stopAfterWithOutcome]) {
            expect(method).not.toHaveBeenCalled()
        }
    })

    test('(R) the Stop hook still reaches the running work', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        consumer = startKeepAliveService()
        beginInFlight('chat')
        window.__risuTaniumKeepAliveStop?.()

        await vi.waitFor(() => {
            expect(abortChatMock).toHaveBeenCalledTimes(1)
        })
    })

    test('(R) a channel that throws is logged and never breaks the work', () => {
        const fake = createHostChannelFake()
        fake.channel.postMessage.mockImplementation(() => { throw new Error('host failed') })
        window.__risuTaniumHost = fake.channel
        const error = vi.spyOn(console, 'error').mockImplementation(() => { })
        consumer = startKeepAliveService()

        expect(() => beginInFlight('chat')).not.toThrow()
        expect(error).toHaveBeenCalled()
    })
})

describe('a pending hidden-reply save (the save kind)', () => {
    test('only a pending save shows the save-pending notice with no Stop action', () => {
        const host = fakeHost()
        attach(host)
        host.stop.mockClear()

        beginInFlight('save')

        expect(host.start).toHaveBeenCalledWith(LABELS.savePending, '')
    })

    test('a chat with a pending save keeps the generating notice with Stop', () => {
        const host = fakeHost()
        attach(host)
        beginInFlight('chat')
        beginInFlight('save')

        expect(host.update).not.toHaveBeenCalled()
        expect(host.start).toHaveBeenCalledWith(LABELS.generating, LABELS.stop)
    })

    test('speech with a pending save is working work with Stop', () => {
        const host = fakeHost()
        attach(host)
        beginInFlight('tts')
        beginInFlight('save')

        expect(host.start).toHaveBeenCalledWith(LABELS.working, LABELS.stop)
        expect(host.update).not.toHaveBeenCalled()
    })

    test('the chat ending under a pending save is one update, with no native stop requested', () => {
        const host = fakeHost()
        attach(host)
        host.stop.mockClear()
        const endChat = beginInFlight('chat')
        beginInFlight('save')
        host.update.mockClear()

        endChat()

        expect(host.update).toHaveBeenCalledTimes(1)
        expect(host.update).toHaveBeenCalledWith(LABELS.savePending, '')
        expect(host.stopAfter).not.toHaveBeenCalled()
        expect(host.stop).not.toHaveBeenCalled()
    })

    test('the save ending last updates to Finishing up and then hands the linger to the host, in that order', () => {
        const host = fakeHost()
        attach(host)
        const endSave = beginInFlight('save')
        host.update.mockClear()

        endSave()

        expect(host.update).toHaveBeenCalledWith(LABELS.finishing, '')
        expect(host.stopAfter).toHaveBeenCalledWith(KEEP_ALIVE_LINGER_MS)
        expect(host.update.mock.invocationCallOrder[0]).toBeLessThan(host.stopAfter.mock.invocationCallOrder[0])
    })

    test('a stale Stop tap with only a save pending does not stop the service', () => {
        const host = fakeHost()
        attach(host)
        beginInFlight('save')
        host.stop.mockClear()

        window.__risuTaniumKeepAliveStop?.()

        expect(host.stop).not.toHaveBeenCalled()
        expect(host.stopAfter).not.toHaveBeenCalled()
        expect(stopWork).not.toHaveBeenCalled()
    })

    test('a Stop tap with a busy action and a save pending still stops the service', () => {
        const host = fakeHost()
        attach(host)
        beginInFlight('busy')
        beginInFlight('save')
        host.stop.mockClear()

        window.__risuTaniumKeepAliveStop?.()

        expect(host.stop).toHaveBeenCalledTimes(1)
    })
})

const CHAT_TARGET = { chaId: 'g1', chatId: 'c1' }

describe('contract v2: the notice for work in flight', () => {
    // P1, regression reproducer: on the base, a chat in flight calls the v1 start with two strings and never startState.
    test('a chat in flight starts the service with a generating notice carrying its start time and Stop', () => {
        vi.setSystemTime(50_000)
        const host = fakeHostV2()
        attach(host)
        host.stop.mockClear()

        beginInFlight('chat', { target: CHAT_TARGET })

        expect(host.startState).toHaveBeenCalledTimes(1)
        expect(host.start).not.toHaveBeenCalled()
        expect(host.requestNotificationPermissionOnce.mock.invocationCallOrder[0]).toBeLessThan(host.startState.mock.invocationCallOrder[0])
        expect(sentNotices(host)[0].payload).toEqual({
            v: 2,
            state: 'generating',
            title: LABELS.generating,
            text: '',
            startedAt: 50_000,
            stopLabel: LABELS.stop,
            publicTitle: LABELS.generating,
            stoppingTitle: V2_LABELS.stopping,
            stoppedTitle: V2_LABELS.stopped,
            identity: null,
            avatar: null,
            target: CHAT_TARGET,
        })
    })

    // P2, regression reproducer: on the base there is no startState, and speech alone reads "Working…".
    test('the highest-priority work decides the state, and only a reply or speech carries Stop', () => {
        const host = fakeHostV2()
        attach(host)
        const endImage = beginInFlight('image')
        beginInFlight('translate')
        const endTts = beginInFlight('tts')
        const endChat = beginInFlight('chat', { target: CHAT_TARGET })
        endChat()
        endTts()
        endImage()

        const states = sentNotices(host)
            .filter((sent) => sent.method !== 'stopAfterWithOutcome')
            .map((sent) => [sent.payload.state, sent.payload.title, sent.payload.stopLabel])
        expect(states).toEqual([
            ['image', V2_LABELS.image, ''],
            ['speaking', V2_LABELS.speaking, LABELS.stop],
            ['generating', LABELS.generating, LABELS.stop],
            ['speaking', V2_LABELS.speaking, LABELS.stop],
            ['image', V2_LABELS.image, ''],
            ['translating', V2_LABELS.translating, ''],
        ])
    })

    test('request, embedding and busy work read Working, counting from the earliest of them', () => {
        const host = fakeHostV2()
        attach(host)
        vi.setSystemTime(10_000)
        beginInFlight('embed')
        vi.setSystemTime(12_000)
        beginInFlight('request')

        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'working', title: LABELS.working, startedAt: 10_000, stopLabel: '' }))
    })

    test('each state counts from the start of its own work, and a pending save has no chronometer', () => {
        const host = fakeHostV2()
        attach(host)
        vi.setSystemTime(1_000)
        beginInFlight('tts')
        expect(liveNotice(host).startedAt).toBe(1_000)
        vi.setSystemTime(2_000)
        const endChat = beginInFlight('chat', { target: CHAT_TARGET })
        expect(liveNotice(host).startedAt).toBe(2_000)
        endChat()
        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'speaking', startedAt: 1_000 }))
        beginInFlight('save')
        beginInFlight('tts')
        expect(liveNotice(host).state).toBe('speaking')
    })

    test('only a pending save reads as saving, with no Stop and no chronometer', () => {
        const host = fakeHostV2()
        attach(host)

        beginInFlight('save')

        expect(sentNotices(host)[0].payload).toEqual(expect.objectContaining({ state: 'savePending', title: LABELS.savePending, stopLabel: '', startedAt: null, target: null }))
    })

    test('an unchanged notice is not sent again', () => {
        const host = fakeHostV2()
        attach(host)
        beginInFlight('chat', { target: CHAT_TARGET })
        beginInFlight('chat', { target: CHAT_TARGET })
        beginInFlight('save')

        expect(host.startState).toHaveBeenCalledTimes(1)
        expect(host.updateState).not.toHaveBeenCalled()
    })

    test('a host with only some of the v2 methods, or a page without the v2 dependencies, keeps the v1 calls', () => {
        const partial = fakeHost() as FakeHost & { startState: Mock<(json: string) => void> }
        partial.startState = vi.fn()
        attach(partial)
        beginInFlight('chat', { target: CHAT_TARGET })
        expect(partial.start).toHaveBeenCalledTimes(1)
        expect(partial.startState).not.toHaveBeenCalled()
        consumer?.dispose()
        resetInFlightForTest()

        const full = fakeHostV2()
        consumer = createKeepAliveConsumer({ host: full, kinds: inFlightKinds, subscribe: subscribeInFlight, labels: () => LABELS, stopWork })
        beginInFlight('chat', { target: CHAT_TARGET })
        expect(full.start).toHaveBeenCalledTimes(1)
        expect(full.startState).not.toHaveBeenCalled()
    })
})

describe('contract v2: the chat target', () => {
    // P14, regression reproducer: on the base there is no startState.
    test('a chat notice carries the target of the live chat, and image, translation and other work carry none', () => {
        const host = fakeHostV2()
        attach(host)
        const endChat = beginInFlight('chat', { target: CHAT_TARGET })
        expect(liveNotice(host).target).toEqual(CHAT_TARGET)
        endChat()
        vi.advanceTimersByTime(KEEP_ALIVE_LINGER_MS * 2)

        beginInFlight('image')
        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'image', target: null, identity: null }))
        beginInFlight('translate')
        beginInFlight('embed')
        expect(liveNotice(host).target).toBeNull()
    })

    test('a chat with no recorded target carries none', () => {
        const host = fakeHostV2()
        attach(host)
        beginInFlight('chat')
        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'generating', target: null }))
    })

    // P14b, new code (generating restated: chat outranks speech, so a live chat never shows Speaking).
    test('with a chat and speech both live, the notice is Generating with the chat target', () => {
        const host = fakeHostV2()
        attach(host)
        beginInFlight('tts')
        beginInFlight('chat', { target: CHAT_TARGET })

        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'generating', target: CHAT_TARGET }))
    })

    test('speech that begins 3000 ms after the chat ended still shows the chat', () => {
        const host = fakeHostV2()
        attach(host)
        beginInFlight('chat', { target: CHAT_TARGET })()
        vi.advanceTimersByTime(3000)

        beginInFlight('tts')

        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'speaking', target: CHAT_TARGET }))
    })

    test('speech that begins 11000 ms after the chat ended shows no stale chat', () => {
        const host = fakeHostV2()
        attach(host)
        beginInFlight('chat', { target: CHAT_TARGET })()
        vi.advanceTimersByTime(11_000)

        beginInFlight('tts')

        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'speaking', target: null, identity: null }))
    })

    // R3-1: the window is decided when the speech begins, not at every sync.
    test('speech that began inside the window keeps the chat when a later sync falls outside it', () => {
        const host = fakeHostV2()
        attach(host, { identityOf: () => ({ key: 'c1', name: 'Alice' }) })
        const endChat = beginInFlight('chat', { target: CHAT_TARGET })
        const endSynthesis = beginInFlight('tts')
        endChat()
        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'speaking', target: CHAT_TARGET }))
        vi.advanceTimersByTime(15_000)

        // The clip's own token begins, then the synthesis token ends: both sync, 15 s after the chat ended.
        const endClip = beginInFlight('tts')
        endSynthesis()

        expect(liveNotice(host)).toEqual(expect.objectContaining({
            state: 'speaking',
            target: CHAT_TARGET,
            identity: { key: 'c1', name: 'Alice' },
        }))
        // Every notice sent for the speech names the chat, none of them drops it.
        const speaking = sentNotices(host).filter((sent) => sent.payload.state === 'speaking')
        expect(speaking.length).toBeGreaterThanOrEqual(2)
        expect(speaking.every((sent) => sent.payload.target?.chatId === 'c1')).toBe(true)
        endClip()
    })

    test('a speech that ends and a later one that begins outside the window decide again', () => {
        const host = fakeHostV2()
        attach(host)
        const endChat = beginInFlight('chat', { target: CHAT_TARGET })
        const endFirst = beginInFlight('tts')
        endChat()
        endFirst()
        vi.advanceTimersByTime(20_000)

        beginInFlight('tts')

        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'speaking', target: null }))
    })

    // The window runs from the latest chat end, not from the first one.
    test('the window is measured from the end of the latest chat, not of an earlier one', () => {
        const host = fakeHostV2()
        const otherTarget = { chaId: 'g2', chatId: 'c9' }
        attach(host)
        beginInFlight('chat', { target: CHAT_TARGET })()
        vi.advanceTimersByTime(5000)
        const endSecond = beginInFlight('chat', { target: otherTarget })
        vi.advanceTimersByTime(20_000)
        endSecond()
        vi.advanceTimersByTime(1000)

        beginInFlight('tts')

        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'speaking', target: otherTarget }))
    })

    // A speech that began inside the window and is stopped after it still closes with the chat it showed.
    test('a Stop 20 s into a speech that began inside the window keeps the name, avatar key and target in the closing notice', () => {
        const host = fakeHostV2()
        attach(host, { identityOf: () => ({ key: 'c1', name: 'Alice' }) })
        beginInFlight('chat', { target: CHAT_TARGET })()
        vi.advanceTimersByTime(1000)
        const endSpeech = beginInFlight('tts')
        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'speaking', target: CHAT_TARGET, identity: { key: 'c1', name: 'Alice' } }))
        vi.advanceTimersByTime(20_000)

        endSpeech()

        const closing = sentNotices(host).at(-1)
        expect(closing?.method).toBe('stopAfterWithOutcome')
        expect(closing?.payload).toEqual(expect.objectContaining({
            state: 'finishing',
            identity: { key: 'c1', name: 'Alice' },
            target: CHAT_TARGET,
        }))
    })
})

describe('contract v2: the closing notice and the run outcome', () => {
    // P3, regression reproducer: on the base the end sends update + stopAfter, never stopAfterWithOutcome.
    test.each([
        ['stopped', V2_LABELS.stopped, ''],
        ['failed', V2_LABELS.failed, V2_LABELS.failedHint],
    ] as const)('a chat that ended %s sends one closing notice with the delayed stop and no update', (outcome, title, text) => {
        const host = fakeHostV2()
        attach(host)
        const end = beginInFlight('chat', { target: CHAT_TARGET })
        host.updateState.mockClear()
        host.update.mockClear()

        end(outcome)

        expect(host.stopAfterWithOutcome).toHaveBeenCalledTimes(1)
        const closing = sentNotices(host).at(-1)
        expect(closing?.method).toBe('stopAfterWithOutcome')
        expect(closing?.ms).toBe(KEEP_ALIVE_LINGER_MS)
        expect(closing?.payload).toEqual(expect.objectContaining({ state: outcome, title, text, stopLabel: '', startedAt: null, target: CHAT_TARGET }))
        expect(host.updateState).not.toHaveBeenCalled()
        expect(host.update).not.toHaveBeenCalled()
        expect(host.stopAfter).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })

    test('the closing notice of a normal end is Finishing up, which carries the ended chat', () => {
        const host = fakeHostV2()
        attach(host)

        beginInFlight('chat', { target: CHAT_TARGET })('reply')

        expect(sentNotices(host).at(-1)?.payload).toEqual(expect.objectContaining({ state: 'finishing', title: LABELS.finishing, stopLabel: '', target: CHAT_TARGET }))
    })

    // P3a, regression reproducer: the outcome must survive the hidden reply's save.
    test('a chat that ended stopped under a pending save still shows Stopped when the save ends last', () => {
        const host = fakeHostV2()
        attach(host)
        const endChat = beginInFlight('chat', { target: CHAT_TARGET })
        const endSave = beginInFlight('save')
        endChat('stopped')
        expect(host.stopAfterWithOutcome).not.toHaveBeenCalled()

        endSave()

        expect(host.stopAfterWithOutcome).toHaveBeenCalledTimes(1)
        expect(sentNotices(host).at(-1)?.payload).toEqual(expect.objectContaining({ state: 'stopped', target: CHAT_TARGET }))
    })

    // P3b, regression reproducer: a later unit of work must not show an outcome that was not its own.
    test('a failure does not show again after other work has begun and ended', () => {
        const host = fakeHostV2()
        attach(host)
        beginInFlight('chat', { target: CHAT_TARGET })('failed')
        host.stopAfterWithOutcome.mockClear()
        host.startState.mockClear()

        beginInFlight('translate')()

        expect(sentNotices(host).at(-1)?.payload.state).toBe('finishing')
    })

    test('a failure that ended while speech was live does not show after translation ends', () => {
        const host = fakeHostV2()
        attach(host)
        const endChat = beginInFlight('chat', { target: CHAT_TARGET })
        const endTts = beginInFlight('tts')
        endChat('failed')

        const endTranslate = beginInFlight('translate')
        endTts()
        endTranslate()

        expect(sentNotices(host).at(-1)?.payload.state).toBe('finishing')
    })

    // P3d: the outcome is taken before the running check, so one that ends after the system's time limit is discarded.
    test('an outcome that ends while the service is not running is not shown by a later save run', () => {
        const host = fakeHostV2()
        attach(host)
        const endChat = beginInFlight('chat', { target: CHAT_TARGET })
        window.__risuTaniumKeepAliveTimeout?.()

        endChat('failed')
        expect(host.stopAfterWithOutcome).not.toHaveBeenCalled()

        const endSave = beginInFlight('save')
        expect(sentNotices(host).at(-1)?.payload.state).toBe('savePending')
        endSave()

        expect(host.stopAfterWithOutcome).toHaveBeenCalledTimes(1)
        expect(sentNotices(host).at(-1)?.payload.state).toBe('finishing')
    })

    test('a v1 host still reads and discards the outcome at the all-ended sync', () => {
        const host = fakeHost()
        attach(host)
        const endChat = beginInFlight('chat', { target: CHAT_TARGET })
        window.__risuTaniumKeepAliveTimeout?.()

        endChat('failed')

        expect(takeRunOutcome()).toBeNull()
    })
})

describe('contract v2: identity in the closing notice and the latch', () => {
    const ALICE = { key: 'c1', name: 'Alice' }

    // P15 (target and identity part), new code. R3-5: a finishing notice carries the ended chat's target and identity too,
    // so a Stopped that native converts from it names the same chat as a Stopped the page sent.
    test.each(['stopped', 'failed', 'reply'] as const)('a chat that ended %s sends its target and identity', (outcome) => {
        const host = fakeHostV2()
        attach(host, { identityOf: () => ALICE })

        beginInFlight('chat', { target: CHAT_TARGET })(outcome)

        expect(sentNotices(host).at(-1)?.payload).toEqual(expect.objectContaining({ target: CHAT_TARGET, identity: ALICE }))
    })

    // The lock-screen text is the public title: it is the state's label and never the speaker's name.
    test('the public title of a live notice is the state label and never carries the name', () => {
        const host = fakeHostV2()
        attach(host, { identityOf: () => ALICE })

        beginInFlight('chat', { target: CHAT_TARGET })

        const live = liveNotice(host)
        expect(live.identity).toEqual(ALICE)
        expect(live.publicTitle).toBe(LABELS.generating)
        expect(JSON.stringify(live.publicTitle)).not.toContain('Alice')
    })

    test.each([
        ['stopped', V2_LABELS.stopped],
        ['failed', V2_LABELS.failed],
        ['reply', LABELS.finishing],
    ] as const)('the public title of the closing notice of a chat that ended %s is the state label and never carries the name', (outcome, label) => {
        const host = fakeHostV2()
        attach(host, { identityOf: () => ALICE })

        beginInFlight('chat', { target: CHAT_TARGET })(outcome)

        const closing = sentNotices(host).at(-1)?.payload
        expect(closing?.identity).toEqual(ALICE)
        expect(closing?.publicTitle).toBe(label)
        expect(closing?.publicTitle).not.toContain('Alice')
    })

    test('a finishing notice after unrelated work, long after the chat, names no chat', () => {
        const host = fakeHostV2()
        attach(host, { identityOf: () => ALICE })
        beginInFlight('chat', { target: CHAT_TARGET })()
        vi.advanceTimersByTime(30_000)

        beginInFlight('translate')()

        expect(sentNotices(host).at(-1)?.payload).toEqual(expect.objectContaining({ state: 'finishing', target: null, identity: null }))
    })

    test('image, translation and other work carry no identity even right after a chat', () => {
        const host = fakeHostV2()
        attach(host, { identityOf: () => ALICE })
        beginInFlight('chat', { target: CHAT_TARGET })()

        beginInFlight('image')

        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'image', identity: null, target: null }))
    })

    test('the identity of a live chat is read from the dependency at every sync, so a group speaker change is sent', () => {
        let speaker = ALICE
        const host = fakeHostV2()
        attach(host, { identityOf: () => speaker })
        beginInFlight('chat', { target: CHAT_TARGET })
        speaker = { key: 'c2', name: 'Bob' }

        beginInFlight('save')
        beginInFlight('chat', { target: CHAT_TARGET })

        expect(liveNotice(host).identity).toEqual({ key: 'c2', name: 'Bob' })
    })
})

const ALICE_SUBJECT: KeepAliveSubject = { identity: { key: 'c1', name: 'Alice' }, image: 'assets/alice.png', ownerImage: 'assets/alice.png' }
const BOB_SUBJECT: KeepAliveSubject = { identity: { key: 'c2', name: 'Bob' }, image: 'assets/bob.png', ownerImage: 'assets/bob.png' }
const ALICE_AVATAR = 'data:image/webp;base64,QUxJQ0U='
const BOB_AVATAR = 'data:image/webp;base64,Qk9C'

interface FakeAvatar extends KeepAliveAvatarSource {
    of: Mock<(image: string) => string | null | undefined>
    warm: Mock<(image: string) => Promise<void>>
    /** Makes the image known (a thumbnail, or null for none) and finishes its pending warms. */
    settle(image: string, value: string | null): Promise<void>
}

/** A stand-in for the thumbnail memo: unknown images answer undefined until a test settles them. */
function fakeAvatar(known: Record<string, string | null> = {}): FakeAvatar {
    const memo = new Map<string, string | null>(Object.entries(known))
    const pending = new Map<string, Array<() => void>>()
    return {
        of: vi.fn((image: string) => (memo.has(image) ? memo.get(image) : undefined)),
        warm: vi.fn((image: string) => new Promise<void>((resolve) => {
            pending.set(image, [...(pending.get(image) ?? []), resolve])
        })),
        async settle(image: string, value: string | null) {
            memo.set(image, value)
            for (const resolve of pending.get(image) ?? []) {
                resolve()
            }
            pending.delete(image)
            await vi.advanceTimersByTimeAsync(0)
        },
    }
}

function avatarsSent(host: FakeHostV2): Array<string> {
    return sentNotices(host).flatMap((sent) => (sent.payload.avatar === null ? [] : [sent.payload.avatar]))
}

describe('contract v2: identity from the subject (C2b)', () => {
    // P8, new code.
    test('a reply state names the speaker with the owner as the target, and other work names nobody', () => {
        const host = fakeHostV2()
        const groupSubject: KeepAliveSubject = { identity: { key: 'member', name: 'Member' }, image: 'assets/m.png', ownerImage: 'assets/g.png' }
        attach(host, { subjectOf: () => groupSubject })

        const endChat = beginInFlight('chat', { target: CHAT_TARGET })
        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'generating', identity: { key: 'member', name: 'Member' }, target: CHAT_TARGET }))
        endChat()

        beginInFlight('image')
        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'image', identity: null, target: null }))
    })

    test('speech right after the chat keeps the chat identity, and the closing notices carry it too', () => {
        const host = fakeHostV2()
        attach(host, { subjectOf: () => ALICE_SUBJECT })
        const endChat = beginInFlight('chat', { target: CHAT_TARGET })
        const endSpeech = beginInFlight('tts')
        endChat()
        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'speaking', identity: ALICE_SUBJECT.identity }))

        endSpeech()

        expect(sentNotices(host).at(-1)?.payload).toEqual(expect.objectContaining({ state: 'finishing', identity: ALICE_SUBJECT.identity, target: CHAT_TARGET }))
    })

    test('a subject that is gone gives a notice with no identity', () => {
        const host = fakeHostV2()
        attach(host, { subjectOf: () => null })

        beginInFlight('chat', { target: CHAT_TARGET })

        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'generating', identity: null, target: CHAT_TARGET }))
    })
})

describe('contract v2: the avatar (C2b)', () => {
    // P9, new code. R3-2: the consumer sees undefined from the source and warms; a string is sent, null is no icon.
    test('a miss starts the notice with no avatar, warms once, and the finished warm sends exactly one update with it', async () => {
        const host = fakeHostV2()
        const avatar = fakeAvatar()
        attach(host, { subjectOf: () => ALICE_SUBJECT, avatar })

        beginInFlight('chat', { target: CHAT_TARGET })

        expect(host.startState).toHaveBeenCalledTimes(1)
        expect(liveNotice(host).avatar).toBeNull()
        expect(avatar.warm).toHaveBeenCalledTimes(1)
        expect(avatar.warm).toHaveBeenCalledWith('assets/alice.png')

        await avatar.settle('assets/alice.png', ALICE_AVATAR)

        expect(host.updateState).toHaveBeenCalledTimes(1)
        expect(avatarsSent(host)).toEqual([ALICE_AVATAR])
        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'generating', identity: ALICE_SUBJECT.identity }))
    })

    test('a hit goes out with the start, and later notices of the same run do not carry it again', () => {
        const host = fakeHostV2()
        const avatar = fakeAvatar({ 'assets/alice.png': ALICE_AVATAR })
        attach(host, { subjectOf: () => ALICE_SUBJECT, avatar })

        beginInFlight('chat', { target: CHAT_TARGET })
        beginInFlight('save')
        beginInFlight('tts')
        beginInFlight('image')

        expect(avatar.warm).not.toHaveBeenCalled()
        expect(host.startState).toHaveBeenCalledTimes(1)
        expect(avatarsSent(host)).toEqual([ALICE_AVATAR])
    })

    test('a new run for the same speaker sends the avatar again, because native lost it with the old service', () => {
        const host = fakeHostV2()
        const avatar = fakeAvatar({ 'assets/alice.png': ALICE_AVATAR })
        attach(host, { subjectOf: () => ALICE_SUBJECT, avatar })

        beginInFlight('chat', { target: CHAT_TARGET })()
        expect(host.stopAfterWithOutcome).toHaveBeenCalledTimes(1)
        beginInFlight('chat', { target: CHAT_TARGET })

        expect(host.startState).toHaveBeenCalledTimes(2)
        expect(avatarsSent(host)).toEqual([ALICE_AVATAR, ALICE_AVATAR])
    })

    test('the closing notice does not carry an avatar that already went out', () => {
        const host = fakeHostV2()
        attach(host, { subjectOf: () => ALICE_SUBJECT, avatar: fakeAvatar({ 'assets/alice.png': ALICE_AVATAR }) })

        beginInFlight('chat', { target: CHAT_TARGET })('stopped')

        const closing = sentNotices(host).at(-1)
        expect(closing?.method).toBe('stopAfterWithOutcome')
        expect(closing?.payload).toEqual(expect.objectContaining({ state: 'stopped', identity: ALICE_SUBJECT.identity, avatar: null }))
    })

    test('null from the source means no icon: nothing is sent and nothing is warmed', async () => {
        const host = fakeHostV2()
        const avatar = fakeAvatar({ 'assets/alice.png': null })
        attach(host, { subjectOf: () => ALICE_SUBJECT, avatar })

        beginInFlight('chat', { target: CHAT_TARGET })
        await vi.advanceTimersByTimeAsync(0)

        expect(avatarsSent(host)).toEqual([])
        expect(avatar.warm).not.toHaveBeenCalled()
        expect(host.updateState).not.toHaveBeenCalled()
    })

    test('a speaker with no image sends no avatar and warms nothing', () => {
        const host = fakeHostV2()
        const avatar = fakeAvatar()
        attach(host, { subjectOf: () => ({ ...ALICE_SUBJECT, image: '', ownerImage: '' }), avatar })

        beginInFlight('chat', { target: CHAT_TARGET })

        expect(avatar.of).not.toHaveBeenCalled()
        expect(avatar.warm).not.toHaveBeenCalled()
        expect(avatarsSent(host)).toEqual([])
    })

    test('a warm that finishes after the identity changed is dropped: no avatar for the old speaker, no second warm for the new one', async () => {
        let subject = ALICE_SUBJECT
        const host = fakeHostV2()
        const avatar = fakeAvatar()
        attach(host, { subjectOf: () => subject, avatar })
        beginInFlight('chat', { target: CHAT_TARGET })
        subject = BOB_SUBJECT
        beginInFlight('save')
        expect(liveNotice(host).identity).toEqual(BOB_SUBJECT.identity)
        expect(avatar.warm).toHaveBeenCalledTimes(2)
        const updatesBefore = host.updateState.mock.calls.length

        await avatar.settle('assets/alice.png', ALICE_AVATAR)

        expect(host.updateState).toHaveBeenCalledTimes(updatesBefore)
        expect(avatarsSent(host)).toEqual([])
        expect(avatar.warm).toHaveBeenCalledTimes(2)

        await avatar.settle('assets/bob.png', BOB_AVATAR)

        expect(avatarsSent(host)).toEqual([BOB_AVATAR])
    })

    test('a warm that finishes after the work ended sends nothing', async () => {
        const host = fakeHostV2()
        const avatar = fakeAvatar()
        attach(host, { subjectOf: () => ALICE_SUBJECT, avatar })
        beginInFlight('chat', { target: CHAT_TARGET })()

        await avatar.settle('assets/alice.png', ALICE_AVATAR)

        expect(host.updateState).not.toHaveBeenCalled()
        expect(avatarsSent(host)).toEqual([])
    })

    test('a group run also warms the owner image, and that warm sends nothing', async () => {
        const host = fakeHostV2()
        const avatar = fakeAvatar({ 'assets/m.png': ALICE_AVATAR })
        const groupSubject: KeepAliveSubject = { identity: { key: 'member', name: 'Member' }, image: 'assets/m.png', ownerImage: 'assets/g.png' }
        attach(host, { subjectOf: () => groupSubject, avatar })

        beginInFlight('chat', { target: CHAT_TARGET })

        expect(avatar.warm).toHaveBeenCalledTimes(1)
        expect(avatar.warm).toHaveBeenCalledWith('assets/g.png')
        await avatar.settle('assets/g.png', BOB_AVATAR)
        expect(avatarsSent(host)).toEqual([ALICE_AVATAR])
        expect(host.updateState.mock.calls.every((call) => (JSON.parse(call[0]) as KeepAlivePayload).avatar === null)).toBe(true)
    })

})

describe('contract v2: the live character count (C2b)', () => {
    // P10, new code.
    function generating(count: { value: number | null }, extra: Partial<KeepAliveV2Deps> = {}): FakeHostV2 {
        const host = fakeHostV2()
        attach(host, { characters: () => count.value, ...extra })
        return host
    }

    test('the generating notice has no count text until a count exists, then at most one update per second', () => {
        const count: { value: number | null } = { value: null }
        const host = generating(count)

        beginInFlight('chat', { target: CHAT_TARGET })
        expect(liveNotice(host).text).toBe('')
        count.value = 10
        vi.advanceTimersByTime(999)
        expect(host.updateState).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)

        expect(host.updateState).toHaveBeenCalledTimes(1)
        expect(liveNotice(host).text).toBe('10 characters')
        count.value = 25
        count.value = 40
        vi.advanceTimersByTime(1000)
        expect(host.updateState).toHaveBeenCalledTimes(2)
        expect(liveNotice(host).text).toBe('40 characters')
    })

    test('an unchanged count sends nothing', () => {
        const count = { value: 7 as number | null }
        const host = generating(count)
        beginInFlight('chat', { target: CHAT_TARGET })
        expect(liveNotice(host).text).toBe('7 characters')

        vi.advanceTimersByTime(5000)

        expect(host.updateState).not.toHaveBeenCalled()
    })

    test('the count is formatted for the reader, with grouping', () => {
        const count = { value: 1204 as number | null }
        const host = generating(count)

        beginInFlight('chat', { target: CHAT_TARGET })

        expect(liveNotice(host).text).toBe(`${new Intl.NumberFormat().format(1204)} characters`)
    })

    test('low-power mode sends none, and a later tick outside it sends the current count', () => {
        const count = { value: 3 as number | null }
        const low = { value: true }
        const host = generating(count, { lowPower: () => low.value })
        beginInFlight('chat', { target: CHAT_TARGET })
        expect(liveNotice(host).text).toBe('')
        count.value = 50

        vi.advanceTimersByTime(5000)
        expect(host.updateState).not.toHaveBeenCalled()
        low.value = false
        vi.advanceTimersByTime(1000)

        expect(host.updateState).toHaveBeenCalledTimes(1)
        expect(liveNotice(host).text).toBe('50 characters')
    })

    test('in low-power mode no update carries a count, whatever syncs it', () => {
        const count = { value: 1234 as number | null }
        const host = generating(count, { lowPower: () => true })
        beginInFlight('chat', { target: CHAT_TARGET })
        vi.advanceTimersByTime(5000)

        beginInFlight('request')

        const sent = sentNotices(host)
        expect(sent.length).toBeGreaterThanOrEqual(1)
        expect(sent.every((notice) => notice.payload.text === '')).toBe(true)
        expect(JSON.stringify(sent)).not.toContain('characters')
    })

    test('only generating counts: speech, image and the closing notice carry no count, and no timer is left', () => {
        const count = { value: 12 as number | null }
        const host = generating(count)
        const endChat = beginInFlight('chat', { target: CHAT_TARGET })
        const endSpeech = beginInFlight('tts')
        expect(vi.getTimerCount()).toBeGreaterThan(0)
        endChat()
        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'speaking', text: '' }))
        expect(vi.getTimerCount()).toBe(0)
        vi.advanceTimersByTime(5000)
        count.value = 99
        vi.advanceTimersByTime(5000)
        expect(liveNotice(host).text).toBe('')

        endSpeech()
        expect(sentNotices(host).at(-1)?.payload.text).toBe('')
        expect(vi.getTimerCount()).toBe(0)
        beginInFlight('image')
        expect(liveNotice(host)).toEqual(expect.objectContaining({ state: 'image', text: '' }))
        expect(vi.getTimerCount()).toBe(0)
    })

    test('the timer is cleared when the work ends, when the system ends the service and when the consumer is disposed', () => {
        const count = { value: 1 as number | null }
        generating(count)
        const endChat = beginInFlight('chat', { target: CHAT_TARGET })
        expect(vi.getTimerCount()).toBe(1)
        endChat()
        expect(vi.getTimerCount()).toBe(0)

        beginInFlight('chat', { target: CHAT_TARGET })
        expect(vi.getTimerCount()).toBe(1)
        window.__risuTaniumKeepAliveTimeout?.()
        expect(vi.getTimerCount()).toBe(0)

        resetInFlightForTest()
        consumer?.dispose()
        consumer = null
        generating(count)
        beginInFlight('chat', { target: CHAT_TARGET })
        expect(vi.getTimerCount()).toBe(1)
        consumer?.dispose()
        expect(vi.getTimerCount()).toBe(0)
    })

    test('without the count dependency or its label no count is shown', () => {
        const host = fakeHostV2()
        attach(host)

        beginInFlight('chat', { target: CHAT_TARGET })
        vi.advanceTimersByTime(3000)

        expect(liveNotice(host).text).toBe('')
        expect(host.updateState).not.toHaveBeenCalled()
    })

    test('the count is asked for the chat target of the live chat', () => {
        const asked: Array<{ chaId: string, chatId: string }> = []
        const host = fakeHostV2()
        attach(host, { characters: (target) => { asked.push(target); return 4 } })

        beginInFlight('chat', { target: CHAT_TARGET })

        expect(asked).toContainEqual(CHAT_TARGET)
        expect(liveNotice(host).text).toBe('4 characters')
    })
})
