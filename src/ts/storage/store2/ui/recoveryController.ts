import type { Store2Backend, Store2Read } from '../backend/types'
import type { Store2RecoveryRequest } from '../bootDispatch'
import { classifyCommitRead } from '../commitKey'
import type { FenceExitResult } from '../fence'
import type { ForeignClearHook, Staging } from '../owner'
import {
    CANDIDATE_PAGE_SIZE, candidatePage, listRecoveryCandidates, screenOffers, type ExitResult,
} from '../recovery'
import { installPick, pickCandidate, type PickReady } from '../recoveryPick'
import { seedStore2Profile, type SeedOutcome } from '../bootSeed'
import {
    convertLegacyProfile, convertLegacyWithout, type ConvertResult, type ConvertStrictHooks, type ConvertWithoutHooks,
} from '../legacy/convert'
import {
    blockedBeforeWrite, blockedScreen, confirmConvertScreen, confirmConvertWithoutScreen, confirmFromBackupScreen, confirmIncompleteScreen,
    foreignMarkerScreen, pickedManifestKey, recoveryBlockedBeforeWriteScreen,
    recoveryChangedScreen, recoveryCheckingScreen, recoveryFreshScreen, recoveryInstalledScreen, recoveryInstallScreen,
    recoveryNoticeScreen, recoveryOffersScreen, recoveryPickScreen, recoveryUnconfirmedScreen, recoveryUnexpectedScreen,
    recoveryTooNewScreen, recoveryWaitScreen, recoveryWorkingScreen,
    type BootQuestion, type BootScreenModel,
} from './bootText'
import { createPresenceProbes } from './presenceProbes'

/**
 * The recovery screen's controller: it lists the saved versions, and runs a pick, a conversion or a start-empty seed over
 * the session's commit key, one exit at a time. Every screen is a model shown through the port.
 *
 * Invariants:
 *  - Nothing is written before the person agrees. The pick confirmation precedes the first `pickCandidate`; the
 *    conversion and seed confirmations precede their exits; the conversion's own questions precede its fence.
 *  - The compare basis of every exit is `basis`: the session's commit-key read at the start, replaced only by the
 *    `markerRead` of a marker this screen wrote. No re-read ever replaces it, so a change made anywhere else can only
 *    make a later exit conflict, and a conflict ends the screen.
 *  - The screen ends, and issues no backend call afterwards, on `conflict`, any `abandoned`, a `contended` fence, an
 *    `unknown` outcome, a conversion or seed that stopped after its marker, and any rejection of a wrapped call. It
 *    holds no timer, retry or listener that could reach the backend after that. An end is a screen whose only button
 *    reloads, and `runRecovery` never settles.
 *  - A conversion or seed that stopped before its marker returns to the saved versions: it wrote nothing of its own.
 *  - Only one exit runs at a time: each exit is started from one sequential flow after a single-answer question.
 */

/** The screens the controller shows. The production port is the boot screen; the tests record. */
export interface RecoveryPort {
    /** A question: resolves once, with the key of the button pressed. */
    ask(model: BootScreenModel): Promise<string>
    /** A screen with no button that answers it. */
    show(model: BootScreenModel): void
    /** A screen that stays up and whose only button reloads. */
    terminal(model: BootScreenModel): void
    reload(): void
}

/** The exits and reads the controller calls, so a test can answer or reject any of them. */
export interface RecoveryCalls {
    listCandidates: typeof listRecoveryCandidates
    pick: typeof pickCandidate
    install: typeof installPick
    convert: typeof convertLegacyProfile
    convertWithout: typeof convertLegacyWithout
    seed: typeof seedStore2Profile
}

const DEFAULT_CALLS: RecoveryCalls = {
    listCandidates: listRecoveryCandidates,
    pick: pickCandidate,
    install: installPick,
    convert: convertLegacyProfile,
    convertWithout: convertLegacyWithout,
    seed: seedStore2Profile,
}

/** Unwinds a flow to `runRecovery` once a final screen is up. Never escapes this module. */
class Stop extends Error {
    constructor() {
        super('The recovery screen stopped.')
        this.name = 'Stop'
    }
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function unreachable(value: never): never {
    throw new TypeError(`Unhandled recovery result: ${JSON.stringify(value)}`)
}

type EntryResult = Exclude<ConvertResult, { status: 'all-failed' }> | SeedOutcome
type Next = 'back' | 'retry'

async function drive(request: Store2RecoveryRequest, port: RecoveryPort, calls: RecoveryCalls, backend: Store2Backend, initial: Store2Read): Promise<never> {
    const { session, env, lists, keyEnv } = request
    const owner = session.ownerId
    const probes = createPresenceProbes(env.store)
    let basis: Store2Read = initial
    // True once this screen's own marker stands. The pick confirmation is asked while it is false.
    let markerWritten = false
    // True once a pick returned `ready`: starting empty is then no longer offered.
    let candidatePassed = false

    function stopWith(model: BootScreenModel): Stop {
        port.terminal(model)
        return new Stop()
    }

    /** Every call that reads or writes the backend runs here: a rejection ends the screen. */
    async function safeCall<T>(call: () => Promise<T>): Promise<T> {
        try {
            return await call()
        } catch (error) {
            if (error instanceof Stop) {
                throw error
            }
            throw stopWith(recoveryUnexpectedScreen(messageOf(error)))
        }
    }

    async function question<T>(asked: BootQuestion<T>): Promise<T> {
        const key = await port.ask(asked.model)
        if (!Object.prototype.hasOwnProperty.call(asked.answers, key)) {
            throw new Error(`The recovery screen answered with an unknown button: ${key}`)
        }
        return asked.answers[key]
    }

    function showChecking(): void {
        void port.ask(recoveryCheckingScreen()).then(() => probes.skip())
    }

    /** The question for another owner's standing marker, asked inside the exit before it writes anything. */
    function foreignQuestion(resume: () => void): ForeignClearHook {
        return async (marker: Staging) => {
            const clear = await question(foreignMarkerScreen(marker)) === 'clear'
            if (clear) {
                resume()
            }
            return clear
        }
    }

    function installedStop(): Stop {
        port.show(recoveryInstalledScreen())
        port.reload()
        return new Stop()
    }

    async function onFence(fence: Exclude<FenceExitResult, { status: 'written' }>): Promise<Next> {
        switch (fence.status) {
            case 'not-durable':
                return question(recoveryNoticeScreen({ kind: 'fence-not-durable' }))
            case 'not-offered':
                if (fence.reason === 'fence-too-new') {
                    throw stopWith(recoveryTooNewScreen())
                }
                return question(recoveryNoticeScreen({ kind: 'not-offered', reason: fence.reason, detail: fence.detail }))
            case 'contended':
                throw stopWith(recoveryChangedScreen())
            case 'failed':
                return question(recoveryNoticeScreen({ kind: 'fence-failed' }))
            default:
                return unreachable(fence)
        }
    }

    async function onExit(exit: Exclude<ExitResult, { status: 'marked' }>): Promise<Next> {
        switch (exit.status) {
            case 'refused':
                throw stopWith(recoveryTooNewScreen())
            case 'foreign-marker':
                throw stopWith(recoveryWaitScreen())
            case 'fence':
                return onFence(exit.fence)
            case 'conflict':
            case 'abandoned':
                throw stopWith(recoveryChangedScreen())
            case 'failed':
                return question(recoveryNoticeScreen({ kind: 'exit-failed' }))
            case 'unknown':
                throw stopWith(recoveryUnconfirmedScreen())
            default:
                return unreachable(exit)
        }
    }

    async function installFlow(ready: PickReady): Promise<void> {
        candidatePassed = true
        markerWritten = true
        basis = ready.marked.markerRead
        if (!(await question(recoveryInstallScreen(ready.counts, probes.cause())))) {
            return
        }
        for (;;) {
            port.show(recoveryWorkingScreen())
            const result = await safeCall(() => calls.install(ready, { confirm: true }))
            switch (result.status) {
                case 'installed':
                    throw installedStop()
                case 'abandoned':
                    throw stopWith(recoveryChangedScreen())
                case 'invalid':
                    await question(recoveryNoticeScreen({ kind: 'problem', problem: result.problem, markerStands: true }))
                    return
                case 'upload-failed':
                case 'failed':
                    if (await question(recoveryNoticeScreen({ kind: 'install-failed', detail: result.cause.message })) === 'retry') {
                        continue
                    }
                    return
                case 'unknown':
                    throw stopWith(recoveryUnconfirmedScreen())
                default:
                    return unreachable(result)
            }
        }
    }

    async function pickFlow(manifestKey: string): Promise<void> {
        if (!markerWritten && !(await question(recoveryPickScreen(manifestKey)))) {
            return
        }
        for (;;) {
            probes.reset()
            showChecking()
            const result = await safeCall(() => calls.pick(backend, basis, manifestKey, {
                owner,
                env: keyEnv,
                foreignClear: foreignQuestion(showChecking),
                ...probes.probes,
            }))
            switch (result.status) {
                case 'ready':
                    return installFlow(result)
                case 'invalid':
                    if (result.marked !== null) {
                        markerWritten = true
                        basis = result.marked.markerRead
                    }
                    await question(recoveryNoticeScreen({ kind: 'problem', problem: result.problem, markerStands: markerWritten }))
                    return
                case 'exit':
                    if (await onExit(result.exit) === 'back') {
                        return
                    }
                    continue
                default:
                    return unreachable(result)
            }
        }
    }

    /** The outcome of a conversion or a seed over an `exit` entry. */
    async function onEntryResult(result: EntryResult): Promise<Next> {
        switch (result.status) {
            case 'installed':
                throw installedStop()
            case 'declined':
                return 'back'
            case 'reclassify':
                throw stopWith(recoveryChangedScreen())
            case 'blocked':
                if (blockedBeforeWrite(result.reason)) {
                    return question(recoveryBlockedBeforeWriteScreen(result))
                }
                throw stopWith(blockedScreen({ reason: result.reason, detail: result.detail, mayHaveWritten: true }))
            case 'exit':
                return onExit(result.exit)
            default:
                return unreachable(result)
        }
    }

    async function convertFlow(): Promise<void> {
        if (!(await question(confirmConvertScreen()))) {
            return
        }
        for (;;) {
            port.show(recoveryWorkingScreen())
            const convertRequest = {
                store: env.store,
                listBackupTimes: env.listBackupTimes,
                readColdStorageItem: env.readColdStorageItem,
                backend,
                entry: { kind: 'exit' as const, commitRead: basis, foreignClear: foreignQuestion(() => port.show(recoveryWorkingScreen())) },
                owner,
                lists,
                env: keyEnv,
                decoders: request.decoders,
                resolve: request.resolve,
            }
            const hooks: ConvertStrictHooks = {
                confirmIncomplete: (items) => question(confirmIncompleteScreen(items)),
                confirmFromBackup: async (backup) => await question(confirmFromBackupScreen(backup)) === 'convert',
            }
            let result = await safeCall(() => calls.convert(convertRequest, hooks))
            if (result.status === 'all-failed') {
                const withoutHooks: ConvertWithoutHooks = {
                    confirmIncomplete: hooks.confirmIncomplete,
                    confirmSkipped: async (skipped) => await question(confirmConvertWithoutScreen(skipped)) === 'convert',
                }
                result = await safeCall(() => calls.convertWithout(convertRequest, withoutHooks))
            }
            if (await onEntryResult(result) === 'back') {
                return
            }
        }
    }

    async function freshFlow(): Promise<void> {
        if (!(await question(recoveryFreshScreen()))) {
            return
        }
        for (;;) {
            port.show(recoveryWorkingScreen())
            const entry = { kind: 'exit' as const, commitRead: basis, foreignClear: foreignQuestion(() => port.show(recoveryWorkingScreen())) }
            const outcome = await safeCall(() => calls.seed(backend, entry, { owner, lists, env: keyEnv, oldData: { store: env.store, listBackupTimes: env.listBackupTimes } }))
            if (await onEntryResult(outcome) === 'back') {
                return
            }
        }
    }

    let candidates: string[] = []
    let listFailed: string | null = null
    const listing = await safeCall(() => calls.listCandidates(backend, classifyCommitRead(basis)))
    if (listing.status === 'listed') {
        candidates = listing.candidates
    } else {
        listFailed = listing.cause.message
    }
    let upstreamMainFile: boolean | null
    try {
        upstreamMainFile = await env.upstreamMainFile()
    } catch {
        upstreamMainFile = null
    }
    let shown = CANDIDATE_PAGE_SIZE

    for (;;) {
        const page = candidatePage(candidates, 0, shown)
        const offers = screenOffers({ tooNew: false, candidateCount: candidates.length, upstreamMainFile, candidatePassed })
        const key = await port.ask(recoveryOffersScreen({ shown: page.keys, hasOlder: page.nextOffset !== null, listFailed, offers }))
        const picked = pickedManifestKey(key)
        if (picked !== null) {
            if (!page.keys.includes(picked)) {
                throw new Error(`The recovery screen answered with an unlisted version: ${picked}`)
            }
            await pickFlow(picked)
            continue
        }
        switch (key) {
            case 'recoveryShowOlder':
                shown += CANDIDATE_PAGE_SIZE
                break
            case 'recoveryConvertOffer':
                await convertFlow()
                break
            case 'recoveryFreshOffer':
                await freshFlow()
                break
            default:
                throw new Error(`The recovery screen answered with an unknown button: ${key}`)
        }
    }
}

/**
 * Runs the recovery screen. It never settles: the page stays on the screen it ends on, or reloads after an install.
 */
export async function runRecovery(request: Store2RecoveryRequest, port: RecoveryPort, calls: RecoveryCalls = DEFAULT_CALLS): Promise<void> {
    try {
        const backend = request.session.backend
        const initial = request.session.commitRead
        if (backend === null || initial === null) {
            throw new Error('The session holds no storage to recover.')
        }
        await drive(request, port, calls, backend, initial)
    } catch (error) {
        if (!(error instanceof Stop)) {
            port.terminal(recoveryUnexpectedScreen(messageOf(error)))
        }
    }
    await new Promise<never>(() => { })
}
