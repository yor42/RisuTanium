# Migrating from Upstream RisuAI

> **The authors wrote this page from the removal plan and from the source of the app. They did not test it against a running build with a real RisuAccount.** Nobody who works on this fork has an account-sync backup to test with. So the routes below are unverified. This is most true for the route with the encrypted backup. If a step here does not match what you see, the page is more likely wrong than your data.

## What this fork does not have

This fork has no RisuAccount sign-in. It does not sync your data to the cloud service of RisuAccount. There is no login screen for it, and no on/off switch to turn sync back on. Google Drive backup is also gone. If you want RisuAccount sign-in, sync, or Drive backup, use upstream RisuAI.

This does **not** affect RisuRealm. You can still browse, download, and anonymously upload to RisuRealm without a sign-in to RisuAccount. RisuRealm is the only service of upstream that this fork still uses.

The first time you use Realm, this fork asks you to accept the Terms of Service and the Privacy Policy of upstream RisuAI. Realm is a service that upstream operates, not this app. If you already accepted them in upstream RisuAI itself, that acceptance does not carry over. This fork asks again the first time.

## The normal route: a `.bin` local backup

For almost everyone, migration works like a move between any two RisuAI installs. On upstream, go to **Settings → Account & Files → Save Backup Locally** to make a `.bin` file. In this fork, the same tab is **Settings → Backup & Files → Load Backup Locally**. Import the file the same way as on upstream. This works whether or not you used RisuAccount sync, if the backup is not encrypted (see the next section).

When you import, keep in mind how the restore of this fork behaves:

- **Close every other tab of this app first.** If your browser supports the check that the restore needs, the app refuses the restore while another tab of the app is open. If your browser cannot do that check, you get a warning before the restore proceeds. A plain-HTTP LAN address and an older browser are two examples. Read the warning. A second tab that is open can silently overwrite the restored data the next time that tab saves.
- If the restore succeeds, the app reloads by itself. On the Tauri desktop build, the app relaunches by itself. You do not need to do anything else to finish.

## If your backup is encrypted

Since upstream commit `dae3f6509` (2026-10-14), upstream encrypts every full backup that you save on its own site (`risuai.xyz`). It does so whether or not you are signed in to RisuAccount. This fork cannot read that kind of `.bin` file. If you try to import one, the app shows a message. The message says that it cannot read the file, for technical reasons. The app imports nothing: no assets, no cold storage, and no database changes.

This affects only a full backup that you **saved on `risuai.xyz`**. A backup from a self-hosted or locally run upstream instance, including the desktop app, is not encrypted this way. It imports normally. A logout from account sync before you save on `risuai.xyz` does not help any more, because the file is still encrypted.

Upstream issue kwaroran/Risuai#1681 (open, 2026-10-22) reports that you can restore these backups only on `risuai.xyz` itself. The RisuAI desktop app and a self-hosted Node server cannot restore them either. A related upstream issue is #1641. Now there is no way to move your full data, with its images, off `risuai.xyz`.

The reason is deliberate. It is not a bug that the authors will fix later. To read that kind of file, the app must depend on an endpoint that the own servers of RisuAccount control. This fork cannot make sure that the endpoint is safe, and it cannot rely on it. Upstream has one alternative. The next section describes it.

## What you can do on upstream instead

If the app refused your backup, upstream offers one way to get part of your data out:

- On `risuai.xyz`, use **Save Partial Backup Locally (Excluding Character Assets)**. This is the label of the button. The backup is not encrypted. It keeps every chat, including the cold-storage chat bodies. It keeps character, group, and persona profile images, your user icon, your background, and folder and preset images. It drops everything else: emotion images, additional character assets, and VITS voice files.

This route loses the images that it drops. Per upstream issue #1681, it does not work to load the encrypted full backup into the desktop app or a self-hosted copy and save it again there. This fork does not decrypt the file itself.

For each import here, close every other tab of this app first. The tab check and the automatic reload that the normal route above describes apply here too.

The authors read this route from the code and from the source of upstream. They did not run it end to end. Nobody who maintains this fork has an encrypted `risuai.xyz` backup to test it against. If you try it, treat your original data on `risuai.xyz` as the source of truth until you check the result.

## Self-hosted or local upstream: do not lose your images

Your upstream install can be self-hosted or run locally (not `risuai.xyz`), and you can use account sync there. In that case, a plain **Save Backup Locally** can silently leave your images out. Upstream has a setting that is **on by default**. It is hidden unless **Show Unrecommended Settings** is on. While account sync is active, the setting skips the writing of image assets into a local backup.

Before you make the backup, go to **Settings → Advanced Settings** in upstream:

1. Turn on **Show Unrecommended Settings**.
2. Untick **Skip Saving Assets on Web Sync**.

Then make your backup. If you skip this step, the backup that you make misses images, and the app gives no warning at that time.

**Do this before you replace the upstream install with this fork**, if you upgrade in place (the same server folder or Docker volume). After you switch to this fork, no RisuAccount sign-in is left to make a fresh backup from. The `.bin` that you make beforehand, while upstream still runs, carries your data over.

## In-place upgrades: the stale-profile notice

You can also migrate in another way. Swap a self-hosted upstream install for this fork on the same origin, and keep the same `save/` folder or Docker volume. This route is supported next to the `.bin` import above.

Suppose that account sync was on for that origin. The storage layer of this fork detects that at startup. When you turn sync on, upstream freezes the data that was there just before sync started. That data is in the local storage of your browser, in OPFS, or in the `save/` folder of the Node server, depending on which one was active at the time. While sync stays on, upstream never updates that data again. After the switch to this fork, you see that frozen data, and nothing tells you that it is out of date.

Instead, this fork shows a notice on boot. The notice says three things:
- This browser profile used RisuAccount sync, which this app does not support.
- What you are about to see is the data stored here from before you turned sync on.
- Other browsers or devices can hold newer changes to your data.

If you can be missing something that your account has, the notice tells you to make a local backup of the data before you import anything else over it. The notice also repeats that you must sign in to an upstream RisuAI and make a `.bin` backup there to bring the current data of your account here. See the sections above.

**When you press OK, the app reloads.** The app does not go past this notice on its own. It waits for you. The notice and the OK button do not touch your chat data. OK only clears the sync-related flags on this browser profile. Then the app reloads, so that it boots normally afterward.

## Self-hosted Node servers: a logout can move your data into the browser

The own logout of upstream has a specific quirk that existed before this fork. It matters if your self-hosted install uses the Node server backend. That backend is the `save/` folder on disk, not the own storage of the browser. The quirk happens on upstream, before you touch this fork. This fork does not cause it.

The account-sync "logout" of upstream always writes the data that it un-syncs into the plain local storage of the browser. It does this even when the actual backend of the deployment is the Node server or OPFS, not browser storage. So on a Node-server deployment, a logout from RisuAccount on upstream can leave your current data in the local storage of that browser. The `save/` folder of the server stays at the state from before sync started. The two places can disagree, and upstream does not reconcile them for you. If this happens to you, look at both places on upstream. Then decide which one to use for your migration backup.

## `risuaiAccountCached` and other leftover account-sync keys

If you used account sync or Google Drive backup on this origin, upstream can have left a few storage keys behind:
- A LocalForage database called `risuaiAccountCached` (account sync).
- The localStorage keys `risu_lastsaved` and `backup` (the bookkeeping of Drive backup). `backup` counts only when its value is exactly `save` or `load`.

This fork clears all three at every ordinary boot, on the web build and on the desktop app. On the web build, it also clears the account-sync flags `dosync` and `fallbackRisuToken`. The cleanup is best-effort. It never blocks or fails the boot. There is no recovery step. The app drops whatever was in `risuaiAccountCached`. It does not read or migrate the content first. If you need what is in it, use the routes above to get your data out of an upstream install before this fork clears it.
