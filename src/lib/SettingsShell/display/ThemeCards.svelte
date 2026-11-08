<script lang="ts">
    import { language } from '../../../lang'
    import type { SettingContext } from '../../../ts/setting/types'

    interface Props {
        ctx: SettingContext
    }
    let { ctx }: Props = $props()

    /** The offered chat themes. The retired `custom` value is not offered; a profile that holds it shows none selected. */
    const THEMES: readonly { value: string, key: string }[] = [
        { value: '', key: 'standard' },
        { value: 'waifu', key: 'waifu' },
        { value: 'mobilechat', key: 'mobilechat' },
        { value: 'cardboard', key: 'cardboard' },
        { value: 'customHTML', key: 'customHTML' },
    ]

    const names: Readonly<Record<string, string>> = language.settingsShellThemeNames
    const descs: Readonly<Record<string, string>> = language.settingsShellThemeDescs
    const group = $props.id()
</script>

<fieldset class="mt-4 min-w-0 border-0 p-0" data-part="theme-cards">
    <legend class="text-textcolor">{language.settingsShellThemeLegend}</legend>
    <div class="mt-2 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
        {#each THEMES as theme (theme.key)}
            {@const selected = (ctx.db.theme ?? '') === theme.value}
            <label
                class="relative flex flex-col gap-2 rounded-md border p-2 cursor-pointer transition-colors hover:bg-darkbutton"
                class:border-borderc={selected}
                class:bg-darkbutton={selected}
                class:border-darkborderc={!selected}
            >
                <input
                    class="sr-only peer"
                    type="radio"
                    name={group}
                    value={theme.value}
                    checked={selected}
                    onchange={() => { ctx.db.theme = theme.value }}
                />
                <span class="relative flex h-16 w-full overflow-hidden rounded-sm bg-darkbg peer-focus-visible:ring-2 peer-focus-visible:ring-textcolor2" aria-hidden="true" data-theme-thumb={theme.key}>
                    {#if theme.key === 'standard'}
                        <span class="m-2 flex w-full flex-col gap-1">
                            <span class="h-2 w-3/5 rounded-sm bg-darkbutton"></span>
                            <span class="h-2 w-4/5 self-end rounded-sm bg-selected"></span>
                            <span class="h-2 w-2/5 rounded-sm bg-darkbutton"></span>
                        </span>
                    {:else if theme.key === 'waifu'}
                        <span class="m-2 w-2/5 rounded-sm bg-selected"></span>
                        <span class="my-2 mr-2 flex grow flex-col justify-end gap-1">
                            <span class="h-2 rounded-sm bg-darkbutton"></span>
                            <span class="h-2 w-4/5 rounded-sm bg-darkbutton"></span>
                        </span>
                    {:else if theme.key === 'mobilechat'}
                        <span class="m-2 flex w-full flex-col gap-1">
                            <span class="h-3 w-3/5 rounded-full bg-darkbutton"></span>
                            <span class="h-3 w-3/5 self-end rounded-full bg-selected"></span>
                            <span class="h-3 w-2/5 rounded-full bg-darkbutton"></span>
                        </span>
                    {:else if theme.key === 'cardboard'}
                        <span class="m-2 flex w-full flex-col gap-1">
                            <span class="h-4 rounded-sm border border-darkborderc bg-bgcolor"></span>
                            <span class="h-4 rounded-sm border border-darkborderc bg-bgcolor"></span>
                        </span>
                    {:else}
                        <span class="m-auto font-mono text-sm text-textcolor2">&lt;/&gt;</span>
                    {/if}
                </span>
                <span class="text-sm text-textcolor">{names[theme.key]}</span>
                <span class="text-xs text-textcolor2">{descs[theme.key]}</span>
            </label>
        {/each}
    </div>
</fieldset>
