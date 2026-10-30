// @vitest-environment happy-dom

/**
 * The page side of the Android keep-alive service (`./keepAliveService`)
 * against the REAL in-flight registry and a fake host bridge. A passing test
 * says nothing about the Kotlin service or the notification.
 */
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { beginInFlight, inFlightKinds, resetInFlightForTest, subscribeInFlight } from '../process/inFlightWork'
import {
    createKeepAliveConsumer, KEEP_ALIVE_LINGER_MS, startKeepAliveService,
    type KeepAliveConsumer, type KeepAliveHost,
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

const stopWork = vi.fn()
let consumer: KeepAliveConsumer | null = null

function attach(host: Partial<KeepAliveHost>): KeepAliveConsumer {
    consumer = createKeepAliveConsumer({
        host,
        kinds: inFlightKinds,
        subscribe: subscribeInFlight,
        labels: () => LABELS,
        stopWork,
    })
    return consumer
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

    test('(R) the service is driven by messages: a stop at start, then permission and start for work, update and stopAfter at its end', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        consumer = startKeepAliveService()
        expect(consumer).not.toBeNull()
        expect(fake.postedTo('keepAlive', 'stop')).toEqual([{ bridge: 'keepAlive', method: 'stop', args: [] }])

        const end = beginInFlight('chat')
        expect(fake.postedTo('keepAlive', 'requestNotificationPermissionOnce')).toEqual([
            { bridge: 'keepAlive', method: 'requestNotificationPermissionOnce', args: [] },
        ])
        expect(fake.postedTo('keepAlive', 'start')).toEqual([
            { bridge: 'keepAlive', method: 'start', args: ['Generating a reply…', 'Stop'] },
        ])

        end()
        expect(fake.postedTo('keepAlive', 'update').at(-1)).toEqual({ bridge: 'keepAlive', method: 'update', args: ['Finishing up…', ''] })
        expect(fake.postedTo('keepAlive', 'stopAfter')).toEqual([
            { bridge: 'keepAlive', method: 'stopAfter', args: [KEEP_ALIVE_LINGER_MS] },
        ])
    })

    test('(R) the channel wins over the separate host object, which is never called', () => {
        const fake = createHostChannelFake()
        const host = fakeHost()
        window.__risuTaniumHost = fake.channel
        window.__risuTaniumKeepAlive = host
        consumer = startKeepAliveService()
        beginInFlight('chat')

        expect(fake.postedTo('keepAlive', 'start')).toHaveLength(1)
        for (const method of [host.start, host.update, host.stop, host.stopAfter, host.requestNotificationPermissionOnce]) {
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
