# Migrating from Upstream RisuAI

> **This page is written from the removal plan and the app's source, not tested against a
> running build with a real RisuAccount.** Nobody working on this fork has an account-sync
> backup to test with, so the routes below — especially the encrypted-backup route — are unverified. If
> a step here does not match what you actually see, that is more likely to be this page than
> your data.

## What this fork does not have

This fork does not have RisuAccount sign-in, and does not sync your data to RisuAccount's cloud
service. There is no login screen for it, and no "on/off" switch to turn sync back on. Google
Drive backup is also gone. If you want RisuAccount sign-in, sync, or Drive backup, use upstream
RisuAI.

This does **not** affect RisuRealm — you can still browse, download and anonymously upload to
RisuRealm without signing in to RisuAccount. RisuRealm is the only one of upstream's services this
fork still uses.

The first time you use Realm, this fork asks you to accept upstream RisuAI's Terms of Service and
Privacy Policy, since Realm is a service upstream operates, not this app. An acceptance you already
gave in upstream RisuAI itself does not carry over; this fork asks again, the first time.

## The normal route: a `.bin` local backup

For almost everyone, migrating is the same as moving between any two RisuAI installs: on
upstream, use **Settings → Account & Files → Save Backup Locally** to make a `.bin` file. Here,
that same tab is **Settings → Backup & Files → Load Backup Locally** — import the file the same
way you would on upstream. This works whether or not you ever used RisuAccount sync, as long as
the backup itself is not encrypted (see the next section).

When you import, keep in mind how this fork's restore behaves:

- **Close every other tab of this app first.** If your browser supports the check needed here,
  the restore is refused outright while another tab of the app is open. If your browser can't do
  that check (for example a plain-HTTP LAN address, or an older browser), you instead get a
  warning before the restore proceeds — read it, since an open second tab can silently overwrite
  what you just restored the next time it saves.
- On success, the app reloads (or, on the Tauri desktop build, relaunches) by itself. You don't
  need to do anything else to finish.

## If your backup is encrypted

Since upstream commit `dae3f6509` (2026-10-14), every full backup saved on upstream's own site
(`risuai.xyz`) is encrypted, whether or not you are signed in to RisuAccount. This fork cannot
read that kind of `.bin` file. Trying to import one shows a message telling you it cannot be read,
for technical reasons, and nothing is imported — no assets, no cold storage, no database changes.

This only affects a full backup **saved on `risuai.xyz`**. A backup saved from a self-hosted or
locally run upstream instance (including the desktop app) is not encrypted this way and imports
normally. Logging out of account sync before saving on `risuai.xyz` no longer helps: the file is
still encrypted.

Upstream issue kwaroran/Risuai#1681 (open, 2026-10-22) reports that these backups can only be
restored on `risuai.xyz` itself: the RisuAI desktop app and a self-hosted Node server cannot
restore them either (related upstream issue: #1641). There is currently no way to move your full
data, with its images, off `risuai.xyz`.

The reason is deliberate, not a bug to be fixed later: reading that kind of file would depend on
an endpoint RisuAccount's own servers control, which this fork cannot verify or rely on. One upstream
alternative exists, described below.

## What you can do on upstream instead

If your backup was refused, upstream offers one way to get part of your data out:

- On `risuai.xyz`, **Save Partial Backup Locally (Excluding Character Assets)** (the button's
  own label). It is not encrypted, and it keeps every chat, including cold-storage chat bodies.
  It keeps character, group and persona profile images, your user icon, your background, and
  folder and preset images. It drops everything else — emotion images, additional character
  assets and VITS voice files.

This route loses the images it drops. Loading the encrypted full backup into the desktop app or a
self-hosted copy and saving it again there does not work, per upstream issue #1681. This fork does
not decrypt the file itself.

For each import here, close every other tab of this app first — see the restore behavior noted in
the normal route above; the same tab-check and automatic-reload behavior applies.

This route is read from the code and upstream's source, not run end to end — nobody
maintaining this fork has an encrypted `risuai.xyz` backup to test it against. If you try it,
treat your original data on `risuai.xyz` as the source of truth until you have checked the result.

## Self-hosted or local upstream: don't lose your images

If your upstream install is self-hosted or run locally (not `risuai.xyz`) and you used account
sync there, a plain **Save Backup Locally** can silently leave your images out. Upstream has a
setting, **on by default** and hidden unless **Show Unrecommended Settings** is on, that skips
writing image assets into a local backup while account-sync is active.

Before making the backup, in upstream's **Settings → Advanced Settings**:

1. Turn on **Show Unrecommended Settings**.
2. Untick **Skip Saving Assets on Web Sync**.

Then make your backup. Skipping this step means the backup you make will be missing images, with
no warning at the time.

**Do this before you replace the upstream install with this fork**, if you are upgrading in
place (the same server folder or Docker volume). Once you switch to this fork, there is no
RisuAccount sign-in left to make a fresh backup from — the `.bin` you make beforehand, while
upstream is still running, is what carries your data over.

## In-place upgrades: the stale-profile notice

You can also migrate by swapping a self-hosted upstream install for this fork on the same
origin, keeping the same `save/` folder or Docker volume. This is a supported route alongside the
`.bin` import above.

If that origin previously had account sync turned on, this fork's storage layer detects it at
startup. Turning sync on, upstream, freezes whatever data was there just before sync started —
your browser's local storage, OPFS, or the Node server's `save/` folder, depending on which one
was active at the time — and never updates it again while sync stays on. After the switch to this
fork, that is the data you would otherwise see, silently, with no sign it is out of date.

Instead, this fork shows a notice on boot: this browser profile used RisuAccount sync, which this
app does not support; what you are about to see is the data stored here from before sync was
turned on, and other browsers or devices may have changed your data since then. If what you see
might be missing something your account has, the notice tells you to make a local backup of it
before importing anything else over it. It also repeats that bringing your account's current data
here means signing in to an upstream RisuAI and making a `.bin` backup there, per the sections
above.

**Pressing OK reloads the app.** The app does not proceed past this notice on its own — it waits
for you. Your chat data is not touched by seeing the notice or pressing OK: pressing OK only
clears the sync-related flags on this browser profile, then reloads the app so it boots normally
afterward.

## Self-hosted Node servers: a logout can move your data into the browser

There is a specific, pre-existing quirk in **upstream's own logout**, worth knowing about if your
self-hosted install uses the Node server backend (the `save/` folder on disk, not the browser's
own storage). This happens on upstream, before you ever touch this fork — it is not something
this fork does.

Upstream's account-sync "logout" always writes the data it is un-syncing into the browser's own
plain local storage — even when the deployment's actual backend is the Node server or OPFS, not
browser storage at all. So on a Node-server deployment, logging out of RisuAccount on upstream can
leave your current data sitting in that browser's local storage, while the server's `save/` folder
stays at whatever it was before sync started. The two can disagree, and upstream does not
reconcile them for you. If you hit this, check both places on upstream before deciding which one
to make your migration backup from.

## `risuaiAccountCached` and other leftover account-sync keys

If you ever used account sync or Google Drive backup on this origin, upstream may have left a few
storage keys behind: a LocalForage database called `risuaiAccountCached` (account sync), and the
localStorage keys `risu_lastsaved` and `backup` (Drive backup's bookkeeping; `backup` only when its
value is exactly `save` or `load`). This fork clears all three at every ordinary boot, on the web
build and the desktop app alike. On the web build it also clears the account-sync flags `dosync`
and `fallbackRisuToken`. The cleanup is best-effort and never blocks or fails the boot. There is no recovery step: whatever was in `risuaiAccountCached` is simply dropped, not read
or migrated first. If you need what's in it, get your data out of an upstream install using the
routes above before you let this fork clear it.
