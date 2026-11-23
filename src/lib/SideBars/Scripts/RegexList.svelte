<script lang="ts">
    import type { customscript } from "src/ts/storage/database.svelte";
    import RegexData from "./RegexData.svelte";
    import { language } from "src/lang";
    import Sortable from "sortablejs";
    import { sleep, sortableOptions } from "src/ts/util";
    import { onDestroy, onMount } from "svelte";
    import WindowedSegment from "src/lib/UI/Windowed/WindowedSegment.svelte";
    import { createWindowHost } from "src/ts/windowing/windowHost.svelte";
    import { orderAfterSortableDrop } from "src/ts/windowing/rowReorder";
  import { DownloadIcon, HardDriveUploadIcon, PlusIcon } from "@lucide/svelte";
  import { exportRegex, importRegex } from "src/ts/process/scripts";
    interface Props {
        value?: customscript[];
        buttons?: boolean
    }

    let { value = $bindable([]), buttons = false }: Props = $props();
    let stb: Sortable = null
    let ele: HTMLDivElement = $state()
    let sorted = $state(0)
    let opened = 0
    // Only the rows near the view are mounted; the row keys are positions, so a drop is read as a data order by orderAfterSortableDrop.
    const windowHost = createWindowHost({ root: () => ele ?? null })
    onDestroy(() => windowHost.dispose())
    const REGEX_ROW_FALLBACK_PX = 48
    const rowKeys = $derived(value.map((_, i) => String(i)))
    const createStb = () => {
        const list = ele?.querySelector('[data-window-list]')
        if(!list){
            return
        }
        stb = Sortable.create(list as HTMLElement, {
            onEnd: async (evt) => {
                const order = orderAfterSortableDrop(list, evt.item, 'data-risu-idx', value.length)
                if(order){
                    value = order.map((i) => value[i])
                }
                try {
                    stb.destroy()
                } catch (error) {}
                sorted += 1
                await sleep(1)
                createStb()
            },
            ...sortableOptions,
            draggable: '[data-window-key]',
        })
    }

    // An open row stays mounted, so its open state and its count in `opened` survive scrolling.
    let openRows = $state<string[]>([])
    const onOpen = (idx: number) => {
        openRows = [...openRows, String(idx)]
        opened += 1
        if(stb){
            try {
                stb.destroy()
            } catch (error) {}
        }
    }
    const onClose = (idx: number) => {
        const at = openRows.indexOf(String(idx))
        if(at !== -1){
            openRows = openRows.filter((_, i) => i !== at)
        }
        opened -= 1
        if(opened === 0){
            createStb()
        }
    }

    onMount(createStb)

    onDestroy(() => {
        if(stb){
            try {
                stb.destroy()
            } catch (error) {}
        }
    })
</script>
{#key sorted}
    <div class="contain w-full max-w-full mt-2 flex flex-col p-3 border-selected border-1 bg-darkbg rounded-md" bind:this={ele}>
        {#if value.length === 0}
                <div class="text-textcolor2">{language.sidebarUi.noScripts}</div>
        {/if}
        <WindowedSegment host={windowHost} keys={rowKeys} height={{ fallback: REGEX_ROW_FALLBACK_PX }} pinned={openRows} class="flex flex-col" data-window-list>
            {#snippet item(key, i)}
                <RegexData idx={i} bind:value={value[i]} onOpen={onOpen} onClose={onClose} onRemove={(target) => {
                    let customscript = value
                    const at = customscript ? customscript.indexOf(target) : -1
                    if(at === -1) return
                    customscript.splice(at, 1)
                    value = customscript
                }}/>
            {/snippet}
        </WindowedSegment>
    </div>
{/key}
{#if buttons}
    <div class="flex gap-2 mt-2">
        <button class="rounded-md text-textcolor2 hover:text-textcolor focus-within:text-textcolor" aria-label={language.add} onclick={() => {
            value.push({
            comment: "",
            in: "",
            out: "",
            type: "editinput"
            })
        }}>
            <PlusIcon aria-hidden="true" />
        </button>
        <button class="rounded-md text-textcolor2 hover:text-textcolor focus-within:text-textcolor" aria-label={language.export} onclick={() => {
            exportRegex(value)
        }}><DownloadIcon aria-hidden="true" /></button>
        <button class="rounded-md text-textcolor2 hover:text-textcolor focus-within:text-textcolor" aria-label={language.import} onclick={async () => {
            value = await importRegex(value)
        }}><HardDriveUploadIcon aria-hidden="true" /></button>
    </div>
{/if}