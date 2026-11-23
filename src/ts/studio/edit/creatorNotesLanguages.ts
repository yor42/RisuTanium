// The creator notes as classic MultiLangInput edits them: the languages of the note's map and the string a Studio edit
// of one language writes. The parse and encode below are the functions of util.ts and give the same result for every
// string (creatorNotesLanguages.test.ts compares them); util's module graph is the whole app, so the Studio form keeps
// its own copy instead of importing it. A Studio edit leaves the string classic's own editor leaves for the same typing,
// and classic's mount over it writes nothing new.

export function parseNote(data: string): Record<string, string> {
    const result: Record<string, string> = {}
    const regex = /# `(.+?)`\n([\s\S]+?)(?=\n# `|$)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(data)) !== null) {
        if (match.index === regex.lastIndex) {
            regex.lastIndex++
        }
        result[match[1]] = match[2]
    }
    result.xx = data.replace(regex, '')
    return result
}

export function encodeNote(data: Record<string, string>): string {
    let result = ''
    if (data.xx) {
        result = data.xx
    }
    for (const key in data) {
        result = `${result}\n# \`${key}\`\n${data[key]}`
    }
    return result
}

// The name classic shows on a language tab: the language's own name, the code itself when the platform has none.
export function languageName(code: string): string {
    try {
        return code === 'xx' ? 'Unknown Language' : (new Intl.DisplayNames([code, 'en'], { type: 'language' }).of(code) ?? code)
    } catch {
        return code
    }
}

// The languages of a note, in parse order: untagged text is the EN section when the note has no `en` section, and is
// otherwise not a language of its own. A duplicated header reads as its last occurrence, at the first one's position.
export function notesLanguages(text: string): Record<string, string> {
    const languages = parseNote(text)
    if (languages.en === undefined) {
        languages.en = languages.xx
    }
    delete languages.xx
    return languages
}

// The note after `lang` gets `body`: every language is re-encoded once, an emptied non-EN language is removed and an
// emptied EN becomes one space. The result has no untagged text, always has an `en` section and no header-only section.
// A body that itself contains a line starting a section header (a newline followed by "# `code`") cannot round-trip: the
// parse ends that body at the line, so the field shows the shortened text after the write, as classic's editor does.
export function withLanguageBody(text: string, lang: string, body: string): string {
    const languages = notesLanguages(text)
    languages[lang] = body
    for (const key of Object.keys(languages)) {
        if (languages[key] === '' && key !== 'en') {
            delete languages[key]
        }
    }
    if (languages.en === '') {
        languages.en = ' '
    }
    return encodeNote(languages)
}
