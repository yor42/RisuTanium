<div class="flex flex-col gap-1" class:mb-4={marginBottom}>
    {#each rows as row, i (row.id)}
        <input
            class={"border border-darkborderc peer focus:border-borderc rounded-md shadow-xs text-textcolor bg-transparent risu-focus-ring transition-colors duration-200 w-full" + ((className) ? (' ' + className) : '')}
            class:text-sm={size === 'sm'}
            class:text-md={size === 'md'}
            class:text-lg={size === 'lg'}
            class:text-xl={size === 'xl'}

            class:px-4={size === 'md'}
            class:py-2={size === 'md'}
            class:px-2={size === 'sm'}
            class:py-1={size === 'sm'}
            class:px-6={size === 'lg' || size === 'xl'}
            class:py-3={size === 'lg' || size === 'xl'}

            autocomplete={isMasked(row.text) ? 'new-password' : 'off'}
            spellcheck="false"
            autocorrect="off"
            autocapitalize="off"
            type={isMasked(row.text) ? 'password' : 'text'}
            placeholder={i === 0 ? placeholder : (i === rows.length - 1 ? language.settingsPage.addAnotherKey : '')}
            aria-label={labelId ? undefined : (i > 0 && i === rows.length - 1 ? language.settingsPage.addAnotherKey : fillLang(language.settingsPage.keyRowLabel, { n: i + 1 }))}
            aria-labelledby={labelId ? labelledBy(row.id, i) : undefined}
            aria-describedby={labelId ? labelledBy(row.id, i) + ' ' + hintId : hintId}
            value={row.text}
            {@attach rowEvents(row.id)}
        />
        {#if labelId && rows.length > 1}
            {#if i > 0 && i === rows.length - 1}
                <span class="sr-only" id={addId(row.id)}>{language.settingsPage.addAnotherKey}</span>
            {:else}
                <span class="sr-only" id={posId(row.id)}>{i + 1}</span>
            {/if}
        {/if}
    {/each}
    <div id={hintId} class="text-textcolor2 text-xs">{language.settingsPage.keySeparatorHint}</div>
</div>

<script lang="ts">
    import { tick } from 'svelte'
    import { language } from 'src/lang'
    import { fillLang } from 'src/lang/fill'
    import { isSecretRef } from 'src/ts/secretRefPattern'
    import { splitKeys } from 'src/ts/process/request/keyRing'
    import { splitEditedRow } from './keyRowSplit'

    interface Props {
        size?: 'sm'|'md'|'lg'|'xl';
        placeholder?: string;
        value: string;
        marginBottom?: boolean;
        className?: string;
        hideText?: boolean;
        labelId?: string;
    }

    interface Row {
        id: number;
        text: string;
    }

    let {
        size = 'md',
        placeholder = '',
        value = $bindable(),
        marginBottom = false,
        className = '',
        hideText = false,
        labelId = undefined
    }: Props = $props();

    const hintId = $props.id()
    const posId = (rowId: number) => hintId + '-pos' + rowId
    const addId = (rowId: number) => hintId + '-add' + rowId

    // With a caller label, a sole row is named by the label alone; with several rows each name
    // appends the row's position, or the add-another text on the trailing empty row, so rows stay
    // distinguishable while the visible field label leads every name.
    function labelledBy(rowId: number, index: number): string {
        if (rows.length === 1) {
            return labelId ?? ''
        }
        return (labelId ?? '') + ' ' + (index > 0 && index === rows.length - 1 ? addId(rowId) : posId(rowId))
    }
    let nextId = 0
    const elements = new Map<number, HTMLInputElement>()

    function buildRows(source: string): Row[] {
        const texts = typeof source === 'string' ? splitKeys(source) : []
        const list: Row[] = (texts.length === 1 && texts[0] === '' ? [] : texts).map((text) => ({ id: nextId++, text }))
        list.push({ id: nextId++, text: '' })
        return list
    }

    // The value last read from or written to the bound prop. Rows are rebuilt only when the prop
    // differs from it, so the component's own writes never rebuild (which would drop the focused
    // element) while every external change, including one back to an earlier value, does.
    let lastSeen = value
    let rows = $state<Row[]>(buildRows(value))

    $effect.pre(() => {
        const external = value
        if (external !== lastSeen) {
            lastSeen = external
            rows = buildRows(external)
        }
    })

    function isMasked(text: string): boolean {
        return hideText && !isSecretRef(text)
    }

    // The always-present empty row at the end is not a key. A sole key row is written exactly as
    // typed; with several, whitespace-only rows are dropped so no empty line is stored.
    function composeValue(): string {
        const last = rows[rows.length - 1]
        const keyRows = last && last.text === '' ? rows.slice(0, -1) : rows
        if (keyRows.length === 1) {
            return keyRows[0].text
        }
        return keyRows.map((row) => row.text).filter((text) => text.trim() !== '').join('\n')
    }

    function commit() {
        const next = composeValue()
        lastSeen = next
        value = next
    }

    function ensureTrailingRow() {
        const last = rows[rows.length - 1]
        if (!last || last.text.trim() !== '') {
            rows.push({ id: nextId++, text: '' })
        }
    }

    function copyRow(id: number, node: HTMLInputElement) {
        const row = rows.find((candidate) => candidate.id === id)
        if (!row) {
            return false
        }
        row.text = node.value
        ensureTrailingRow()
        commit()
        return true
    }

    // Runs on the row's settled value; never calls focus(), so the element the caret is in survives.
    function settle(id: number, node: HTMLInputElement) {
        const index = rows.findIndex((candidate) => candidate.id === id)
        if (index < 0) {
            return
        }
        const texts = rows.map((row) => row.text)
        texts[index] = node.value
        const split = splitEditedRow(texts, index, node.selectionStart)
        if (!split) {
            copyRow(id, node)
            return
        }
        const count = split.rows.length - texts.length + 1
        const keepAt = split.focusRow - index
        const keptText = split.rows[split.focusRow]
        node.value = keptText
        if (document.activeElement === node) {
            node.setSelectionRange(split.caret, split.caret)
        }
        const replacement: Row[] = []
        for (let k = 0; k < count; k++) {
            replacement.push({ id: k === keepAt ? id : nextId++, text: split.rows[index + k] })
        }
        rows = [...rows.slice(0, index), ...replacement, ...rows.slice(index + 1)]
        ensureTrailingRow()
        commit()
        void tick().then(() => {
            // Only while the row still holds the kept run: a character typed since then owns the caret.
            if (document.activeElement === node && node.value === keptText && node.selectionStart !== split.caret) {
                node.setSelectionRange(split.caret, split.caret)
            }
        })
    }

    // Listeners sit on the element itself, like TextInput's writeBack, so a non-bubbling event is
    // handled too. Rows are looked up by id at event time because removals shift indices.
    function rowEvents(id: number) {
        return (node: HTMLInputElement) => {
            elements.set(id, node)
            const onInput = (event: Event) => {
                if ((event as InputEvent).isComposing) {
                    copyRow(id, node)
                } else {
                    settle(id, node)
                }
            }
            const onSettle = () => settle(id, node)
            const onFocusOut = () => {
                const index = rows.findIndex((candidate) => candidate.id === id)
                if (index >= 0 && index < rows.length - 1 && rows[index].text === '') {
                    rows.splice(index, 1)
                }
            }
            const onKeyDown = (event: KeyboardEvent) => {
                if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) {
                    return
                }
                const index = rows.findIndex((candidate) => candidate.id === id)
                const next = index >= 0 && index < rows.length - 1 ? elements.get(rows[index + 1].id) : undefined
                if (next) {
                    event.preventDefault()
                    next.focus()
                }
            }
            node.addEventListener('input', onInput)
            node.addEventListener('compositionend', onSettle)
            node.addEventListener('change', onSettle)
            node.addEventListener('focusout', onFocusOut)
            node.addEventListener('keydown', onKeyDown)
            return () => {
                elements.delete(id)
                node.removeEventListener('input', onInput)
                node.removeEventListener('compositionend', onSettle)
                node.removeEventListener('change', onSettle)
                node.removeEventListener('focusout', onFocusOut)
                node.removeEventListener('keydown', onKeyDown)
            }
        }
    }
</script>
