// The `nexus` colour-scheme preset for src/ts/gui/colorscheme.ts (audit AUD-01, AUDIT_RESPONSE R-01).
// Approved by the maintainer on 2026-10-16, both as a preset and as the default for new installs.
// Paste the object into `colorShemes` there; this file is a design reference and is not imported by the app.
// Field names and order follow the app's ColorScheme interface.
//
// Contrast (WCAG 2.x, computed):
//   textcolor   #ebecff  17.60:1 on bgcolor, 16.04:1 on darkbg, 13.13:1 on selected
//   textcolor2  #9ca6c9   8.53:1 on bgcolor,  7.78:1 on darkbg,  6.36:1 on selected
//   borderc     #38d9ff  12.28:1 on bgcolor (focus borders and rings)
//   draculared  #ff6b81   7.51:1 on bgcolor
//   darkBorderc #5b6396   3.59:1 on bgcolor, 3.28:1 on darkbg, 3.03:1 on darkbutton. Input, checkbox and
//                         button borders use it, so it meets the 3:1 non-text minimum (WCAG 1.4.11). The audit's
//                         #23274d was 1.44:1.
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
}
