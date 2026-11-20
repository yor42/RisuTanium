<script lang="ts">
    // Test-only: the real TaskHost and the real ToastHost wired as App.svelte wires them, with an opener button inside
    // the inert scope that a shown task card makes inert.
    import AlertInertScope from '../../UI/GUI/AlertInertScope.svelte'
    import TaskHost from './TaskHost.svelte'
    import ToastHost from './ToastHost.svelte'
    import type { ToastHost as ToastHostModel } from '../../../ts/toast/toastHost.svelte'

    interface Props {
        host: ToastHostModel
    }

    let { host }: Props = $props()
</script>

<AlertInertScope>
    <button type="button" data-test="opener">Open</button>
</AlertInertScope>
<TaskHost toasts={host} />
<ToastHost {host} />
