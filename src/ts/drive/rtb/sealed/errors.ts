import { RtbCouldNotReadError } from '../rangeSource'

/**
 * A chunk of a sealed file failed authentication after the file was opened. It is a subclass of the
 * existing could-not-read error, so every catch site that halts on `RtbCouldNotReadError` keeps
 * halting; only a caller that asks for this type learns that the bytes were damaged rather than
 * unreadable.
 */
export class RtbSealedAuthError extends RtbCouldNotReadError {
    /** Index of the chunk that failed. */
    readonly chunk: number

    constructor(chunk: number, offset: number, length: number) {
        super(`sealed chunk ${chunk} failed authentication (read of ${length} bytes at ${offset})`, offset, length)
        this.name = 'RtbSealedAuthError'
        this.chunk = chunk
    }
}

/** The writer was given a password that cannot be used; nothing was derived or written. */
export class SealedPasswordError extends Error {
    readonly reason: 'empty' | 'ill-formed'

    constructor(reason: 'empty' | 'ill-formed') {
        super(`the password cannot be used: ${reason}`)
        this.name = 'SealedPasswordError'
        this.reason = reason
    }
}
