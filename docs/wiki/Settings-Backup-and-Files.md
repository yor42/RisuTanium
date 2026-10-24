# Settings: Backup & Files

Part of [[Settings]]. Open **Settings → Backup & Files**.

Fork difference: upstream calls this tab "Account & Files" and it has a Risu Account section
(sign in, account-sync toggle, logout). This fork has no account sign-in and no account-sync, so
that section is gone here — see [[Migrating from upstream]] if you're moving data from an
upstream install.

## Controls, in order

| Control | Does |
|---|---|
| **Save Backup Locally** | Always shown. Confirms ("Do you really want to save backup?"), then writes a full local `.bin` backup: all assets (Tauri: the appdata `assets/` folder; otherwise the active storage backend's keys), all cold-storage payloads, and the database — with any `account` field stripped. Ends with a markdown list of skipped/missing assets, or "Success". |
| **Save Partial Backup Locally (Excluding Character Assets)** | Always shown. An outer confirm plus two more confirms. Keeps the database plus profile/persona/folder/preset images and cold storage; excludes emotion images, additional assets, VITS voice files and character-card (CC) assets. |
| **Load Backup Locally** | Always shown. Two confirms ("Do you really want to load backup? All datas will be lost!", then "Do you really, really want to load backup? All datas will be lost!"), then restores from a `.bin` file you pick. See [Load Backup Locally](#load-backup-locally) below for the full restore behavior. |
| **Load Internal Backup** | Always shown, with a static label (no "server backup" variant — that's an upstream account-sync distinction this fork doesn't have). Same two confirms as above, then lists periodic auto-backups (named `dbbackup-<timestamp>`) found in Tauri's `database/` folder, or in the active storage backend on other builds; pick one to load it. Repairs ids, installs the restored database, and shows "Loaded backup". **This does not reload the app.** |
| **Clean Unused Cold Storage** | Always shown. Confirms with a permanent-delete warning, then clears cold-storage entries no longer referenced by any character. Refuses with an error if any character is currently frozen (a save is in flight). |
| **Export Save as Dataset** | Always shown. No confirm. Downloads a `dataset.json` with one `{name, description, chats, lorebook}` entry per saved chat of each non-group character (a character with three chats gives three entries). |
| **Asset Cache Integrity** panel | See [Asset Cache Integrity](#asset-cache-integrity) below. Hidden on the Tauri desktop build. |
| **Local Storage Backend** panel | See [Local Storage Backend (OPFS)](#local-storage-backend-opfs) below. Shown only on the web build, when your browser supports the APIs it needs. |

<!-- src/lib/Setting/Pages/UserSettings.svelte:12-61; src/ts/drive/backuplocal.ts:22-189; src/ts/process/coldstorage.svelte.ts:437-446; src/ts/storage/exportAsDataset.ts:1-29; src/ts/globalApi.svelte.ts:3141-3191; src/lang/en.ts:1771 -->

## Asset Cache Integrity

Shown when you're not on the Tauri desktop build (web and self-hosted Node-server builds both get
it).

- **"Warn on startup if a quick sample check finds corruption"** — a checkbox bound to
  `db.checkCorruption`, **off by default**. While it's on, every ordinary boot (non-Tauri) samples
  3 random, currently-referenced in-memory assets and verifies each of them (no cold-storage read).
  If any sample doesn't match, you get a non-blocking toast: "Possible asset corruption detected
  (${target}). Check Backup & Files → Asset Cache Integrity." This runs on every boot the box is
  ticked, not just once.
- **"Verify Asset Cache Now"** button — a separate, full manual scan with a progress indicator. It
  hashes every cached asset against its expected content hash, and if it finds mismatches, offers
  to remove them (with a confirm). It ends with a markdown report: counts of assets checked, not
  cached, not content-addressed, and mismatched, plus the eviction outcome if you removed any.

The checkbox (boot-time sample) and the button (full manual scan) are separate code paths that
happen to share this panel's heading.

<!-- src/lib/Setting/Pages/StorageMaintenanceSettings.svelte:19-28; src/ts/storage/storageMaintenance.ts:14-85; src/ts/bootstrap.ts:573-607 -->

## Local Storage Backend (OPFS)

Shown only when all of these hold: you're on the web build (not Tauri, not a self-hosted Node
server), and your browser supports OPFS, `FileSystemFileHandle.createWritable`, and the Web Locks
API (`navigator.locks`). If your browser is missing any of those, the panel doesn't appear at all.

Description shown on the page: "Experimental. OPFS has a stronger write-atomicity story than the
default IndexedDB backend. Switching reloads the app and migrates your existing local data
automatically."

The button reads **"Switch to OPFS storage (experimental)"** or **"Switch back to default
storage"** depending on which backend this tab is actually using right now, not on the saved
switch flag.

### Switching to OPFS

1. Confirm: "Switch local storage to OPFS (experimental) and reload the app? Your existing local
   data will be migrated automatically on reload."
2. A free-space check runs first: if the browser reports less free space than your current usage,
   you get a warning ("The switch may not have enough free space: about X MB in use, and about
   Y MB free. If it fails partway, you stay on your current storage with no data lost. Continue
   anyway?") that you can cancel out of. If the browser can't report an estimate, this check is
   silently skipped.
3. The switch takes an exclusive cross-tab lock (5-second timeout). If another tab already holds
   it, or your browser can't do the check, you get: "Another tab of this app appears to be open
   (or your browser does not support the check needed here). Close all other tabs first, then try
   again." — and nothing changes.
4. On success, the app reloads. The actual data copy happens on that next boot, not before the
   reload.

**On the boot after a successful switch request**, one of these outcomes shows as a single
blocking notice with an OK button (this is not shown on Tauri):

| Outcome | What you see | What happens to your data |
|---|---|---|
| Unsupported | "The storage backend was not switched: this browser does not support a feature the switch needs. Your data is unchanged, and you can switch again from Backup & Files in Settings." | Falls back to the default storage backend, unchanged. |
| Interrupted | "The storage backend was not switched: another tab was open, or a switch was interrupted. Your data is unchanged, and you can switch again from Backup & Files in Settings." | Same fallback. |
| Quota exceeded | "The storage backend was not switched: the browser ran out of storage space. Your data is unchanged, ..." | Same fallback; any partially-copied OPFS keys are removed on a best-effort basis. |
| Other error | "The storage backend was not switched: ${detail}. Your data is unchanged, ..." (detail is the raw error message) | Same fallback and cleanup as above. |
| Success | No notice. | You're now on OPFS. |

### Switching back to the default backend

Refused outright — "This tab isn't currently using OPFS storage, so there is nothing to switch
back from here." — unless the live backend on *this tab* is actually OPFS. Otherwise: confirm
("Switch local storage back to the default backend and reload the app? Your existing OPFS data
will be migrated automatically before reloading."), then the same exclusive-lock step and the same
lock-refusal message as above. On success it copies every OPFS key back into the default storage,
clears the OPFS migration bookkeeping (so a later switch to OPFS migrates fresh instead of
skipping already-copied keys), removes the OPFS flag, and reloads. On a copy failure, it releases
the lock and shows the error instead.

<!-- src/lib/Setting/Pages/StorageMaintenanceSettings.svelte:3-46; src/ts/storage/storageMaintenance.ts:106-191; src/ts/storage/autoStorage.ts:140-236; src/ts/bootstrap.ts:185-193 -->

## Restoring is refused while work is running

**Load Backup Locally** and **Load Internal Backup** refuse to run while any work is registered against a chat (a reply, auto mode, a command line, `/multisend`, a Post File job, a reroll) in any chat, or while the composer's one-action window is open (a send, reroll, undo reroll or auto mode). You see the error: "Something is still writing into a chat, so the backup was not loaded. Wait for it to finish or stop it, then try again. Reloading the page also ends all work."

When it is checked:

- **Both buttons:** when you click, before the two confirms.
- **Load Backup Locally:** again when the load starts, again after you pick a file, and once more just before the database is written. The last check comes after the file scan and after the other-tab check described below, so a send that starts while those are running still stops the restore.
- **Load Internal Backup:** at the start, and again right before the restored database is installed.

If the refusal comes at the last check of Load Backup Locally, the database is not written, but the assets and cold-storage entries that were already read from the file stay in storage (the same as for the other early exits of that restore). This refusal and the other-tab check are separate checks.

<!-- src/ts/drive/backupWorkGuard.ts:12-18; src/ts/process/chatOrigin.ts:1042-1044; src/lib/Setting/Pages/UserSettings.svelte:33-55; src/ts/drive/backuplocal.ts:385,400,448-457,628-635; src/ts/globalApi.svelte.ts:3146,3188; src/lang/en.ts:775 -->

## Load Backup Locally

1. Two confirms, as listed in the controls table above.
2. File picker (`.bin`); if you cancel without picking a file, nothing happens.
3. The app scans the file for the RisuAccount encryption marker, showing "Checking local
   backup... (NN.NN%)". If the file can't be read, you get "The file could not be read. Nothing
   was imported."
4. **If the marker is found**, the restore is refused: "This backup was saved on risuai.xyz, which
   encrypts its full backups so that only risuai.xyz can restore them. It cannot be read here.
   Nothing was imported. ..." with a link to the migration guide — see
   [[Migrating from upstream]]. Nothing is written in this case.
5. **Cross-tab guard** — skipped entirely on Tauri (a single instance, so there's nothing to guard
   against; no warning either way). On the web build:
   - If your browser doesn't support Web Locks (`navigator.locks`) — for example a plain-HTTP LAN
     address, or an older browser — the app can't check whether another tab is open. You get a
     confirm: "Your browser can't check whether another tab of this app is open before restoring.
     If another tab of this app is open, it can overwrite the data you're restoring with its own
     older data the next time it saves -- even if that tab has no unsaved changes of its own.
     Close every other tab of this app first, then continue. Continue anyway?" Cancel writes
     nothing; Continue restores without any tab check.
   - Otherwise, the app shows "Checking for other open tabs of this app before restoring..." while
     it tries for an exclusive lock (2 seconds). If it can't get the lock: "Another tab of this app
     appears to be open. Close every other tab of this app first, then try again. Nothing was
     restored." **Close every other tab of this app before restoring, or the restore is refused.**
6. The backup streams in, showing "Loading local Backup... (NN.NN%)"; assets and cold-storage
   entries are written to storage as they're read, before the restore is known to have fully
   succeeded.
   - If an encrypted part turns up partway through the stream, the import stops: "This backup
     contains an encrypted part and the import stopped. Some images or cold-storage entries may
     already have been added or replaced. Your current database was not changed."
   - If the file has no database entry at all: "Failed, Is file corrupted?"
7. If the backup has incomplete cold-storage data, you get one more confirm about that.
8. The restored database is repaired (ids) and written to `database.bin` under the write lock.
9. **On success**: the app shows a wait message, "Success, Refreshing your app." — there is no
   separate "Success" alert to dismiss — then reloads itself: on Tauri it relaunches the app; on
   the web build it drops the query string (keeping the hash) and reloads, with no "Leave site?"
   browser prompt, since the reload is app-initiated.
   - If the write succeeded but the app couldn't reload on its own: "Your backup was restored and
     saved, but the app could not reload automatically. Please reload the page (or restart the
     app) to finish."
10. **If writing the restored backup fails**: "The restored backup could not be saved. Some images
    or cold-storage entries may already have been added or replaced. Your current database was not
    changed."
11. **If the import fails before any write happens**: "Failed, Is file corrupted?"

Note: **Load Internal Backup** (in the controls table above) does not go through this streaming
restore path and does not reload the app on its own.

<!-- src/lib/Setting/Pages/UserSettings.svelte:32-48; src/ts/drive/backuplocal.ts; src/ts/storage/storageTabLocks.ts:120-171,283-436 -->
