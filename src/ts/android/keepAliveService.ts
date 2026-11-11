/**
 * Page side of the Android keep-alive foreground service. The service keeps the
 * app process alive while work is in flight (a reply, speech, an image, a
 * translation, an import or export); this module mirrors the in-flight
 * registry onto the host bridge and delivers the notification's Stop action to
 * the running work. Everywhere the bridge is absent (web, desktop, iOS, an old
 * host) it does nothing.
 */
import { language } from 'src/lang'
import { fillLang } from '../../lang/fill'
import { lowPowerMarked } from '../chatShell/lowPower'
import { activeStreamChars, subscribeStreamChanges, type StreamChange } from '../process/activeStreams'
import {
    inFlightChatTarget, inFlightKinds, inFlightSince, subscribeInFlight, takeRunOutcome,
    type InFlightKind, type InFlightTarget, type RunOutcome,
} from '../process/inFlightWork'
import { isAndroidTransport } from '../storage/tauriByteTransport'
import { keepAliveHost } from './hostBridge'
import type * as NotificationAvatarModule from './notificationAvatar'

/** The host object `KeepAliveBridge` exposes to the page. */
export interface KeepAliveHost {
    start(title: string, stopLabel: string): unknown
    update(title: string, stopLabel: string): unknown
    stop(): unknown
    /** Stops the service after `ms` natively, so a throttled hidden page cannot delay it; `start`, `update` and `stop` cancel it. */
    stopAfter(ms: number): unknown
    requestNotificationPermissionOnce(): unknown
}

/**
 * Contract v2 of the same host object: each method carries its notice as the JSON string of a
 * `KeepAlivePayload`. A host without them is an old one and gets the v1 calls.
 */
export interface KeepAliveHostV2 {
    /** Starts the service with a notice. */
    startState(json: string): unknown
    /** Replaces the notice; like `update` it cancels a pending delayed stop. */
    updateState(json: string): unknown
    /** Shows the closing notice (stopped, failed or finishing) and stops the service after `ms`, in one call. */
    stopAfterWithOutcome(ms: number, json: string): unknown
}

/** The deep link: the same host object also hands the page the chat a notification tap named. */
export interface KeepAliveHostLaunch {
    /** Asks for the pending target; the host answers through `window.__risuTaniumLaunchTarget`, with null when there is none. */
    requestOpenTarget(): unknown
}

/** Whatever subset of the keep-alive host methods the host provides. */
export type KeepAliveHostObject = Partial<KeepAliveHost & KeepAliveHostV2 & KeepAliveHostLaunch>

declare global {
    interface Window {
        /** Android host: the keep-alive service bridge. Absent elsewhere. */
        __risuTaniumKeepAlive?: KeepAliveHostObject
        /** Called by the host when the notification's Stop action is tapped. */
        __risuTaniumKeepAliveStop?: () => void
        /** Called by the host when the system ended the service on its time limit. */
        __risuTaniumKeepAliveTimeout?: () => void
    }
}

/**
 * How long the service outlives the last work. Short gaps between units of
 * work (auto mode, a reply followed by speech) keep one service and one
 * notification instead of flapping. The linger also gives a hidden reply's
 * save time to land before the process loses its foreground status; the
 * notice reads "Finishing up…" without a Stop action meanwhile.
 */
export const KEEP_ALIVE_LINGER_MS = 10000

export interface KeepAliveLabels {
    generating: string
    working: string
    /** Shown while the service lingers after the last work, with no Stop action. */
    finishing: string
    /** Shown while only a hidden reply's save is pending, with no Stop action. */
    savePending: string
    stop: string
}

/** The titles of the contract-v2 states that v1 has no title for. */
export interface KeepAliveStateLabels {
    speaking: string
    image: string
    translating: string
    /** Native shows it from the Stop tap until the stoppable work has ended. */
    stopping: string
    failed: string
    failedHint: string
    stopped: string
    /** The live count line, with a `{count}` placeholder; without it no count is shown. */
    characters?: string
}

/** The states a v2 notice can show; the last three are the closing notice that comes with the delayed stop. */
export type KeepAliveState =
    | 'generating' | 'speaking' | 'image' | 'translating' | 'working' | 'savePending'
    | 'finishing' | 'stopped' | 'failed'

/** The character a reply notice names; `key` is the speaker's id. */
export interface KeepAliveIdentity {
    key: string
    name: string
}

/**
 * Who speaks in a chat and which images belong to it, as the page resolves them. `image` is the speaker's
 * avatar location, `ownerImage` the owner's (a group's own image in a group chat); either is empty when
 * there is none.
 */
export interface KeepAliveSubject {
    identity: KeepAliveIdentity
    image: string
    ownerImage: string
}

/**
 * The thumbnail memo as the consumer sees it. `of` answers a thumbnail (string), none (null: an animated,
 * ineligible or failed image, or images hidden) or not known yet (undefined); only undefined makes the
 * consumer `warm` the image, which never rejects.
 */
export interface KeepAliveAvatarSource {
    of(image: string): string | null | undefined
    warm(image: string): Promise<void>
}

/**
 * The contract-v2 notice, sent to the host as JSON. Titles come from the language table, so native
 * holds no strings of its own. `publicTitle` is the state title and never names a character. Native
 * shows `stoppingTitle` from the Stop tap on and, when the closing notice arrives while it is
 * stopping, `stoppedTitle`.
 */
export interface KeepAlivePayload {
    v: 2
    state: KeepAliveState
    title: string
    text: string
    /** Epoch milliseconds the chronometer counts from; null shows none. */
    startedAt: number | null
    /** Empty for every state without a Stop action. */
    stopLabel: string
    publicTitle: string
    stoppingTitle: string
    stoppedTitle: string
    identity: KeepAliveIdentity | null
    avatar: string | null
    /** The chat a tap opens. The owner's id: for a group chat, the group. */
    target: InFlightTarget | null
}

/** What the v2 path needs besides the v1 dependencies. Without it a host's v2 methods go unused. */
export interface KeepAliveV2Deps {
    labels: () => KeepAliveStateLabels
    /** Read at every all-ended sync, before the service-running check; consuming clears it. */
    takeRunOutcome: () => RunOutcome | null
    /** The target of the latest live chat. */
    chatTarget: () => InFlightTarget | null
    /** When the earliest live token of a kind began. */
    since: (kind: InFlightKind) => number | null
    /** The identity to show for a chat, when there is no `subjectOf` to give it with its images. */
    identityOf?: (target: InFlightTarget) => KeepAliveIdentity | null
    /** The speaker and images of a chat, read at every sync that sees the chat live. */
    subjectOf?: (target: InFlightTarget) => KeepAliveSubject | null
    /** Without it no avatar is sent. */
    avatar?: KeepAliveAvatarSource
    /** The characters the reply of that chat has written so far; null when not known. */
    characters?: (target: InFlightTarget) => number | null
    /** True while low-power mode is on: the count then stops updating. */
    lowPower?: () => boolean
    /** Hears of every stream change (a count note). Without it only the once-a-second tick refreshes the count. */
    subscribeChanges?: (listener: (change: StreamChange) => void) => () => void
    /** True while the page is hidden: only then does a stream change push the count, since the tick may not run. */
    pageHidden?: () => boolean
}

export interface KeepAliveDeps {
    host: KeepAliveHostObject
    kinds: () => InFlightKind[]
    subscribe: (callback: () => void) => () => void
    labels: () => KeepAliveLabels
    /** Aborts the reply being generated and the speech being played. */
    stopWork: () => void
    lingerMs?: number
    v2?: KeepAliveV2Deps
}

export interface KeepAliveConsumer {
    /** Detaches from the registry and the window hooks; does not stop the service, and a native stop already requested stays pending. */
    dispose(): void
}

interface Notice {
    title: string
    stopLabel: string
}

/** A chat the run showed: its target, the identity resolved for it and the images of its speaker and owner. */
interface ChatRecord {
    target: InFlightTarget
    identity: KeepAliveIdentity | null
    image: string
    ownerImage: string
}

/** A notice and the chat record it names; its avatar is attached when it is sent. */
interface NoticeDraft {
    payload: KeepAlivePayload
    record: ChatRecord | null
}

/** How often the live count is refreshed at most. */
const COUNT_INTERVAL_MS = 1000

/** A missing method is skipped and a failing call is logged: neither may break the work that triggered it. */
function callHost<K extends keyof (KeepAliveHost & KeepAliveHostV2)>(
    host: KeepAliveHostObject,
    method: K,
    ...args: Parameters<(KeepAliveHost & KeepAliveHostV2)[K]>
): void {
    try {
        const call = host[method] as ((...callArgs: Parameters<(KeepAliveHost & KeepAliveHostV2)[K]>) => unknown) | undefined
        // Called as a method: the host bridge object needs its receiver.
        call?.apply(host, args)
    } catch (error) {
        console.error('keep-alive host call failed', error)
    }
}

function sameTarget(left: InFlightTarget, right: InFlightTarget): boolean {
    return left.chaId === right.chaId && left.chatId === right.chatId
}

/** The state the highest-priority kind in flight gives: chat, then speech, image, translation, other work. */
function stateOf(kinds: InFlightKind[]): KeepAliveState {
    if (onlySavePending(kinds)) {
        return 'savePending'
    }
    if (kinds.includes('chat')) {
        return 'generating'
    }
    if (kinds.includes('tts')) {
        return 'speaking'
    }
    if (kinds.includes('image')) {
        return 'image'
    }
    if (kinds.includes('translate')) {
        return 'translating'
    }
    return 'working'
}

/** True when a pending hidden-reply save is the only work in flight. */
function onlySavePending(kinds: InFlightKind[]): boolean {
    return kinds.length > 0 && kinds.every((kind) => kind === 'save')
}

function noticeFor(kinds: InFlightKind[], labels: KeepAliveLabels): Notice {
    if (onlySavePending(kinds)) {
        return { title: labels.savePending, stopLabel: '' }
    }
    const chat = kinds.includes('chat')
    const stoppable = chat || kinds.includes('tts')
    return {
        title: chat ? labels.generating : labels.working,
        stopLabel: stoppable ? labels.stop : '',
    }
}

export function createKeepAliveConsumer(deps: KeepAliveDeps): KeepAliveConsumer {
    const { host } = deps
    const lingerMs = deps.lingerMs ?? KEEP_ALIVE_LINGER_MS
    // Contract v2 needs the host's three methods and the page's v2 dependencies; otherwise the v1 calls run.
    const v2 = deps.v2 !== undefined
        && typeof host.startState === 'function'
        && typeof host.updateState === 'function'
        && typeof host.stopAfterWithOutcome === 'function'
        ? deps.v2
        : null
    let running = false
    let shown: Notice | null = null
    // The v2 notice last sent to the host, as the JSON that went out.
    let shownJson: string | null = null
    let lingerTimer: ReturnType<typeof setTimeout> | null = null
    // The latest chat the registry showed live, and when the first sync without a chat saw it gone.
    let lastChat: ChatRecord | null = null
    let lastChatEndedAt: number | null = null
    // Speech with no chat live shows the chat that just ended, if it ended within the linger. That is
    // decided once, when the speech begins, and kept until it ends: a long synthesis that runs past
    // the window must not lose the name, avatar and deep link when its clip begins. `null` means
    // undecided; a record of `null` means the speech has no chat to show.
    let speechSubject: { record: ChatRecord | null } | null = null
    // The identity keys whose avatar already went to the native service. Native keeps the bitmaps for the
    // life of the service only, so the set is cleared whenever a service is started and never at the end
    // of the work: the thumbnail memo, not this set, is what the reply notice reads afterwards.
    const avatarSentFor = new Set<string>()
    // Refreshes the live count while the state is generating.
    let countTimer: ReturnType<typeof setInterval> | null = null
    // When the latest start or update went to the host; the stream-note pushes are spaced from it (MC-1499).
    let lastNoticeAt = 0
    const numberFormat = new Intl.NumberFormat()

    const cancelLinger = (): void => {
        if (lingerTimer !== null) {
            clearTimeout(lingerTimer)
            lingerTimer = null
        }
    }

    const stopCounting = (): void => {
        if (countTimer !== null) {
            clearInterval(countTimer)
            countTimer = null
        }
    }

    const stopService = (): void => {
        cancelLinger()
        stopCounting()
        running = false
        shown = null
        shownJson = null
        callHost(host, 'stop')
    }

    /** The ended chat while it is still inside the linger, else null. */
    const endedChatInWindow = (): ChatRecord | null =>
        lastChat !== null && lastChatEndedAt !== null && Date.now() - lastChatEndedAt <= lingerMs ? lastChat : null

    /** Resolves a chat's speaker and images; without a `subjectOf` only the identity is known. */
    const recordOf = (target: InFlightTarget, v2Deps: KeepAliveV2Deps): ChatRecord => {
        const subject = v2Deps.subjectOf?.(target) ?? null
        if (subject !== null) {
            return { target, identity: subject.identity, image: subject.image, ownerImage: subject.ownerImage }
        }
        return { target, identity: v2Deps.identityOf?.(target) ?? null, image: '', ownerImage: '' }
    }

    /** Looks an image up in the background; `onDone` runs when it is finished, whatever the result. */
    const warmImage = (image: string, onDone: (() => void) | null): void => {
        const source = deps.v2?.avatar
        if (source === undefined) {
            return
        }
        try {
            void source.warm(image).then(
                () => onDone?.(),
                (error: unknown) => console.error('keep-alive avatar warm failed', error),
            )
        } catch (error) {
            console.error('keep-alive avatar warm failed', error)
        }
    }

    /** Records which chat the run shows and when it went away. */
    const trackChat = (kinds: InFlightKind[], v2Deps: KeepAliveV2Deps): void => {
        if (kinds.includes('chat')) {
            const target = v2Deps.chatTarget()
            if (target !== null) {
                lastChat = recordOf(target, v2Deps)
                // A group run's owner image is not the speaker's: warm it too, for the reply notice that follows.
                if (v2Deps.avatar !== undefined && lastChat.ownerImage !== '' && lastChat.ownerImage !== lastChat.image
                    && v2Deps.avatar.of(lastChat.ownerImage) === undefined) {
                    warmImage(lastChat.ownerImage, null)
                }
            }
            lastChatEndedAt = null
        } else if (lastChat !== null && lastChatEndedAt === null) {
            lastChatEndedAt = Date.now()
        }
        if (kinds.includes('chat') || !kinds.includes('tts')) {
            speechSubject = null
        }
    }

    const recordFor = (target: InFlightTarget, v2Deps: KeepAliveV2Deps): ChatRecord =>
        lastChat !== null && sameTarget(lastChat.target, target) ? lastChat : recordOf(target, v2Deps)

    /**
     * The avatar to send with a notice that names `record`, or null: none for a speaker without one, none
     * once it went out, and none while it is not known. A thumbnail that is not known yet is looked up in
     * the background; when that finishes, one update carries it if the notice still names the same speaker.
     */
    const avatarFor = (record: ChatRecord | null, v2Deps: KeepAliveV2Deps): string | null => {
        const source = v2Deps.avatar
        if (source === undefined || record === null || record.identity === null || record.image === '') {
            return null
        }
        const key = record.identity.key
        if (avatarSentFor.has(key)) {
            return null
        }
        const known = source.of(record.image)
        if (typeof known === 'string') {
            avatarSentFor.add(key)
            return known
        }
        if (known === undefined) {
            warmImage(record.image, () => onAvatarWarmed(key))
        }
        return null
    }

    /** The speaker the notice for the work in flight names right now, without deciding anything new. */
    const liveSpeakerKey = (kinds: InFlightKind[]): string | null => {
        const state = stateOf(kinds)
        const record = state === 'generating' ? lastChat : state === 'speaking' ? speechSubject?.record ?? null : null
        return record?.identity?.key ?? null
    }

    const onAvatarWarmed = (key: string): void => {
        if (v2 === null || !running) {
            return
        }
        const kinds = deps.kinds()
        if (kinds.length === 0 || liveSpeakerKey(kinds) !== key) {
            return
        }
        pushLive(kinds, v2)
    }

    const startedAtOf = (state: KeepAliveState, v2Deps: KeepAliveV2Deps): number | null => {
        switch (state) {
            case 'generating':
                return v2Deps.since('chat')
            case 'speaking':
                return v2Deps.since('tts')
            case 'image':
                return v2Deps.since('image')
            case 'translating':
                return v2Deps.since('translate')
            case 'working': {
                const starts = (['request', 'embed', 'busy'] as const)
                    .map((kind) => v2Deps.since(kind))
                    .filter((start): start is number => start !== null)
                return starts.length > 0 ? Math.min(...starts) : null
            }
            default:
                return null
        }
    }

    /** The count line of a generating reply, or empty when there is no count or no label for it. */
    const countText = (record: ChatRecord | null, v2Deps: KeepAliveV2Deps): string => {
        // Low power shows no count on any path: a count sent by a non-tick sync would stay frozen on screen.
        if (v2Deps.lowPower?.() === true) {
            return ''
        }
        const label = v2Deps.labels().characters
        const count = record === null || label === undefined ? null : v2Deps.characters?.(record.target) ?? null
        return label === undefined || count === null ? '' : fillLang(label, { count: numberFormat.format(count) })
    }

    /** The notice for work in flight. Only a reply state names a chat; image, translation and other work never do. */
    const livePayload = (kinds: InFlightKind[], v2Deps: KeepAliveV2Deps): NoticeDraft => {
        const state = stateOf(kinds)
        const labels = deps.labels()
        const stateLabels = v2Deps.labels()
        let record: ChatRecord | null = null
        if (state === 'generating') {
            record = lastChat
        } else if (state === 'speaking') {
            speechSubject ??= { record: endedChatInWindow() }
            record = speechSubject.record
        }
        const title = {
            generating: labels.generating,
            speaking: stateLabels.speaking,
            image: stateLabels.image,
            translating: stateLabels.translating,
            working: labels.working,
            savePending: labels.savePending,
            finishing: labels.finishing,
            stopped: stateLabels.stopped,
            failed: stateLabels.failed,
        }[state]
        const payload: KeepAlivePayload = {
            v: 2,
            state,
            title,
            text: state === 'generating' ? countText(record, v2Deps) : '',
            startedAt: startedAtOf(state, v2Deps),
            stopLabel: state === 'generating' || state === 'speaking' ? labels.stop : '',
            publicTitle: title,
            stoppingTitle: stateLabels.stopping,
            stoppedTitle: stateLabels.stopped,
            identity: record?.identity ?? null,
            avatar: null,
            target: record?.target ?? null,
        }
        return { payload, record }
    }

    /**
     * The closing notice sent with the delayed stop. A stop or a failure shows as such, with the ended
     * chat's target and identity; anything else is `finishing`, which carries the ended chat's target
     * and identity too (when it ended inside the linger), so that native, which shows Stopped for a
     * finishing notice that arrives after the user's Stop, names the same chat a chat-stopped Stopped
     * does.
     */
    const closingPayload = (outcome: RunOutcome | null, v2Deps: KeepAliveV2Deps, speechRecord: ChatRecord | null): NoticeDraft => {
        const labels = deps.labels()
        const stateLabels = v2Deps.labels()
        let state: KeepAliveState = 'finishing'
        let title = labels.finishing
        let text = ''
        // The record a speech showed up to this sync outranks the window: a speech that outlasts the
        // window must still close with the chat it named.
        let record: ChatRecord | null = speechRecord ?? endedChatInWindow()
        if (outcome !== null) {
            state = outcome.outcome
            title = outcome.outcome === 'stopped' ? stateLabels.stopped : stateLabels.failed
            text = outcome.outcome === 'failed' ? stateLabels.failedHint : ''
            record = outcome.target === null ? null : recordFor(outcome.target, v2Deps)
        }
        const payload: KeepAlivePayload = {
            v: 2,
            state,
            title,
            text,
            startedAt: null,
            stopLabel: '',
            publicTitle: title,
            stoppingTitle: stateLabels.stopping,
            stoppedTitle: stateLabels.stopped,
            identity: record?.identity ?? null,
            avatar: null,
            target: record?.target ?? null,
        }
        return { payload, record }
    }

    /**
     * Sends the notice for the work in flight: a start when no service runs, else an update when the
     * notice changed or an avatar is ready to go with it. The avatar is left out of the comparison, so
     * having sent it never makes the next notice look changed. With `resend` an unchanged notice goes out too:
     * native drops the count line when no start or update arrived for 5 s, so a count that stays the same
     * would otherwise vanish while chunks keep arriving (MC-1450).
     */
    const pushLive = (kinds: InFlightKind[], v2Deps: KeepAliveV2Deps, resend = false): void => {
        const { payload, record } = livePayload(kinds, v2Deps)
        const comparable = JSON.stringify(payload)
        if (!running) {
            // A new native service starts with no bitmaps, so every avatar has to be sent again.
            avatarSentFor.clear()
        }
        const avatar = avatarFor(record, v2Deps)
        const json = avatar === null ? comparable : JSON.stringify({ ...payload, avatar })
        if (!running) {
            running = true
            shownJson = comparable
            callHost(host, 'requestNotificationPermissionOnce')
            lastNoticeAt = Date.now()
            callHost(host, 'startState', json)
        } else if (comparable !== shownJson || avatar !== null || resend) {
            shownJson = comparable
            lastNoticeAt = Date.now()
            callHost(host, 'updateState', json)
        }
        // The count is refreshed once a second, and only while a reply is being generated.
        if (v2Deps.characters !== undefined && payload.state === 'generating') {
            countTimer ??= setInterval(onCountTick, COUNT_INTERVAL_MS)
        } else {
            stopCounting()
        }
    }

    const onCountTick = (): void => {
        if (v2 === null || !running || v2.lowPower?.() === true) {
            return
        }
        const kinds = deps.kinds()
        if (stateOf(kinds) !== 'generating') {
            stopCounting()
            return
        }
        sync()
    }

    const sync = (resend = false): void => {
        const kinds = deps.kinds()
        // Taken before trackChat clears the latch, for the closing notice of a speech that just ended.
        const speechRecord = speechSubject?.record ?? null
        if (v2 !== null) {
            trackChat(kinds, v2)
        }
        if (kinds.length === 0) {
            // Before the running check: an outcome that ends while the service is not running (after the
            // system's time limit) is discarded here, so a later unrelated save run cannot show it.
            const outcome = deps.v2?.takeRunOutcome() ?? null
            stopCounting()
            if (!running) {
                return
            }
            if (v2 !== null) {
                // One call carries the closing notice and the delayed stop: an update sent after
                // stopAfter would be cancelled by it, and one sent before would be a second rebuild.
                running = false
                shown = null
                shownJson = null
                const closing = closingPayload(outcome, v2, speechRecord)
                const avatar = avatarFor(closing.record, v2)
                callHost(host, 'stopAfterWithOutcome', lingerMs, JSON.stringify(avatar === null ? closing.payload : { ...closing.payload, avatar }))
                return
            }
            const finishing: Notice = { title: deps.labels().finishing, stopLabel: '' }
            if (typeof host.stopAfter === 'function') {
                // The host owns the linger: a hidden page's timers are throttled, the host's are not.
                // The service counts as stopped here; a later begin calls start, which cancels the pending stop.
                // The notice changes first: the host's update cancels a pending stop, so stopAfter must come after it.
                running = false
                shown = null
                callHost(host, 'update', finishing.title, finishing.stopLabel)
                callHost(host, 'stopAfter', lingerMs)
            } else if (lingerTimer === null) {
                // The service stays running, so `shown` must track the notice for the next begin to replace it.
                shown = finishing
                callHost(host, 'update', finishing.title, finishing.stopLabel)
                lingerTimer = setTimeout(stopService, lingerMs)
            }
            return
        }
        // A begin during the linger cancels it before anything else is decided.
        cancelLinger()
        if (v2 !== null) {
            pushLive(kinds, v2, resend)
            return
        }
        const notice = noticeFor(kinds, deps.labels())
        if (!running) {
            running = true
            shown = notice
            callHost(host, 'requestNotificationPermissionOnce')
            callHost(host, 'start', notice.title, notice.stopLabel)
            return
        }
        if (shown === null || shown.title !== notice.title || shown.stopLabel !== notice.stopLabel) {
            shown = notice
            callHost(host, 'update', notice.title, notice.stopLabel)
        }
    }

    const unsubscribe = deps.subscribe(() => sync())

    /**
     * A received chunk while the page is hidden. The tick is a page timer a frozen page does not run, but chunk
     * events still do, so the count is pushed from them, spaced by `Date.now()` and never by a timer. A visible
     * page keeps the tick as its only source (MC-1499).
     */
    const onStreamChange = (change: StreamChange): void => {
        if (change === 'speaker') {
            // A turn's speaker renames the card at once: no throttle and no visibility gate, because the
            // note runs on a frozen page where the tick does not (MC-1502). The avatar follows the name.
            if (v2 !== null && running && deps.kinds().includes('chat')) {
                sync()
            }
            return
        }
        if (change !== 'count' || v2 === null || !running || v2.pageHidden?.() !== true || v2.lowPower?.() === true) {
            return
        }
        if (stateOf(deps.kinds()) !== 'generating' || Date.now() - lastNoticeAt < COUNT_INTERVAL_MS) {
            return
        }
        sync(true)
    }
    const unsubscribeChanges = v2?.subscribeChanges?.(onStreamChange)

    const stopHook = (): void => {
        const kinds = deps.kinds()
        if (kinds.includes('chat') || kinds.includes('tts')) {
            deps.stopWork()
            return
        }
        if (onlySavePending(kinds)) {
            // No Stop action is shown for a pending save, so a tap here is stale; stopping would drop the save's protection.
            return
        }
        stopService()
    }
    const timeoutHook = (): void => {
        // The host already ended the service; the next unit of work starts it again.
        cancelLinger()
        stopCounting()
        running = false
        shown = null
        shownJson = null
    }
    window.__risuTaniumKeepAliveStop = stopHook
    window.__risuTaniumKeepAliveTimeout = timeoutHook

    // A recreated page finds a service its predecessor started: it is stopped
    // when nothing is in flight, and kept (re-announced) when work is.
    if (deps.kinds().length === 0) {
        callHost(host, 'stop')
    } else {
        sync()
    }

    return {
        dispose() {
            unsubscribe()
            unsubscribeChanges?.()
            cancelLinger()
            stopCounting()
            if (window.__risuTaniumKeepAliveStop === stopHook) {
                delete window.__risuTaniumKeepAliveStop
            }
            if (window.__risuTaniumKeepAliveTimeout === timeoutHook) {
                delete window.__risuTaniumKeepAliveTimeout
            }
        },
    }
}

let hostReadyListener: ((host: KeepAliveHostObject) => void) | null = null

/**
 * Registers the one function `startKeepAliveService` calls with the host it found, before it starts the
 * consumer. The launch module registers itself when it loads: this module stays free of the character and
 * chat code that module needs, so it can be loaded by a test that mocks only part of the app. Null removes it.
 */
export function onKeepAliveHost(listener: ((host: KeepAliveHostObject) => void) | null): void {
    hostReadyListener = listener
}

// The speaker and avatar code needs the character database and the thumbnail store, so it is loaded when the
// service starts rather than imported here: this module stays loadable by a test that mocks only part of the
// app. Until it has loaded, notices name nobody and carry no avatar; the next sync picks them up.
let subjectCode: typeof NotificationAvatarModule | null = null

/** A hidden page may freeze its timers; the count then reads the received length, which leads the display (MC-1499). */
function pageHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/**
 * Starts the consumer in the Android app. A no-op where the host bridge is
 * absent. The work-stopping modules load only when Stop is delivered.
 */
export function startKeepAliveService(): KeepAliveConsumer | null {
    if (!isAndroidTransport()) {
        return null
    }
    const host = keepAliveHost()
    if (!host) {
        return null
    }
    void import('./notificationAvatar').then((loaded) => {
        subjectCode = loaded
    }).catch((error) => {
        console.error('keep-alive identity code failed to load', error)
    })
    // Before the boot reaches its launch order, which waits for the host's answer only once this ran.
    try {
        hostReadyListener?.(host)
    } catch (error) {
        console.error(error)
    }
    return createKeepAliveConsumer({
        host,
        kinds: inFlightKinds,
        subscribe: subscribeInFlight,
        labels: () => ({
            generating: language.keepAliveGenerating,
            working: language.keepAliveWorking,
            finishing: language.keepAliveFinishing,
            savePending: language.keepAliveSavePending,
            stop: language.keepAliveStop,
        }),
        v2: {
            labels: () => ({
                speaking: language.keepAliveSpeaking,
                image: language.keepAliveImage,
                translating: language.keepAliveTranslating,
                stopping: language.keepAliveStopping,
                failed: language.keepAliveFailed,
                failedHint: language.keepAliveFailedHint,
                stopped: language.keepAliveStopped,
                characters: language.keepAliveCharacters,
            }),
            takeRunOutcome,
            chatTarget: inFlightChatTarget,
            since: inFlightSince,
            subjectOf: (target) => subjectCode?.notificationSubjectOf(target) ?? null,
            avatar: {
                of: (image) => (subjectCode === null ? null : subjectCode.notificationAvatarOf(image)),
                warm: async (image) => {
                    await subjectCode?.warmNotificationAvatar(image)
                },
            },
            characters: (target) => activeStreamChars(target.chaId, pageHidden()),
            lowPower: () => lowPowerMarked(),
            subscribeChanges: subscribeStreamChanges,
            pageHidden,
        },
        stopWork: () => {
            void Promise.all([
                import('../process/composerActions.svelte'),
                import('../process/tts'),
            ]).then(([composer, tts]) => {
                composer.abortChat()
                tts.stopTTS()
            }).catch((error) => {
                console.error('keep-alive stop failed', error)
            })
        },
    })
}
