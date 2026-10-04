/**
 * The production binding of the idle reload: the listeners that tell when the
 * user is active, the signals read from the page, the rate-limit history and
 * the record's storage. Nothing is armed until the characters this page
 * restored (the one on screen and its group members left out) add up to the
 * restored-bytes threshold, so a session that never restores much pays for no
 * listener and no timer.
 */

import { get } from 'svelte/store'
import { BaseDirectory, exists, readFile, remove } from '@tauri-apps/plugin-fs'
import { relaunch } from '@tauri-apps/plugin-process'
import { markAppInitiatedReload } from '../../reloadGuard'
import { isTauri } from '../../platform'
import {
    DBState,
    OpenRealmStore,
    PlaygroundStore,
    CustomGUISettingMenuStore,
    QuickSettings,
    ShowRealmFrameStore,
    alertStore,
    bookmarkListOpen,
    customSideBarConfigDialogStore,
    easyPanelStore,
    hypaV3ModalOpen,
    hypaV3ProgressStore,
    irisStore,
    loadoutModalStore,
    openPersonaList,
    openPresetList,
    pluginAlertModalStore,
    popUpEditorStore,
    popupStore,
    selectedCharID,
    settingsOpen,
    loadedStore,
} from '../../stores.svelte'
import { isSaveClean, getSaveMarkCount } from '../../globalApi.svelte'
import { coversPage } from '../../alertEscape'
import { promptWaiting } from '../../alertPrompts'
import { isWorkInProgress } from '../chatOrigin'
import { isTTSPlaying } from '../ttsPlayback'
import { composerDraftsVersion } from '../composerDrafts.svelte'
import { draftContentOrphanGate } from '../../draftContentOrphanGate'
import { hasDraftOfKind } from '../../localDrafts'
import { getStartupCleanup } from '../../storage/startupCleanupState'
import { readArchiveMemo, readArchiveStrikes } from '../../storage/bootArchiveMemo'
import { hasEnabledV21Plugin } from '../../plugins/v21Plugins'
import { STORAGE_TAB_LOCK_NAME } from '../../storage/storageTabLocks'
import { writeFileAtomic } from '../../storage/tauriAtomicWrite'
import {
    anyChokePointInFlight,
    getLastPluginActivityAt,
    isBusy,
    isPluginDevModeStarted,
    isPluginPanelOpen,
} from './busyActions'
import { isBgmPlaying } from '../../observer.svelte'
import { hasRestoredBytes, restoredBytesOutside, setRestoredBytesListener } from './restoredBytes'
import {
    MIN_RELOAD_INTERVAL_MS,
    POLL_MS,
    idleReloadMayStart,
    RESTORED_BYTES_THRESHOLD,
    type IdleSignals,
} from './idleGate'
import {
    HANDOFF_FILE_PATH,
    buildSelectionPart,
    createFileMedium,
    createStorageMedium,
    draftsVersions,
    readReloadHistory,
    takeDraftsPart,
    writeReloadHistory,
    type HandoffFiles,
    type HandoffMedium,
} from './idleHandoff'
import { createIdleReloadController, type IdleCarry, type IdleReloadController, type IdleReloadDeps } from './idleReload'
import { canBootArchive, didBootPassCommit, wasBootedByIdleReload } from './idleReloadBootState'

/**
 * The desktop path stays off until a relaunch from the idle reload has been
 * observed to bring the app back with an off-screen draft intact. The path is
 * written and tested, and nothing reaches it while this is false.
 */
export const IDLE_RELOAD_DESKTOP_ENABLED = false

/** The listeners' events; each only stamps the time of the user's last activity. */
const ACTIVITY_EVENTS = [
    'pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'scroll',
    'compositionstart', 'compositionupdate', 'compositionend',
    'input', 'beforeinput', 'paste', 'drop', 'dragover', 'focus', 'blur', 'change',
] as const

/** Which path this page's idle reload would take, or `null` when it has none. */
export function idleReloadPlatform(): 'web' | 'desktop' | null {
    if (!isTauri) {
        return 'web'
    }
    return IDLE_RELOAD_DESKTOP_ENABLED ? 'desktop' : null
}

/** The medium of the desktop's record: a file of the app's own data folder. */
export function createTauriHandoffFiles(): HandoffFiles {
    return {
        read: async (path) => (await exists(path, { baseDir: BaseDirectory.AppData }))
            ? await readFile(path, { baseDir: BaseDirectory.AppData })
            : null,
        writeAtomic: (path, bytes) => writeFileAtomic(path, bytes),
        remove: (path) => remove(path, { baseDir: BaseDirectory.AppData }),
    }
}

/** The storage the boot reads the record from, or `null` where there is no idle reload path. */
export function createHandoffMedium(): HandoffMedium | null {
    const platform = idleReloadPlatform()
    if (platform === 'web') {
        return createStorageMedium(sessionStorage)
    }
    return platform === 'desktop' ? createFileMedium(createTauriHandoffFiles()) : null
}

/** The selected character and, for a group, its members: the characters the pass must leave inline. */
export function currentKeepInline(): Set<string> {
    const keep = new Set<string>()
    const selected = DBState.db?.characters?.[get(selectedCharID)]
    if (selected) {
        if (typeof selected.chaId === 'string' && selected.chaId !== '') {
            keep.add(selected.chaId)
        }
        if (selected.type === 'group' && Array.isArray(selected.characters)) {
            for (const member of selected.characters) {
                keep.add(member)
            }
        }
    }
    return keep
}

/** The characters whose restored bytes the reload would not release: the kept-inline set and the trashed, which the pass never archives. */
function bytesExcluded(): Set<string> {
    const excluded = currentKeepInline()
    for (const cha of DBState.db?.characters ?? []) {
        if (cha?.trashTime && typeof cha.chaId === 'string') {
            excluded.add(cha.chaId)
        }
    }
    return excluded
}

function buildCarry(now: number): IdleCarry {
    const keep = currentKeepInline()
    const selected = DBState.db.characters[get(selectedCharID)]
    const chaId = selected && typeof selected.chaId === 'string' && selected.chaId !== '' ? selected.chaId : null
    return {
        selection: buildSelectionPart({ chaId, members: [...keep].filter((id) => id !== chaId), now }),
        drafts: takeDraftsPart(now),
    }
}

function anyMediaPlaying(): boolean {
    if (isBgmPlaying()) {
        return true
    }
    for (const element of document.querySelectorAll<HTMLMediaElement>('audio, video')) {
        if (!element.paused && !element.ended) {
            return true
        }
    }
    return false
}

function anyModalOpen(): boolean {
    return get(settingsOpen)
        || get(hypaV3ModalOpen)
        || get(hypaV3ProgressStore).open
        || get(bookmarkListOpen)
        || get(openPresetList)
        || get(openPersonaList)
        || get(CustomGUISettingMenuStore)
        || get(PlaygroundStore) !== 0
        || pluginAlertModalStore.open
        || easyPanelStore.open
        || popUpEditorStore.open
        || loadoutModalStore.open
        || irisStore.open
        || customSideBarConfigDialogStore.open
        || popupStore.children !== null
        || QuickSettings.open
}

/** Sets up the idle reload for this page; call once, after the database is installed and `loadedStore` is set. */
export function startIdleReload(): void {
    const platform = idleReloadPlatform()
    if (platform === null || !idleReloadMayStart({
        platformEnabled: true,
        canArchive: canBootArchive(),
        bootedByIdleReload: wasBootedByIdleReload(),
        bootPassCommitted: didBootPassCommit(),
    })) {
        return
    }
    const historyStorage: Storage = platform === 'desktop' ? localStorage : sessionStorage

    let lastActivityAt = Date.now()
    let otherTabOpen: boolean | null = platform === 'desktop' ? false : null
    let armed = false
    const stamp = () => { lastActivityAt = Date.now() }

    async function refreshOtherTabs(): Promise<void> {
        if (platform === 'desktop') {
            return
        }
        try {
            const snapshot = await navigator.locks.query()
            otherTabOpen = (snapshot.held ?? []).filter((lock) => lock.name === STORAGE_TAB_LOCK_NAME).length > 1
        } catch (error) {
            otherTabOpen = null
        }
    }

    function collectSignals(): IdleSignals {
        const db = DBState.db
        const now = Date.now()
        const history = readReloadHistory(historyStorage)
        return {
            platformEnabled: true,
            archivingOn: db.archiveCharacters !== false,
            canArchive: canBootArchive(),
            v21PluginEnabled: hasEnabledV21Plugin(db.plugins),
            breaker: readArchiveStrikes(),
            tooLarge: readArchiveMemo().tooLarge,
            formatOk: typeof db.formatversion === 'number' && db.formatversion >= 5,
            restoredBytesOutside: restoredBytesOutside(bytesExcluded()),
            otherTabOpen,
            saveClean: isSaveClean(),
            busyAction: isBusy(),
            chokePointInFlight: anyChokePointInFlight(),
            workInProgress: isWorkInProgress(),
            startupCleanupPending: getStartupCleanup() !== null,
            pluginDevMode: isPluginDevModeStarted(),
            idleMs: now - Math.max(lastActivityAt, getLastPluginActivityAt()),
            windowFocused: document.hasFocus(),
            pageVisible: document.visibilityState === 'visible',
            ttsPlaying: isTTSPlaying(),
            mediaPlaying: anyMediaPlaying(),
            pluginPanelOpen: isPluginPanelOpen(),
            realmOpen: get(OpenRealmStore) || get(ShowRealmFrameStore) !== '',
            alertOpen: coversPage(get(alertStore).type),
            promptOpen: promptWaiting(),
            modalOpen: anyModalOpen(),
            composerDraftOnScreen: hasDraftOfKind('composer'),
            editorOpen: hasDraftOfKind('message'),
            rateLimited: typeof history === 'number' && now >= history && now - history < MIN_RELOAD_INTERVAL_MS,
            historyUnreadable: history === 'unreadable',
        }
    }

    const common = {
        now: () => Date.now(),
        collectSignals,
        epoch: () => [lastActivityAt, getLastPluginActivityAt(), getSaveMarkCount(), ...draftsVersions()],
        buildCarry,
        recordReload: (now: number) => writeReloadHistory(historyStorage, now),
        markAppInitiatedReload,
    }
    const deps: IdleReloadDeps = platform === 'web'
        ? {
            ...common,
            platform,
            medium: createStorageMedium(sessionStorage),
            reloadPage: () => {
                history.replaceState(null, '', location.pathname)
                location.reload()
            },
        }
        : { ...common, platform, medium: createFileMedium(createTauriHandoffFiles()), relaunch: () => relaunch() }
    const controller: IdleReloadController = createIdleReloadController(deps)

    function arm(): void {
        armed = true
        lastActivityAt = Date.now()
        for (const type of ACTIVITY_EVENTS) {
            window.addEventListener(type, stamp, { capture: true, passive: true })
        }
        document.addEventListener('visibilitychange', stamp, { capture: true, passive: true })
        void refreshOtherTabs()
        setInterval(() => {
            void refreshOtherTabs()
            controller.look()
        }, POLL_MS)
    }

    function armIfRestoredEnough(): void {
        if (armed || !get(loadedStore) || !hasRestoredBytes()) {
            return
        }
        if (restoredBytesOutside(bytesExcluded()) >= RESTORED_BYTES_THRESHOLD) {
            arm()
        }
    }

    setRestoredBytesListener(armIfRestoredEnough)
    selectedCharID.subscribe(armIfRestoredEnough)
    armIfRestoredEnough()
}
