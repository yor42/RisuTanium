# Android notification / system-surface docs: verified findings

Research date: 2026-10-25. Read-only web research, no device access. Sources are official (developer.android.com, AOSP googlesource, samsung.com support). Quotes are under 15 words; everything else is paraphrase.
Confidence: H = read on the cited page; M = secondary or search-summary support of an official page, or inferred from page; L = not directly verified.

App context: minSdk 24, target/compile 36, FGS type dataSync, channel IMPORTANCE_LOW, ongoing, silent, CATEGORY_SERVICE, FOREGROUND_SERVICE_IMMEDIATE, one Stop action, content intent.

## 1. Android 16 Live Updates / promoted ongoing notifications

Primary page: https://developer.android.com/develop/ui/views/notifications/live-update

| Fact | URL | Conf. |
|---|---|---|
| Qualifying styles: standard style, BigTextStyle, CallStyle, ProgressStyle, MetricStyle. ProgressStyle is not mandatory. | live-update (above) | H |
| Manifest permission `android.permission.POST_PROMOTED_NOTIFICATIONS`, non-runtime. | live-update | H |
| Request via `EXTRA_REQUEST_PROMOTED_ONGOING` or `NotificationCompat.Builder#setRequestPromotedOngoing`. Must be `setOngoing(true)` and have a `contentTitle`. | live-update | H |
| Disqualifiers: any custom content view/RemoteViews ("Must NOT have any customContentView set"), group summary, `setColorized(true)`, channel IMPORTANCE_MIN. | live-update | H |
| `FLAG_PROMOTED_ONGOING` is set by the system, apps cannot set it directly (the posting app can read it). | https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/app/Notification.java | H |
| Checks: `Notification.hasPromotableCharacteristics()` (ignores user settings); `NotificationManager.canPostPromotedNotifications()` (user setting); `Settings.ACTION_MANAGE_APP_PROMOTED_NOTIFICATIONS` opens the settings screen. | live-update | H |
| OEMs may enforce extra criteria. | live-update | H |
| Allowed: ongoing, user-initiated, time-sensitive activity with a distinct start and end (navigation, calls, rideshare, food delivery). Forbidden: ads, promotions, chat messages, alerts, upcoming calendar events, quick access to app features, ambient or third-party-triggered info. Package tracking is called out as not time-sensitive. | live-update | H |
| "AI generation in progress" is not named in either list. It is plausibly user-initiated, ongoing and start-to-end, but "requires attention throughout" is doubtful for a chat reply. Eligibility is a judgment call. Not found in official docs. | live-update | L (inference) |
| Users can demote/dismiss a Live Update and can disable Live Updates per app. Posting unwanted ones "might cause users to revoke an app's posting permission". Do not repost dismissed ones; use `setDeleteIntent`. | live-update | H |
| Appearance: expanded by default, uncollapsible. | live-update | H |
| Status-bar chip: max width 96dp, always shows the icon, text optional. Text under 7 characters is shown whole; if less than half fits, only the icon shows. Use `setShortCriticalText` or `setWhen` for state. | live-update | H |
| `setShortCriticalText`: added API 36; docs suggest about 7 characters, no display guarantee; it takes precedence over other chip sources. Empty string = icon only. | search summary of https://developer.android.com/reference/android/app/Notification.Builder (reference page too large to fetch directly) | M |
| Chip time: `setWhen` at least 2 minutes in the future counts down; past `when` shows no text; `setUsesChronometer` shows a timer while positive. | live-update | H |
| Indeterminate state for the chip: shows the small icon. For unknown ETAs, use placeholder text such as "Thinking..." instead of an empty state. | live-update | H |
| Does an indeterminate ProgressStyle qualify? ProgressStyle docs never discuss indeterminate. Qualification depends on the generic criteria (ongoing, title, no custom view, etc.), not on determinate progress. A non-ProgressStyle (standard or BigTextStyle) ongoing notification can also qualify. Not found in official docs as an explicit answer. | https://developer.android.com/develop/ui/views/notifications/progress-centric (Compose) and https://developer.android.com/about/versions/16/features/progress-centric-notifications | L |
| androidx: `NotificationCompat.ProgressStyle` and `setRequestPromotedOngoing()` added in androidx.core 1.17.0-alpha01. `setShortCriticalText` in NotificationCompat is in 1.17.0 (search summary). | https://developer.android.com/jetpack/androidx/releases/core | H / M |
| Android 16 feature page frames ProgressStyle use cases as rideshare, delivery, navigation; sample is platform-samples "live-updates". | https://developer.android.com/about/versions/16/features/progress-centric-notifications | H |

Design implication: current notification (standard template, no custom view, ongoing, title set) is structurally promotable; only a title and `setRequestPromotedOngoing(true)` away. Any custom RemoteViews design would forfeit promotion. Policy fit for chat generation is uncertain; promotion is user-revocable.

## 2. Samsung Now Bar / Live Notifications (One UI 7/8)

| Fact | URL | Conf. |
|---|---|---|
| Now bar requires One UI 7.0+ on Android 15 and a screen lock; live notifications show on lock screen, status bar and notification panel; per-category switches under Settings > Lock screen and AOD > Now bar. | https://www.samsung.com/us/support/answer/ANS10004605/ | H |
| Samsung's page does not name third-party apps and states no developer API/allowlist. | same | H |
| One UI 8 Now Bar reportedly ingests Android 16 Live Updates for any app (beta had a "Live notifications for all apps" developer option); One UI 7 was mostly Samsung/allowlisted apps. Press/community only. | https://www.sammobile.com/news/one-ui-8-now-bar-integrates-android-16-live-updates/ , https://www.androidauthority.com/one-ui-8-live-updates-support-3573794 | L (not official) |
| Samsung developer docs on Now Bar third-party requirements: not found in official docs (developer.samsung.com returned nothing; community.samsung.com returned 403). | n/a | n/a |

Working assumption (unverified): Samsung consumes the Android 16 promoted-ongoing flag, so the same requirements as section 1 apply plus possible OEM extras. Verify on a device.

## 3. POST_NOTIFICATIONS denied (Android 13+)

| Fact | URL | Conf. |
|---|---|---|
| Apps need not hold POST_NOTIFICATIONS to start an FGS, but must still include a notification. | https://developer.android.com/develop/ui/views/notifications/notification-permission | H |
| If denied, user still sees FGS notices in the Task Manager but not in the notification drawer. All channels blocked except exemptions (media sessions, CallStyle for self-managed calls). | same | H |
| New installs: notifications off by default on target 13+ until permission granted; Task Manager lets users stop FGS apps from the drawer; apps must handle user-initiated stop. | https://developer.android.com/about/versions/13/behavior-changes-all | H |
| On Android 13+, users can dismiss FGS notifications by default (setOngoing does not prevent it, per the linked section). Exact exceptions not read. | same | M |

## 4. Lock screen visibility

| Fact | URL | Conf. |
|---|---|---|
| PUBLIC = full content; SECRET = nothing; PRIVATE = only basic info (icon, content title), full content hidden. | https://developer.android.com/develop/ui/views/notifications/build-notification | H |
| With PRIVATE, `setPublicVersion()` supplies alternate redacted content. The user has final control, per channel too. | same | H |
| Default visibility when unset, and the exact interaction with the "hide sensitive content" setting: not found in official docs on the pages read. Platform default is VISIBILITY_PRIVATE per Notification reference, unverified here. | n/a | L |

## 5. Small icon

| Fact | URL | Conf. |
|---|---|---|
| Small icon is the only required content. | build-notification (above) | H |
| Status-bar icon appears monochrome. | https://developer.android.com/design/ui/mobile/guides/home-screen/notifications | H |
| Android 12+: system derives the icon color from `setColor`; if unset, uses the system theme color (previously gray). For most styles this applies only to foreground service notifications. | same design page | H |
| 24dp size, white-on-transparent alpha-only, padding/live area: not found in official docs on pages read (Material states only a general 24dp icon baseline). | https://m3.material.io/styles/icons/designing-icons | L |
| Does the accent tint app name in Android 12+ templates: not found in official docs. | n/a | n/a |
| `setColorized(true)` reserved for high-priority use (navigation, calls) and disqualifies promotion. | design page; live-update | H |

## 6. Large icon

| Fact | URL | Conf. |
|---|---|---|
| Use for imagery that reinforces content (avatar, thumbnail); not for branding. Circular for people, square otherwise. | https://developer.android.com/design/ui/mobile/guides/home-screen/notifications | H |
| Recommended pixel size, right-side placement and rounding on Android 12+, visibility in collapsed FGS notifications: not found in official docs. | n/a | n/a |

## 7. Update rate, only-alert-once, chronometer, indeterminate

| Fact | URL | Conf. |
|---|---|---|
| Rate limit: posting "many in less than one second" may cause dropped updates. The exact "5/sec" figure is not in the docs. | build-notification | H (qualitative) / L (number) |
| `setOnlyAlertOnce()` limits sound/vibration/visual interruption to the first appearance. From 8.1, one sound per second. | build-notification | H |
| `setUsesChronometer` / `setWhen` / `setProgress(0,0,true)` semantics: not on the build-notification page. Chronometer behavior for promoted chip is in section 1. | https://developer.android.com/develop/ui/views/notifications/live-update | H (chip only) |

Design implication: throttle streaming-token updates (e.g. at most ~1/sec) and avoid per-token notify().

## 8. Android 12+ FGS notification deferral

| Fact | URL | Conf. |
|---|---|---|
| Android 12+ can delay display of FGS notifications by 10 seconds, with a few exceptions, so short tasks can finish first. | https://developer.android.com/about/versions/12/behavior-changes-all | H |
| `FOREGROUND_SERVICE_IMMEDIATE`: display is immediate even if the default would defer. `FOREGROUND_SERVICE_DEFERRED`: usually suppressed briefly. | AOSP Notification.java (URL in section 1) | H |
| Immediate-exception list (action buttons, mediaPlayback/mediaProjection/phoneCall types, call/navigation categories): the cited anchor `guide/components/foreground-services#notification-immediate` no longer resolves on the fetched pages; list comes from search summaries only. | search summary | M/L |

Note: the app already has an action button and sets IMMEDIATE, so deferral should not apply.

## 9. Custom RemoteViews on Android 12+

| Fact | URL | Conf. |
|---|---|---|
| For target 31+, fully custom notifications not allowed; system applies a standard template nearly identical to DecoratedCustomViewStyle. | https://developer.android.com/develop/ui/views/notifications/custom-notification | H |
| Collapsed custom content max height dropped from 106dp to 48dp; all notifications expandable. | https://developer.android.com/about/versions/12/behavior-changes-12 | H |
| Heights can be as little as 48dp collapsed, 88dp heads-up, 252dp expanded. Clipping behavior not documented. | custom-notification | H |
| Custom content view disqualifies promotion (section 1). | live-update | H |

## 10. dataSync 6-hour limit

| Fact | URL | Conf. |
|---|---|---|
| Target 15+: dataSync (and mediaProcessing) FGS may run 6 hours total per 24 hours, while the app is in the background; tracked per type, shared across the app's services. | https://developer.android.com/develop/background-work/services/fgs/timeout | H |
| System calls `Service.onTimeout(int,int)`; service has a few seconds to `stopSelf()`, else `RemoteServiceException`. After the callback it is no longer a foreground service. | same | H |
| Timer resets when the user brings the app to the foreground. Exhausted limit: new dataSync start throws `ForegroundServiceStartNotAllowedException` until foregrounded. | same | H |
| Also: no dataSync FGS launch from BOOT_COMPLETED on target 15+. | https://developer.android.com/develop/background-work/services/fgs/service-types | H |
| Android 16-specific changes: none stated on the page. | timeout | H |

## 11. Splash screen API

| Fact | URL | Conf. |
|---|---|---|
| With icon background: 240x240dp, inside a 160dp-diameter circle. Without background: 288x288dp, inside a 192dp circle. Branding image 200x80dp. | https://developer.android.com/develop/ui/views/launch/splash-screen | H |
| Animated icon: unlimited duration allowed but recommended not over 1,000 ms; delayed start max 166 ms; loop if startup is longer. | same | H |
| Compat library `androidx.core:core-splashscreen` backports to API 23+ (covers Android 10); day/night supported. Visual differences on Android 10 not documented. | same | H |

## 12. Adaptive and themed icons

| Fact | URL | Conf. |
|---|---|---|
| All layers 108x108dp; inner 66x66dp is never clipped; outer 18dp per side reserved for masking and effects. Logo at least 48dp, at most 66dp. | https://developer.android.com/develop/ui/views/launch/icon_design_adaptive | H |
| Android 13+: themed icons require a `<monochrome>` layer (single layer); tinted from wallpaper. From Android 16 QPR 2, system auto-themes apps lacking one. | same | H |

## 13. Native Toast (for comparison)

| Fact | URL | Conf. |
|---|---|---|
| Target 31+: text toast limited to two lines and shows the app icon next to text; line length varies by screen. | https://developer.android.com/guide/topics/ui/notifiers/toasts | H |
| Android 13 toast-specific behavior: not found in official docs (Android 13 behavior page has none). | https://developer.android.com/about/versions/13/behavior-changes-all | n/a |

## Unverified / conflicting

- AI chat generation as a Live Update use case: not in official allowed/forbidden lists; judgment call, risk of user revocation.
- Indeterminate ProgressStyle qualification: not documented.
- Samsung Now Bar third-party mechanism and requirements: only press/community, no official developer doc found.
- `setShortCriticalText` limit (about 7 chars) and androidx 1.17.0 availability: from search summary of reference pages; the reference pages were too large to fetch directly.
- FGS immediate exception list and the "5 updates/sec" figure: not confirmed in official text.
- Default notification visibility, "hide sensitive content" interaction, small icon 24dp/padding, accent tint of app name, large icon size/placement, chronometer/indeterminate progress semantics: not found on pages read; check Notification/Notification.Builder reference or a device.
- Conflict note: the fetched `fgs/launch` page contradicts older guidance only in omission (no 10-second text); the 10-second figure itself is confirmed on the Android 12 behavior-changes-all page.
