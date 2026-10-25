<script lang="ts">
    import { language } from 'src/lang';
    import { saveAssetFromBlob } from 'src/ts/globalApi.svelte';
    import { DBState } from 'src/ts/stores.svelte';
    import { selectSingleFileObject } from 'src/ts/util';
    import Check from 'src/lib/UI/GUI/CheckInput.svelte';
    import { beginBusy } from 'src/ts/process/memory/busyActions';
</script>

<div class="flex items-center mt-2">
    <Check
        check={DBState.db.customBackground !== ''}
        onChange={async (check) => {
            if (check) {
                DBState.db.customBackground = '-';
                const d = await selectSingleFileObject(['png', 'webp', 'gif']);
                if (!d) {
                    DBState.db.customBackground = '';
                    return;
                }
                const busy = beginBusy('imageAdd');
                try {
                    const img = await saveAssetFromBlob(d);
                    DBState.db.customBackground = img;
                } finally {
                    busy.end();
                }
            } else {
                DBState.db.customBackground = '';
            }
        }}
        name={language.useCustomBackground}
    />
</div>
