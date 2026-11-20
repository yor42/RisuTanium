<script lang="ts">
    import { answerBackupChoice, answerLeaveOut, dataSheetState, registerDataSheetHost } from '../../../ts/setting/dataSheets.svelte'
    import BackupChooserSheet from './BackupChooserSheet.svelte'
    import LeaveOutSheet from './LeaveOutSheet.svelte'

    /**
     * Shows the Data page's sheets. The page mounts it outside the keyed view and the scroll column, because the
     * dialog layer is fixed and an animated or inerted ancestor would break it. While it is mounted it is the host
     * that requests resolve against; when it goes away a pending request resolves `null`.
     */
    interface Props {
        background: readonly HTMLElement[]
    }

    let { background }: Props = $props()

    $effect(() => registerDataSheetHost())
</script>

{#if dataSheetState.pending}
    {@const request = dataSheetState.pending}
    <BackupChooserSheet trigger={request.trigger} {background} onanswer={answerBackupChoice} />
{/if}
{#if dataSheetState.pendingLeaveOut}
    {@const request = dataSheetState.pendingLeaveOut}
    <LeaveOutSheet def={request.def} trigger={request.trigger} {background} onanswer={answerLeaveOut} />
{/if}
