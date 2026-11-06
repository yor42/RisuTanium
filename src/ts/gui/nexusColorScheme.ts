import type { ColorScheme } from './colorscheme'

// The Nexus preset data. It is the `nexus` key of `colorShemes` in colorscheme.ts, after the
// original built-ins, so the picker lists it and `changeColorScheme` applies it through the
// generic table path.
export const nexusColorScheme = {
    bgcolor: '#00011c',
    darkbg: '#0e0f2a',
    borderc: '#38d9ff',
    selected: '#19224a',
    draculared: '#ff6b81',
    textcolor: '#ebecff',
    textcolor2: '#9ca6c9',
    darkBorderc: '#5b6396',
    darkbutton: '#141738',
    type: 'dark' as const,
} satisfies ColorScheme
