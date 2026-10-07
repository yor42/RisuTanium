import {
    BaseDirectory,
    exists,
    mkdir
} from "@tauri-apps/plugin-fs"
import { changeFullscreen, checkNullish, sleep, sleepForever } from "./util"
import { markAppInitiatedReload } from "./reloadGuard"
import localforage from "localforage"
import { v4 as uuidv4 } from 'uuid';
import { get } from "svelte/store";
import { setDatabase, defaultSdDataFunc, getDatabase, type Database } from "./storage/database.svelte";
import { repairBotPresetsId } from "./storage/botPresetRepair";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { checkRisuUpdate } from "./update";
import { MobileGUI, botMakerMode, selectedCharID, loadedStore, DBState, LoadingStatusState, alertStore } from "./stores.svelte";
import { loadPlugins } from "./plugins/plugins.svelte";
import { alertError, alertMd, alertStaleAccountNotice, alertNormal, alertNormalWait, alertSelect, waitAlert, alertConfirm, alertInput, alertToast } from "./alert";
import { characterURLImport, handlePendingRealmLink } from "./characterCards";
import { desktopLaunchImport } from "./desktopLaunch";
import { defaultJailbreak, defaultMainPrompt, oldJailbreak, oldMainPrompt } from "./storage/defaultPrompts";
import { decodeRisuSave, encodeRisuSaveLegacy } from "./storage/risuSave";
import { getPageBlockOwner } from "./storage/pageBlockOwner";
import {
    finishBlockBoot,
    loadBlockProfile,
    olderMainFileCopyExists,
    seedEmptyBlockProfile,
    type BootBackupSource,
    type BootLoadContext,
    type BootLoadUi,
    type BootNotice,
} from "./storage/bootBlockLoad";
import { getPageStorageMode, isAssetSweepHeld, setPageStorageMode } from "./storage/pageStorageMode";
import { fingerprintMainFile } from "./storage/mainFileFingerprint";
import { dropRisuSaveCache } from "./storage/risuSaveCacheDrop";
import { updateAnimationSpeed } from "./gui/animation";
import { updateColorScheme, updateTextThemeAndCSS } from "./gui/colorscheme";
import { language } from "src/lang";
import { startObserveDom } from "./observer.svelte";
import { updateGuisize } from "./gui/guisize";
import { selectCharacterByChaId, updateLorebooks } from "./characters";
import { applyHandoff, readHandoff, type HandoffMedium, type ReadHandoff } from "./process/memory/idleHandoff";
import { createHandoffMedium, startIdleReload } from "./process/memory/idleReloadHost";
import { markBootedByIdleReload, noteBootArchiveSession, noteBootPassCommitted } from "./process/memory/idleReloadBootState";
import { initMobileGesture } from "./hotkey";
import { moduleUpdate } from "./process/modules";
import { repairDatabaseIds } from "./process/chatIds";
import { verifyAssetCacheEntry } from "./storage/assetIntegrity";
import { cleanRouteServedCacheOnce } from "./storage/routeCacheCleanup";
import { getRemoteSaveCleanupAction, getRemoteSavePayloadName } from "./storage/remoteSaveCleanup";
import { sweepTauriAssets, sweepForageAssetKey, ASSET_SWEEP_BATCH_SIZE } from "./storage/assetSweep";
import { recordLoadTimeListing } from "./storage/loadTimeListing";
import { noteMainFileBytes } from "./storage/mainFileRecord";
import { sweepAllWriteTemps } from "./storage/tauriAtomicWrite";
import { startInlayCopy } from "./process/files/inlayCopy";
import { queueInlayCleanupForCharacters } from "./process/files/inlayCleanup";
import { AppStoreUnavailableError, cleanUpCopiedBackOpfs, getAppStore, readMainFile, takeStorageFallbackNotice } from "./storage/store/appStore";
import { StoreNotBinaryError } from "./storage/store/errors";
import { openBootArchiveSession, type BootArchiveNotice, type BootArchiveOutcome, type BootArchiveSession } from "./storage/bootArchivePass";
import { clearArchiveMemo, clearRestoreAllStrikes, rememberPausedTold, rememberSkipped, rememberTooLarge } from "./storage/bootArchiveMemo";
import { hasEnabledV21Plugin } from "./plugins/v21Plugins";
import { applyCharacterDefaults } from "./storage/characterDefaults";
import { recordStartupCleanup } from "./storage/startupCleanupState";
import { startAvatarThumbSweep } from "./media/avatarThumb";
import {
    forageStorage,
    saveDb,
    getDbBackups,
    buildAssetKeepSet,
    getUncleanablesSync,
    getBasename,
    wasAssetWrittenThisPage,
    listAssetsWrittenThisPage,
    setUsingSw,
    checkCharOrder,
    afterNextSaveCommit
} from "./globalApi.svelte";
import { isTauri } from "./platform";
import { isTauriDesktop } from "./tauriDesktop";
import { registerModelDynamic } from "./model/modellist";

const appWindow = isTauriDesktop ? getCurrentWebviewWindow() : null

/**
 * Resolves the next time the alert store returns to `type: 'none'`, the way
 * a blocking notice below is acknowledged -- reacts to the store write
 * directly instead of polling on a timer, so it settles on the very write
 * that clears the alert regardless of how that write is scheduled.
 */
function waitForAlertCleared(): Promise<void> {
    return new Promise<void>((resolve) => {
        const unsubscribe = alertStore.subscribe((v) => {
            if (v.type === 'none') {
                resolve()
                unsubscribe()
            }
        })
    })
}

/**
 * Loads the application data.
 */
export async function loadData() {
    const loaded = get(loadedStore)
    if (!loaded) {
        // Opened after the storage is ready and before the main file is read,
        // and released on every path out of the read, decode and install below,
        // including the error path: a hold kept past a failed boot would block
        // the next tab at its own storage init.
        let archiveSession: BootArchiveSession | null = null
        // Posted right after the install, once the language is set, and each
        // awaited until dismissed.
        let archiveNotices: BootArchiveNotice[] = []
        // The notices of the block store (unused save data left over, an old save
        // file that could not be moved aside, a read-only page), posted before
        // the archive pass's, once each.
        const bootNotices: BootNotice[] = []
        // What an idle reload of the previous page left for this one. Read before
        // the archive pass, whose keep-inline set it supplies, and applied once
        // the database is installed.
        let handoffMedium: HandoffMedium | null = null
        let handoff: ReadHandoff = { selection: null, drafts: null }
        try {
            handoffMedium = createHandoffMedium()
            if (handoffMedium) {
                handoff = await readHandoff(handoffMedium, Date.now())
                if (handoff.selection) {
                    markBootedByIdleReload()
                }
            }
        } catch (error) {
            console.error(error)
        }
        const keepInline = handoff.selection ? new Set(handoff.selection.keepInline) : undefined
        try {
            if (isTauri) {
                LoadingStatusState.text = "Checking Files..."
                appWindow?.maximize()
                if (!await exists('', { baseDir: BaseDirectory.AppData })) {
                    await mkdir('', { baseDir: BaseDirectory.AppData })
                }
                if (!await exists('database', { baseDir: BaseDirectory.AppData })) {
                    await mkdir('database', { baseDir: BaseDirectory.AppData })
                }
                if (!await exists('assets', { baseDir: BaseDirectory.AppData })) {
                    await mkdir('assets', { baseDir: BaseDirectory.AppData })
                }
                // Must stay before the first write to any store key in this
                // page load: a temp file found here is not from a write of
                // this page load. It is a leftover, or at worst the orphaned
                // write of an earlier page load or an exiting process, whose
                // loss never affects the target. Atomic and chunked writes
                // alike leave `risu-write-<id>.tmp` next to their key, so every
                // directory a key can live in is swept, nested ones included
                // (`blocks/<gen>/c/`, `assets/` subfolders), and the AppData
                // root itself (a key without a slash). A directory a write has
                // not created yet is skipped.
                await sweepAllWriteTemps()
                archiveSession = await openBootArchiveSession('tauri')
                noteBootArchiveSession(archiveSession.canArchive)
                let outcome: BootArchiveOutcome | null = null
                LoadingStatusState.text = "Reading Save File..."
                // A head means the profile lives in the block store; only a
                // profile with no head is read as the legacy main file below.
                let storeBoot = await bootFromStore(archiveSession, keepInline)
                // Only an absent main file starts a first launch. A read that
                // fails for any other reason leaves the file as it is and takes
                // the backup route below.
                let readed: Uint8Array | null = null
                let mainReadable = true
                if (storeBoot.kind === 'legacy') {
                    try {
                        readed = (await readMainFile()).bytes
                    } catch (error) {
                        console.error(error)
                        mainReadable = false
                    }
                    if (mainReadable && readed === null && storeBoot.ctx !== null) {
                        storeBoot = await seedBootProfile(storeBoot.ctx, archiveSession, keepInline)
                    }
                }
                if (storeBoot.kind === 'installed') {
                    setDatabase(storeBoot.tree)
                    archiveNotices = storeBoot.archiveNotices
                    bootNotices.push(...storeBoot.notices)
                    noteBootPassCommitted(storeBoot.committed)
                    await archiveSession.release()
                    // The listing prunes the backups; a failure here must neither
                    // stop the boot nor go unreported.
                    Promise.resolve(getDbBackups()).catch((error) => console.error(error))
                } else {
                    // The profile is the legacy main file until a conversion wins.
                    if (storeBoot.ctx !== null) {
                        setPageStorageMode({ kind: 'legacy', convertedFrom: readed === null ? null : fingerprintMainFile(readed) })
                    }
                    if (readed !== null) {
                        try {
                            noteMainFileBytes(readed)
                            LoadingStatusState.text = "Decoding Save File..."
                            const decoded = await decodeMainFile(readed)
                            outcome = await resolveArchiveOutcome(archiveSession, decoded, keepInline)
                        } catch (error) {
                            outcome = null
                        }
                    }
                    if (outcome?.kind === 'stop') {
                        throw outcome.error
                    }
                    if (outcome?.kind === 'install') {
                        try {
                            setDatabase(outcome.tree)
                            if (outcome.noteBytes) {
                                noteMainFileBytes(outcome.noteBytes)
                            }
                            archiveNotices = outcome.notices
                        } catch (error) {
                            console.error(error)
                            outcome = null
                        }
                    }
                    noteBootPassCommitted(outcome?.kind === 'install' && outcome.committed === true)
                    await archiveSession.release()
                    if (outcome?.kind === 'install') {
                        if (outcome.committed === true && storeBoot.ctx !== null) {
                            // The pass converted the profile: it is a block profile now.
                            bootNotices.push(...await settleBlockProfile(storeBoot.ctx))
                        }
                        Promise.resolve(getDbBackups()).catch((error) => console.error(error))
                    }
                }
                if (storeBoot.kind === 'legacy' && outcome?.kind !== 'install') {
                    LoadingStatusState.text = "Reading Backup Files..."
                    const backups = await listBackupsForBoot()
                    let backupLoaded = false
                    for (const backup of backups) {
                        if (!backupLoaded) {
                            try {
                                LoadingStatusState.text = `Reading Backup File ${backup}...`
                                const backupData = await readBackupBytes(backup)
                                setDatabase(
                                    await decodeRisuSave(backupData)
                                )
                                backupLoaded = true
                            } catch (error) {
                                console.error(error)
                            }
                        }
                    }
                    if (!backupLoaded) {
                        throw "Your save file is corrupted"
                    }
                }
                await postBootNotices(bootNotices)
                await postArchiveNotices(archiveNotices)
                LoadingStatusState.text = "Checking Update..."
                await checkRisuUpdate()
                await changeFullscreen()

            }
            else {
                await forageStorage.Init()
                try {
                    await getAppStore()
                } catch (error) {
                    if (error instanceof AppStoreUnavailableError) {
                        throw language.browserStorageUnavailable
                    }
                    throw error
                }
                archiveSession = await openBootArchiveSession('web')
                noteBootArchiveSession(archiveSession.canArchive)
                if (archiveSession.reloading) {
                    // The hold was refused because this page is reloading; the
                    // reload discards this boot.
                    await sleepForever()
                }

                LoadingStatusState.text = "Loading Local Save File..."
                // A head means the profile lives in the block store; only a
                // profile with no head is read as the legacy main file below.
                let storeBoot = await bootFromStore(archiveSession, keepInline)
                // Only an absent main file is seeded. A zero-length file, or a
                // stored value that is not bytes, is an undecodable main file and
                // takes the backup route; it is never written over. A page that
                // runs from OPFS this time has no owner and writes nothing: its
                // empty profile is only installed.
                let gotStorage: Uint8Array | null = null
                let mainReadable = true
                let mainFileSeeded = false
                if (storeBoot.kind === 'legacy') {
                    try {
                        gotStorage = (await readMainFile()).bytes
                        if (gotStorage === null) {
                            mainFileSeeded = true
                            if (storeBoot.ctx === null) {
                                gotStorage = encodeRisuSaveLegacy({})
                            } else {
                                storeBoot = await seedBootProfile(storeBoot.ctx, archiveSession, keepInline)
                            }
                        }
                    } catch (error) {
                        if (!(error instanceof StoreNotBinaryError)) {
                            throw error
                        }
                        console.error(error)
                        mainReadable = false
                    }
                }
                LoadingStatusState.text = "Decoding Local Save File..."
                let outcome: BootArchiveOutcome | null = null
                if (storeBoot.kind === 'installed') {
                    setDatabase(storeBoot.tree)
                    archiveNotices = storeBoot.archiveNotices
                    bootNotices.push(...storeBoot.notices)
                    noteBootPassCommitted(storeBoot.committed)
                    await archiveSession.release()
                } else {
                    // The profile is the legacy main file until a conversion wins.
                    if (storeBoot.ctx !== null) {
                        setPageStorageMode({ kind: 'legacy', convertedFrom: mainReadable && gotStorage !== null ? fingerprintMainFile(gotStorage) : null })
                    }
                    if (mainReadable) {
                        noteMainFileBytes(gotStorage as Uint8Array)
                        try {
                            const decoded = await decodeMainFile(gotStorage as Uint8Array)
                            // The file's bytes are not kept past the decode: the pass
                            // exists to bring memory down, and the main-file record
                            // keeps its own reference only until it has hashed them.
                            gotStorage = null
                            console.log(decoded.tree)
                            outcome = await resolveArchiveOutcome(archiveSession, decoded, keepInline)
                        } catch (error) {
                            console.error(error)
                            outcome = null
                        }
                    }
                    if (outcome?.kind === 'stop') {
                        throw outcome.error
                    }
                    if (outcome?.kind === 'install') {
                        try {
                            setDatabase(outcome.tree)
                            if (outcome.noteBytes) {
                                noteMainFileBytes(outcome.noteBytes)
                            }
                            archiveNotices = outcome.notices
                        } catch (error) {
                            console.error(error)
                            outcome = null
                        }
                    }
                    noteBootPassCommitted(outcome?.kind === 'install' && outcome.committed === true)
                    await archiveSession.release()
                    if (outcome?.kind === 'install' && outcome.committed === true && storeBoot.ctx !== null) {
                        // The pass converted the profile: it is a block profile now.
                        bootNotices.push(...await settleBlockProfile(storeBoot.ctx))
                    }
                }
                if (storeBoot.kind === 'legacy' && storeBoot.ctx === null) {
                    bootNotices.push({ kind: 'opfs-read-only' })
                }
                // The OPFS leftovers of a completed copy back are deleted only
                // after a boot that read the profile from the page's own store
                // and decoded it whole: a block profile with no damage, or an
                // existing main file. A boot that created an empty profile, or
                // fell back to a backup, leaves them: they may be the only copy
                // of the profile.
                const mainFileLoaded = storeBoot.kind === 'installed'
                    ? storeBoot.how === 'store'
                    : outcome?.kind === 'install' && !mainFileSeeded
                if (storeBoot.kind === 'legacy' && outcome?.kind !== 'install') {
                    const backups = await listBackupsForBoot()
                    let backupLoaded = false
                    for (const backup of backups) {
                        if (backupLoaded) {
                            break
                        }
                        try {
                            LoadingStatusState.text = `Reading Backup File ${backup}...`
                            const backupData = await readBackupBytes(backup)
                            setDatabase(
                                await decodeRisuSave(backupData)
                            )
                            backupLoaded = true
                        } catch (error) { }
                    }
                    if (!backupLoaded) {
                        throw "Forage: Your save file is corrupted"
                    }
                }

                // A page that runs from OPFS because the copy back into
                // IndexedDB could not run records its reason in the page's
                // store selection, which runs before setDatabase() above has
                // picked the boot language. Shown once, after decode, so the
                // notice is translated. Both this notice and the stale-account
                // notice below are posted before loadedStore is set; they never
                // collide because this one is awaited to clear before the
                // stale-account check runs.
                const fallbackNotice = takeStorageFallbackNotice()
                if (fallbackNotice) {
                    const message = fallbackNotice.reason === 'space' ? language.opfsFallbackNoticeSpace
                        : fallbackNotice.reason === 'tab' ? language.opfsFallbackNoticeTab
                        : fallbackNotice.reason === 'noIndexedDb' ? language.opfsFallbackNoticeNoIndexedDb
                        : language.opfsFallbackNoticeError(fallbackNotice.detail ?? '')
                    alertNormal(message)
                    await waitForAlertCleared()
                }

                // The block store's notices and then the archive pass's follow the
                // notice above (each is awaited, so none overwrites another in the
                // single alert slot) and come before anything else that can post
                // an alert.
                await postBootNotices(bootNotices)
                await postArchiveNotices(archiveNotices)

                // I6: a returning RisuAccount-sync profile (AutoStorage.Init()
                // detected `accountst === 'able'`) never boots past this point
                // silently. The notice is blocking and re-posts itself against
                // any other alertStore write; only its own OK acknowledges it.
                // Acknowledging removes the three account-sync keys and reloads
                // -- this page life never reaches the service worker,
                // characterURLImport, plugins, loadedStore or saveDb below.
                if (forageStorage.staleAccountProfile) {
                    void alertStaleAccountNotice().then(() => {
                        localStorage.removeItem('accountst')
                        localStorage.removeItem('dosync')
                        localStorage.removeItem('fallbackRisuToken')
                        markAppInitiatedReload()
                        location.reload()
                    })
                    return
                }
                // No stale profile was detected: any leftover sync flags from an
                // earlier, already-resolved migration attempt are stale too, and
                // are dropped without a notice. `dosync` and `fallbackRisuToken`
                // are read and removed only on this branch -- a Tauri boot never
                // touches either.
                localStorage.removeItem('dosync')
                localStorage.removeItem('fallbackRisuToken')

                LoadingStatusState.text = "Checking Service Worker..."
                if (navigator.serviceWorker) {
                    setUsingSw(true)
                    await registerSw()
                }
                else {
                    setUsingSw(false)
                }
                // Never awaited: the clean-up must not delay the app.
                void cleanRouteServedCacheOnce(typeof localStorage === 'undefined' ? null : localStorage)
                if (getDatabase().didFirstSetup) {
                    characterURLImport()
                }
                if (mainFileLoaded) {
                    // Never awaited: the clean-up must not delay the app.
                    void cleanUpCopiedBackOpfs()
                }
            }
            // Both boot branches reach here on the non-stale path (the
            // stale-profile notice above returns before this point, and the
            // next boot's ordinary path runs it instead). Drops the leftovers
            // of two upstream services this app does not offer: the
            // account-sync LocalForage instance named "risuaiAccountCached",
            // and the Google Drive backup's last-saved timestamp
            // (`risu_lastsaved`) and save/load flag (`localStorage['backup']`,
            // removed only when it still holds the value one of Drive's own
            // buttons wrote -- the key name is otherwise generic). Nothing in
            // this app reads or writes any of them, so this cleanup is
            // best-effort and never awaited -- a boot must never fail or
            // stall on it. The drop goes through a named `createInstance`
            // handle rather than the module-level `localforage.dropInstance`,
            // which would initialize LocalForage's own default database as a
            // side effect before ever touching this one. `dropInstance()`
            // itself is given an explicit `{ name }` with no `storeName`:
            // localforage 1.10.0's IndexedDB driver deletes the whole named
            // database only for that shape. Called with no options, it fills
            // in `storeName` from this instance's config, and any
            // `storeName` makes it delete just that object store, leaving an
            // empty "risuaiAccountCached" database behind.
            localStorage.removeItem('risu_lastsaved')
            // The legacy block cache has no reader once the profile is a block
            // profile. Dropped here, with the other leftovers, and so never
            // while a stale-profile notice holds the boot.
            if (blockProfileInstalled) {
                dropRisuSaveCache()
            }
            if (localStorage.getItem('backup') === 'save' || localStorage.getItem('backup') === 'load') {
                localStorage.removeItem('backup')
            }
            try {
                void localforage.createInstance({ name: 'risuaiAccountCached' }).dropInstance({ name: 'risuaiAccountCached' }).catch(() => { })
            } catch (error) { }
            // Never awaited: the copy of the old inlay database must not delay the app.
            startInlayCopy()

            // Taken before any plugin runs: a plugin can write cold-storage
            // units from its first line, and a unit written after this point
            // must never be deletable by the manual clean-up. Awaited so the
            // listing has settled before that can happen.
            LoadingStatusState.text = "Listing Stored Files..."
            try {
                await recordLoadTimeListing()
            } catch (error) { }

            // The restore-all count only matters while a V2.1 plugin is enabled
            // in the installed database; an enabled one keeps it, because a
            // switch-off the breaker made may not have been saved yet.
            try {
                if (!hasEnabledV21Plugin(getDatabase().plugins)) {
                    clearRestoreAllStrikes()
                }
            } catch (error) { }

            LoadingStatusState.text = "Loading Plugins..."
            try {
                await loadPlugins()
            } catch (error) { }
            try {
                //@ts-expect-error navigator.standalone is iOS Safari non-standard property, not in Navigator interface
                const isInStandaloneMode = (window.matchMedia('(display-mode: standalone)').matches) || (window.navigator.standalone) || document.referrer.includes('android-app://');
                if (isInStandaloneMode) {
                    await navigator.storage.persist()
                }
            } catch (error) {

            }
            LoadingStatusState.text = "Checking For Format Update..."
            await checkNewFormat()
            const db = getDatabase();

            LoadingStatusState.text = "Updating States..."
            updateColorScheme()
            updateTextThemeAndCSS()
            updateAnimationSpeed()
            updateHeightMode()
            updateErrorHandling()
            updateGuisize()
            if (!localStorage.getItem('nightlyWarned') && import.meta.env.VITE_RISU_NIGHTLY_BUILD === 'TRUE') {
                alertMd(language.nightlyWarning)
                await waitAlert()
                localStorage.setItem('nightlyWarned', 'true')
            }
            if (db.botSettingAtStart) {
                botMakerMode.set(true)
            }
            if ((db.betaMobileGUI && window.innerWidth <= 800) || import.meta.env.VITE_RISU_LITE === 'TRUE') {
                initMobileGesture()
                MobileGUI.set(true)
            }
            loadedStore.set(true)
            selectedCharID.set(-1)
            startObserveDom()
            assignIds()
            if (handoffMedium && (handoff.selection || handoff.drafts)) {
                // The drafts are put back now and their part is deleted once this page's
                // first save has committed; the reselect settles in the background.
                void applyHandoff(handoff, handoffMedium, selectCharacterByChaId, afterNextSaveCommit)
            }
            try {
                startIdleReload()
            } catch (error) {
                console.error(error)
            }
            registerModelDynamic()
            if (getPageStorageMode().kind !== 'read-only') {
                saveDb()
            }
            moduleUpdate()
            // Recording attaches handlers to the promise, which marks a failure
            // as handled so it never reaches the `unhandledrejection` handler;
            // it is reported here the same way. The call stays un-awaited.
            const startupCleanup = cleanChunks()
            recordStartupCleanup(startupCleanup)
            startupCleanup.catch((error) => {
                console.error(error)
                alertError(error)
            })
            // Detached: its own store, its own try/catch, never awaited so a
            // slow or failing sweep can't hold up boot.
            void startAvatarThumbSweep()
            // Drains a `?realm=` link recorded as pending before the
            // upstream-services agreement was given: not awaited,
            // so boot never blocks on the user's answer.
            void handlePendingRealmLink()
            // Files and deep links the operating system passed in; not
            // awaited, and a boot before first setup leaves them queued.
            if (isTauri && getDatabase().didFirstSetup) {
                void desktopLaunchImport()
            }

        } catch (error) {
            await archiveSession?.release().catch(() => { })
            alertError(error)
        }
    }
}

/** The bytes of numbered backup `backup`; a backup that is not stored is an error, as an undecodable one is. */
async function readBackupBytes(backup: number): Promise<Uint8Array> {
    const key = `database/dbbackup-${backup}.bin`
    const { bytes } = await (await getAppStore()).read(key)
    if (bytes === null) {
        throw new Error(`The backup ${key} is not in storage`)
    }
    return bytes
}

/** What the block store decided at boot (see `bootFromStore`). */
type StoreBoot =
    /**
     * No head: the legacy main file follows. `ctx` is `null` on a page that
     * runs from OPFS this time, which has no owner and writes nothing.
     */
    | { kind: 'legacy', ctx: BootLoadContext | null }
    /** A block profile loaded (or seeded, or restored from a backup) and decoded whole. */
    | { kind: 'installed', tree: Database, how: 'store' | 'backup' | 'seed', committed: boolean, archiveNotices: BootArchiveNotice[], notices: BootNotice[] }

/** The prompts a boot may show before the app is up, over the alert slot. */
const bootUi: BootLoadUi = {
    notify: (text) => alertNormalWait(text),
    choose: async (title, options) => parseInt(await alertSelect([...options], title)),
    confirm: (text) => alertConfirm(text),
}

/**
 * The numbered backups, newest first, without pruning: the damage prompt must
 * write and delete nothing before the person chooses, and a read-only page
 * deletes nothing at all.
 */
async function listBackupTimes(): Promise<number[]> {
    const prefix = 'database/dbbackup-'
    const times: number[] = []
    for (const key of await (await getAppStore()).list(prefix)) {
        const match = /^(\d+)\.bin$/.exec(key.slice(prefix.length))
        if (match) {
            times.push(Number(match[1]))
        }
    }
    return times.sort((a, b) => b - a)
}

/** The backups listing the boot's fallback reads: pruning, except on a read-only page, which deletes nothing. */
function listBackupsForBoot(): Promise<number[]> {
    return getPageStorageMode().kind === 'read-only' ? listBackupTimes() : getDbBackups()
}

const bootBackups: BootBackupSource = {
    list: listBackupTimes,
    read: (time) => readBackupBytes(time),
}

/** The block-store owner of this page with what the boot asks of its surroundings, or `null` on a page that runs from OPFS this time. */
async function blockBootContext(session: BootArchiveSession): Promise<BootLoadContext | null> {
    const owner = await getPageBlockOwner()
    if (owner === null) {
        return null
    }
    return { owner, store: await getAppStore(), session, ui: bootUi, backups: bootBackups, waitForReload: sleepForever }
}

/** Whether this page's profile is a block profile, so the legacy block cache can go once boot is past the stale-profile gate. */
let blockProfileInstalled = false

/**
 * What follows the install of a profile the block store holds: the rename
 * finish and the generations inventory that decides whether the startup asset
 * sweep may run.
 */
async function settleBlockProfile(ctx: BootLoadContext): Promise<BootNotice[]> {
    blockProfileInstalled = true
    return await finishBlockBoot(ctx.owner, ctx.store)
}

/**
 * Loads the profile from the block store when it has a head. A page without
 * an owner (it runs from OPFS this time) and a store with no head answer
 * `legacy`. The strict decode happens inside the owner's `load()`, so a block
 * that does not decode is damage and goes to the prompt, never into a partial
 * install; a profile restored from a backup at that prompt is not run through
 * the archive pass.
 */
async function bootFromStore(session: BootArchiveSession, keepInline: ReadonlySet<string> | undefined): Promise<StoreBoot> {
    const ctx = await blockBootContext(session)
    if (ctx === null) {
        setPageStorageMode({ kind: 'read-only' })
        return { kind: 'legacy', ctx: null }
    }
    const loaded = await loadBlockProfile(ctx)
    if (loaded.kind === 'no-head') {
        return { kind: 'legacy', ctx }
    }
    setPageStorageMode({ kind: 'block' })
    let tree = loaded.tree
    let archiveNotices: BootArchiveNotice[] = []
    let committed = false
    if (loaded.how === 'store') {
        const outcome = await resolveArchiveOutcome(session, { tree, strict: true }, keepInline)
        if (outcome.kind === 'stop') {
            throw outcome.error
        }
        if (outcome.kind === 'backup-fallback') {
            // The committed state could not be read again after the pass failed:
            // a backup never stands in for a block profile that was readable.
            throw language.saveReadFailed
        }
        tree = outcome.tree
        archiveNotices = outcome.notices
        committed = outcome.committed === true
    }
    await session.release()
    return { kind: 'installed', tree, how: loaded.how, committed, archiveNotices, notices: await settleBlockProfile(ctx) }
}

/**
 * Creates the first profile in the block store when there is no head and no
 * main file. A seed that loses to another page loads that page's state.
 */
async function seedBootProfile(ctx: BootLoadContext, session: BootArchiveSession, keepInline: ReadonlySet<string> | undefined): Promise<StoreBoot> {
    const seeded = await seedEmptyBlockProfile(ctx)
    if (seeded.kind === 'load-again') {
        const again = await bootFromStore(session, keepInline)
        if (again.kind === 'legacy') {
            throw language.saveSeedFailed
        }
        return again
    }
    setPageStorageMode({ kind: 'block' })
    await session.release()
    return {
        kind: 'installed',
        tree: seeded.tree,
        how: seeded.kind === 'backup' ? 'backup' : 'seed',
        committed: false,
        archiveNotices: [],
        notices: await settleBlockProfile(ctx),
    }
}

function bootNoticeText(notice: BootNotice): string {
    switch (notice.kind) {
        case 'leftover-generations':
            return language.saveLeftoverNotice
        case 'main-file-left':
            return language.saveMainFileLeftNotice
        case 'opfs-read-only':
            return language.opfsReadOnlyNotice
    }
}

/** Posts each notice of the block store once, in order, awaiting its acknowledgement before the next. */
async function postBootNotices(notices: readonly BootNotice[]) {
    const posted = new Set<BootNotice['kind']>()
    for (const notice of notices) {
        if (posted.has(notice.kind)) {
            continue
        }
        posted.add(notice.kind)
        alertNormal(bootNoticeText(notice))
        await waitForAlertCleared()
    }
}

/**
 * The main file decoded for boot: strictly first, so that the boot archive
 * pass only ever works on a complete reading of the file. A strict decode that
 * fails falls back to the decode boot has always used, whose tree may be
 * missing blocks, and which never goes through the pass.
 */
async function decodeMainFile(bytes: Uint8Array): Promise<{ tree: Database, strict: boolean }> {
    try {
        return { tree: await decodeRisuSave(bytes, { strict: true }), strict: true }
    } catch (error) {
        return { tree: await decodeRisuSave(bytes), strict: false }
    }
}

/**
 * What boot installs from a decoded main file. The pass runs only on a strict
 * decode and never rejects; if it does anyway, the tree it was given is
 * installed (the pass only swaps a slot for a stub after that slot's unit was
 * verified, so that tree is always safe to install), never a backup.
 *
 * A tree that reads the setting off clears the pass's device records first (the
 * notice memo, the strike count and the told record), on every boot and
 * whether or not a pass can run, so turning the setting off and on again
 * always starts from empty records.
 */
async function resolveArchiveOutcome(
    session: BootArchiveSession,
    decoded: { tree: Database, strict: boolean },
    keepInline?: ReadonlySet<string>,
): Promise<BootArchiveOutcome> {
    if (decoded.tree.archiveCharacters === false) {
        clearArchiveMemo()
    }
    if (!decoded.strict) {
        await session.release()
        return { kind: 'install', tree: decoded.tree, noteBytes: null, notices: [] }
    }
    try {
        return await session.run({ tree: decoded.tree, keepInline })
    } catch (error) {
        console.error(error)
        return { kind: 'install', tree: decoded.tree, noteBytes: null, notices: [] }
    }
}

/** How many skipped characters a notice names; the rest are counted. */
const SKIPPED_NAMES_SHOWN = 5

function archiveNoticeText(notice: BootArchiveNotice): string {
    switch (notice.kind) {
        case 'archive-enabled':
            return language.archiveCharactersNotice(language.settings, language.advancedSettings, language.coldStorage)
        case 'archive-skipped': {
            const shown = notice.characters.slice(0, SKIPPED_NAMES_SHOWN).map((cha) => `"${cha.name || cha.chaId}"`)
            return language.archiveCharactersSkippedNotice(
                shown.join(', '),
                notice.characters.length - shown.length,
                language.settings,
                language.advancedSettings,
                language.coldStorage,
            )
        }
        case 'archive-stopped':
            return language.archiveCharactersStoppedNotice(notice.characterName)
        case 'archive-too-large':
            return language.archiveCharactersTooLargeNotice(language.settings, language.advancedSettings, language.coldStorage)
        case 'archive-paused':
            return language.archiveCharactersPausedNotice(language.settings, language.advancedSettings, language.coldStorage)
    }
}

/**
 * Posts each notice of the boot archive pass in order, awaiting its
 * acknowledgement before the next. The device memo a notice carries is written
 * right after that notice is posted and never before: a boot that ends without
 * posting leaves no memo, and the next boot tries again and says so.
 */
async function postArchiveNotices(notices: readonly BootArchiveNotice[]) {
    for (const notice of notices) {
        alertNormal(archiveNoticeText(notice))
        if (notice.kind === 'archive-skipped') {
            rememberSkipped(notice.characters.map((cha) => cha.chaId))
        } else if (notice.kind === 'archive-too-large') {
            rememberTooLarge()
        } else if (notice.kind === 'archive-paused') {
            rememberPausedTold()
        }
        await waitForAlertCleared()
    }
}

/**
 * Registers the service worker and initializes it.
 */
async function registerSw() {
    await navigator.serviceWorker.register("/sw.js", {
        scope: "/"
    });
    await sleep(100);
    const da = await fetch('/sw/init');
    if (!(da.status >= 200 && da.status < 300)) {
        markAppInitiatedReload();
        location.reload();
    }
}

/**
 * Updates the error handling by adding custom handlers for errors and unhandled promise rejections.
 */
function updateErrorHandling() {
    const errorHandler = (event: ErrorEvent) => {
        console.error(event.error);
        if(!(event.error.target instanceof Worker)){
            alertError(event.error);            
        }
    };
    const rejectHandler = (event: PromiseRejectionEvent) => {
        console.error(event.reason);
        alertError(event.reason);
    };
    window.addEventListener('error', errorHandler);
    window.addEventListener('unhandledrejection', rejectHandler);
}

/**
 * Updates the height mode of the document based on the value stored in the database.
 */
function updateHeightMode() {
    const db = getDatabase()
    const root = document.querySelector(':root') as HTMLElement;
    switch (db.heightMode) {
        case 'auto':
            root.style.setProperty('--risu-height-size', '100%');
            break
        case 'vh':
            root.style.setProperty('--risu-height-size', '100vh');
            break
        case 'dvh':
            root.style.setProperty('--risu-height-size', '100dvh');
            break
        case 'lvh':
            root.style.setProperty('--risu-height-size', '100lvh');
            break
        case 'svh':
            root.style.setProperty('--risu-height-size', '100svh');
            break
        case 'percent':
            root.style.setProperty('--risu-height-size', '100%');
            break
    }
}

/**
 * Checks and updates the database format to the latest version.
 */
async function checkNewFormat(): Promise<void> {
    let db = getDatabase();

    // A database that has just been loaded (an idle reload is a boot) may name
    // no preset: the working settings are kept as a new one, never over another.
    repairBotPresetsId(db);

    // Check data integrity
    db.characters = db.characters.map((v) => {
        if (!v) {
            return null;
        }
        return applyCharacterDefaults(v);
    }).filter((v) => {
        return v !== null;
    });

    // This loop must run sequentially (not via Promise.all), because the corrupted-lorebook
    // branch below awaits a sequence of user prompts (alertError/alertConfirm/alertMd), and
    // RisuAI's alert system (src/ts/alert.ts) has a single global alert slot with no ownership.
    // If multiple modules are corrupted and processed concurrently, their prompt sequences
    // interleave on that shared slot: a later module's alert can overwrite an earlier module's
    // still-pending question, and answering it resolves every pending waiter with that same
    // answer. That can silently wipe a module's lorebook (v.lorebook = []) for a confirmation
    // question the user never actually saw. Do not "optimize" this back to Promise.all.
    const newModules: typeof db.modules = [];
    for (const v of (db.modules ?? [])) {
        if (v?.lorebook) {
            if (!Array.isArray(v.lorebook)) {
                console.error('Critical: Invalid lorebook format detected in module');
                console.error('Module data:', JSON.stringify(v, null, 2));
                
                // Alert user about corrupted data
                alertError(language.bootstrap.dataCorruptionDetected(v.name || 'Unknown', typeof v.lorebook));
                await waitAlert();
                
                // Ask if user wants to report the issue
                const shouldReport = await alertConfirm(language.bootstrap.reportErrorQuestion);
                
                if (shouldReport) {
                    try {
                        // Collect diagnostic information (without personal data)
                        const diagnosticInfo = {
                            timestamp: new Date().toISOString(),
                            moduleName: v.name || 'Unknown',
                            lorebookType: typeof v.lorebook,
                            lorebookValue: JSON.stringify(v.lorebook).substring(0, 500), // First 500 chars only
                            isArray: Array.isArray(v.lorebook),
                            keys: v.lorebook ? Object.keys(v.lorebook).join(', ') : 'N/A',
                            formatVersion: db.formatversion || 'Unknown'
                        };
                        
                        // Show the diagnostic info and allow user to copy or send
                        const reportData = JSON.stringify(diagnosticInfo, null, 2);
                        await alertMd(language.bootstrap.diagnosticInformation(reportData));
                        await waitAlert();
                        
                        console.log('Diagnostic information for developers:', diagnosticInfo);
                    } catch (reportError) {
                        console.error('Failed to generate diagnostic report:', reportError);
                    }
                }
                
                // Ask if user wants to reset the data
                const shouldReset = await alertConfirm(language.bootstrap.resetLorebookQuestion);
                
                if (shouldReset) {
                    v.lorebook = [];
                    console.log('Lorebook reset to empty array by user choice');
                } else {
                    console.warn('User chose to keep corrupted lorebook data');
                }
            } else {
                v.lorebook = updateLorebooks(v.lorebook);
            }
        }
        newModules.push(v);
    }
    db.modules = newModules;

    db.modules = db.modules.filter((v) => {
        return v !== null && v !== undefined;
    });

    db.personas = (db.personas ?? []).map((v) => {
        v.id ??= uuidv4()
        return v
    }).filter((v) => {
        return v !== null && v !== undefined;
    });

    if (!db.formatversion) {
        function checkClean(data: string) {

            if (data.startsWith('assets') || (data.length < 3)) {
                return data
            }
            else {
                const d = 'assets/' + (data.replace(/\\/g, '/').split('assets/')[1])
                if (!d) {
                    return data
                }
                return d;
            }
        }

        db.customBackground = checkClean(db.customBackground);
        db.userIcon = checkClean(db.userIcon);

        for (let i = 0; i < db.characters.length; i++) {
            if (db.characters[i].image) {
                db.characters[i].image = checkClean(db.characters[i].image);
            }
            if (db.characters[i].emotionImages) {
                for (let i2 = 0; i2 < db.characters[i].emotionImages.length; i2++) {
                    if (db.characters[i].emotionImages[i2] && db.characters[i].emotionImages[i2].length >= 2) {
                        db.characters[i].emotionImages[i2][1] = checkClean(db.characters[i].emotionImages[i2][1]);
                    }
                }
            }
        }

        db.formatversion = 2;
    }
    if (db.formatversion < 3) {
        for (let i = 0; i < db.characters.length; i++) {
            let cha = db.characters[i];
            if (cha.type === 'character') {
                if (checkNullish(cha.sdData)) {
                    cha.sdData = defaultSdDataFunc();
                }
            }
        }

        db.formatversion = 3;
    }
    if (db.formatversion < 4) {
        //migration removed due to issues
        db.formatversion = 4;
    }
    if (db.formatversion < 5) {
        if (db.loreBookToken < 8000) {
            db.loreBookToken = 8000;
        }
        db.formatversion = 5;
    }
    if (!db.characterOrder) {
        db.characterOrder = [];
    }
    if (db.mainPrompt === oldMainPrompt) {
        db.mainPrompt = defaultMainPrompt;
    }
    if (db.mainPrompt === oldJailbreak) {
        db.mainPrompt = defaultJailbreak;
    }
    const purged: typeof db.characters = [];
    for (let i = 0; i < db.characters.length; i++) {
        const trashTime = db.characters[i].trashTime;
        const targetTrashTime = trashTime ? trashTime + 1000 * 60 * 60 * 24 * 3 : 0;
        if (trashTime && targetTrashTime < Date.now()) {
            purged.push(...db.characters.splice(i, 1));
            i--;
        }
    }
    setDatabase(db);
    checkCharOrder();
    queueInlayCleanupForCharacters(purged);
}

const ASSET_KEY_PREFIX = 'assets/'

/**
 * Purges chunks of data that are not needed.
 */
async function cleanChunks(options:{
    cleanColdStorage?: boolean
} = {}) {
    const cleanColdStorage = options.cleanColdStorage ?? false
    const db = getDatabase()

    // Cheap, sampled integrity spot-check: verify a handful of currently
    // in-use assets against their own content-addressed filename on every
    // boot, rather than every cached asset (which would mean re-hashing the
    // whole library, exactly the cost a "lightweight" signal is meant to
    // avoid). Runs before the cold-storage early return below and reads only
    // the in-memory database (getUncleanablesSync, no cold-storage reads),
    // so it still samples something even on a boot that skips the rest of
    // this function for having cold storage on. Only runs when
    // db.checkCorruption is on (the Backup & Files tab's Asset Cache
    // Integrity panel): that toggle gates the only user-visible effect (the
    // toast), so a save that never enabled it never pays the sampling cost.
    // Read-only either way — doesn't attempt to repair anything; that's the
    // explicit "verify assets" action in the same settings section.
    if (!isTauri && db.checkCorruption) {
        const sampleTargets = getUncleanablesSync(db)
            .sort(() => Math.random() - 0.5)
            .slice(0, 3)
        for (const target of sampleTargets) {
            try {
                const result = await verifyAssetCacheEntry('assets/' + target)
                if (result.status === 'mismatch') {
                    console.error(`Asset cache integrity check failed for assets/${target}: expected content hash ${result.expectedHash}, cached copy hashes to ${result.actualHash}`)
                    alertToast(language.possibleAssetCorruptionToast(target))
                }
            } catch (error) {
                console.error('Asset cache integrity check errored for', target, error)
            }
        }
    }

    if(db.coldstorage && !cleanColdStorage){
        return
    }

    // A read-only page performs no store writes or deletes: no asset sweep, no
    // `.meta` write and no `remotes/` delete.
    if (getPageStorageMode().kind === 'read-only') {
        return
    }

    // A profile with any cold-storage stub never sweeps assets at startup;
    // the manual clean-up is the only thing that deletes assets for it, after
    // reading every blob a save can point at. Nor does a profile that keeps a
    // damaged or older save generation on disk (see `isAssetSweepHeld`), nor
    // while an older copy of the main file exists next to the block profile (a
    // `database.pre-blocks*` copy, or the legacy `database.bin` left in
    // place): the generation or the copy may reference assets no live
    // character does. The sweep resumes once the copy is deleted. This gate
    // covers the asset sweep only: the remote-block cleanup below runs for
    // every profile that gets past the flag check above.
    const sweepAssets = !(db.characters ?? []).some((cha) => cha?.coldstorage)
        && !isAssetSweepHeld()
        && !(await olderMainFileCopyExists(await getAppStore()))

    // `keepSet.complete` is false when any cold-stored character's blob
    // failed to read, was missing, or mismatched chaId -- see
    // globalApi.svelte.ts's `resolveUncleanableChars`. Both sweeps below
    // (never the remote-block cleanup that follows them) skip deleting
    // anything in that case, via the spread below.
    const keepSet = sweepAssets ? await buildAssetKeepSet(db) : null
    // The keep-set is older than the listing and than any save made while the
    // sweep runs, so a key this page load wrote, and a key the live database
    // refers to now, are kept as well (see assetSweep.ts).
    const assetGuards = () => ({
        writtenThisPage: wasAssetWrittenThisPage,
        liveUncleanable: () => new Set(getUncleanablesSync(getDatabase())),
    })
    if (isTauri) {
        // The store's listing leaves out the temp file of an atomic write in
        // flight, and lists a directory that does not exist yet as empty.
        const store = await getAppStore()
        if (keepSet) {
            await sweepTauriAssets({
                ...keepSet,
                ...assetGuards(),
                writtenKeysThisPage: listAssetsWrittenThisPage,
                listAssets: async () => (await store.list(ASSET_KEY_PREFIX)).map((key) => ({ name: key.slice(ASSET_KEY_PREFIX.length) })),
                removeAsset: (key) => store.delete(key, 'unconditional'),
                getBasename
            })
        }

        const remoteKeys = await store.list('remotes/')

        const remoteUncleanables = new Set<string>(
            db.characters.map((v) => v.chaId)
        )
        for (const remoteKey of remoteKeys) {
            try {
                const remoteFileName = getBasename(remoteKey)
                const remotePayloadName = getRemoteSavePayloadName(remoteFileName)
                if(!remotePayloadName){
                    continue
                }
                const fexists = remoteUncleanables.has(remotePayloadName)
                if(!fexists){

                    const metaPath = remoteKey + '.meta'
                    // A `.meta` that cannot be read leaves the block for a later
                    // boot; one that does not parse is a `.meta` with no
                    // timestamp, which keeps the block. Absence is asked of the
                    // store's own existence check, which does not depend on how
                    // the plugin words a missing file.
                    let meta: Uint8Array | null = null
                    try {
                        if (await store.has(metaPath)) {
                            meta = (await store.read(metaPath)).bytes
                        }
                    } catch (error) {
                        continue
                    }
                    let metaLastUsed:unknown
                    if (meta !== null) {
                        try {
                            metaLastUsed = JSON.parse(new TextDecoder().decode(meta)).lastUsed
                        } catch (error) {}
                    }

                    const cleanupAction = getRemoteSaveCleanupAction({
                        fileName: remoteFileName,
                        activeCharacterIds: remoteUncleanables,
                        hasMeta: meta !== null,
                        metaLastUsed
                    })
                    if(cleanupAction === 'create-meta'){
                        const metaJson = {
                            lastUsed: Date.now()
                        }
                        await store.write(metaPath, new TextEncoder().encode(JSON.stringify(metaJson)), 'unconditional')
                    }
                    else if(cleanupAction === 'delete'){
                        await store.delete(remoteKey, 'unconditional')
                        await store.delete(metaPath, 'unconditional')
                    }
                }
            } catch (error) {
                console.log('error', remoteKey)
            }
        }
    }
    else {
        // Both listings are taken before anything is removed, so a listing that
        // fails rejects the clean-up with nothing deleted.
        const store = await getAppStore()
        const assetKeys = await store.list(ASSET_KEY_PREFIX)
        const remoteKeys = await store.list('remotes/')
        const characterIds = new Set<string>(
            db.characters.map((v) => v.chaId)
        )
        if (keepSet?.complete === false) {
            console.log('cleanChunks: cold-storage read was incomplete, skipping the forage asset sweep this run')
        }
        if (keepSet && keepSet.complete !== false) {
            const guards = assetGuards()
            // Only keys the keep-set does not protect are candidates, so the
            // live references are walked once per batch of candidates and
            // never for a listing the keep-set already covers.
            const candidates = assetKeys.filter((key) => !keepSet.uncleanable.has(getBasename(key)))
            for (let start = 0; start < candidates.length; start += ASSET_SWEEP_BATCH_SIZE) {
                // One answer for the whole batch of deletes.
                const live = guards.liveUncleanable()
                for (const asset of candidates.slice(start, start + ASSET_SWEEP_BATCH_SIZE)) {
                    await sweepForageAssetKey(asset, {
                        ...keepSet,
                        writtenThisPage: guards.writtenThisPage,
                        liveUncleanable: () => live,
                        removeAsset: (key) => store.delete(key, 'unconditional'),
                        getBasename
                    })
                }
            }
        }
        for (const asset of remoteKeys) {
            if (asset.endsWith('.meta')){
                continue
            }
            // getRemoteSavePayloadName() only recognizes the legacy
            // `.local.bin` suffix — a content-addressed (`v:2`,
            // `<chaId>.<hash>.bin`) file returns null here and is
            // correctly left untouched, matching the Tauri branch above.
            // A hash-named file must never be reduced to a bogus
            // "character id" via a fixed-length suffix strip: that id
            // would never match anything real, making a live block look
            // orphaned and deletable after the grace period. See
            // Agents/Reports/08-remote-block-gc-transactional-safety.md.
            const name = getRemoteSavePayloadName(getBasename(asset))
            if(!name){
                continue
            }
            const exists = characterIds.has(name)
            if(!exists){
                let okayToDelete = false
                try {
                    const metaPath = asset + '.meta'
                    const metaData = (await store.read(metaPath)).bytes
                    if (metaData !== null) {
                        const metaJson = JSON.parse(new TextDecoder().decode(metaData))
                        const lastUsed = metaJson.lastUsed as number
                        if(Date.now() - lastUsed > 1000 * 60 * 60 * 24 * 7) { //not used for 7 days
                            okayToDelete = true
                        }
                    }
                    else{
                        //write meta for next time
                        const metaJson = {
                            lastUsed: Date.now()
                        }
                        await store.write(metaPath, new TextEncoder().encode(JSON.stringify(metaJson)), 'unconditional')
                    }
                } catch (error) {}
                if (okayToDelete) {
                    await store.delete(asset, 'unconditional')
                }
            }
        }
    }
}


/**
 * Repairs `DBState.db.characters`' ids in place, as boot does: a missing
 * `chaId` or chat id gets a fresh one, and an id already seen (by any
 * character or chat of either kind, in array order) is treated as missing
 * too, so the first holder by position keeps it. Holds one id set for the
 * whole database.
 *
 * Boot-only: never call this at runtime. It reassigns any id it finds
 * already present twice to a fresh one, which would move that id out from
 * under a plugin, a draft, or anything else already addressing it.
 *
 * A backup load runs the same algorithm directly from `chatIds.ts` (see
 * `repairDatabaseIds`) on the decoded object, before it enters `$state`,
 * rather than through this export -- pulling this whole module in for that
 * one call would drag boot's entire module graph into every backup-load
 * caller. `chatIds.ts` imports nothing from the app store, so that direct
 * call never does either.
 */
export function assignIds() {
    repairDatabaseIds({ characters: DBState?.db?.characters })
}
