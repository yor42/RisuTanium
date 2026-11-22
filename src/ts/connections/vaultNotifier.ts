import type { FlaggedConnection, VaultHost } from './keyVaultStore.svelte'

const KEEP_PLAIN_FLAG = 'risutanium.vault.keepPlainNoticed'
const REENTRY_SET_KEY = 'risutanium.vault.reentryShown'

export interface NoticeStorage {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

/**
 * The notice cadence: the keep-plain notice once per device until a wrap succeeds; the needs-re-entry
 * notice when the set of flagged connections differs from the last one shown. Storage failures
 * never throw.
 */
export function createVaultNotifier(
    storage: NoticeStorage,
    show: (message: string) => void,
    texts: { keepPlain(): string, needsReentry(names: string): string },
): VaultHost['notify'] {
    const safe = <T>(fn: () => T): T | undefined => {
        try {
            return fn()
        } catch {
            return undefined
        }
    }
    return {
        keepPlain() {
            if (safe(() => storage.getItem(KEEP_PLAIN_FLAG)) === '1') {
                return
            }
            safe(() => storage.setItem(KEEP_PLAIN_FLAG, '1'))
            show(texts.keepPlain())
        },
        wrapped() {
            safe(() => storage.removeItem(KEEP_PLAIN_FLAG))
        },
        reentry(flagged: FlaggedConnection[]) {
            const shown = flagged.map((item) => item.id).sort().join('\n')
            const last = safe(() => storage.getItem(REENTRY_SET_KEY)) ?? ''
            if (shown === last) {
                return
            }
            safe(() => storage.setItem(REENTRY_SET_KEY, shown))
            if (flagged.length > 0) {
                show(texts.needsReentry(flagged.map((item) => item.name).join(', ')))
            }
        },
    }
}
