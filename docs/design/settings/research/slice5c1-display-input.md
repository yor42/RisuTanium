# Slice 5c-1 source discovery: 화면·읽기 (display) and 입력·접근성 (input), DD-250 repair state, DD-223 undo window

Date 2026-10-28. Source read only, nothing run. OBSERVED = read in code or design files; INFERRED = my reading, not executed. Anchors are `path:line`. Proposals live only in section 8; open questions in section 9.
Abbreviations: DSD = `src/ts/setting/displaySettingsData.svelte.ts`; ASD = `src/ts/setting/accessibilitySettingsData.ts`; DB = `src/ts/storage/database.svelte.ts` (defaults block 100-740, type block 862-1330); EN = `src/lang/en.ts`; D1 = `docs/design/settings/data.js`.

## 0. Headline facts
1. OBSERVED: the app has two data-driven pages. `DisplaySettings.svelte` (title `language.display` = "Display & Audio", EN:1234) renders three tabs from DSD: Theme (11 items, DSD:15-141), Size and Speed (10, DSD:143-249), Others (32, DSD:251-374). `AccessibilitySettings.svelte` renders ASD: 28 items (ASD:9-222). Total 81 items. With `useLegacyGUI` on the tabs vanish and all three groups stack (DisplaySettings.svelte:11,16). The same legacy flag is read by BotSettings and OtherBotSettings (BotSettings.svelte:117, OtherBotSettings.svelte:31).
2. OBSERVED: the "Others" tab is a flat list of 32 unrelated items (sounds, quotes, saving icon, network key masking, beta GUI, notifications, CSS). It is the main regroup target.
3. OBSERVED, dead: `showMemoryLimit` and `memoryLimitThickness` do nothing visible today. `Chat.svelte:1481` draws the line only if `isLastMemory` is true, and every caller passes `false` (Chats.svelte:128, DefaultChatScreen.svelte:929, BookmarkList.svelte:195/208, WelcomeRisu.svelte). `showMemoryLimit` is read nowhere outside the settings list (grep of `src`). The D1 row `chatfeat.memLimit` (D1:153) carries the same toggle.
4. OBSERVED, dead: `moveInsteadOfCopyOnCMPConvert` is set (DB:734), typed (DB:1327) and listed (ASD:199-205) but read by no code (grep of `src`).
5. OBSERVED: the page has no low-power or reduce-motion setting. Motion = one number `animationSpeed` (seconds written to `--risu-animation-speed`, `src/ts/gui/animation.ts:5`). `prefers-reduced-motion` is honoured in only two components (`Chat.svelte:168`, `SourceDisclosure.svelte:92`). Low power does not exist in the app, so the mockup's `display.lowPower` is a design-only feature (DD-wide low-power theme work is elsewhere).
6. OBSERVED: streaming optimisation (`streamingDisplayOptimizationMode`) and `keepSessionAlive` live on the Advanced page (`advancedSettingsData.ts:70,148`), not here. DD at DECISIONS.md:520 retires the streaming setting. The D1 rows `display.streamOpt` / `display.keepAlive` therefore belong to 5c-2 or nowhere.
7. OBSERVED: the repair state of DD-250 needs per-mode visibility fields that do not exist in the app (grep for hybrid / uiMode / hideUnused in DB and stores: no match). They are new (section 3).

## 1. Today in the app

### 1.1 Display page, Theme tab (DSD:15-141)
| Item (label, EN) | Field | Type / default | Bounds / options | Takes effect | Notes |
|---|---|---|---|---|---|
| "Select your theme" (`theme`, EN:739 help-style text) | `theme` | string, '' (DB:157) | '' Standard Risu, waifu, mobilechat, cardboard, customHTML | ChatScreen.svelte:35 (waifu); Chat.svelte:193,1002,1484,1528 (mobilechat, cardboard) | Option labels are hard-coded English names. Label is a sentence, not a name. |
| "Define custom GUI" button | opens `CustomGUISettingMenuStore` | button | shown only when `theme === 'custom'` (DSD:37) | CustomGUISettingMenu.svelte | DEAD CONDITION: 'custom' is not in the option list (DSD:22-29). Reachable only from an old saved value. |
| "Chat HTML" textarea | `guiHTML` | string | shown when `theme === 'customHTML'` | Chat.svelte (guiHTML) | Help `chatHTML` EN:648. |
| "Waifu Chat Width" | `waifuWidth` | number, 100 (DB:163) | slider 50-200 %, only theme waifu | ChatScreen.svelte:46 | Platform-neutral. |
| "Waifu Character Size" | `waifuWidth2` | number, 100 (DB:166) | slider 20-150 %, only theme waifu | ChatScreen.svelte:41 | |
| "Color Scheme" grid | `colorSchemeName` (+ `colorScheme` resolved copy) | string, 'default' (DB:405) | 15 presets from `colorShemes` (colorscheme.ts:38-232: default, dark, light, cherry, galaxy, nature, ocean, aurora, twilight, realblack, monokai-light, monokai-black, sky-light, sage-light, lavender-light, slate-light, plus "lite") + custom | `changeColorScheme` (colorscheme.ts:241); `isLite` forces the 'lite' scheme (colorscheme.ts:272) | Names are derived by capitalising ids (ColorSchemeSelect.svelte:13-20). The palette tile is a CSS `conic-gradient` wheel (ColorSchemeSelect.svelte:21-26). |
| Custom colour editor | `customColorScheme` | object | shown when scheme is custom | CustomColorSchemeEditor.svelte | 10 colours + dark/light type (colorscheme.ts:21). |
| "Text Color" | `textTheme` | 'standard' (DB:213) | standard ("Classic Risu"), highcontrast ("High-Contrast"), custom | `updateTextThemeAndCSS` (colorscheme.ts:345-390) | `isLite` forces standard (colorscheme.ts:345). |
| Custom text theme editor | `customTextTheme` | object | when custom | colorscheme.ts:386-388 | FontColorStandard / Italic / Bold and more. |
| "Font" | `font` | 'default' (DB:550) | default, timesnewroman, custom | updateTextThemeAndCSS | Only two named fonts. |
| (unlabelled text) custom font | `customFont` | string | when font is custom | same | `fallbackLabel: ''`, so it has no label at all (DSD:135). |

### 1.2 Display page, Size and Speed tab (DSD:143-249)
| Item | Field | Default | Bounds | Takes effect | Notes |
|---|---|---|---|---|---|
| "Chat Text Size" (`UISize`, EN:1226) | `zoomsize` | 100 (DB:133) | 50-200 (%) | Chat.svelte:1047-1048 (font 0.875 rem x zoom and line height), PartialEditController, TextAreaResizable | MISLEADING key name; label is accurate for chat body but also scales message editor fields. |
| "Line Height" | `lineHeight` | 1.25 (DB:552) | 0.5-3 step 0.05 | Chat.svelte:1048 (multiplied by zoom) | Mockup default 1.5. |
| "Icon Size" | `iconsize` | 100 (DB:154) | 50-200 | Chat.svelte:1301,1312 (avatar box 3.5 rem x size) | Means character avatar size in chat, not "icon". |
| "Input Area Size" | `textAreaSize` | 0 (DB:538) | -5..5 steps, shown as Tiny...Hugest (`guiSizeText`, guisize.ts:22+) | TextAreaInput.svelte, guisize.ts:14 | Step labels are hard-coded English words. |
| "Input Area Text Size" | `textAreaTextSize` | 0 (DB:540) | 0-3 | same | |
| "Sidebar Size" | `sideBarSize` | 0 (DB:539) | 0-3 | `--sidebar-size` = 24 + 4 x n rem (guisize.ts:16) | |
| "Asset Images Max Width" | `assetWidth` | -1 (DB:402) | -1..40 rem, -1 "Unlimited", 0 "Hidden" | parser.svelte.ts:517 | -1 and 0 are special values hidden behind a slider. In rem, not %. |
| "Animation Speed" | `animationSpeed` | 0.4 (DB:403) | 0-1 step 0.05, seconds | animation.ts:5 `--risu-animation-speed` | 0 = instant. Name implies faster-is-higher but the number is a duration (larger = slower). MISLEADING. |
| "Memory Limit Thickness" | `memoryLimitThickness` | 1 (DB:469) | 1-500 px; shown only when `showMemoryLimit` | Chat.svelte:1481 | DEAD (fact 3). |
| "Settings close button size" | `settingsCloseButtonSize` | 24 (DB:683) | 16-48 px | Settings.svelte:175,222 | Help EN:672: "top right corner of the settings window". Desktop-oriented. |

### 1.3 Display page, Others tab (DSD:251-374)
| Item (EN label) | Field | Type / default | Takes effect | Notes |
|---|---|---|---|---|
| Fullscreen | `fullScreen` | bool, false (DB:148) | `changeFullscreen` util.ts:324 (needs `appWindow`) | PLATFORM-ONLY: shown only `isTauriDesktop` (DSD:258). |
| Show Memory Limit | `showMemoryLimit` | bool, false (DB:240) | none | DEAD. |
| Show First Message Pages | `showFirstMessagePages` | bool, false (DB:243) | Chat.svelte:1200 (needs swipe on) | Depends on `swipe`. Label unclear: it shows the "1/3" pager on the greeting. |
| Hide RisuRealm | `hideRealm` | bool | MainMenu.svelte:187 | Realm is the community hub. |
| Hide All Images | `hideAllImages` | bool, false (DB:684) | CharListAvatar, GridCatalog, RealmHubIcon, RealmPopUp | Help EN:684: bot icons, bot image assets, Realm covers. Not chat inlays. |
| Show Folder Name in Icon | `showFolderName` | bool | GridCatalog, SidebarRail | |
| Use custom background | `customBackground` | string, '' (DB:136); '-' is a transient picking marker | CustomBackgroundToggle.svelte:11-33 (png, webp, gif, saved as image id) | Check + file picker in one control. Cancelling restores ''. |
| Play Message Audio | `playMessage` | bool, false (DB:151) | composerActions.svelte.ts:568 | Help `msgSound` EN:493 "*ding*". Label sounds like TTS. |
| Play Audio on Translate Completion | `playMessageOnTranslateEnd` | bool | translator.ts:331 | |
| Round Icons | `roundIcons` | bool | Chat.svelte, SidebarRail | |
| Custom Text Screen Color | `textScreenColor` | string or undefined (null = off), swatch default #121212 | ChatScreen.svelte | NullableTextColorToggle: check + colour in one row. |
| Text Outlines | `textBorder` | bool | ChatScreen.svelte | Mockup calls this "채팅창 윤곽선"/"Text screen borders" (a different field). |
| Round Text Screen | `textScreenRounded` | bool | ChatScreen.svelte | |
| Text Screen Borders | `textScreenBorder` | string/null, #121212 | ChatScreen.svelte | colour variant. |
| Show Saving Icon | `showSavingIcon` | bool, false (DB:601) | SavePopupIcon.svelte:75 | Mockup default true. |
| Show Prompt Comparison | `showPromptComparison` | bool, false (DB:603) | botpreset.svelte:204 | A preset-editor feature, odd on a display page. |
| Use Chat Message Copy | `useChatCopy` | bool | Chat.svelte:720 | Shows a copy button. |
| Use Additional Assets Preview | `useAdditionalAssetsPreview` | bool | CharConfig.svelte:100,628, ModuleMenu | Studio/character editor behaviour, not display. |
| Use Legacy GUI | `useLegacyGUI` | bool | settings tabs (above) | Affects only the Settings layout; design replaces it. |
| Hide API Keys | `hideApiKey` | bool, true (DB:565) | BotSettings, OtherBotSettings, CharConfig | Mockup already retired it: `models.hideApiKey` is a note "always hidden" (data3.js:199-201). Confirm: the app still lets users show keys. |
| Disable Quote Formatting | `unformatQuotes` | bool, false (DB:566) | parser.svelte.ts | Label is negative ("Disable"). |
| Blockquote Styling | `blockquoteStyling` | bool | parser.svelte.ts | |
| Custom Quotes + 4 text boxes | `customQuotes` (DB:577) + `customQuotesData` | bool false; 4 strings, default ['“','”','‘','’'] (DB:578) | parser.svelte.ts | Boxes shown only when on (DSD:307). The box fallback in the UI is straight quotes `"` and `'` (DSD:310) but the stored default is curly: mismatch if the array is missing. |
| Beta Mobile GUI | `betaMobileGUI` | bool | bootstrap.ts:534 (window width <= 800; also forced by lite build) | Help EN:624: "Requires refresh". |
| Menu Side Bar | `menuSideBar` | bool | Sidebar.svelte:63 | Name opaque; it toggles the whole side bar (section 1.4 table). |
| Notification | `notification` | bool | NotificationToggle.svelte:11-33: requests browser permission; on denial alerts `permissionDenied` and turns itself off | WEB/WebView PLATFORM concern (Notification API). Mockup models three states (off/background/always); the app has one boolean. |
| Use Chat Sticker | `useChatSticker` | bool | DefaultChatScreen.svelte:580 | Shown only if `showUnrecommended` (DSD:361); help `unrecommended` EN:626. |
| Custom CSS | `customCSS` | string, '' (DB:571) | `updateTextThemeAndCSS` -> `CustomCSSStore` (colorscheme.ts:412) | Help EN:623 promises Ctrl+. toggle; I did not find the handler in `hotkey.ts` (not verified). |

### 1.4 Accessibility page (ASD:9-222; title "Accessibility" EN:1341)
Defaults: only those with `??=` in DB are set; an absent boolean is undefined = off.
| Item (EN label) | Field | Default | Takes effect | Notes |
|---|---|---|---|---|
| Ask Removal | `askRemoval` | true (DB:258) | Chat.svelte | Confirm before deleting a message. |
| Use Swipe for Regeneration | `swipe` | true (DB:118) | Chat.svelte:1196, panelGesture.ts, MobileCharacters | The "gestures" row; on a mouse it just enables the swipe arrows. |
| Remove subsequent when message remove | `instantRemove` | undefined | Chat.svelte | Opaque label; deletes later messages too. Destructive, no confirm text. |
| Send with Enter Key | `sendWithEnter` | true (DB:370) | DefaultChatScreen.svelte | |
| "Fixed at the bottom of the chat window (When unchecked, Shift + Enter changes to send a message.)" | `fixedChatTextarea` | undefined | DefaultChatScreen.svelte | MISLEADING: label bundles two facts; the Shift+Enter note belongs with Send with Enter. |
| Click Text to Edit | `clickToEdit` | undefined | Chat.svelte | |
| Enable Block Partial Edit (hover) | `enableBlockPartialEdit` | false (DB:376) | Chat.svelte | Hover-based, unusable on touch. |
| Long Press to Open Popup Editor | `longPressToPopupEditor` | false (DB:732) | TextAreaInput.svelte:92 | Touch. Has a `fallbackLabel`, meaning the EN key may be absent in older locales. |
| Enable Drag Partial Edit (select text) | `enableDragPartialEdit` | false (DB:377) | Chat.svelte | |
| Bot Menu when Launch | `botSettingAtStart` | false (type DB:999) | bootstrap.ts:531 | Opens the character settings panel on launch; the mockup relabels "Start in settings" (wrong: it is the bot menu, not Settings). |
| Show Menu Chat List | `showMenuChatList` | undefined | DefaultChatScreen.svelte | Chat-input menu entry, not a sidebar. |
| Show Menu Hypa Modal | `showMenuHypaMemoryModal` | undefined | DefaultChatScreen.svelte:1019 | Chat-input menu entry for the memory summary window. |
| Go to Character on Realm Import | `goCharacterOnImport` | undefined | characterCards.ts:2250 | Realm import only (also `forceRedirect`). |
| Side Menu Reroll Button | `sideMenuRerollButton` | undefined | DefaultChatScreen.svelte | |
| Local Activation in Global Lorebook | `localActivationInGlobalLorebook` | undefined | LoreBookData.svelte | Lorebook editor behaviour. |
| Show Request Info Inside Chat | `requestInfoInsideChat` | undefined | Chat.svelte | Developer detail (tokens, model). |
| Inlay Error Response | `inlayErrorResponse` | undefined (off) | index.svelte.ts:541 | When on, errors are shown as a chat message; mockup default true is wrong. |
| Lorebook Bulk Enabling | `bulkEnabling` | undefined | LoreBookSetting.svelte | Lorebook editor behaviour. |
| Show Translation Loading | `showTranslationLoading` | undefined | ChatBody.svelte | |
| Auto scroll to new message | `autoScrollToNewMessage` | true (DB:704) | Chats.svelte | |
| Always scroll (ignore scroll position) | `alwaysScrollToNewMessage` | false (DB:705) | Chats.svelte | Shown only if auto-scroll is on (ASD:165). |
| New Message Button Style | `newMessageButtonStyle` | 'bottom-center' (DB:706) | DefaultChatScreen.svelte | 6 options (bottom-center, bottom-right, bottom-left, floating-circle, right-center, top-bar); shown only if auto-scroll on AND always-scroll off (ASD:173). The button appears when you are scrolled up. |
| Create Folder on Branch | `createFolderOnBranch` | true (DB:717) | Chat.svelte | Mockup default false is wrong. |
| Move Menu Button to Bottom of Sidebar | `hamburgerButtonBottom` | false (DB:718) | Sidebar.svelte | One-hand reach. |
| Move Instead of Copy on CMP Convert | `moveInsteadOfCopyOnCMPConvert` | false (DB:734) | none | DEAD (fact 4). |
| Apply Additional Parameters to All Models | `applyAdditionalParamsToAll` | undefined | request/shared.ts | Belongs with models/parameters. |
| Enable RisuTanium Pro Tools | `enableRisuaiProTools` | `plugins.length > 0` (DB:723) | DefaultChatScreen.svelte:1000, Settings.svelte:150 | Reveals the plugin tools and the plugin settings entry. |
| Custom Sidebar Configuration (custom component) | `customSidebarItems` (DB:733, 1325) | [] | CustomSidebarConfig.svelte (dialog list of added entries with Delete, search-and-add of any setting) | Delete there is immediate with no confirm or undo. |
| "Accessibility" header | none | | | Nothing here is a screen-reader, contrast, large-target or reduced-motion setting. The page name overstates; real a11y items are `textTheme: highcontrast`, text size, and input sizes. |

### 1.5 Input-adjacent facts
- Hotkeys are on a separate page (HotkeySettings.svelte, slice 5a), not here.
- Haptics are hard-coded: `navigator.vibrate?.(15)` at SidebarRail.svelte:1009 and GridCatalog.svelte:580. No setting. DECISIONS.md:191 says the redesign adds an off switch (Android touch only).
- `isLite` build (`VITE_RISU_LITE === 'TRUE'`, lite.ts:6) hides parts of Settings (Settings.svelte:35,83), forces 'lite' colour scheme and standard text colours, and enables the mobile GUI (bootstrap.ts:534). It is a build flag, not a setting.
- Edge-swipe to open the sidebar: gesture code exists (`panelGesture.ts`, `panelGestureBinding`) but no setting toggles it.

## 2. Today in the mockup (D1 rows 219-282; data2..data5b.js add or remove none for pages display/input)
Searched data2.js, data3.js, data4.js, data5a.js, data5b.js: the only touch is data3.js:199-201, which retires `models.hideApiKey`. No `display.*` / `input.*` override exists.

Row count: display 35 (theme 8, font/size 10, chat 11, low power 6); input 29 (send 10, gestures 5, a11y 6, menu 8). Section ids at D1:29-30.

### 2.1 Mockup rows with no app source (invented)
| Row | Why invented |
|---|---|
| `display.background` (network/solid/image, D1:223) | App has only an image on/off (`customBackground`). No network/solid choices. `display.bgImage` (D1:224) matches the picker half. |
| `display.lowPower` (D1:255) | No low-power setting in the app (fact 5). Design feature (low power theme/performance). |
| `display.reducedMotion` (D1:256, follow system/on/off) | No setting; app reads the media query in two places. |
| `display.haptics` (D1:258) | Vibration hard-coded; DD-191 makes it new. |
| `display.streamOpt` (D1:259) | Real field is on Advanced and DD (DECISIONS.md:520) retires it. |
| `display.keepAlive` (D1:260) | Real field on Advanced (`advancedSettingsData.ts:70`); ignored on Android (App.svelte:87-90 returns early). |
| `input.edgeSwipe` (D1:279) | Gesture exists, setting does not. |
| `input.largeTargets`, `input.reduceTransparency`, `input.screenReader`, `input.focusRing` (D1:282-286) | None exist in the app (grep of `src` for these terms finds nothing). Design proposals; no stored field. |
Counts: 11 invented rows (6 display, 5 input), plus `display.bgImage` as partly sourced.

### 2.2 Mockup controls that do not match the real type or default
| Row | Mockup | App |
|---|---|---|
| `display.theme` | options standard / waifu / mobilechat / cardboard / **custom** (value 'custom') (D1:220) | real value for custom HTML is `customHTML`; `custom` is dead (section 1.1) |
| `display.colorScheme` | 3 options deepnexus / light / contrast (D1:221) | 16 presets + custom; "contrast" is a text theme, not a colour scheme |
| `display.textTheme` | standard / highlight / custom (D1:222) | standard / highcontrast / custom |
| `display.font` | 5 fonts incl. Nanum (D1:230) | default / timesnewroman / custom |
| `display.zoom` | 50-200 step 5 default 100 (D1:232) | match (app step 1) |
| `display.lineHeight` | 1-3, default 1.5 (D1:233) | 0.5-3, default 1.25 |
| `display.textAreaSize` / `textAreaText` / `sidebarSize` | 50-200 % (D1:235-237) | -5..5, 0..3, 0..3 named steps |
| `display.assetWidth` | 20-100 % default 100 (D1:238) | -1..40 rem; -1 unlimited, 0 hidden; default -1 |
| `display.settingsCloseSize` | 50-200 % (D1:239) | 16-48 px default 24 |
| `display.animSpeed` | 0.1-1.5 x, default 0.4 (D1:257) | 0-1 s duration, default 0.4 |
| `display.notification` | off / background / always (D1:246) | one boolean |
| `display.savingIcon` | default true (D1:245) | default false |
| `display.textBorder` | labelled "Text screen borders" (D1:225) | field `textBorder` is "Text Outlines"; "Text Screen Borders" is `textScreenBorder` (colour) |
| `display.quote*` | four text rows always visible (D1:248-251) | shown only when `customQuotes` is on |
| `input.botAtStart` | "Start in settings" (D1:272) | opens the bot menu (character settings), not Settings |
| `input.inlayError` | default true (D1:273) | undefined (off) |
| `input.newMsgButton` | icon / text / hidden (D1:279) | 6 positions; only when auto-scroll on and always-scroll off |
| `input.branchFolder` | default false (D1:296) | default true |
| `input.menuChatList`, `menuSidebar`, `goCharOnImport` | default true | undefined (off) |
| `input.menuSidebar` | "Menu side bar" | whole side bar on/off; wording unclear |

### 2.3 App settings missing from the mockup
Display: `waifuWidth`, `waifuWidth2`, `guiHTML` textarea, custom colour editor, custom text-colour editor, `showMemoryLimit` (only as `chatfeat.memLimit`) + `memoryLimitThickness`, `showFirstMessagePages`, `playMessage`, `playMessageOnTranslateEnd`, `roundIcons`, `textScreenColor`, `textScreenRounded`, `textScreenBorder` colour, `showPromptComparison`, `useChatCopy`, `useAdditionalAssetsPreview`, `useLegacyGUI`, `unformatQuotes`, `blockquoteStyling`, `customQuotes` toggle, `betaMobileGUI` = 21.
Input: `localActivationInGlobalLorebook`, `bulkEnabling`, `moveInsteadOfCopyOnCMPConvert`, `applyAdditionalParamsToAll`, `enableRisuaiProTools` = 5.
Total missing: 26. `hideApiKey` is deliberately retired (data3.js:199).

## 3. DD-250 repair state
### 3.1 The link and the fixture
- OBSERVED: `home/nav.js:41` `settingsRepair` builds `Nav.href('settings', { page: 'display', fixture: 'all-modes-hidden-repair' })`; Home's banner (`home/app.js:71`, strings `repair.h/p/btn`, strings.js:84,172) says "Only {mode} is shown / The other modes are hidden. You can show them again in Settings." with button "Show all modes".
- OBSERVED: Home fixture state (`home/data.js:104,119,127`): URL `only=rp|utility` hides the switcher; the fixture forces `S.only = S.only || S.mode`. Home modes are `rp`, `hybrid`, `utility` (data.js:10). So Home can currently hide the switcher only when a single mode (rp or utility) is chosen; hybrid cannot be the only mode (MAIN_MENU.md:109 asks if it can).
- OBSERVED: HOME_RETURN_SPEC.md:12,66 records the link target and that `settings/` has no such fixture ("left for slice 5c").
- DD-250 (DECISIONS.md:1337): link goes through `settings/index.html`; Settings adds the all-modes-hidden repair state in slice 5c. Page is `display` per the link.
- Older mockup (`mockups/settings.html:242,254,316-317,535-557`): fixture 'all-modes-hidden-repair' = `modeVis ['utility','hybrid']`, `hideUnused true`, from home. Section 'modes' with a "Hide unused modes" switch (id ctl-hideunused), a "Show all modes" button, a status line ("All 4 modes are visible" / "N of 4 modes visible: ..."), and a confirm dialog "Show all modes?" listing the modes that become visible; confirm keeps unsent draft and scroll. Back reads "Back to Home" -> `home.html?mode=utility` (settings-checks.md:43). That mockup had four modes (utility, roleplay, hybrid, playground); Home now has three.

### 3.2 What the repair state must show (inferred from the above, not yet decided)
- Page 화면·읽기 opens on the mode section (or the repair callout above it), not the first section.
- Current visibility: which of rp / hybrid / utility are visible, and that hide-unused is on.
- One clear action "Show all modes" (matches Home's button label) with the dialog result and a status line; restoring does not lose the Home draft and Back returns to Home (DD-210 return contract).
- Hide-unused switch (so repair is reversible) and, if allowed, per-mode visibility.

### 3.3 Stored settings touched: new, not in the app
- OBSERVED: no app field for mode visibility. Onboarding's checkbox "Hide unused modes and features?" (STARTUP_AND_ONBOARDING.md:106) says the exact set is "decided at implementation". AUDIT_RESPONSE.md:149 asks whether mode is persisted. MAIN_MENU.md:108-109 lists the open questions.
- So the repair state touches NEW fields (names are proposals): a hide-unused flag and a visible-mode set over rp/hybrid/utility. Today's only related existing field is `showUnrecommended` (DB:228), unrelated. The state is therefore a design-only requirement for the main session to add storage for.
- It is a device-or-profile scope question: modes follow the profile in the older mockup (scope SC.dev, settings.html:316).

## 4. DD-223 undo window (10 s everywhere; the toast says when undo ends early)
Rule: DECISIONS.md:1300. Settings has one toast element (`psToast`, slice2.js:345-360); a new toast replaces the old one, which removes its Undo button. Default `toastMs` is 10000 (slice2.js:254), `toastGraceMs` 3000 (min remaining after a dialog closes, slice2.js:327). While any dialog, sheet or menu is open the toast timer is held (slice2.js:359 "never runs out behind a dialog"). Slices 5a/5b `toast()` is `B.psToast` (slice5a.js:69, slice5b.js:55) so they inherit the 10 s default unless `ms` is passed.
Separate from the toast: the Ctrl+Z / Alt+Z library undo stack (`LU`, 50 entries, slice2.js:595) stays live after the toast closes; deleted presets stay in "Recently deleted" until the page closes (mockup, slice2.js:196). So the toast ends but undo does not, except where noted.

| Toast (file:line) | Window now | Can undo end early? | Does the toast say so? |
|---|---|---|---|
| Preset deleted (slice2.js:676, kind delete, action luAction) | 10 s toast; LU entry persists | Yes: "Delete forever" in Recently deleted (slice2.js:703-707) removes the entry; purge toast has `ms: 4000`, no action | No |
| Folder deleted (slice2.js:1276) | 10 s | Same LU rules | No |
| Folder made (slice2.js:1270) | 4 s, no undo | n/a | n/a |
| Preset switched (slice2.js:525, Undo Alt+Z) | 10 s; undo works if previous preset still exists (checks `P(prev.id)`, "nothingLib") | Yes: previous preset deleted meanwhile | No |
| Restore applied (slice2.js:498, kind restore) | 10 s | Yes: Alt+Z undo of bulk changes capped by `maxUndo` 50 | No |
| Live-save undo / redo (slice2.js:486, 604 kind undo / lu-undo) | 10 s, no action button | n/a (result messages) | n/a |
| Connection deleted (slice3.js:372, kind conn-delete) | 10 s | Yes: restoring needs the key re-entered (slice3.js:369 shows "Set key" action when the key was dropped) | Partly: separate "Set key" toast |
| Parameter change / reset (slice4.js:490, action only when `lu`) | 10 s | Yes: other edits push the stack | No |
| Persona deleted (slice5a.js:354) | 10 s, sub shows chats and new active persona | Yes: LU rules | No |
| Plugin removed (slice5a.js:498) | 10 s | Yes | No |
| Module deleted (slice5a.js:729) | 10 s | Yes | No |
| Purge (slice5a.js:105, 4 s), conversion open (slice5a.js:737, action not undo), short notices (2.5-5 s) | 2.5-5 s | no undo | n/a |
| Preset deleted, chat features (slice5b.js:331) | 10 s | Yes | No |
| Translation cache cleared (slice5b.js:616-617) | 10 s toast; undo callback also checks `Date.now() - t0 > CFG.undoMs` (10 s) and then says `cacheGone` | Yes, at 10 s regardless of Alt+Z; also if re-translation refilled the cache (`ST.trCache === 0` check) | Only after the fact |
| Slice 1 (slice1.js:701) `toast()`: 2.6 s plain toast, no undo | 2.6 s | n/a | n/a |
Observed inconsistency: slice 5b's cache undo is the only place where Alt+Z itself stops at 10 s; every other delete keeps Alt+Z until the page closes. None of the toasts mention an early end ("until you leave this page", "until Delete forever"). This is the gap DD-223 asks to fix. Not run; reading only.
For 5c-1: the only undo-worthy actions are the repair "Show all modes" (non-destructive; proposal: no undo, or undo for 10 s), "Remove custom sidebar item" (app deletes instantly), and Reset-to-default on a row.

## 5. Device floor notes
- OBSERVED: the colour grid uses `conic-gradient` (ColorSchemeSelect.svelte:21) and `grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr))` (line 41): Chrome 69+/57+ both fine for Android 10 WebView on Note 9. INFERRED only; not rendered.
- Low power: the app's only knobs are `animationSpeed` (0 = instant, DSD:226-229) and the Advanced streaming optimisation. No blur/shadow switch exists. For Pi 3 and Note 9 the cost drivers on these pages are `customBackground` (large png/webp/gif; GIF animation), `waifu` theme transition images (ChatScreen.svelte:41-46 with `TransitionImage`), heavy `customCSS`, and large `assetWidth` images. INFERRED.
- `betaMobileGUI` only applies at width <= 800 and "Requires refresh" (EN:624), so it matters for Note 9 portrait only.
- `hamburgerButtonBottom`, `longPressToPopupEditor`, `sideMenuRerollButton`, swipe and haptics are the touch-ergonomics items for Note 9. Hover-based `enableBlockPartialEdit` is useless on touch-only devices.
- `fullScreen` (Tauri desktop only) and `notification` (Notification API, may be unsupported in Android WebView; the code catches the missing Permissions API but calls `Notification.requestPermission` unguarded, NotificationToggle.svelte:20) are platform-limited. Pi 3 runs a desktop browser: Tauri fullscreen does not apply unless it is the Tauri build.
- `keepSessionAlive` is skipped on Android (App.svelte:87-90) because a foreground service already does it; it belongs to Advanced.
- Low-power mode in the mockup (`display.lowPower`, D1:255) has no app source; any design needs the main session to add storage. Reduced motion should follow `prefers-reduced-motion` which the app only partly honours.

## 6. Plain-label problems (source of "misleading")
`theme` label is a sentence; `UISize` = chat text size but also scales editor text; `iconsize` is avatar size; `animationSpeed` is a duration (bigger = slower); "Remove subsequent when message remove" = delete the following messages too; `fixedChatTextarea` bundles Shift+Enter note; "Menu Side Bar" opaque; "Inlay Error Response" = show errors as a chat message; "Show Menu Hypa Modal" = memory summary window in the chat menu; "Disable Quote Formatting" is a negative; "Text Outlines" vs "Text Screen Borders" vs "Custom Text Screen Color" are three similar names; "Display & Audio" page name includes only two sound toggles; "Accessibility" page has few a11y settings.

## 7. Platform and dead summary
- Dead (no effect): `showMemoryLimit`, `memoryLimitThickness`, `moveInsteadOfCopyOnCMPConvert`, theme 'custom' branch (and so `display.customGui` button unreachable from the UI).
- Legacy/layout-only: `useLegacyGUI` (settings layout), `betaMobileGUI` (beta), `useChatSticker` (flagged "unrecommended").
- Platform-only: `fullScreen` (Tauri desktop), `notification` (web/WebView), `longPressToPopupEditor` and swipe (touch), `settingsCloseButtonSize` (desktop window).
- Belong elsewhere by function: `showPromptComparison` (presets), `useAdditionalAssetsPreview` and `localActivationInGlobalLorebook`, `bulkEnabling` (Studio/lorebook), `applyAdditionalParamsToAll` (models), `goCharacterOnImport` (library/import), `requestInfoInsideChat` (developer), `hideApiKey` (keys/connection).

## 8. Design proposals (not decisions)
1. Regroup 화면·읽기: 테마와 색 (theme, colour scheme, text colour, background, custom editors), 글꼴과 크기 (font, chat text size, line height, avatar size, input sizes, sidebar size, asset width, text screen look), 채팅 표시 (quotes, first-message pages, copy button, saving icon, hide images), 소리와 알림 (play message, translate-end sound, notification), 움직임 (animation speed as 느림-빠름 mapped from duration, plus low power if the main session agrees), 고급 (custom CSS, beta mobile GUI, legacy), and the mode-visibility section above everything in the repair fixture.
2. Regroup 입력·접근성: 보내기·편집, 스크롤·제스처, 메뉴·사이드바 (with move-to-bottom, custom sidebar entry), 삭제와 확인, 알림 표시, with lorebook and import items either moved or relabelled.
3. Real controls: slider for sizes with named steps and "default" reset; segmented for 6-option button position as a small picker (position preview), file picker for background, colour swatch grid (reuse 16 presets), select for fonts with a "직접 입력" field; keep checkboxes as switches.
4. Remove or flag: rows in 2.1 with no source (mark `새 기능` where a design proposal is kept); drop the dead items; replace `useLegacyGUI` with nothing.
5. Repair state: a top section "표시할 모드" with 3 mode switches, hide-unused switch, "모든 모드 보이기" button and dialog (matching mockups/settings.html:535-557), status line, and Back to Home.
6. Undo: all Settings toasts at 10 s; add a sub line when undo ends early (e.g. "삭제 취소는 이 창을 닫을 때까지 쓸 수 있어요" if the LU entry dies on close); cache-clear undo window is 10 s with no Alt+Z beyond it, so say so.

## 9. Open product questions
1. Mode storage (DD-250). The app has no mode-visibility fields. Options: (a) add `hiddenModes` set + `hideUnusedModes` flag, profile-wide (recommended: matches the older mockup and onboarding); (b) device-only; (c) Home-only with no Settings repair (not allowed by DD-250). Also: can Hybrid be the only mode? Options: yes, or never hide Hybrid (recommend: let any single mode be the only one, and repair always works).
2. Low power and reduce motion. Options: (a) add real stored `lowPower` + `reducedMotion` (system/on/off) to the app (recommended, the redesign relies on them); (b) keep as mockup-only stand-ins with a "새 기능" tag; (c) drop.
3. Invented a11y rows (large targets, reduce transparency, screen-reader hints, focus ring, edge swipe, haptics). Options: (a) remove all; (b) keep only those the main session commits to build (recommend: keep haptics off switch, per DECISIONS.md:191, edge swipe and reduce transparency as tagged proposals; drop screen-reader hints and focus ring until a real implementation exists); (c) keep all as proposals.
4. Dead settings (`showMemoryLimit`, `memoryLimitThickness`, `moveInsteadOfCopyOnCMPConvert`). Options: (a) hide them (recommend); (b) show with "지금은 동작하지 않아요"; (c) ask main session to revive the memory-limit line first.
5. Theme options. Real: Standard, Waifu, Mobile Chat, CardBoard, Custom HTML (+ legacy custom GUI). Options: (a) keep all five with plain names and thumbnails; (b) hide the three alternate chat themes behind "고급" ; (c) reduce to Standard + Custom HTML (recommend (a): they are real, selectable behaviours).
6. Colour scheme. Real list is 16 presets + custom. Options: show all 16 as a swatch grid (recommend, matches app); show 3 mockup names (no source); group by light/dark.
7. Animation speed. Real value is a duration 0-1 s. Options: label "느림-빠름" with reversed mapping (recommend; changes only presentation); keep the raw seconds; replace by on/reduced/off.
8. Items that belong elsewhere (`showPromptComparison`, `useAdditionalAssetsPreview`, `localActivationInGlobalLorebook`, `bulkEnabling`, `applyAdditionalParamsToAll`, `goCharacterOnImport`, `requestInfoInsideChat`, `hideApiKey`). Options: move to their owning page (Settings or Studio) (recommend); keep on 입력·접근성 under "그 밖에"; remove.
9. `hideApiKey` is retired in the mockup ("always hidden", data3.js:199) but the app still lets users reveal keys. Confirm retire and reveal-on-demand per field, or keep the switch.
10. Notification. App is one boolean with a permission prompt and a platform limit; mockup has three states. Options: boolean + status line (recommend); keep three states as new work; drop on Android WebView.
11. Quote formatting: four boxes only when custom quotes is on (app) vs always visible (mockup). Recommend the app behaviour with a live preview line.
12. Undo (DD-223). Cache-clear undo ends at 10 s for Alt+Z as well; other deletes persist in the stack until the page closes. Options: say "until you leave this page" on every delete toast (recommend); make every undo end at 10 s; keep as is. Confirm whether Settings keeps a Recently-deleted bin beyond the page (mockup says until the page closes).
13. `useLegacyGUI`: drop in the redesign (recommend), or keep only as a hidden compatibility setting.

## 10. Not verified
Did not run the app or the mockups. Not read: ChatScreen.svelte theme details beyond the anchors, CustomColorSchemeEditor and CustomTextThemeEditor fields, the Ctrl+. custom-CSS toggle handler, which locales have `longPressToPopupEditor`, whether `unformatQuotes`/`blockquoteStyling` have default values set elsewhere, the exact mobile layout of the app pages, the rest of slice 5a/5b toast wording and any DD-223 early-end copy in the other lanes, and runtime behaviour of any toast timer.
