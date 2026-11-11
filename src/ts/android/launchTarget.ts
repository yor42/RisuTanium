/**
 * The notification deep link and the launch order. A tap on a reply notice names the chat that replied;
 * the host holds that target until the page asks for it (`requestOpenTarget`) and answers through
 * `window.__risuTaniumLaunchTarget`. The target comes from outside the app, so it is validated here again
 * and opens only an existing, non-trashed, non-hidden character through the ordinary pick, and only a chat
 * that exists exactly once in it. Anything else is treated as no tap.
 *
 * Launch order (`startLaunchNavigation`, the boot's last step): the target, when it resolves, is opened as
 * the user's own pick and the last-character restore is told the launch is claimed, so a cold tap shows
 * the target and not the remembered character. The recorder is armed before the pick, so the target is the
 * character remembered next. A refused or unknown target is no tap and the restore runs as usual. A tap
 * that arrives later (a warm tap, or an answer after the wait) opens the same way, over whatever is open,
 * and counts as user navigation: a pending restore pick ends superseded.
 */
import { changeCharOrAlert } from '../characterPick'
import { openChatOf } from '../chatShell/chatOpen'
import { restoreInProgress } from '../drive/restoreInProgress'
import { resolveRestoreIndex } from '../lastCharacterMemory'
import { startLastCharacterRestore } from '../lastCharacterRestore'
import { readAt } from '../process/chatOrigin'
import { busyKinds } from '../process/memory/busyActions'
import { getDatabase } from '../storage/database.svelte'
import { onKeepAliveHost, type KeepAliveHostObject } from './keepAliveService'

declare global {
    interface Window {
        /** Called by the host with the target a notification tap named, or null when there is none. */
        __risuTaniumLaunchTarget?: (target: unknown) => void
        /** Called by the host when a tap arrives while the app is running; the page then asks again. */
        __risuTaniumLaunchTargetReady?: () => void
    }
}

/** How long the launch waits for the host's answer before it restores as usual. */
const ANSWER_WAIT_MS = 1000

/** The longest id the host accepts; the same limit is applied again here. */
const MAX_ID_LENGTH = 200

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

interface LaunchTarget {
    chaId: string
    chatId: string
}

interface ResolvedTarget extends LaunchTarget {
    index: number
}

/** none: no host, nothing to wait for. waiting: asked, no answer yet. held: answered, not yet taken. done: the launch order ran. */
type Phase = 'none' | 'waiting' | 'held' | 'done'

let phase: Phase = 'none'
let heldTarget: LaunchTarget | null = null
let activeHost: KeepAliveHostObject | null = null
let wakeLaunch: (() => void) | null = null

function idOf(value: unknown): string | null {
    if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID_LENGTH || CONTROL_CHARACTERS.test(value)) {
        return null
    }
    return value
}

/** The target in the host's answer, or null for no answer, no target or one that does not fit. */
function targetOf(raw: unknown): LaunchTarget | null {
    if (typeof raw !== 'object' || raw === null) {
        return null
    }
    const chaId = idOf((raw as { chaId?: unknown }).chaId)
    const chatId = idOf((raw as { chatId?: unknown }).chatId)
    return chaId !== null && chatId !== null ? { chaId, chatId } : null
}

/**
 * The character slot for `target`, or null when it must not be opened: the character is missing, trashed or
 * hidden, or a backup restore or an import is running. A refusal is a console warning only.
 */
function resolveLaunchTarget(target: LaunchTarget): ResolvedTarget | null {
    if (restoreInProgress() || busyKinds().some((kind) => kind === 'import' || kind === 'backupLoad')) {
        console.warn('A notification tap was dropped while a restore or an import runs')
        return null
    }
    const index = resolveRestoreIndex(getDatabase().characters, target.chaId)
    if (index === null) {
        console.warn('A notification tap named a character that cannot be opened')
        return null
    }
    return { ...target, index }
}

/**
 * Opens the target as an ordinary, non-quiet pick: an archived character is restored first, and a failed
 * restore shows the usual alert and leaves the app where it was. Only a selected character opens its chat,
 * and `readAt` runs nothing for a chat that is gone or held twice, or a character id held twice, so the
 * character then stays on its current chat. Nothing else is closed or left open by this.
 */
async function openResolved(target: ResolvedTarget): Promise<void> {
    try {
        const outcome = await changeCharOrAlert('notification.openChat', target.index)
        if (outcome !== 'selected') {
            return
        }
        readAt({ chaId: target.chaId, chatId: target.chatId }, (context) => {
            openChatOf(context.owner, context.chat)
        })
    } catch (error) {
        console.error(error)
    }
}

function openLater(target: LaunchTarget): void {
    try {
        const resolved = resolveLaunchTarget(target)
        if (resolved) {
            void openResolved(resolved)
        }
    } catch (error) {
        console.error(error)
    }
}

/** The host's answer. It never throws: the host calls it through the page's script evaluation. */
function onAnswer(raw: unknown): void {
    try {
        const target = targetOf(raw)
        if (phase === 'done') {
            if (target) {
                openLater(target)
            }
            return
        }
        if (phase === 'none') {
            return
        }
        // A later "no target" never replaces a target that is already held.
        if (target) {
            heldTarget = target
        }
        phase = 'held'
        wakeLaunch?.()
    } catch (error) {
        console.error(error)
    }
}

function askHost(): boolean {
    try {
        // Called as a method: the host bridge object needs its receiver.
        activeHost?.requestOpenTarget?.()
        return true
    } catch (error) {
        console.error(error)
        return false
    }
}

function onReady(): void {
    if (phase !== 'none') {
        askHost()
    }
}

/**
 * Installs the answer hooks and asks the host for the pending target, when the host can give one. Without
 * `requestOpenTarget` (web, desktop, an old host) nothing is installed and the launch never waits. A host
 * that refuses the request is the same as no host. Never throws.
 */
export function installLaunchTarget(host: KeepAliveHostObject): void {
    if (typeof host.requestOpenTarget !== 'function') {
        return
    }
    activeHost = host
    heldTarget = null
    window.__risuTaniumLaunchTarget = onAnswer
    window.__risuTaniumLaunchTargetReady = onReady
    phase = 'waiting'
    if (!askHost()) {
        phase = 'none'
    }
}

// `startKeepAliveService` hands the host over before the boot's launch order is reached.
onKeepAliveHost(installLaunchTarget)

function waitForAnswer(): Promise<void> {
    return new Promise<void>((resolve) => {
        const timer = setTimeout(finish, ANSWER_WAIT_MS)
        function finish(): void {
            clearTimeout(timer)
            wakeLaunch = null
            resolve()
        }
        wakeLaunch = finish
    })
}

/**
 * One synchronous block: take the target, resolve it, tell the restore whether the launch is claimed (this
 * arms the recorder before the pick, so an unarchived target is recorded), then open the target. The claim
 * must come from the resolution and not from a selection read after the pick: an archived target's pick
 * waits with the selection still at Home, which would let the restore pick a second character.
 */
function runLaunchStretch(): void {
    const target = heldTarget
    heldTarget = null
    phase = 'done'
    let resolved: ResolvedTarget | null = null
    try {
        resolved = target ? resolveLaunchTarget(target) : null
    } catch (error) {
        console.error(error)
    }
    try {
        void startLastCharacterRestore(undefined, { launchClaimed: resolved !== null })
    } catch (error) {
        console.error(error)
    }
    if (resolved) {
        void openResolved(resolved)
    }
}

/**
 * The boot's last step. With no host, or an answer already in, the launch order runs before this returns;
 * while the host's answer is still pending it waits for it at most `ANSWER_WAIT_MS`, and an answer after that
 * opens as a warm tap. Not awaited by the boot; never throws and never rejects.
 */
export async function startLaunchNavigation(): Promise<void> {
    try {
        if (phase === 'waiting') {
            await waitForAnswer()
        }
    } catch (error) {
        console.error(error)
    }
    try {
        runLaunchStretch()
    } catch (error) {
        console.error(error)
    }
}

/** Puts the module back to its initial state, for tests. */
export function resetLaunchTargetForTests(): void {
    phase = 'none'
    heldTarget = null
    activeHost = null
    wakeLaunch = null
    if (typeof window !== 'undefined') {
        delete window.__risuTaniumLaunchTarget
        delete window.__risuTaniumLaunchTargetReady
    }
}
