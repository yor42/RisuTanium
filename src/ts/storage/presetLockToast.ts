import { language } from '../../lang'
import { toastHost, type PlainToastInit } from '../toast/toastHost.svelte'
import type { LockHost } from './presetLocks'
import { keptGroupsText } from './presetLockLabels'

/** Says once, after a preset switch, which locked groups kept their current value. Silent when no group is locked. */
export function postKeptGroupsToast(host: LockHost, post: (init: PlainToastInit) => unknown = (init) => toastHost.post(init)): void {
    const kept = keptGroupsText(host)
    if (kept !== '') {
        post({ kind: 'info', text: language.presetLockKept(kept) })
    }
}
