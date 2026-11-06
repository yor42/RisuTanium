# Settings: Backup & Files

This page belongs to [[Settings]]. To open it, go to **Settings → Backup & Files**.

Fork difference: Upstream calls this tab "Account & Files". It has a Risu Account section with sign-in, an account-sync toggle, and a logout. This fork has no account sign-in and no account sync. So that section is gone. To move data from an upstream install, see [[Migrating from upstream]].

## Controls, in order

| Control | What it does |
|---|---|
| **Save Backup Locally** | The page always shows it. The app asks you to accept ("Do you really want to save backup?"). Then it writes a full local `.bin` backup. The backup holds all assets, all cold-storage payloads, and the database. The app strips any `account` field. Assets come from the appdata `assets/` folder on Tauri, and from the keys of the active storage backend on other builds. The process ends with a Markdown list of skipped or missing assets, or with "Success". |
| **Save Partial Backup Locally (Excluding Character Assets)** | The page always shows it. The app asks one outer confirm and two more confirms. The backup keeps the database, the images of profiles, personas, folders, and presets, and cold storage. It excludes emotion images, additional assets, VITS voice files, and character-card (CC) assets. |
| **Load Backup Locally** | The page always shows it. The app asks two confirms ("Do you really want to load backup? All datas will be lost!", then "Do you really, really want to load backup? All datas will be lost!"). Then it restores from a `.bin` file that you pick. For the full restore behavior, see [Load Backup Locally](#load-backup-locally) below. |
| **Load Internal Backup** | The page always shows it, with a static label. There is no "server backup" variant. That is an upstream account-sync distinction that this fork does not have. The app asks the same two confirms as above. Then it lists the periodic auto-backups (named `dbbackup-<timestamp>`). It finds them in the `database/` folder of Tauri, or in the active storage backend on other builds. Pick one to load it. The app repairs ids, installs the restored database, and shows "Loaded backup". **This does not reload the app.** |
| **Clean Unused Cold Storage** | The page always shows it. The app asks you to accept, with a warning that the deletion is permanent. Then it clears the cold-storage entries that no character references any more. It refuses with an error if any character is frozen now (a save is in progress). |
| **Export Save as Dataset** | The page always shows it. It asks no confirm. It downloads a `dataset.json`. The file has one `{name, description, chats, lorebook}` entry for each saved chat of each character that is not a group. A character with three chats gives three entries. |
| **Asset Cache Integrity** panel | See [Asset Cache Integrity](#asset-cache-integrity) below. The Tauri desktop build hides it. |
| **Local Storage Backend** panel | See [Local Storage Backend (OPFS)](#local-storage-backend-opfs) below. The page shows it only on the web build, when your browser supports the APIs that it needs. |

<!-- src/lib/Setting/Pages/UserSettings.svelte:12-61; src/ts/drive/backuplocal.ts:22-189; src/ts/process/coldstorage.svelte.ts:437-446; src/ts/storage/exportAsDataset.ts:1-29; src/ts/globalApi.svelte.ts:3141-3191; src/lang/en.ts:1771 -->

## Asset Cache Integrity

The page shows this panel when you are not on the Tauri desktop build. Both the web build and the self-hosted Node-server builds get it.

- **"Warn on startup if a quick sample check finds corruption"**: A checkbox bound to `db.checkCorruption`. It is **off by default**. While it is on, every ordinary boot (non-Tauri) samples 3 random assets that are referenced now and are in memory. The check verifies each of them. It does not read cold storage. If any sample does not match, you get a toast that does not block you: "Possible asset corruption detected (${target}). Check Backup & Files → Asset Cache Integrity." This runs on every boot while the box is ticked, not only one time.
- **"Verify Asset Cache Now"** button: A separate, full manual scan with a progress indicator. It hashes every cached asset against its expected content hash. If it finds mismatches, it offers to remove them, and you must accept. It ends with a Markdown report. The report counts the assets that the scan checked, the assets that are not cached, the assets that are not content-addressed, and the assets that mismatched. If you removed any assets, the report also shows the outcome of the eviction.

The checkbox (the sample at boot) and the button (the full manual scan) are separate code paths. They only share the heading of this panel.

<!-- src/lib/Setting/Pages/StorageMaintenanceSettings.svelte:19-28; src/ts/storage/storageMaintenance.ts:14-85; src/ts/bootstrap.ts:573-607 -->

## Local Storage Backend (OPFS)

The page shows this panel only when all of these conditions hold. You are on the web build (not Tauri, and not a self-hosted Node server). Your browser supports OPFS, `FileSystemFileHandle.createWritable`, and the Web Locks API (`navigator.locks`). If your browser lacks any of these, the panel does not appear at all.

The page shows this description: "Experimental. OPFS has a stronger write-atomicity story than the default IndexedDB backend. Switching reloads the app and migrates your existing local data automatically."

The button reads **"Switch to OPFS storage (experimental)"** or **"Switch back to default storage"**. Which one it reads depends on the backend that this tab uses right now. It does not depend on the saved switch flag.

### Switching to OPFS

1. The app asks you to accept: "Switch local storage to OPFS (experimental) and reload the app? Your existing local data will be migrated automatically on reload."
2. A check of free space runs first. Suppose the browser reports less free space than your current usage. Then you get a warning that you can cancel: "The switch may not have enough free space: about X MB in use, and about Y MB free. If it fails partway, you stay on your current storage with no data lost. Continue anyway?" If the browser cannot report an estimate, the app silently skips this check.
3. The switch takes an exclusive lock across tabs (timeout of 5 seconds). Suppose another tab already holds the lock, or your browser cannot do the check. Then you get this message, and nothing changes: "Another tab of this app appears to be open (or your browser does not support the check needed here). Close all other tabs first, then try again."
4. If the switch succeeds, the app reloads. The data copy happens on that next boot, not before the reload.

**On the boot after a successful switch request**, one of these outcomes shows as a single notice that blocks you, with an OK button. The notice does not show on Tauri:

| Outcome | What you see | What happens to your data |
|---|---|---|
| Unsupported | "The storage backend was not switched: this browser does not support a feature the switch needs. Your data is unchanged, and you can switch again from Backup & Files in Settings." | The app falls back to the default storage backend, unchanged. |
| Interrupted | "The storage backend was not switched: another tab was open, or a switch was interrupted. Your data is unchanged, and you can switch again from Backup & Files in Settings." | The same fallback. |
| Quota exceeded | "The storage backend was not switched: the browser ran out of storage space. Your data is unchanged, ..." | The same fallback. The app removes any partially copied OPFS keys on a best-effort basis. |
| Other error | "The storage backend was not switched: ${detail}. Your data is unchanged, ..." (detail is the raw error message) | The same fallback and cleanup as above. |
| Success | No notice. | You are on OPFS now. |

### Switching back to the default backend

The app refuses outright with this message: "This tab isn't currently using OPFS storage, so there is nothing to switch back from here." This happens unless the live backend on *this tab* is actually OPFS. Otherwise, the app asks you to accept: "Switch local storage back to the default backend and reload the app? Your existing OPFS data will be migrated automatically before reloading." Then the same exclusive-lock step follows, with the same lock-refusal message as above. If the switch succeeds, the app does these things:
- It copies every OPFS key back into the default storage.
- It clears the bookkeeping of the OPFS migration. So a later switch to OPFS migrates fresh, and does not skip keys that are already copied.
- It removes the OPFS flag.
- It reloads.

If the copy fails, the app releases the lock and shows the error instead.

<!-- src/lib/Setting/Pages/StorageMaintenanceSettings.svelte:3-46; src/ts/storage/storageMaintenance.ts:106-191; src/ts/storage/autoStorage.ts:140-236; src/ts/bootstrap.ts:185-193 -->

## Restoring is refused while work is running

**Load Backup Locally** and **Load Internal Backup** refuse to run in two cases. In the first case, any work is registered against a chat in any chat. This work is a reply, an auto mode, a command line, `/multisend`, a Post File job, or a reroll. In the second case, the one-action window of the composer is open. This is a send, reroll, undo reroll, or auto mode. You see this error: "Something is still writing into a chat, so the backup was not loaded. Wait for it to finish or stop it, then try again. Reloading the page also ends all work."

The app checks at these times:

- **Both buttons:** When you click, before the two confirms.
- **Load Backup Locally:** Again when the load starts, again after you pick a file, and once more just before the app writes the database. The last check comes after the file scan and after the check for other tabs (described below). So a send that starts while those run still stops the restore.
- **Load Internal Backup:** At the start, and again right before the app installs the restored database.

Suppose the refusal comes at the last check of Load Backup Locally. Then the app does not write the database. But the assets and cold-storage entries that the app already read from the file stay in storage. This is the same as for the other early exits of that restore. This refusal and the check for other tabs are separate checks.

<!-- src/ts/drive/backupWorkGuard.ts:12-18; src/ts/process/chatOrigin.ts:1042-1044; src/lib/Setting/Pages/UserSettings.svelte:33-55; src/ts/drive/backuplocal.ts:385,400,448-457,628-635; src/ts/globalApi.svelte.ts:3146,3188; src/lang/en.ts:775 -->

## Load Backup Locally

1. You get two confirms, as the controls table above lists them.
2. A file picker (`.bin`) opens. If you cancel without a file, nothing happens.
3. The app scans the file for the RisuAccount encryption marker. It shows "Checking local backup... (NN.NN%)". If the app cannot read the file, you get "The file could not be read. Nothing was imported."
4. **If the app finds the marker**, it refuses the restore: "This backup was saved on risuai.xyz, which encrypts its full backups so that only risuai.xyz can restore them. It cannot be read here. Nothing was imported. ..." The message has a link to the migration guide. See [[Migrating from upstream]]. In this case, the app writes nothing.
5. **Guard across tabs**: The app skips it entirely on Tauri. Tauri has a single instance, so there is nothing to guard against, and the app gives no warning either way. On the web build:
   - Suppose your browser does not support Web Locks (`navigator.locks`). Examples are a plain-HTTP LAN address and an older browser. Then the app cannot check whether another tab is open. You get a confirm: "Your browser can't check whether another tab of this app is open before restoring. If another tab of this app is open, it can overwrite the data you're restoring with its own older data the next time it saves -- even if that tab has no unsaved changes of its own. Close every other tab of this app first, then continue. Continue anyway?" Cancel writes nothing. Continue restores without any check of tabs.
   - Otherwise, the app shows "Checking for other open tabs of this app before restoring..." while it tries to get an exclusive lock (2 seconds). If it cannot get the lock, you get this message: "Another tab of this app appears to be open. Close every other tab of this app first, then try again. Nothing was restored." **Close every other tab of this app before you restore. Otherwise the app refuses the restore.**
6. The backup streams in. The app shows "Loading local Backup... (NN.NN%)". The app writes assets and cold-storage entries to storage as it reads them. This happens before the app knows that the restore fully succeeded.
   - If an encrypted part turns up partway through the stream, the import stops: "This backup contains an encrypted part and the import stopped. Some images or cold-storage entries may already have been added or replaced. Your current database was not changed."
   - If the file has no database entry at all, you get: "Failed, Is file corrupted?"
7. If the backup has incomplete cold-storage data, you get one more confirm about that.
8. The app repairs the ids of the restored database and writes it to `database.bin` under the write lock.
9. **On success**: The app shows a wait message, "Success, Refreshing your app." There is no separate "Success" alert to dismiss. Then the app reloads itself. On Tauri, it relaunches the app. On the web build, it drops the query string (and keeps the hash) and reloads. The browser shows no "Leave site?" prompt, because the app starts the reload.
   - Suppose the write succeeded, but the app could not reload on its own. Then you get: "Your backup was restored and saved, but the app could not reload automatically. Please reload the page (or restart the app) to finish."
10. **If the write of the restored backup fails**, you get: "The restored backup could not be saved. Some images or cold-storage entries may already have been added or replaced. Your current database was not changed."
11. **If the import fails before any write happens**, you get: "Failed, Is file corrupted?"

Note: **Load Internal Backup** (in the controls table above) does not go through this streaming restore path. It does not reload the app on its own.

<!-- src/lib/Setting/Pages/UserSettings.svelte:32-48; src/ts/drive/backuplocal.ts; src/ts/storage/storageTabLocks.ts:120-171,283-436 -->
