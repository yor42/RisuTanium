/**
 * The app side of the connection-key vault: installs the host into keyVaultStore, registers the
 * hide-time fallback and runs the boot steps. bootstrap.ts is the only importer.
 *
 * `vaultBoot()` installs the host as its first synchronous statement, so a later throw never leaves
 * an Android page uninstalled (which would write plain keys with no notice). `vaultReady` is replaced
 * synchronously and resolves when the boot's unwraps settle or after `VAULT_BOOT_BUDGET_MS`, so
 * `loadedStore` never waits longer than that. Nothing here throws into boot.
 */
import { language } from 'src/lang'
import { queueNotice } from '../alertPrompts'
import { hostChannelPresent } from '../android/hostBridge'
import { markBootWrite } from '../bootWindow'
import { requestSaveNow } from '../globalApi.svelte'
import { registerLeaveFlush } from '../process/saveOnHide'
import { secretRefName } from '../secretRefPattern'
import { getDatabase } from '../storage/database.svelte'
import { getPageStorageMode } from '../storage/pageStorageMode'
import { isAndroidTransport } from '../storage/tauriByteTransport'
import { storedConnections } from './connections'
import { createVaultNotifier } from './vaultNotifier'
import {
    beginVaultBoot, endVaultBoot, installVaultHost, noticeReentry, unwrapAllForBoot, vaultLeaveFlush,
    wrapPlainKeysAfterLoad, type VaultHost, type VaultPlatform,
} from './keyVaultStore.svelte'

/** The most `loadedStore` waits for the boot's unwraps. */
export const VAULT_BOOT_BUDGET_MS = 4000

function platformOfPage(): VaultPlatform {
    if (!isAndroidTransport()) {
        return 'none'
    }
    return hostChannelPresent() ? 'vault' : 'android-legacy'
}

function buildHost(): VaultHost {
    return {
        platform: platformOfPage(),
        findConnection: (id) => storedConnections(getDatabase()).find((conn) => conn.id === id),
        listConnections: () => storedConnections(getDatabase()),
        requestSaveNow,
        markBootWrite,
        isReadOnlyPage: () => getPageStorageMode().kind === 'read-only',
        notify: createVaultNotifier(localStorage, queueNotice, {
            keepPlain: () => language.vaultKeepPlainNotice,
            needsReentry: (names) => language.vaultNeedsReentryNotice(names),
        }),
        messages: { keyUnavailable: () => language.vaultKeyTemporarilyUnavailable },
    }
}

const isReferenceLine = (line: string): boolean => secretRefName(line) !== null

export interface VaultBootHandle {
    /** Boot step 3, run after `loadedStore`: wraps plain keys, then the re-entry notice. Never throws. */
    afterLoad(): Promise<void>
}

/**
 * Starts right after `checkNewFormat()`. Steps 1 (restore staging) and 2 (unwrap every envelope)
 * run under the budget; step 3 is `afterLoad`.
 */
export function vaultBoot(): VaultBootHandle {
    installVaultHost(buildHost())
    try {
        registerLeaveFlush(vaultLeaveFlush)
    } catch (error) {
        console.error(error)
    }
    beginVaultBoot(async () => {
        await unwrapAllForBoot()
    }, VAULT_BOOT_BUDGET_MS)
    return {
        async afterLoad() {
            try {
                await wrapPlainKeysAfterLoad(isReferenceLine)
            } catch (error) {
                console.error(error)
            } finally {
                endVaultBoot()
                noticeReentry()
            }
        },
    }
}
