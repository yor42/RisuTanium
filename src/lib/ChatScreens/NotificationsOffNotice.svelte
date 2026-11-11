<script lang="ts">
    import { language } from 'src/lang'
    import {
        consumeNotificationsOffNotice,
        dismissNotificationsOffNotice,
        notificationsOff,
        openNotificationSettings,
    } from 'src/ts/android/replyNotifications.svelte'

    // Only the instance that consumed the notice shows it. The consume is a compare-and-set on the
    // module phase, so a second or later instance never gets it, and the notice is shown at most once
    // per process.
    let mine = $state(false)

    // The notice registers no teardown: unmounting is how it leaves the chat, and it is never
    // re-armed. A denial that arrives while this instance is mounted is taken through the tracked phase.
    // Known limitation: an instance covered by Settings or Studio still consumes the notice, so if that
    // visit then remounts the chat (a UI-language change or a chat-shell switch) the user never saw it;
    // the Settings line stays as the fallback.
    $effect(() => {
        if (notificationsOff.phase === 'pending' && consumeNotificationsOffNotice()) {
            mine = true
        }
    })
</script>

{#if mine && notificationsOff.phase === 'consumed'}
    <div
        role="status"
        data-part="notifications-off-notice"
        class="flex flex-wrap items-center gap-2 mx-4 mt-2 mb-2 p-2 rounded-md border border-darkborderc bg-darkbg text-textcolor text-sm"
    >
        <p class="grow min-w-0 wrap-anywhere">{language.notificationsOffNotice}</p>
        <div class="flex gap-2">
            <button
                type="button"
                data-action="open-settings"
                class="px-3 py-1 rounded-md border border-darkborderc bg-darkbutton text-textcolor hover:bg-selected transition-colors"
                onclick={openNotificationSettings}
            >{language.notificationsOffOpenSettings}</button>
            <button
                type="button"
                data-action="close"
                class="px-3 py-1 rounded-md border border-darkborderc text-textcolor2 hover:bg-selected transition-colors"
                onclick={dismissNotificationsOffNotice}
            >{language.uiCommon.close}</button>
        </div>
    </div>
{/if}
