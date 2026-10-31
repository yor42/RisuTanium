import { get } from "svelte/store"
import { language } from "../../lang"
import { alertToast, doingAlert } from "../alert"
import { alertStore } from "../stores.svelte"

/**
 * Tells the user that a plugin wrote an id-less character over an existing one.
 * The written copy always gets a fresh id, so references that named the
 * replaced character do not carry over to it. Memory only; nothing is saved.
 *
 * Writes of one plugin are coalesced into one notice per burst. An id this
 * path minted for a plugin is not announced again when the plugin replaces
 * that copy, so a plugin that keeps editing one character is announced once.
 */

const QUIET_MS = 1000
const HARD_MS = 5000
const MINTED_CAP = 256
const SHOWN_NAMES = 3

type Burst = {
    names: string[]
    quiet: ReturnType<typeof setTimeout> | null
    hard: ReturnType<typeof setTimeout> | null
}

type NoticeReplaced = { chaId?: string } | null | undefined
type NoticeWritten = { name?: string, chaId?: string }

const minted = new Map<string, Set<string>>()
const bursts = new Map<string, Burst>()

function clearTimers(burst: Burst) {
    if (burst.quiet !== null) {
        clearTimeout(burst.quiet)
        burst.quiet = null
    }
    if (burst.hard !== null) {
        clearTimeout(burst.hard)
        burst.hard = null
    }
}

function flush(plugin: string) {
    const burst = bursts.get(plugin)
    if (!burst) {
        return
    }
    clearTimers(burst)
    // A toast replaces whatever the alert slot holds, so an open prompt, notice or wait stays untouched
    // and the flush tries again later.
    if (doingAlert() || get(alertStore).type === 'wait') {
        burst.quiet = setTimeout(() => flush(plugin), QUIET_MS)
        return
    }
    bursts.delete(plugin)
    const shown = burst.names.slice(0, SHOWN_NAMES).map((name) => `"${name}"`).join(', ')
    alertToast(language.pluginIdlessCopyNotice(plugin, shown, burst.names.length - SHOWN_NAMES > 0 ? burst.names.length - SHOWN_NAMES : 0))
}

/**
 * Called after a plugin setter assigned `written` into the character list.
 * `wasIdless` is taken before the fresh id was filled in.
 */
export function noteIdlessCopyWrite(pluginName: string, replaced: NoticeReplaced, written: NoticeWritten, wasIdless: boolean) {
    if (!wasIdless) {
        return
    }
    const plugin = pluginName ?? ''
    let own = minted.get(plugin)
    if (!own) {
        own = new Set()
        minted.set(plugin, own)
    }
    const replacedId = replaced?.chaId
    const announce = typeof replacedId === 'string' && replacedId !== '' && !own.has(replacedId)
    if (typeof written.chaId === 'string' && written.chaId !== '') {
        own.add(written.chaId)
        if (own.size > MINTED_CAP) {
            own.delete(own.values().next().value as string)
        }
    }
    if (!announce) {
        return
    }
    const name = typeof written.name === 'string' && written.name !== '' ? written.name : (written.chaId ?? '')
    let burst = bursts.get(plugin)
    if (!burst) {
        burst = { names: [], quiet: null, hard: null }
        bursts.set(plugin, burst)
    }
    if (!burst.names.includes(name)) {
        burst.names.push(name)
    }
    if (burst.quiet !== null) {
        clearTimeout(burst.quiet)
    }
    burst.quiet = setTimeout(() => flush(plugin), QUIET_MS)
    if (burst.hard === null) {
        burst.hard = setTimeout(() => flush(plugin), HARD_MS)
    }
}

export function resetIdlessCopyNoticeForTest() {
    for (const burst of bursts.values()) {
        clearTimers(burst)
    }
    bursts.clear()
    minted.clear()
}
