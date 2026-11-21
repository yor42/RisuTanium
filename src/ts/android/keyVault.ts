/**
 * Page side of the Android Keystore vault: wraps a connection key into an opaque envelope string and
 * unwraps it again, over the host message channel only. Nothing here calls the vault on its own; the
 * envelope is opaque to this code.
 *
 * Every call settles with a result, never a throw. A call has no deadline of its own: one watchdog
 * covers all calls in flight and counts silence, so a slow batch of replies that keeps arriving
 * never times out, while a host that goes quiet settles everything with `timeout` after
 * `VAULT_SILENCE_MS`.
 */
import { hostRequest } from './hostBridge'

/**
 * `invalidated`: the key behind the envelope is gone. `unreadable`: the envelope is damaged or not
 * ours. `unavailable`: no channel, or the channel was released mid-call. `timeout`: the watchdog
 * fired. `other`: anything else, including a code this page does not know.
 */
export type VaultErrorCode = 'invalidated' | 'unreadable' | 'unavailable' | 'timeout' | 'other'

export type VaultResult<T> = { ok: true; value: T } | { ok: false; code: VaultErrorCode }

/** How long all calls in flight may go without any vault reply before they settle with `timeout`. */
export const VAULT_SILENCE_MS = 10_000

const HOST_CODES: ReadonlySet<string> = new Set(['invalidated', 'unreadable', 'unavailable', 'other'])

interface Inflight {
    cancel(): void
    finish(result: VaultResult<never>): void
}

const inflight = new Set<Inflight>()
let timer: ReturnType<typeof setTimeout> | undefined
let fired = false

function fail(code: VaultErrorCode): VaultResult<never> {
    return { ok: false, code }
}

function arm(): void {
    if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
    }
    if (inflight.size > 0) {
        timer = setTimeout(onSilence, VAULT_SILENCE_MS)
    }
}

function onSilence(): void {
    timer = undefined
    fired = true
    for (const call of [...inflight]) {
        inflight.delete(call)
        call.cancel()
        call.finish(fail('timeout'))
    }
}

/** True from a watchdog fire until the next vault reply arrives. */
export function watchdogFired(): boolean {
    return fired
}

function readReply<T>(reply: Record<string, unknown>, accept: (value: unknown) => value is T): VaultResult<T> {
    if (reply.vault === 'ok') {
        return accept(reply.value) ? { ok: true, value: reply.value } : fail('other')
    }
    if (reply.vault === 'error' && typeof reply.code === 'string' && HOST_CODES.has(reply.code)) {
        return fail(reply.code as VaultErrorCode)
    }
    return fail('other')
}

function call<T>(method: string, args: unknown[], accept: (value: unknown) => value is T): Promise<VaultResult<T>> {
    return new Promise((resolve) => {
        let request: ReturnType<typeof hostRequest>
        try {
            request = hostRequest('keyVault', method, args)
        } catch {
            resolve(fail('other'))
            return
        }
        if (!request) {
            resolve(fail('unavailable'))
            return
        }
        const entry: Inflight = { cancel: request.cancel, finish: resolve as (result: VaultResult<never>) => void }
        inflight.add(entry)
        if (timer === undefined) {
            arm()
        }
        request.reply.then(
            (reply) => {
                if (!inflight.delete(entry)) {
                    return
                }
                if (reply === null) {
                    arm()
                    resolve(fail('unavailable'))
                    return
                }
                fired = false
                arm()
                resolve(readReply(reply, accept))
            },
            () => {
                if (inflight.delete(entry)) {
                    arm()
                    resolve(fail('other'))
                }
            },
        )
    })
}

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isString = (value: unknown): value is string => typeof value === 'string'

/** Whether the host's Keystore provider loads and lists. False is a real answer; a failed call is an error result. */
export function vaultAvailable(): Promise<VaultResult<boolean>> {
    return call('available', [], isBoolean)
}

/** The envelope for a plaintext key. */
export function wrapKey(plain: string): Promise<VaultResult<string>> {
    return call('wrap', [plain], isString)
}

/** The plaintext an envelope holds. */
export function unwrapKey(envelope: string): Promise<VaultResult<string>> {
    return call('unwrap', [envelope], isString)
}
