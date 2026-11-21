# Settings: Backup & Files

This page belongs to [[Settings]]. To open it, go to **Settings → Backup & Files**.

Fork difference: Upstream calls this tab "Account & Files". It has a Risu Account section with sign-in, an account-sync toggle, and a logout. This fork has no account sign-in and no account sync. So that section is gone. To move data from an upstream install, see [[Migrating from upstream]].

## Controls, in order

| Control | What it does |
|---|---|
| **Save Backup Locally** | The page always shows it. The app asks you to accept ("Do you really want to save backup?"). Then it writes a full local `.bin` backup. The backup holds all assets, all cold-storage payloads, and the database. The app strips any `account` field. Assets come from the appdata `assets/` folder on Tauri, and from the keys of the Node server storage on other builds. The process ends with a Markdown list of skipped or missing assets, or with "Success". |
| **Save Partial Backup Locally (Excluding Character Assets)** | The page always shows it. The app asks one outer confirm and two more confirms. The backup keeps the database, the images of profiles, personas, folders, and presets, and cold storage. It excludes emotion images, additional assets, VITS voice files, and character-card (CC) assets. |
| **Load Backup Locally** | The page always shows it. The app asks two confirms ("Do you really want to load backup? All datas will be lost!", then "Do you really, really want to load backup? All datas will be lost!"). Then it restores from a `.bin` file that you pick. For the full restore behavior, see [Load Backup Locally](#load-backup-locally) below. |
| **Load Internal Backup** | The page always shows it, with a static label. There is no "server backup" variant. That is an upstream account-sync distinction that this fork does not have. The app asks the same two confirms as above. Then it lists the periodic auto-backups (named `dbbackup-<timestamp>`). It finds them in the `database/` folder of Tauri, or in the Node server storage on other builds. Pick one to load it. The app repairs ids, installs the restored database, and shows "Loaded backup". **This does not reload the app.** |
| **Clean Unused Cold Storage** | The page always shows it. The app asks you to accept, with a warning that the deletion is permanent. Then it clears the cold-storage entries that no character references any more. It refuses with an error if any character is frozen now (a save is in progress). |
| **Export Save as Dataset** | The page always shows it. It asks no confirm. It downloads a `dataset.json`. The file has one `{name, description, chats, lorebook}` entry for each saved chat of each character that is not a group. A character with three chats gives three entries. |

<!-- src/lib/Setting/Pages/UserSettings.svelte:12-61; src/ts/drive/backuplocal.ts:22-189; src/ts/process/coldstorage.svelte.ts:437-446; src/ts/storage/exportAsDataset.ts:1-29; src/ts/globalApi.svelte.ts:3141-3191; src/lang/en.ts:1771 -->

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
3. The app scans the file for the RisuAccount encryption marker. It shows "Checking the backup... (NN%)". If the app cannot read the file, you get "The file could not be read. Nothing was imported."
4. **If the app finds the marker**, it refuses the restore: "This backup was saved on risuai.xyz, which encrypts its full backups so that only risuai.xyz can restore them. It cannot be read here. Nothing was imported. ..." The message has a link to the migration guide. See [[Migrating from upstream]]. In this case, the app writes nothing.
5. **Guard across tabs**: The app skips it entirely on Tauri. Tauri has a single instance, so there is nothing to guard against, and the app gives no warning either way. On the web build:
   - Suppose your browser does not support Web Locks (`navigator.locks`). Examples are a plain-HTTP LAN address and an older browser. Then the app cannot check whether another tab is open. You get a confirm: "Your browser can't check whether another tab of this app is open before restoring. If another tab of this app is open, it can overwrite the data you're restoring with its own older data the next time it saves -- even if that tab has no unsaved changes of its own. Close every other tab of this app first, then continue. Continue anyway?" Cancel writes nothing. Continue restores without any check of tabs.
   - Otherwise, the app shows "Checking for other open tabs of this app before restoring..." while it tries to get an exclusive lock (2 seconds). If it cannot get the lock, you get this message: "Another tab of this app appears to be open. Close every other tab of this app first, then try again. Nothing was restored." **Close every other tab of this app before you restore. Otherwise the app refuses the restore.**
6. The backup streams in. The app shows "Restoring the backup... (NN%)". The app writes assets and cold-storage entries to storage as it reads them. This happens before the app knows that the restore fully succeeded.
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
