<script lang="ts">
    import { onDestroy } from 'svelte'
    import { get } from 'svelte/store'
    import { UsersIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { appDateFormat, appRelativeFormat } from 'src/ts/appIntl.svelte'
    import { changeCharOrAlert } from 'src/ts/characterPick'
    import { archivedMemberIds, changeCharGeneration, supersedeChangeChar } from 'src/ts/characters'
    import { DBState, selectedCharID } from 'src/ts/stores.svelte'
    import CharListAvatar from '../../Others/CharListAvatar.svelte'
    import { UPSTREAM_TAG_CLASS } from '../SourceDisclosure.svelte'
    import type { HomeBand } from './homeLayout'
    import type { ShelfStory } from './homeStories'
    import { STORY_DATE_OPTIONS, STORY_RELATIVE_OPTIONS, storyDateTime, storyTime } from './storyTime'

    interface Props {
        // Resolved against the live list by HomeShell: the order and the text are the snapshot, the
        // entry, its archived state and its time are live.
        stories: ShelfStory[]
        band: HomeBand
    }

    let { stories, band }: Props = $props()

    const uid = $props.id()
    const lead = $derived(stories[0])
    const rows = $derived(stories.slice(1))

    // The time labels follow this clock: a minute tick, and a refresh when the page is visible again.
    let now = $state(Date.now())
    $effect(() => {
        const refresh = () => {
            now = Date.now()
        }
        const timer = setInterval(refresh, 60_000)
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                refresh()
            }
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
            clearInterval(timer)
            document.removeEventListener('visibilitychange', onVisible)
        }
    })
    const formats = $derived({
        relative: appRelativeFormat(STORY_RELATIVE_OPTIONS),
        date: appDateFormat(STORY_DATE_OPTIONS),
        justNow: language.homeStoryJustNow,
    })

    // The restoring open of an archived card. `opening` marks the card; `openGeneration` is the
    // `changeChar` generation right after this card's open started.
    let opening: string | null = $state(null)
    let openGeneration = 0

    // The two awaiting branches of `changeChar`: an archived slot, and a group with an archived member.
    function mustRestore(entry: ShelfStory['entry']): boolean {
        return !!entry.coldstorage || (entry.type === 'group' && archivedMemberIds(entry).length > 0)
    }

    // The ordinary character pick of the list and the rail. `switchCharacter` is not used: with no
    // selection no chat shell is mounted, so a quiet failed restore would end with nothing on screen.
    function openStory(entry: ShelfStory['entry']) {
        const index = DBState.db.characters.indexOf(entry)
        if (index === -1) {
            return
        }
        if (!mustRestore(entry)) {
            void changeCharOrAlert('home.story', index)
            return
        }
        const chaId = entry.chaId
        if (opening === chaId) {
            return
        }
        opening = chaId
        const run = changeCharOrAlert('home.story', index)
        openGeneration = changeCharGeneration()
        void run.then((outcome) => {
            if (outcome !== 'selected' && opening === chaId) {
                opening = null
            }
        })
    }

    // Leaving the landing cancels a pending open only while it is still the latest and nothing is
    // selected: a pick made elsewhere is never cancelled, and an open that selected has nothing to cancel.
    onDestroy(() => {
        if (opening !== null && changeCharGeneration() === openGeneration && get(selectedCharID) < 0) {
            supersedeChangeChar()
        }
    })

    function labelIds(story: ShelfStory, i: number): string {
        const ids = [story.entry.type === 'group' ? `${uid}-g${i}` : `${uid}-n${i}`]
        if (story.chatLabel !== null) {
            ids.push(`${uid}-c${i}`)
        }
        if (story.archived) {
            ids.push(`${uid}-a${i}`)
        }
        ids.push(`${uid}-t${i}`)
        return ids.join(' ')
    }

    const phone = $derived(band === 'phone')
</script>

{#snippet card(story: ShelfStory, i: number, isLead: boolean)}
    {@const entry = story.entry}
    {@const name = entry.name || language.settingsPage.unnamed}
    {@const at = entry.lastInteraction ?? NaN}
    <button
        type="button"
        data-part="home-story"
        data-cha-id={entry.chaId}
        data-lead={isLead || undefined}
        data-archived={story.archived || undefined}
        aria-labelledby={labelIds(story, i)}
        aria-describedby={story.snippet !== '' ? `${uid}-s${i}` : undefined}
        aria-busy={opening === entry.chaId ? 'true' : undefined}
        class="risu-focus-ring flex w-full min-w-0 flex-row overflow-hidden border border-transparent bg-darkbg text-left text-textcolor hover:border-darkborderc {isLead ? 'rounded-[var(--home-card-radius)]' : 'rounded-[var(--home-radius-5)]'}"
        onclick={() => openStory(entry)}
    >
        <CharListAvatar
            src={entry.image ?? ''}
            busy={opening === entry.chaId}
            class="{isLead ? (phone ? 'w-[var(--home-lead-portrait-phone)]!' : 'w-[var(--home-lead-portrait)]!') : 'w-[var(--home-avatar-lg)]!'} h-auto! min-h-[var(--home-avatar-lg)]! self-stretch rounded-none! bg-darkbutton! shadow-none!"
        />
        <span
            class="flex min-w-0 flex-1 flex-col {isLead
                ? phone
                    ? 'gap-[var(--home-space-2)] px-[var(--home-space-7)] pt-[var(--home-space-7)] pb-[var(--home-space-6)]'
                    : 'gap-[var(--home-space-3)] px-[var(--home-space-11)] pt-[var(--home-space-11)] pb-[var(--home-space-10)]'
                : phone
                    ? 'gap-[var(--home-space-2)] px-[var(--home-space-6)] py-[var(--home-space-5)]'
                    : 'gap-[var(--home-space-2)] px-[var(--home-space-7)] py-[var(--home-space-6)]'}"
        >
            <span class="flex flex-wrap items-baseline gap-x-2">
                <span
                    id="{uid}-n{i}"
                    data-part="home-story-name"
                    class="max-w-full font-bold [overflow-wrap:break-word] {isLead
                        ? `${phone ? 'text-[length:var(--home-text-lg)]' : 'text-[length:var(--home-text-xl)]'} leading-[var(--home-leading-tight)] tracking-[var(--home-tracking-h1)]`
                        : 'text-[length:var(--home-text-base)]'}"
                >{name}</span>
                {#if entry.type === 'group'}
                    <span aria-hidden="true" class="shrink-0 text-[color:var(--home-ink-2)]"><UsersIcon size={14} /></span>
                    <span id="{uid}-g{i}" hidden>{language.chatShellGroupName(name)}</span>
                {/if}
                {#if story.archived}
                    <span id="{uid}-a{i}" data-part="home-story-archived" class={UPSTREAM_TAG_CLASS}>{language.homeStoryArchived}</span>
                {/if}
            </span>
            {#if story.chatLabel !== null}
                <span id="{uid}-c{i}" data-part="home-story-chat" class="line-clamp-1 text-[length:var(--home-text-sm)] text-[color:var(--home-ink-2)]">{story.chatLabel}</span>
            {/if}
            {#if story.snippet !== ''}
                <span
                    id="{uid}-s{i}"
                    data-part="home-story-snippet"
                    class={isLead
                        ? `line-clamp-2 max-w-[var(--home-measure-quote)] border-l-[length:calc(2*var(--home-hairline))] border-[color:var(--home-accent-solid)] text-[length:var(--home-text-quote)] leading-[var(--home-leading-quote)] text-[color:var(--home-ink)] ${phone ? 'mt-[var(--home-space-3)] pl-[var(--home-space-5)]' : 'mt-[var(--home-space-6)] pl-[var(--home-space-7)]'}`
                        : 'line-clamp-1 text-[length:var(--home-text-md)] text-[color:var(--home-ink-2)]'}
                >{story.snippet}</span>
            {/if}
            <span class="mt-auto text-[length:var(--home-text-sm)] text-[color:var(--home-ink-3)] {isLead ? (phone ? 'pt-[var(--home-space-5)]' : 'pt-[var(--home-space-8)]') : 'pt-[var(--home-space-3)]'}">
                <time id="{uid}-t{i}" data-part="home-story-time" datetime={storyDateTime(at)}>{storyTime(at, now, formats)}</time>
            </span>
        </span>
    </button>
{/snippet}

<section data-part="home-shelf-section" aria-labelledby="{uid}-h">
    <h2 id="{uid}-h" class="mb-[var(--home-space-8)] text-[length:var(--home-text-lg)] font-bold tracking-[var(--home-tracking-h1)]">{language.homeStoriesHeading}</h2>
    <div
        data-part="home-shelf"
        class="grid grid-cols-1 gap-[var(--home-space-4)] @min-[768px]:gap-[var(--home-space-6)] {rows.length > 0 ? '@min-[1000px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]' : ''}"
    >
        {#if lead}
            {@render card(lead, 0, true)}
        {/if}
        {#if rows.length > 0}
            <ul
                data-part="home-story-rows"
                class="grid grid-cols-1 gap-[var(--home-space-4)] @min-[768px]:grid-cols-2 @min-[768px]:gap-[var(--home-space-6)] @min-[1000px]:grid-cols-1 @min-[1000px]:content-start"
            >
                {#each rows as story, index (story.entry.chaId)}
                    <li class="min-w-0">{@render card(story, index + 1, false)}</li>
                {/each}
            </ul>
        {/if}
    </div>
</section>
