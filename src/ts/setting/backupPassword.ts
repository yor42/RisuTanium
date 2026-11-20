/**
 * Backup Password
 *
 * The rules of the password a person types in the "Make a backup" chooser. Component-free, and it imports only the
 * engine's password function, so the cipher code stays out of the settings chunk.
 */

import { passwordBytes } from '../drive/rtb/sealed/password';

/** Why Start refuses: the text the sealed format cannot use, or two entries that differ. */
export type BackupPasswordProblem = 'unusable' | 'mismatch';

/**
 * The reason the two entries cannot start a sealed export, or `null`. The first entry must pass the engine's own
 * password rule, so Start never hands the engine text it refuses. The match compares the NFC forms, because the
 * engine keys on NFC: two spellings of one text are the same password. No length or strength rule.
 */
export function backupPasswordProblem(first: string, second: string): BackupPasswordProblem | null {
    const bytes = passwordBytes(first);
    if (typeof bytes === 'string') return 'unusable';
    bytes.fill(0);
    return first.normalize('NFC') === second.normalize('NFC') ? null : 'mismatch';
}

/**
 * True when the browser has no `crypto.subtle`, which is the case on plain HTTP. The sealed export then runs its
 * key derivation and cipher in script, which is slower. It mirrors the engine's own cipher choice.
 */
export function encryptionIsSlow(env: { crypto?: { subtle?: unknown } } = globalThis): boolean {
    return env.crypto?.subtle === undefined;
}
