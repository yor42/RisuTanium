import { alertClear } from '../alert'
import { language } from 'src/lang'
import { askPassword } from '../passwordPrompt'
import { yieldToEventLoop } from '../storage/saveYield'
import { RtbCouldNotReadError, rangeSourceFrom, type RangeSource } from './rtb/rangeSource'
import type { RtbVerdict } from './rtb/rtbVerify'
import { classifyPrefix, SNIFF_BYTES } from './rtb/sniff'
import type { AskReason, DecryptingRangeSource } from './rtb/sealed/decryptingSource'
import { openSealedRtb } from './rtb/sealed/decryptingSource'
import type { PickedRtb, RtbPrepareCause, RtbPrepareEnd } from './rtbRestorePlan'

/**
 * The sealed (password-encrypted) front of a `.rtb` restore (CHORE-128 S10). `verifyAndConfirm` calls
 * `openRestoreSource` where it used to wrap the picked file, so everything after it (verification, the copy, the install and
 * the side restore, the page's and the start-up restore's alike) reads one `RangeSource` and never learns whether the file
 * was sealed. The password is asked only here, before any asset or store write, and never stored.
 */

type RtbEnded = Extract<RtbPrepareEnd, { kind: 'ended' }>

/** The file, plain or decrypting, or the end of the restore. `sealed` is set only when `source` decrypts. */
export type OpenedSource =
    | { kind: 'ended', end: RtbEnded }
    | { kind: 'open', source: RangeSource, sealed: DecryptingRangeSource | null }

/** The calls the opening makes outside the file; the verification deps of `verifyAndConfirm` carry them. */
export interface SealedOpenDeps {
    password(reason: AskReason): Promise<string | null>
    error(text: string): void
    wait(text: string): void
}

const ended = (outcome: 'canceled' | 'nothing-replaced', cause: RtbPrepareCause | null): RtbEnded => ({ kind: 'ended', outcome, cause })

/**
 * Wraps the picked file. A file with the sealed magic is opened here: its header is judged and the password asked before
 * anything else reads it. Every other prefix, a prefix that cannot be read and a broken sealed magic included, returns the
 * plain source so the classifier reports it exactly as before.
 */
export async function openRestoreSource(picked: PickedRtb, deps: SealedOpenDeps): Promise<OpenedSource> {
    const outer = rangeSourceFrom(picked.source)
    let prefix: Uint8Array
    try {
        prefix = await outer.read(0, Math.min(outer.size, SNIFF_BYTES))
    } catch (error) {
        if (error instanceof RtbCouldNotReadError) {
            return { kind: 'open', source: outer, sealed: null }
        }
        throw error
    }
    if (classifyPrefix(prefix).kind !== 'sealed') {
        return { kind: 'open', source: outer, sealed: null }
    }
    const result = await openSealedRtb(outer, {
        askPassword: deps.password,
        beforeDerive: () => {
            deps.wait(language.rtbRestorePasswordChecking)
            return yieldToEventLoop()
        },
    })
    if (result.kind === 'open') {
        return { kind: 'open', source: result.source, sealed: result.source }
    }
    switch (result.class) {
        case 'damaged':
            console.error(result.detail)
            deps.error(language.rtbRestoreDamaged)
            return { kind: 'ended', end: ended('nothing-replaced', 'damaged') }
        case 'newer':
            console.warn(result.detail)
            deps.error(language.rtbRestoreNewer('the encryption format'))
            return { kind: 'ended', end: ended('nothing-replaced', 'newer') }
        case 'could-not-read':
            console.error(result.detail)
            deps.error(language.backupFileUnreadable)
            return { kind: 'ended', end: ended('nothing-replaced', 'could-not-read') }
        case 'unlock-failed':
            console.error(result.detail)
            deps.error(language.rtbRestoreUnlockFailed)
            return { kind: 'ended', end: ended('nothing-replaced', 'could-not-read') }
        case 'canceled':
            return { kind: 'ended', end: ended('canceled', 'declined') }
    }
}

/**
 * The verdict the restore acts on. A damaged chunk met during the verification reaches `verifyRtb` as a plain could-not-read
 * message; the source remembers the authentication failure, which marks it damaged. Every plaintext that is itself a sealed
 * file (`encrypted`) is damaged too, because every sealed prefix is taken by `openRestoreSource`.
 */
export function sealedVerdict(opened: Extract<OpenedSource, { kind: 'open' }>, verdict: RtbVerdict): Exclude<RtbVerdict, { kind: 'encrypted' }> {
    if (verdict.kind === 'encrypted') {
        return { kind: 'damaged', reason: 'the plaintext is a sealed file' }
    }
    if (verdict.kind === 'could-not-read' && opened.sealed?.authFailure != null) {
        return { kind: 'damaged', reason: opened.sealed.authFailure.message }
    }
    return verdict
}

/** The real password question: replaces any wait text on screen, then asks in the masked prompt. */
export function askRtbPassword(reason: AskReason): Promise<string | null> {
    alertClear()
    const message = reason === 'first'
        ? language.rtbRestorePasswordPrompt
        : reason === 'wrong'
            ? language.rtbRestorePasswordWrong
            : language.rtbRestorePasswordUnusable
    return askPassword({ message })
}
