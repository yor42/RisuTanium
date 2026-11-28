<script lang="ts">
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import { DBState } from "src/ts/stores.svelte";
    import { isLocked, setLocked, type LockGroupId } from "src/ts/storage/presetLocks";
    import { lockLabel } from "src/ts/storage/presetLockLabels";

    interface Props {
        id: LockGroupId;
        className?: string;
    }

    let { id, className = "" }: Props = $props();
</script>

<div data-part="preset-lock-switch" data-lock={id} class="flex min-h-11 items-center">
    <Check
        check={isLocked(DBState.db, id)}
        name={lockLabel(id)}
        {className}
        onChange={(on) => { setLocked(DBState.db, id, on) }}
    />
</div>
