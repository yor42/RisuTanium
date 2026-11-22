import { appFsMkdirAll } from "./storage/appFs"
import { changeFullscreen, checkNullish, sleepForever } from "./util"
import { markAppInitiatedReload } from "./reloadGuard"
import localforage from "localforage"
import { v4 as uuidv4 } from 'uuid';
import { get } from "svelte/store";
import { setDatabase, defaultSdDataFunc, getDatabase, type Database } from "./storage/database.svelte";
import { applyUsageRetention } from "./usage/usageRetention";
import { repairBotPresetsId } from "./storage/botPresetRepair";
import { takePresetIdsMinted } from "./storage/presetMeta";
import { takeConnectionsMigrated } from "./connections/migrate";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { checkRisuUpdate } from "./update";
import { botMakerMode, selectedCharID, loadedStore, DBState, LoadingStatusState } from "./stores.svelte";
import { loadPlugins } from "./plugins/plugins.svelte";
import { alertError, alertMd, alertStaleAccountNotice, waitAlert, alertInput, alertToast } from "./alert";
import { queueNotice, noticesSettled, askPrompt } from "./alertPrompts";
import { handleWindowError } from "./windowErrorGuard";
import { characterURLImport, handlePendingRealmLink } from "./characterCards";
import { desktopLaunchImport } from "./desktopLaunch";
import { androidOpenedFilesImport } from "./android/openedFiles";
import { startLaunchNavigation } from "./android/launchTarget";
import { defaultJailbreak, defaultMainPrompt, oldJailbreak, oldMainPrompt } from "./storage/defaultPrompts";
import { decodeRisuSave, decodeRisuSaveReporting, encodeRisuSaveLegacy, type SalvageOmittedBlock } from "./storage/risuSave";
import { legacyPartialFact, legacyPartialNoticeText, setLegacyPartialSave, type LegacyPartialSave } from "./storage/legacyPartialSave";
import { getPageStorageMode, pageMayGoLive, setPageStorageMode } from "./storage/pageStorageMode";
import { updateAnimationSpeed } from "./gui/animation";
import { updateColorScheme, updateTextThemeAndCSS } from "./gui/colorscheme";
import { language } from "src/lang";
import { markBootWrite } from "./bootWindow";
import { startObserveDom } from "./observer.svelte";
import { updateGuisize } from "./gui/guisize";
import { startRootAttributeMirror } from "./gui/rootAttributes";
import { repairModuleListLorebooks } from "./process/moduleLorebookRepair";
import { startCharacterPutBack } from "./process/memory/characterPutBack";
import { moduleUpdate } from "./process/modules";
import { repairDatabaseIds } from "./process/chatIds";
import { repairCharacterTree, repairPersonas } from "./storage/characterTreeRepair";
import { sweepAllWriteTemps } from "./storage/tauriAtomicWrite";
import { startInlayCopy } from "./process/files/inlayCopy";
import { queueInlayCleanupForCharacters } from "./process/files/inlayCleanup";
import { getAppStore, readMainFile } from "./storage/store/appStore";
import { StoreNotBinaryError } from "./storage/store/errors";
import { getStore2Boot, type Store2BootNotice, type Store2BootResult } from "./storage/store2/bootActive";
import { getActiveStore2Save } from "./storage/store2/saveActive";
import { startStore2Maintenance } from "./storage/store2/maintenance";
import { clearBootScreen } from "./storage/store2/ui/bootScreen.svelte";
import { noticeText } from "./storage/store2/ui/bootText";
import { LEGACY_MAIN_FILE_KEY } from "./storage/blockKeys";
import { listBackupTimes } from "./drive/backupList";
import { clearArchiveMemo } from "./storage/bootArchiveMemo";
import { applyCharacterDefaults } from "./storage/characterDefaults";
import { isTrashPurgeDue } from "./storage/trashPurge";
import { startAvatarThumbSweep } from "./media/avatarThumb";
import {
    afterNextSaveCommit,
    characterCommitVerdict,
    forageStorage,
    getCommittedSaveMarkCount,
    getSaveMarkCount,
    requestSaveNow,
    saveDb,
    checkCharOrder
} from "./globalApi.svelte";
import { fillLang } from "./../lang/fill";
import { isAndroidTransport } from "./storage/tauriByteTransport";
import { markCharacterForSave } from "./storage/characterSaveMarks";
import { configurePageState, requestReconcile, setReconcileTrigger } from "./nativeReply/pageState";
import { createReconciler, recoveredText, type ReconcileNotes } from "./nativeReply/reconcile";
import { reconcileGateOpen } from "./nativeReply/gate";
import { setParkedReplyAsker, showParkedReplies } from "./nativeReply/parkedDialog";
import { createReplyStore } from "./nativeReply/store";
import { isNodeServer, isTauri } from "./platform";
import { isTauriDesktop } from "./tauriDesktop";
import { registerModelDynamic } from "./model/modellist";

const appWindow = isTauriDesktop ? getCurrentWebviewWindow() : null

/**
 * Loads the application data.
 */
export async function loadData() {
    const loaded = get(loadedStore)
    if (!loaded) {
        // What a read-only legacy page installed that is not the whole current save (a partly decoded main file, or a
        // numbered backup), kept for the export and told once after the page may go live. Null for everything else.
        let legacyPartial: LegacyPartialSave | null = null
        // The notices the store2 boot dispatch raised, posted after the database is installed so they are in its language.
        let store2Notices: readonly Store2BootNotice[] = []
        // What the character list of the installed tree needed before it was
        // installed: entries that are not characters left out, ids that are
        // missing or cannot be saved replaced. Told once, after the install.
        const bootRepairs: BootRepairs = { dropped: 0, changed: 0 }
        try {
            // First, before any store is touched: a page that is neither Tauri nor served by the Node server has no
            // byte store to open, so it refuses, reads and writes nothing, and stays unloaded. The UI language is not
            // loaded yet, so the text is the English default.
            if (!isTauri && !isNodeServer) {
                throw language.staticBuildUnsupported
            }
            // A page with no dispatch has no profile to open, so it reports this and stays unloaded.
            if (getStore2Boot() === null) {
                throw missingStore2BootError()
            }
            if (isTauri) {
                LoadingStatusState.text = "Checking Files..."
                appWindow?.maximize()
                // Creating is idempotent, so no existence check precedes it: one call per directory.
                await appFsMkdirAll('')
                await appFsMkdirAll('database')
                await appFsMkdirAll('assets')
                // Must stay before the first write to any store key in this
                // page load: a temp file found here is not from a write of
                // this page load. It is a leftover, or at worst the orphaned
                // write of an earlier page load or an exiting process, whose
                // loss never affects the target. Atomic and chunked writes
                // alike leave `risu-write-<id>.tmp` next to their key, so every
                // directory a key can live in is swept, nested ones included
                // (`assets/` subfolders, and `blocks/<gen>/c/` of pre-store2 data), and the AppData
                // root itself (a key without a slash). A directory a write has
                // not created yet is skipped.
                await sweepAllWriteTemps()
                const store2Boot = await runStore2Boot()
                if (store2Boot.kind === 'stopped') {
                    await sleepForever()
                    return
                }
                store2Notices = store2Boot.notices
                if (store2Boot.kind === 'store2') {
                    await installStore2Profile(store2Boot, bootRepairs)
                } else {
                    // The legacy profile is only read, never written: no numbered backup is pruned.
                    LoadingStatusState.text = "Reading Save File..."
                    setPageStorageMode({ kind: 'read-only', reason: store2Boot.reason })
                    // Any main-file read that fails leaves the file as it is and takes the backup route below.
                    let readed: Uint8Array | null = null
                    try {
                        readed = (await readMainFile()).bytes
                    } catch (error) {
                        console.error(error)
                    }
                    let installed = false
                    if (readed !== null) {
                        let decodedTree: Database | null = null
                        let decodedOmitted: ReadonlyMap<string, SalvageOmittedBlock> = new Map()
                        try {
                            LoadingStatusState.text = "Decoding Save File..."
                            const decoded = await decodeMainFile(readed)
                            // A tree that reads the setting off clears the device records of the retired archive notices,
                            // so turning the setting off and on again starts from empty records.
                            if (decoded.tree.archiveCharacters === false) {
                                clearArchiveMemo()
                            }
                            decodedTree = decoded.tree
                            decodedOmitted = decoded.omitted
                        } catch (error) {
                            decodedTree = null
                        }
                        if (decodedTree !== null) {
                            try {
                                await repairBootTree(decodedTree, bootRepairs)
                                setDatabase(decodedTree)
                                installed = true
                                legacyPartial = legacyPartialFact(null, decodedOmitted)
                            } catch (error) {
                                console.error(error)
                            }
                        }
                    }
                    if (!installed) {
                        LoadingStatusState.text = "Reading Backup Files..."
                        const backups = await listBackupTimes()
                        let backupLoaded = false
                        for (const backup of backups) {
                            if (!backupLoaded) {
                                try {
                                    LoadingStatusState.text = `Reading Backup File ${backup}...`
                                    const backupData = await readBackupBytes(backup)
                                    const backupDecoded = await decodeRisuSaveReporting(backupData)
                                    await repairBootTree(backupDecoded.db, bootRepairs)
                                    setDatabase(backupDecoded.db)
                                    backupLoaded = true
                                    legacyPartial = legacyPartialFact(backup, backupDecoded.omitted)
                                } catch (error) {
                                    console.error(error)
                                }
                            }
                        }
                        if (!backupLoaded) {
                            throw "Your save file is corrupted"
                        }
                    }
                }
                assertPageMayGoLive()
                // Informational notices are queued, not awaited: the boot goes on while the person reads them, and the
                // notice queue shows them one at a time. An update question asked below takes the screen over a notice.
                postStore2Notices(store2Notices)
                postLegacyPartialNotice(legacyPartial)
                LoadingStatusState.text = "Checking Update..."
                await checkRisuUpdate()
                await changeFullscreen()

            }
            else {
                await forageStorage.Init()
                await getAppStore()
                const store2Boot = await runStore2Boot()
                if (store2Boot.kind === 'stopped') {
                    await sleepForever()
                    return
                }
                store2Notices = store2Boot.notices
                if (store2Boot.kind === 'store2') {
                    await installStore2Profile(store2Boot, bootRepairs)
                } else {
                    // The legacy profile is only read, never written: no numbered backup is pruned.
                    LoadingStatusState.text = "Loading Local Save File..."
                    setPageStorageMode({ kind: 'read-only', reason: store2Boot.reason })
                    // Only an absent main file is replaced by an empty profile, and that profile is only installed, never
                    // written. A zero-length file, or a stored value that is not bytes, is an undecodable main file and
                    // takes the backup route.
                    let gotStorage: Uint8Array | null = null
                    let mainReadable = true
                    try {
                        gotStorage = (await readMainFile()).bytes
                        if (gotStorage === null) {
                            gotStorage = encodeRisuSaveLegacy({})
                        }
                    } catch (error) {
                        if (!(error instanceof StoreNotBinaryError)) {
                            throw error
                        }
                        console.error(error)
                        mainReadable = false
                    }
                    LoadingStatusState.text = "Decoding Local Save File..."
                    let installed = false
                    if (mainReadable) {
                        let decodedTree: Database | null = null
                        let decodedOmitted: ReadonlyMap<string, SalvageOmittedBlock> = new Map()
                        try {
                            const decoded = await decodeMainFile(gotStorage as Uint8Array)
                            // The file's bytes are not kept past the decode.
                            gotStorage = null
                            console.log(decoded.tree)
                            // A tree that reads the setting off clears the device records of the retired archive notices,
                            // so turning the setting off and on again starts from empty records.
                            if (decoded.tree.archiveCharacters === false) {
                                clearArchiveMemo()
                            }
                            decodedTree = decoded.tree
                            decodedOmitted = decoded.omitted
                        } catch (error) {
                            console.error(error)
                            decodedTree = null
                        }
                        if (decodedTree !== null) {
                            try {
                                await repairBootTree(decodedTree, bootRepairs)
                                setDatabase(decodedTree)
                                installed = true
                                legacyPartial = legacyPartialFact(null, decodedOmitted)
                            } catch (error) {
                                console.error(error)
                            }
                        }
                    }
                    if (!installed) {
                        const backups = await listBackupTimes()
                        let backupLoaded = false
                        for (const backup of backups) {
                            if (backupLoaded) {
                                break
                            }
                            try {
                                LoadingStatusState.text = `Reading Backup File ${backup}...`
                                const backupData = await readBackupBytes(backup)
                                const backupDecoded = await decodeRisuSaveReporting(backupData)
                                await repairBootTree(backupDecoded.db, bootRepairs)
                                setDatabase(backupDecoded.db)
                                backupLoaded = true
                                legacyPartial = legacyPartialFact(backup, backupDecoded.omitted)
                            } catch (error) { }
                        }
                        if (!backupLoaded) {
                            throw "Forage: Your save file is corrupted"
                        }
                    }
                }
                assertPageMayGoLive()

                // The dispatch's notices and then the legacy-partial notice are
                // queued in that order. The notice queue shows them one at a
                // time in FIFO order, never overwrites one with another, and
                // ends each only by the person's own close. They are not
                // awaited here: the boot goes on behind them.
                postStore2Notices(store2Notices)
                postLegacyPartialNotice(legacyPartial)

                // I6: a returning RisuAccount-sync profile (AutoStorage.Init()
                // detected `accountst === 'able'`) never boots past this point
                // silently. The queued notices are drained first, so the consent
                // is never shown over one; the consent is blocking and re-posts
                // itself against any other alertStore write, and only its own OK
                // acknowledges it. Acknowledging removes the three account-sync
                // keys and reloads -- this page life never reaches
                // characterURLImport, plugins, loadedStore or saveDb below.
                if (forageStorage.staleAccountProfile) {
                    await noticesSettled()
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

                if (getDatabase().didFirstSetup) {
                    characterURLImport()
                }
            }
            // Both boot branches reach here on the non-stale path of a life
            // that stays (the stale-profile notice above returns before this
            // point). Drops the leftovers of two upstream services this app does
            // not offer: the
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
            if (localStorage.getItem('backup') === 'save' || localStorage.getItem('backup') === 'load') {
                localStorage.removeItem('backup')
            }
            try {
                void localforage.createInstance({ name: 'risuaiAccountCached' }).dropInstance({ name: 'risuaiAccountCached' }).catch(() => { })
            } catch (error) { }
            // Never awaited: the copy of the old inlay database must not delay the app.
            startInlayCopy()

            LoadingStatusState.text = "Listing Stored Files..."

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
            // The pack element is inserted before #customcss, so it sits after the app's sheets and before Custom CSS in document order.
            // Boot does not wait for the judge: a chat shown first has the built-in look until the pack is applied.
            void import('./themePack/activePack.svelte').then((m) => m.startThemePackApply()).catch((error) => console.error(error))
            startRootAttributeMirror(window, document)
            updateAnimationSpeed()
            updateHeightMode()
            updateErrorHandling()
            updateGuisize()
            if (!localStorage.getItem('nightlyWarned') && import.meta.env.VITE_RISU_NIGHTLY_BUILD === 'TRUE') {
                alertMd(language.nightlyWarning)
                await waitAlert()
                localStorage.setItem('nightlyWarned', 'true')
            }
            if (bootRepairs.dropped > 0 || bootRepairs.changed > 0) {
                alertToast(language.saveRepairedEntriesNotice(bootRepairs.dropped, bootRepairs.changed))
            }
            if (db.botSettingAtStart) {
                botMakerMode.set(true)
            }
            loadedStore.set(true)
            selectedCharID.set(-1)
            startObserveDom()
            assignIds()
            // A store2 page starts the put-back too: it unloads a loaded, unchanged character through the residency.
            if (getPageStorageMode().kind !== 'read-only') {
                try {
                    startCharacterPutBack()
                } catch (error) {
                    console.error(error)
                }
            }
            registerModelDynamic()
            if (getPageStorageMode().kind !== 'read-only') {
                saveDb()
                // A read-only legacy page saves nothing, so it does not prune at start; a writable page applies the retention
                // setting once at start (the record path applies it again when the local month changes).
                try {
                    applyUsageRetention(getDatabase(), new Date(), { force: true })
                } catch (error) {
                    console.error(error)
                }
                // After saving has started: the reconcile appends replies the native side received while this page
                // could not see them, and their saves are waited for through the commits saveDb makes.
                startNativeReply()
            }
            moduleUpdate()
            // Recording attaches handlers to the promise, which marks a failure
            // as handled so it never reaches the `unhandledrejection` handler;
            // it is reported here the same way. The call stays un-awaited.
            // A store2 page that found its profile ready deletes the old-format files after its first quiet moment; the runner
            // starts nothing on any other page, keeps its own try/catch and is never awaited.
            startStore2Maintenance({ store: getAppStore, listBackupTimes })
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
            // Files other Android apps opened or shared; not awaited. The
            // drain itself holds them until first setup is done, so this
            // runs before it too. A no-op without the Android host.
            if (isTauri) {
                androidOpenedFilesImport()
            }
            // Last in the boot, after the saved state is installed and the launch drains have started, so
            // the restore is a pick like a user's and every arrival that can be known here has been seen.
            // Not awaited; it never throws.
            void startLaunchNavigation()

        } catch (error) {
            alertError(error)
        }
    }
}

/**
 * The error of a page that registered no store2 boot dispatch. `loadData` throws it before any store is touched, so such
 * a page reports it and stays unloaded.
 */
function missingStore2BootError(): Error {
    return new Error('No store2 boot dispatch is registered: registerStore2Boot() must run before loadData(), and this page has no other boot path.')
}

/**
 * Asks the registered store2 boot what this page's profile is, before anything is read. The environment is the page's own
 * store and the questions the dispatch cannot answer itself (whether a main file exists, the numbered backups, the old
 * cold units); the numbered-backup listing never prunes.
 * Reports the save step: the dispatch reads and assembles the profile, and answers any conversion or recovery question,
 * while that text is up.
 */
async function runStore2Boot(): Promise<Store2BootResult> {
    const boot = getStore2Boot()
    if (boot === null) {
        // `loadData` checks the registration before it touches a store; this only narrows the type.
        throw missingStore2BootError()
    }
    const store = await getAppStore()
    // The save step marks the dispatch entry exactly. It is a text only: no await or yield follows it, so it adds no latency.
    LoadingStatusState.text = "Reading Save File..."
    let result: Store2BootResult
    try {
        result = await boot({ store, upstreamMainFile: () => store.has(LEGACY_MAIN_FILE_KEY), listBackupTimes, readColdStorageItem: readColdUnitForConversion })
    } catch (error) {
        // A throw after an answer leaves the "Working" screen up; the page reports the error and must not keep telling the person to wait.
        clearBootScreen()
        throw error
    }
    if (result.kind !== 'stopped') {
        // The boot goes on: whatever screen it showed has done its work, and the page must not keep it over the app.
        clearBootScreen()
    }
    return result
}

/** The page's cold-unit reader, loaded when a conversion first reads a unit, so a page that never converts does not load the module. */
async function readColdUnitForConversion(key: string) {
    const { readColdStorageItem } = await import('./process/coldstorage.svelte')
    return readColdStorageItem(key)
}

/**
 * Installs the open store2 profile. The repairs the legacy boot makes to a decoded tree apply to the assembled one the same way.
 * Reports the library step: the repairs, the install and the notices the caller posts after it run under that text.
 */
async function installStore2Profile(boot: Extract<Store2BootResult, { kind: 'store2' }>, repairs: BootRepairs) {
    LoadingStatusState.text = "Decoding Save File..."
    await repairBootTree(boot.database, repairs)
    setDatabase(boot.database)
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

/**
 * Keeps the legacy-partial fact for the export and queues its notice once. Runs only after `assertPageMayGoLive`, so a page
 * that does not go live neither tells nor keeps it; the notice follows the notices that say why the page is read-only.
 */
function postLegacyPartialNotice(fact: LegacyPartialSave | null): void {
    setLegacyPartialSave(fact)
    if (fact !== null) {
        queueNotice(legacyPartialNoticeText(fact))
    }
}

/**
 * Throws unless the page may become interactive in the mode the dispatch left it in: a read-only page, or a store2 page
 * that holds its active save. Runs after the install and before any boot notice and before `loadedStore` is set, so a page
 * that could neither save nor refuse a write never goes live.
 */
function assertPageMayGoLive(): void {
    const mode = getPageStorageMode()
    const hasActiveSave = getActiveStore2Save() !== null
    if (!pageMayGoLive(mode, hasActiveSave)) {
        throw new Error(`The page storage mode is '${mode.kind}' and ${hasActiveSave ? 'a' : 'no'} store2 save is active, so the page cannot save or refuse a write and does not go live.`)
    }
}

/**
 * Queues each notice the store2 boot raised once, in order, on the notice queue, which shows them one at a time and ends
 * each only by the person's own close. It does not wait for them. It runs after the database is installed, so the text is
 * in the database's language; a notice that ended the boot has no text here.
 */
function postStore2Notices(notices: readonly Store2BootNotice[]): void {
    const posted = new Set<Store2BootNotice['name']>()
    for (const notice of notices) {
        const text = noticeText(notice)
        if (text === null || posted.has(notice.name)) {
            continue
        }
        posted.add(notice.name)
        queueNotice(text)
    }
}

/**
 * The main file decoded for boot: strictly first. A strict decode that fails
 * falls back to the lenient decode, whose tree may be missing blocks; either
 * tree is installed as it is. The caller is told what the lenient tree lacks: a strict tree lacks nothing.
 */
async function decodeMainFile(bytes: Uint8Array): Promise<{ tree: Database, strict: boolean, omitted: ReadonlyMap<string, SalvageOmittedBlock> }> {
    try {
        return { tree: await decodeRisuSave(bytes, { strict: true }), strict: true, omitted: new Map() }
    } catch (error) {
        const lenient = await decodeRisuSaveReporting(bytes)
        return { tree: lenient.db, strict: false, omitted: lenient.omitted }
    }
}

/**
 * Updates the error handling by adding custom handlers for errors and unhandled promise rejections.
 */
export function updateErrorHandling() {
    const errorHandler = (event: ErrorEvent) => {
        handleWindowError(event, {
            warn: (message) => console.warn(message),
            error: (error) => console.error(error),
            report: (error) => alertError(error),
        });
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

interface BootRepairs {
    dropped: number
    changed: number
}

/**
 * Makes the character list of a tree about to be installed one the save can
 * hold, before any plugin can read it: entries that are not characters are
 * dropped, a missing id is filled, and an id that cannot key a block is
 * replaced with the lists that named it following. No archived unit is read at
 * boot: an archived character with an unusable id is installed as it is, and
 * the save loop waits on it.
 */
async function repairBootTree(tree: unknown, tally: BootRepairs): Promise<void> {
    if (typeof tree !== 'object' || tree === null) {
        return
    }
    const result = await repairCharacterTree(tree as { characters?: unknown }, 'boot')
    for (const notice of result.notices) {
        if (notice.kind === 'entries-dropped') {
            tally.dropped += notice.count
        } else {
            tally.changed += 1
        }
    }
}

/**
 * Checks and updates the database format to the latest version.
 */
async function checkNewFormat(): Promise<void> {
    let db = getDatabase();

    // A database that has just been loaded may name
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

    // Sequential and live-list safe; see repairModuleListLorebooks.
    await repairModuleListLorebooks(db);

    // Fork-specific: after the repair the list is a non-empty list of objects
    // and the selected persona is an index into it, so the pass below cannot
    // throw and every reader finds a selected persona. The repair runs before
    // the id pass so a persona it adds gets an id. It changes only the in-memory
    // database; the mark makes the boot's normal save write it, and a read-only
    // page keeps it in memory.
    const personaRepair = repairPersonas(db);
    db.personas = (db.personas ?? []).map((v) => {
        v.id ??= uuidv4()
        return v
    });
    const personaNotices: string[] = []
    if (personaRepair.dropped > 0) {
        personaNotices.push(language.personasRepairedNotice(personaRepair.dropped))
    }
    if (personaRepair.added === 'empty') {
        personaNotices.push(language.personaListEmptyNotice)
    } else if (personaRepair.added === 'buffer') {
        personaNotices.push(language.personaSelectionMissingNotice)
    }
    if (personaNotices.length > 0) {
        markBootWrite()
        alertToast(personaNotices.join(' '))
    }

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
        if (isTrashPurgeDue(db.characters[i].trashTime, Date.now())) {
            purged.push(...db.characters.splice(i, 1));
            i--;
        }
    }
    setDatabase(db);
    // Ids minted by any setDatabase of the boot, and the id of a preset the repair appended, exist only in memory
    // until the boot's normal save writes them; the mark makes it write, so the ids are the same on the next load.
    // The connections migration rewrites the config and preset units the same way; the same mark persists it.
    const presetIdsMinted = takePresetIdsMinted();
    const connectionsMigrated = takeConnectionsMigrated();
    if (presetIdsMinted || connectionsMigrated) {
        markBootWrite();
    }
    checkCharOrder();
    queueInlayCleanupForCharacters(purged);
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

let nativeReplyStarted = false

/**
 * Starts the native reply reconcile of an Android page: the page state that waits for saves, the reconcile that places
 * replies recorded while the page could not see them, and its triggers (launch and every return to visible). Other
 * platforms own no replies, so nothing is installed. Runs once, after saving has started.
 */
function startNativeReply(): void {
    if (nativeReplyStarted || !isAndroidTransport()) {
        return
    }
    nativeReplyStarted = true
    const store = createReplyStore()
    const notes: ReconcileNotes = {
        failedElsewhere: (name) => fillLang(language.replyFailedElsewhere, { name }),
        stoppedElsewhere: (name) => fillLang(language.replyStoppedElsewhere, { name }),
        interrupted: (name) => fillLang(language.nativeReplyInterrupted, { name }),
        unreadable: (key, problem) => fillLang(language.nativeReplyUnreadable, { key, problem }),
    }
    // Back and every other way out of the dialog answer `later`: only a press on Discard removes a record.
    setParkedReplyAsker(async (reply) => {
        const answer = await askPrompt({
            type: 'parkedReply',
            msg: language.parkedReplyTitle,
            parkedReply: { name: reply.name, text: reply.text },
        })
        return answer === 'discard' ? 'discard' : 'later'
    })
    const reconciler = createReconciler({
        store,
        gate: () => reconcileGateOpen({
            readOnly: getPageStorageMode().kind === 'read-only',
            didFirstSetup: getDatabase().didFirstSetup,
            visible: document.visibilityState === 'visible',
        }),
        notice: queueNotice,
        notes,
        recoverText: async (listing, blob, bodyText) => {
            const [{ risuEscape }, { pluginV2 }, { createRunSubject }] = await Promise.all([
                import('./parser/parser.svelte'),
                import('./plugins/plugins.svelte'),
                import('./process/chatOrigin'),
            ])
            return await recoveredText(listing.status, bodyText, blob, {
                escape: risuEscape,
                replacers: async (text) => {
                    let replaced = text
                    for (const replacer of pluginV2.replacerafterRequest) {
                        replaced = await replacer(replaced, 'model')
                    }
                    return replaced
                },
                subject: createRunSubject({ chaId: blob.target.chaId, chatId: blob.target.chatId }),
            })
        },
        apply: async (input) => (await import('./process/index.svelte')).applyRecoveredReply(input),
        replayStream: async (blob, bytes, complete) => {
            const [{ replayOpenAIChatStream }, { createRunSubject }, { createUsageMeter }] = await Promise.all([
                import('./nativeReply/streamReplay'),
                import('./process/chatOrigin'),
                import('./usage/usageMeter'),
            ])
            const meter = createUsageMeter()
            const { modelText } = await replayOpenAIChatStream({
                bytes,
                complete,
                rule: {
                    deepSeekThinkingOutput: blob.parse.deepSeekThinkingOutput,
                    extractJson: blob.parse.extractJson,
                    jsonSchema: blob.parse.jsonSchema,
                    multiGen: blob.parse.multiGen,
                },
                subject: createRunSubject({ chaId: blob.target.chaId, chatId: blob.target.chatId }),
            }, meter)
            return { modelText, meter }
        },
        applyStream: async (input) => (await import('./process/index.svelte')).applyRecoveredStreamReply(input),
        settleUsage: (blob, meter, how, modelText) => {
            void import('./usage/usageCapture').then(({ settleRecoveredUsage }) => settleRecoveredUsage(blob.usage, meter, how, modelText)).catch((error) => console.error(error))
        },
        restoreCharacter: async (chaId) => (await import('./process/coldMemberRestore')).restoreColdCharacterByChaId(chaId),
        preLoadChat: async (characterIndex, chatIndex) => (await import('./process/coldstorage.svelte')).preLoadChat(characterIndex, chatIndex),
        showParked: (items) => showParkedReplies(items, {
            discard: (key) => store.discard(key),
            discardFailed: (reply, error) => alertToast(`${reply.name}: ${error instanceof Error ? error.message : String(error)}`),
        }),
    })
    configurePageState({
        store,
        waiter: {
            committedMarkCount: getCommittedSaveMarkCount,
            markCount: getSaveMarkCount,
            verdict: characterCommitVerdict,
            afterNextCommit: afterNextSaveCommit,
            markCharacter: markCharacterForSave,
            requestSaveNow,
        },
        onUnreadable: reconciler.reportUnreadable,
    })
    setReconcileTrigger(() => { void reconciler.request() })
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            requestReconcile()
        }
    })
    requestReconcile()
}
