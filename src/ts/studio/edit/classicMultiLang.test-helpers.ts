// The script logic of the classic creator-notes editor (MultiLangInput.svelte) over the real parse and encode functions:
// what its mount writes, what a tab click writes, what "+" does and what typing writes. The component keeps a map of
// languages, re-parses the bound string after every write, and applies `updateValue` on mount, on a tab click and on
// every input. This copy lets a test compare a Studio edit with the string classic leaves, without a DOM.

import { encodeMultilangString, parseMultilangString } from '../../util'

export interface ClassicEditor {
    // The bound string.
    value(): string
    // The selected tab's language.
    selected(): string
    // The languages that have a tab.
    tabs(): string[]
    // A tab click on an existing language.
    click(lang: string): void
    // The "+" menu choosing a language: a draft entry, no write.
    add(lang: string): void
    // Typing into the selected tab's textarea.
    type(body: string): void
}

export function mountClassic(initial: string): ClassicEditor {
    let value = initial
    let selectedLang = 'en'
    const first = parseMultilangString(value)
    if (first.en === undefined) {
        first.en = first.xx
        delete first.xx
    }
    let valueObject: { [code: string]: string } = first
    const updateValue = (): void => {
        for (const lang in valueObject) {
            if (valueObject[lang] === '' && lang !== selectedLang && lang !== 'en') {
                delete valueObject[lang]
            }
        }
        if (valueObject.xx) {
            delete valueObject.xx
        }
        if (valueObject.en === '') {
            valueObject.en = ' '
        }
        value = encodeMultilangString(valueObject)
        // The component's `$effect.pre` re-parses the bound string after each write.
        valueObject = parseMultilangString(value)
    }
    updateValue()
    return {
        value: () => value,
        selected: () => selectedLang,
        tabs: () => Object.keys(valueObject).filter((lang) => lang !== 'xx'),
        click(lang) {
            selectedLang = lang
            updateValue()
        },
        add(lang) {
            valueObject[lang] = ''
            selectedLang = lang
        },
        type(body) {
            valueObject[selectedLang] = body
            updateValue()
        },
    }
}

// What classic leaves after "mount, choose or add `lang`, type `body`".
export function classicSession(initial: string, lang: string, body: string): string {
    const editor = mountClassic(initial)
    if (editor.tabs().includes(lang)) {
        editor.click(lang)
    } else {
        editor.add(lang)
    }
    editor.type(body)
    return editor.value()
}

// The same, then the tab is left for EN: the settled string once classic drops an emptied non-EN language.
export function classicSettled(initial: string, lang: string, body: string): string {
    const editor = mountClassic(initial)
    if (editor.tabs().includes(lang)) {
        editor.click(lang)
    } else {
        editor.add(lang)
    }
    editor.type(body)
    editor.click('en')
    return editor.value()
}

// What classic's mount writes over a string.
export function classicMount(value: string): string {
    return mountClassic(value).value()
}
