<script lang="ts">
    import { language } from 'src/lang';
    import { disable, enable, state as replyNotificationState } from 'src/ts/android/replyNotifications.svelte';
    import Check from 'src/lib/UI/GUI/CheckInput.svelte';

    // On means the user opted in and Android would show a notification now; the host reports both.
    const on = $derived(replyNotificationState.optedIn && replyNotificationState.enabled);
    const blocked = $derived(replyNotificationState.optedIn && !replyNotificationState.enabled);

    // The box follows the reported state: a tap the host does not confirm (permission refused, settings opened) puts it back.
    let shown = $state(false);
    $effect.pre(() => {
        shown = on;
    });

    function onSwitch(checked: boolean): void {
        if (checked) {
            enable();
        } else {
            disable();
        }
        shown = on;
    }
</script>

<div class="flex items-center mt-2">
    <Check
        bind:check={shown}
        name={language.replyNotificationsSetting}
        onChange={onSwitch}
    />
</div>
<p class="text-sm text-textcolor2 mt-1" data-part="reply-notifications-help">{language.replyNotificationsHelp}</p>
{#if blocked}
    <p class="text-sm text-textcolor2 mt-1" data-part="reply-notifications-status">{language.replyNotificationsBlocked}</p>
{/if}
