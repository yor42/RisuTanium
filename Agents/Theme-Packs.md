# Theme packs: reference for the UI overhaul's theming contract

Working reference, 2026-10-27, lane A. The decisions are the original entries in [Maintainer-Context](Maintainer-Context.md); this file holds the data they point to (the idea list, the capability matrix, the font tables). If this file and an `MC-` entry disagree, the entry wins. Nothing here authorizes application code, a commit or a push.

## Purpose

Custom theme packs are an end goal of the UI overhaul: tokens plus part-scoped CSS, no free CSS, with a theming contract as the overhaul's first implementation stage (`MC-689`). A small set of acceptance packs proves the contract: it passes if every acceptance pack can be written as a pack with no app-code change, so part names must be fine-grained, part CSS may use layout and decoration, critical surfaces take tokens only, and packs change appearance only (`MC-691`). The acceptance packs double as the documentation examples; real product names are never used (`MC-692`). `MC-695` fixes the acceptance set at five, records the pack rules and the font policy, and amends `MC-691` and `MC-692`.

Source of the idea list: the maintainer's brain dump (`84d86594-Human_brain_dumps.txt`, uploaded in session b5cab228), 17 entries. The capability matrix, the pack-purpose notes and the font checks are lane A's work on 2026-10-27, from `%TEMP%\risu-b715\themes\decisions-2026-10-27.md`.

The "nod to" wording below is the maintainer's internal provenance for each idea. Per `MC-692`, real product names are never used in the packs themselves.

## The 17 ideas

Status is one of: **acceptance** (one of the five packs that prove the contract and serve as documentation examples), **gallery** (backlog), **dropped**, **baseline** (not a pack). Wording follows the maintainer's list where possible.

### Utility

| # | Pack | Status | Description (maintainer's list) | Name origin |
|---|---|---|---|---|
| 1 | Banana Cocoa | acceptance | Nod to kakaotalk: yellow messenger-like layout on a blue background. | Kakao -> Cocoa, with banana referring to the kakaotalk yellow. |
| 2 | Coordinated Blue | gallery | Nod to dis'cord'. The list spells it "Cordinated Blue"; the "Cordination" typo is intentional in the list. | Discord -> Cord -> **Coord**ination. |
| 3 | Human Orange | gallery | Nod to the Claude Code / Claude desktop app. | Anthropic -> Human. |
| 4 | Codex White | dropped (`MC-695`) | Nod to ChatGPT / Codex. | Codex (both OpenAI Codex and the book) + White. |
| 5 | Office Sheet | acceptance | Nod to Excel or other spreadsheet programs. | MS/Libre **Office** + Spread**Sheet**. |

### Games

| # | Pack | Status | Description (maintainer's list) | Name origin |
|---|---|---|---|---|
| 6 | Aqua Halo (renamed from Archived Blue, `MC-695`) | gallery | Nod to the Blue Archive UI: white and blue buttons, a darker blue or sky-blue background. | Blue Archive -> Archived Blue; renamed to Aqua Halo by the maintainer. |
| 7 | Terran Eclipse | acceptance | Nod to the Arknights UI and the in-game PRTS: neon blue, yellow and red highlights in the background or on edges; black UI elements with white outline and text, or white elements with black outline and text; frosted semi-transparent elements. | Terra (the in-universe planet of Arknights, and general Latin) + Eclipse, a reference to a generally dark theme. |
| 8 | Peachy Talks | gallery | Nod to Momotalk, Blue Archive's in-universe messenger app: overall similar to Kakaotalk, but with pink as the accent colour instead of neon yellow. 경기천년제목 is the main font. | Peach (Momo) + Pink. |
| 9 | Elemental Ivory | gallery | Nod to the Genshin Impact UI: ivory baseline, dark space-like background, gold or dark brown text and icons. | Elements + Ivory. |
| 10 | Aerial Glass | gallery | Nod to Ace Combat: semi-transparent, HUD-like lines and flat colour, green or blue. | "Aerial" refers both to the semi-transparent philosophy of Windows Aero and to the aerial combat of Ace Combat. |

The maintainer's note on this group: the games' original UI fonts need separate investigation. See the game-font guesses below.

### Others

| # | Pack | Status | Description (maintainer's list) | Name origin |
|---|---|---|---|---|
| 11 | Deep Nexus | baseline (not a pack) | The default, original look and the baseline the theming contract is defined against. The list points to `projects/RisuAI-UI-Rework/Agents/design` and what the UI overhaul sessions are building. | None given. |
| 12 | Cardboard Cutout | gallery | Original theme with no reference. Themed after cardboard crafts and Nintendo Labo: textured background, cardboard-like edges. | Cardboard, "straightforward". |
| 13 | Scratch White | acceptance | Original theme with no reference. Themed after paper notes: white background, paper texture, torn edges, the 나눔손글씨 font. | Scratchpad. |
| 14 | Origin Navy | acceptance | Nods to upstream. Follows the current colour and design language, stylized to fit the new UI. | Origin + the navy blue of upstream. |
| 15 | Carbon Fiber | gallery | Original theme with no reference. The list says it aims to be OLED-friendly, simplistic true black with shades of grey and carbon-fibre textures, and ends with "light theme". The maintainer's clarification (`MC-695`): "black background, white text and outlines". | None given. |
| 16 | Nostalgic Millennia (the list spells it "Nostaltic millennia") | gallery | Turns the app into an early-2000s web style, with old system default fonts like 굴림 or Tahoma. | None given. |
| 17 | The Project | gallery; best spare for the acceptance set | ASCII-art-style UI that nods to the beginning of the internet and computers, with unrefined, simulated text-only GUI. It does not have to be text only; the general look of old text-only web pages is fine. | The first CERN web page, `http://info.cern.ch/hypertext/WWW/TheProject.html` ("TheProject" in the URL). |

Counts: 5 acceptance (1, 5, 7, 13, 14), 10 gallery (2, 3, 6, 8, 9, 10, 12, 15, 16, 17), 1 dropped (4), 1 baseline (11); total 17.

## Capability matrix

Lane A, 2026-10-27. Marks: ● strong, ○ light, - not used. Text after a mark qualifies it. Row numbers match the idea list above.

| # | Pack | Colour | Font | Corners | Density | Blur / transparency | Motion | Part layout | Decoration | Texture image |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Banana Cocoa | ● | ○ | ● | ○ | - | - | ● messenger | ○ | - |
| 2 | Coordinated Blue | ● | ○ | ○ | ● | - | - | ○ sidebars | - | - |
| 3 | Human Orange | ● | ● | ○ | ○ | - | - | - | - | - |
| 4 | Codex White | dropped | | | | | | | | |
| 5 | Office Sheet | ○ | ○ system | ● none | ● compact | - | - | ● grid | ● grid lines | - |
| 6 | Aqua Halo (was Archived Blue) | ● | ○ | ● | - | ○ | ○ | ○ | ● | - |
| 7 | Terran Eclipse | ● | ○ | ● angled | - | ● frosted | ○ | ○ | ● outlines, neon edges | - |
| 8 | Peachy Talks | ● | ● named | ● | ○ | - | - | ● messenger | ○ | - |
| 9 | Elemental Ivory | ● | ○ | ○ | - | ○ | ○ | - | ● gold ornaments | ○ |
| 10 | Aerial Glass | ● | ○ mono | ● none | - | ● | ○ | ○ HUD | ● HUD lines | - |
| 11 | Deep Nexus | the baseline, not a pack | | | | | | | | |
| 12 | Cardboard Cutout | ○ | ○ | ● uneven | - | ○ | ○ | - | ● cut edges | ● |
| 13 | Scratch White | ○ | ● named, CJK | ● torn | - | - | - | - | ● torn edges | ● paper |
| 14 | Origin Navy | ● | ○ | ○ | ○ | - | - | - | - | - |
| 15 | Carbon Fiber (black background, white text and outlines) | ● | - | ○ | - | - | - | - | ○ | ● |
| 16 | Nostalgic Millennia | ● | ● system | ● none | ● | - | - | ○ | ● bevels | - |
| 17 | The Project | ● | ● mono | ● none | ● | - | - | ● | ● ASCII frames | - |

## What each acceptance pack tests

- **Origin Navy:** tokens only, with no part CSS.
- **Office Sheet:** part layout, density, square corners and grid decoration.
- **Terran Eclipse:** blur and transparency, outlines, and performance at the Note 9 floor.
- **Scratch White:** texture images, irregular edges, and a bundled Korean font (licence and size).
- **Banana Cocoa:** the chat screen reshaped into a messenger layout.

Lane A's reading: together these cover every matrix column. The Project is the best spare, as the strip-every-default test (it strips every default decoration).

## Pack rules (`MC-695`)

The maintainer's eight answers are quoted verbatim in `MC-695`; the rules below are lane A's wording of them.

1. **Fonts:** a pack ships only the unmodified files its foundry publishes. No self-made subsets or format conversions.
2. **Licence field:** every pack carries a licence and attribution field, checked when the pack is installed.
3. **Free packs:** packs bundled with the app must be free. Packs distributed separately are not restricted by this rule.
4. **Size:** there is no size cap. Importing an exceptionally large pack shows a warning first. The threshold for "exceptionally large" is not decided: TODO(evidence).
5. **Images:** packs may carry image assets, such as textures.
6. **Blur:** every pack that uses blur or transparency effects ships a reduced-effects fallback.
7. **Light and dark:** a pack may be light-only or dark-only. The theme picker shows which modes a pack supports.
8. **Game fonts:** licence-check the fonts fans believe each game uses, and pick from the compatible guesses. Use a generic fallback only when none is compatible.

Earlier rules that still apply: tokens plus part-scoped CSS, no free CSS (`MC-689`); critical surfaces (warnings, data-loss and save-failure prompts, permission dialogs, restore and export dialogs) take tokens only, and packs change appearance only (`MC-691`).

## Font tables

**Scope (`MC-695` answer 9):** a pack's font covers UI elements, not titles or logos. NanumGothic (나눔고딕; OFL 1.1, unmodified foundry files) covers most game-nod packs. Title-face guesses below are recorded but out of scope.

Confidence marks are carried over exactly from the lane A source file and are not upgraded here. The SOURCED label was added by this file for fan-claim basis cells; the source file says "fan-claimed". VERIFIED means lane A checked the named primary source on 2026-10-27. UNVERIFIED means a source could not be read or checked. SOURCED means the claim is stated by a named third-party source. INFERRED means lane A's inference or the source's passage could not be fetched.

### Named fonts

| Font | Used by (per the idea list) | Finding | Mark and source |
|---|---|---|---|
| Nanum Pen Script (a 나눔손글씨 face) | Scratch White (the list names 나눔손글씨 generally; which face is not stated in the list) | OFL 1.1. "NanumPen" is a Reserved Font Name. A format change or subset counts as a "Modified Version". This is the basis of rule 1. | VERIFIED: `raw.githubusercontent.com/google/fonts/main/ofl/nanumpenscript/OFL.txt` |
| 경기천년제목 (Gyeonggi Cheonnyeon Jemok) | Peachy Talks (main font); fan-claimed for Blue Archive | Free to use. "프로그램에 탑재하여 배포하는 것도 가능합니다". "폰트 자체를 그대로 판매하거나 유료로 양도하는 행위는 허용되지 않습니다". The terms say nothing about modification. The 공공누리 type 1 label on that page applies to "이 게시물" (the page itself). | VERIFIED: `gg.go.kr` ciIdx=679. The KOGL Type 1 listing at `gongu.copyright.or.kr` (wrtSn=13288411) is UNVERIFIED: lane A's fetch returned HTTP 500. |
| Gulim (굴림) | Nostalgic Millennia | No self-hosting and no WOFF or WOFF2 conversion. Naming it in a CSS font stack is allowed. | VERIFIED: `learn.microsoft.com/en-us/typography/fonts/font-faq` |
| Tahoma | Nostalgic Millennia | Same as Gulim. | VERIFIED: same page |

### App fonts

| Font | Finding | Mark |
|---|---|---|
| gg sans | Proprietary. | Not verified by lane A. |
| OpenAI Sans | Proprietary. | Not verified by lane A. |
| Styrene | Proprietary. | Not verified by lane A. |
| Tiempos | Proprietary. | Not verified by lane A. |

The source file does not say which gallery pack each app font belongs to; TODO(evidence).

### Game-font guesses

Second check, 2026-10-27: general-purpose research, lane A spot-checked. Every match to a game below is eyeballing or a fan claim. No designer statement or verified datamine was found.

| Game | Best shippable pick | Licence and file sizes | Basis of the guess | Not shippable |
|---|---|---|---|---|
| Blue Archive | 경기천년제목 for Korean, plus Noto Sans KR for Latin and body text. | 경기천년제목: terms as in the named-fonts table (VERIFIED). Noto Sans KR: OFL 1.1, 10,414,588 B variable TTF. | SOURCED: 경기천년제목 is fan-claimed by a DCInside projectmx post (no=10376867) and namu.wiki 경기천년체 "사용 예시". | G2 Sans Serif and RoG2 (Morisawa, commercial). No MomoTalk-specific font was identified. |
| Arknights / PRTS | Source Han Sans (body). Source Han Serif is the title face: out of scope. | OFL 1.1, Reserved Font Name 'Source'. VERIFIED: `adobe-fonts/source-han-sans` LICENSE.txt. Adobe's unmodified KR files: SourceHanSansKR-Regular.otf 4,632,304 B; SourceHanSerifKR-Regular.otf 7,669,328 B. | SOURCED: gcores 135723 and the TimWangZi fan list. | Bender (no explicit licence). Novecento Wide (its free EULA bans app embedding; lane A could not read the PDF: UNVERIFIED). |
| Genshin Impact | NanumGothic ExtraBold for the Korean side. | OFL, 2,112,720 B. | INFERRED: Namu says the game's Hangul came from it; the passage could not be fetched. | HYWenHei-85W (Hanyi, commercial). |
| Ace Combat 7 | NanumGothic (the default UI font). | NanumGothic: OFL 1.1. | The maintainer: the fan fonts "are for title recreation, not in game texts" (`MC-695` answer 9). | ACES07 (a title face, out of scope): a fan recreation with no explicit licence, 247 glyphs and no Hangul, and it copies a proprietary design. BNS-UCGothicLatin-DB: proprietary. |

Sizes matter for rule 1 (unmodified foundry files) because a bundled pack carries the whole file; no subset is allowed.

## Open items

1. **Nostalgic Millennia on Android.** The pack's period fonts are Gulim and Tahoma, which can be named in a font stack but not shipped (VERIFIED, named-fonts table). A stand-in candidate, Galmuri, was proposed in the lane A brief; it is **not licence-checked**: TODO(evidence), check its licence and whether the foundry publishes an unmodified file before relying on it. Whether Gulim or Tahoma is installed on the Android target is not recorded: TODO(evidence).
2. **Ace Combat (Aerial Glass).** The fan fonts are title recreations (`MC-695` answer 9), so they are out of scope. The UI text uses NanumGothic. Whether the matrix's "mono" for Aerial Glass still holds is open.
3. **MomoTalk (Peachy Talks).** No MomoTalk-specific font was identified. The list names 경기천년제목 as Peachy Talks' main font; the Blue Archive fan claim for the same font is SOURCED, not designer-confirmed.
4. **KOGL listing for 경기천년제목.** The gongu.copyright.or.kr page returned HTTP 500; its content is UNVERIFIED. The gg.go.kr terms are VERIFIED and are what rule 1 relies on.
5. **Novecento Wide EULA** could not be read (PDF): UNVERIFIED. It matters only if Arknights' title font is revisited.
6. **App fonts** (gg sans, OpenAI Sans, Styrene, Tiempos) were not verified; they are recorded as proprietary on the source file's word only.
7. **"Exceptionally large" import threshold** (rule 4): TODO(evidence), no number decided.
8. **Where the Human Orange pack sits.** `MC-695` reads the answer "only accept human orange" as keeping it in the gallery. The maintainer's "yeah" in answer 9 followed that question, so lane A takes it as confirmed (INFERRED).
