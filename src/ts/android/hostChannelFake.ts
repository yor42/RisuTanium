/**
 * Test-only stand-in for the message object the Android host injects into the app's main frame:
 * `postMessage(string)` sends to the host, and `message` listeners receive events whose `data`
 * is a string. It imports nothing but vitest, so it can sit next to tests that run against code
 * that has never heard of the channel.
 */
import { vi, type Mock } from 'vitest'

export interface HostChannelFakeObject {
    postMessage: Mock<(message: string) => void>
    addEventListener: Mock<(type: string, listener: (event: { data: unknown }) => void) => void>
    removeEventListener: Mock<(type: string, listener: (event: { data: unknown }) => void) => void>
}

export interface HostChannelFake {
    channel: HostChannelFakeObject
    /** Every message the page has posted so far, parsed. */
    posted(): Array<Record<string, unknown>>
    /** The posted messages of one bridge and method. */
    postedTo(bridge: string, method: string): Array<Record<string, unknown>>
    /** The host sends a string to every attached `message` listener. */
    deliver(json: string): void
    /** How many `message` listeners are attached right now. */
    listeners(): number
}

export function createHostChannelFake(): HostChannelFake {
    const attached = new Set<(event: { data: unknown }) => void>()
    const channel: HostChannelFakeObject = {
        postMessage: vi.fn<(message: string) => void>(),
        addEventListener: vi.fn((type: string, listener: (event: { data: unknown }) => void) => {
            if (type === 'message') {
                attached.add(listener)
            }
        }),
        removeEventListener: vi.fn((type: string, listener: (event: { data: unknown }) => void) => {
            if (type === 'message') {
                attached.delete(listener)
            }
        }),
    }
    const posted = (): Array<Record<string, unknown>> =>
        channel.postMessage.mock.calls.map((call) => JSON.parse(call[0]) as Record<string, unknown>)
    return {
        channel,
        posted,
        postedTo: (bridge, method) => posted().filter((message) => message.bridge === bridge && message.method === method),
        deliver(json) {
            for (const listener of [...attached]) {
                listener({ data: json })
            }
        },
        listeners: () => attached.size,
    }
}
