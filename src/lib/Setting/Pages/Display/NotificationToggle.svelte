<script lang="ts">
    import { language } from 'src/lang';
    import { alertError } from 'src/ts/alert';
    import { DBState } from 'src/ts/stores.svelte';
    import { readNotificationStatus, requestNotifications, type NotificationStatus } from 'src/ts/gui/notificationPermission';
    import Check from 'src/lib/UI/GUI/CheckInput.svelte';

    // The browser permission is not reactive, so the line is re-read after each ask.
    let status = $state<NotificationStatus>(readNotificationStatus());

    const statusText = $derived(
        status === 'granted'
            ? language.settingsShellNotificationGranted
            : status === 'denied'
              ? language.settingsShellNotificationDenied
              : status === 'default'
                ? language.settingsShellNotificationDefault
                : language.settingsShellNotificationUnsupported
    );

    // The stored flag is written only by a click, so a profile that never stored it stays unset on mount.
    async function onSwitch(checked: boolean): Promise<void> {
        DBState.db.notification = checked;
        if (!checked) {
            return;
        }
        status = await requestNotifications();
        if (status === 'granted') {
            return;
        }
        // A refusal says so; a missing API or a dismissed prompt only turns the switch off.
        if (status === 'denied') {
            alertError(language.permissionDenied);
        }
        DBState.db.notification = false;
    }
</script>

<div class="flex items-center mt-2">
    <Check
        check={DBState.db.notification === true}
        name={language.notification}
        onChange={onSwitch}
    />
</div>
<p class="text-sm text-textcolor2 mt-1" data-part="notification-status">{statusText}</p>
