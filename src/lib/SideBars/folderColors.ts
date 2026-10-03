import { language } from "src/lang";

type FolderColorLabelKey =
    | 'folderColorRed'
    | 'folderColorGreen'
    | 'folderColorBlue'
    | 'folderColorYellow'
    | 'folderColorIndigo'
    | 'folderColorPurple'
    | 'folderColorPink'
    | 'folderColorDefault'

interface FolderColorEntry {
    // Stored on the folder; the sidebar styling matches on these exact strings.
    value: string
    labelKey: FolderColorLabelKey
}

// Order is the order of the select list; label and stored value come from the same entry.
const folderColorEntries: readonly FolderColorEntry[] = [
    { value: 'red', labelKey: 'folderColorRed' },
    { value: 'green', labelKey: 'folderColorGreen' },
    { value: 'blue', labelKey: 'folderColorBlue' },
    { value: 'yellow', labelKey: 'folderColorYellow' },
    { value: 'indigo', labelKey: 'folderColorIndigo' },
    { value: 'purple', labelKey: 'folderColorPurple' },
    { value: 'pink', labelKey: 'folderColorPink' },
    { value: 'default', labelKey: 'folderColorDefault' },
]

/** Display labels in select order, read from the current language at call time. */
export function getFolderColorLabels(): string[] {
    return folderColorEntries.map((entry) => language.sidebarUi[entry.labelKey])
}

/** Stored colour for the select index, or undefined when the index matches no entry. */
export function getFolderColorValue(index: number): string | undefined {
    return folderColorEntries[index]?.value.toLocaleLowerCase()
}
