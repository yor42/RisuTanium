# DEEP NEXUS - design language

Date: 2026-10-16. **Status: design proposal and sample package for the next UI overhaul.** Not an implementation authorization, not a layout decision and not a campaign record. Planning context: [product overhaul direction](../planning/2026-10-16-product-overhaul-direction.md) sections 2, 5, 6 and 8. The file index and integration steps are in [README.md](README.md).

![DEEP NEXUS mockup: glass cards on the abyssal canvas over the network background, with the status mark in a run card and a legend of the four states](mockup-preview.png)

*Synthetic content, rendered from [mockups/home.html](mockups/home.html) with a simulated pointer at the lower left (rendered before the click-wave change in [AUDIT_RESPONSE.md](AUDIT_RESPONSE.md); the current renderer shows links only inside a wave ring). The status mark's placement in the run card is one example placement, not a decision about Home's layout. That page is now the 3-mode main menu ([MAIN_MENU.md](MAIN_MENU.md)); the run card with every status is in [mockups/run-status.html](mockups/run-status.html).*

## 1. Philosophy

DEEP NEXUS is sophisticated minimalism with a warm heart: a single abyssal deep-blue canvas, translucent glass surfaces and restrained luminescence, and a warm light wherever the person is. It should look sleek and professional and also feel welcoming and a little charming, never soulless or cold: a place people are glad to come back to, not a control room.

Light is reserved for meaning. A cyan glow says the system is doing something; a warm light says "this is you, or yours". Neither is decoration.

It deliberately avoids aggressive cyberpunk tropes: no neon grids, glitch effects, scanline overlays, hard magenta/cyan clashes, angular HUD chrome or constant attention-seeking motion. It equally avoids the cold opposite: an empty, all-blue console that speaks only in system terms.

Principles:

1. **Depth through translucency, not shadow.** Hierarchy comes from surface opacity steps and hairline borders on one canvas, not from stacked drop shadows.
2. **Luminescence is a signal.** Only active states glow. A static screen should be almost entirely non-luminous.
3. **Motion explains state.** Every status animation maps to a run activity and has a still equivalent plus a text label. The network background is the one ambient exception; it is slow, low-contrast and fully optional (section 6).
4. **Cheap by construction.** Animate `transform` and `opacity` only in the DOM. Blur and glow sit behind tokens and have low-power fallbacks.
5. **Warm toward people.** Wherever the person appears (their name, their picture, a greeting, a finished task), the interface turns warm. Cyan stays the colour of the system's state.
6. **Speak like a person.** Copy is short, friendly and plain, and greets people by name once it knows it. Charm lives in a few moments, not in every pixel.

### Warmth

The mockup that shows this is [mockups/onboarding.html](mockups/onboarding.html). The colours are tokens in [theme/nexus-tokens.css](theme/nexus-tokens.css) (section 2).

- **Warm hue.** `--nexus-warm` (`#ffb38a`) is used for names, greetings and the person's own things. It measures 11.42:1 on the onboarding card. It is never used for status, warnings or errors: the caution yellow `#ffd166` and the error `#ff6b81` always come with an icon or words, so the three cannot be confused by hue alone.
- **Avatar placeholder.** A warm gradient (`--nexus-warm-from` to `--nexus-warm-to`) with the initial in canvas colour (9.95:1 at the darker end), instead of an empty dashed box. Its ring is warm at 55% (3.8:1 against the card and canvas).
- **Warm bloom.** A second static radial bloom at the lower left of `.nexus-canvas` (`--nexus-canvas-warm`, warm at 13%), so the abyss reads as lit from below rather than empty. It never animates and is hidden in forced colours.
- **Soft shapes.** Generous radii: 16 px option cards, 20 px panels, 28 px avatar. Nothing the person touches has sharp corners; inputs and buttons use 10 to 11 px.
- **Small responses.** An option card lifts by 2 px under a hover-capable pointer. The chosen card's icon tilts and grows slightly. The avatar responds to hover. These use `transform` only, and reduced motion removes them.
- **Voice.** Second person, contractions and short sentences: "Hi, welcome to RisuTanium", "What brings you here?", "Nice to meet you, Mina.", "Ready when you are, Mina", "All set, Mina". It is not cutesy: no emoji in interface text, no mascot voice and at most one exclamation mark in a flow ("Have fun!"). Errors and warnings stay calm and plain, never jokey.
- **Wording reference: Discord.** Discord's interface copy is the tone reference for wording: casual and direct, friendly without being silly, and plain about what happens next. Use it for the feel, not as text to copy.
- **Where charm goes.** Greetings, the first picture, finishing and empty states. Working screens such as chat and editors stay quiet.
- **Sentence case** for every label, legends included (section 4).

Tailwind gets `text-nexus-warm`, `from-nexus-warm-from` and `to-nexus-warm-to` from `nexus.css`. Not designed yet: a one-time greeting motion for the status mark on the welcome screen. It would need a new status, or an animation outside the status set, because the mark never animates while idle (section 8).

## 2. Color tokens

Defined in [theme/nexus-tokens.css](theme/nexus-tokens.css). All ratios are WCAG 2.x contrast after alpha compositing. They were computed with the WCAG relative-luminance formula against the canvas `#00011C`. The worst case is the bloom region (`#00023B`), and the second column gives that value.

| Token | Value | Use | Contrast canvas / bloom |
|---|---|---|---|
| `--nexus-canvas` | `#00011C` | App background (abyss) | - |
| `--nexus-canvas-bloom` | `#00023B` | Soft radial bloom at the top; the original canvas color | - |
| `--nexus-canvas-warm` | `rgb(255 154 122 / 0.13)` | Warm bloom at the lower left. Muted text at its peak is 6.02:1 | - |
| `--nexus-surface` | `white / 0.03` | Cards, panels: `bg-white/[0.03]` | - |
| `--nexus-surface-raised` | `white / 0.06` | Selected nav item, buttons, rows | - |
| `--nexus-surface-flat` | `rgb(14 15 42 / 0.94)` | Low-power and reduced-transparency replacement for blurred glass | - |
| `--nexus-edge` | `white / 0.07` | Hairline borders: `border-white/[0.07]` | 1.13 / 1.14 (decorative only) |
| `--nexus-edge-strong` | `white / 0.16` | Borders that must be noticed (never the only cue) | 1.46 / 1.47 |
| `--nexus-text` | `white / 0.92` | Primary text | 17.22 / 16.44 |
| `--nexus-text-secondary` | `white / 0.64` | Secondary text | 8.27 / 7.99 |
| `--nexus-text-muted` | `white / 0.55` | Minimum for any text, including captions | 6.24 / 6.06 |
| `--nexus-accent` | `#38D9FF` | Active indicators, glow color | 12.28 / 11.70 |
| `--nexus-ring` | `#7FE9FF` | Focus ring, status text, links in the network | 14.69 / 14.00 |
| `--nexus-core-from` | `#00A1AD` | Brand gradient start (teal) | 6.56 / 6.25 |
| `--nexus-core-to` | `#587BFF` | Brand gradient end (periwinkle) | 5.57 / 5.31 |
| `--nexus-warm` | `#FFB38A` | People: names, greetings, avatars (section 1). Never status | 11.82 / 11.26 |
| `--nexus-warm-from` / `-to` | `#FF9A7A` / `#FFC58F` | Avatar placeholder gradient; canvas-coloured text on it is 9.95 / 13.35 | - |
| `--nexus-network-node` / `-link` | `190 220 255` / `127 233 255` | Network background colors as `r g b` triplets | decorative |

The canvas was darkened from `#00023B` to `#00011C` (same hue, about half the luminance) so the network background and glass read as depth. The original value survives as the bloom. The brand gradient stops are the existing values in `docs/branding/`.

Rules:

- **Text never goes below white at 55%.** White at 45% measures 4.33:1 on `#00023B` and fails AA for body text.
- `--nexus-edge` is decorative. An interactive control must not depend on its border to be recognizable: it also needs a label or a fill step (`surface-raised`). WCAG 1.4.11 non-text contrast (3:1) applies to the focus ring and state indicators, not to card outlines.
- **Selected and pressed states use `.nexus-selected`:** a 3px inset accent bar (12.28:1), plus `--nexus-edge-strong` and usually `surface-raised`. A fill step or an edge-strong border alone (1.46:1) does not meet 3:1.
- **These ratios are against the bare canvas.** Text that sits directly on the network background, with no blurred or flat surface between them, can cross a bright node or link: worst case about 1.7:1 for muted and 2.4:1 for primary text on a single node. Those are few-pixel features, but keep body text on surfaces, and keep only large headings directly on the canvas.
- Status is never conveyed by color or motion alone; see section 7.
- Tokens are static values. They are not routed through the user's color scheme (`--risu-theme-*`), and this package adds no skinning or theme-switching layer.

## 3. Surfaces

Base surface: `bg-white/[0.03] backdrop-blur-md border border-white/[0.07]` (`.nexus-surface`), rounded `rounded-2xl` for cards and `rounded-xl` for controls.

- `.nexus-surface` and the other component classes live in `@layer components`, so Tailwind utilities on the same element (`rounded-none`, `border-0`, `bg-transparent`, `motion-reduce:*`) still override them. They are a default, not a lock.
- Nest at most two surface levels. Use `surface-raised` for the inner level, not another blurred layer.
- Canvas luminescence is two large, static radial blooms (`.nexus-canvas`): the cool bloom at the top and the warm one at the lower left. Under `forced-colors: active` both are removed.
- **Low-power fallback:** under `.nexus-low-power` or `prefers-reduced-transparency: reduce`, `.nexus-surface` drops `backdrop-filter` and uses `--nexus-surface-flat`. Over a moving background a 3% surface without blur would let the network show through text, so the fallback is a near-opaque tint, never a bare translucent card.
- Under `forced-colors: active`, surfaces use system `Canvas` / `CanvasText`.

## 4. Typography

- Fonts (DD-034, replaces the earlier "no web font" rule): UI text uses NanumSquare Neo and chat reading defaults to Nanum Gothic, both bundled locally under the NAVER Nanum licence, with the system stack as fallback ([fonts/RESEARCH.md](fonts/RESEARCH.md)); the user font setting still overrides chat text. The wordmark in `docs/branding/` uses NanumSquare Neo; it is branding artwork, not a UI font requirement. The one exception is the topbar wordmark, which loads the app's own NanumSquare Neo Heavy (`src/etc/fonts/NanumSquareNeo/`, already shipped by `Title.svelte`) for the wordmark text and its seasonal variants only ([seasonal/README.md](seasonal/README.md)).
- Scale (rem, 16px base): 0.8125 caption, 0.875 secondary, 0.9375 body, 1.0625 card title, 1.625 page title. Weight 400 for body text and 600 for titles; avoid 700+ except in the wordmark.
- Sentence case. No all-caps labels and no extra-wide tracking (a cyberpunk trope).
- Respect user font scaling: no fixed pixel line heights on text containers.

## 5. Motion

| Rule | Value |
|---|---|
| Standard easing | `cubic-bezier(0.4, 0, 0.2, 1)` (`--nexus-ease`) |
| DOM properties | `transform`, `opacity` only. No animated `filter`, `box-shadow`, `width`, `top` or `background-position` (the existing `saving-animation` uses the last one and is not a model for new work). |
| Durations | 150 ms press, 220 ms surface enter (`.nexus-enter`), 450 ms status-mark morph, 1.2-2.4 s status loops |
| Glow | A blurred layer that is never transformed, so its filter output does not change; only its `opacity` animates. |
| Canvas | The network background redraws a `<canvas>` raster. It never affects layout; its budget is in section 6. |

### Status mark

The RisuTanium mark is three concentric inverted equilateral triangles sharing one centroid: a white frame, a white mid triangle (0.208 scale) and the teal-to-periwinkle core (0.133 scale). For motion the frame is split into its three mitred sides. At rest they tile the original frame exactly, and each side can move on its own.

The mark is one inline SVG. The markup comes from `brand/nexusMark.ts` and the motion from `brand/nexus-mark.css`; `data-status` on the `<svg>` picks the pose and the loop. Every part stays in the DOM. A status change transitions the poses over 0.45 s, so the shape morphs instead of swapping: the triangle drops its top side to become a downward chevron, and the chevron swings 180° to point up. Magnitudes are large on purpose so the motion reads at 20 to 32 px on a phone: whole-frame rotation, moves of 7 to 14 units, and opacity dips to 0.45. The viewBox (`-73 -66 146 146`) holds the frame turned to any angle and the chevron's full stream, so nothing is clipped in an `<img>` or an `overflow: hidden` parent.

| Status | Motion | Still pose |
|---|---|---|
| `idle` | None | The logo, faint glow |
| `waiting` | Whole mark pulses dimly (effective opacity 0.45 to 0.9, 1.6 s; white at 0.45 is 4.42:1 on the canvas) | Mark at 90%, no glow |
| `preparing` | The three sides fly in along their normals, hold and fly out, staggered (2.4 s) | Left side offset and faded |
| `memory` | Sides clamp inward together; particle layers converge; centre swells (2.4 s) | Centre enlarged, particles at 65% |
| `thinking` | Frame breathes `scale(0.84)` to `1.04` with opacity; centre counter-breathes; glow pulses (2.4 s) | Smaller frame, bright glow |
| `generating` | A push runs round the frame, one side after another (1.2 s) | Top side pushed out |
| `tool_call` | Frame turns 120° at a time like a gear; centre turns the other way (1.6 s) | Frame turned 60° (points up) |
| `translating` | Whole mark flips horizontally; the core gradient comes back reversed (2.4 s) | Mark narrowed mid-flip |
| `imaging` | The hole fills from the top with the core gradient, then clears (2 s) | Hole 60% filled |
| `speaking` | Outlines of the centre ripple outward (1.6 s, two staggered) | One ripple |
| `finishing` | A slower inward tick runs round the frame (1.8 s) | Right side pulled in |
| `done` | One pop to `scale(1.1)` and a glow flash that settles bright | Bright glow |
| `stopped` | None | Mark at 50%, core faded |
| `error` | One horizontal shake, then rest | Centre turns warm (`#ff6b81`, 7.51:1 on the canvas) |
| `transfer_in` | Top side drops away; the chevron streams downward past the centred mid triangle with a trailing copy (1.4 s); the core pulses outward (0.7 s) | Downward chevron around the centre |
| `transfer_out` | As `transfer_in`, swung round to point up | Upward chevron around the centre |
| `scanning` | A light band runs down the mark, clipped to it (1.8 s) | Band across the middle |

Every still pose differs from the others in shape, size, colour or opacity, except `done`, which differs from `idle` only by a brighter glow. `done` is transient, and the text alternative names it. Loops restart when the status changes; only the pose layers morph. With reduced motion or `still`, poses snap and only opacity fades.

Standalone animated files for previews and design tools are generated into `brand/svg/` (one per status, the stylesheet inlined). Inside an `<img>`, the browser repaints the whole image each frame. Use the inline component in the app.

## 6. Network background

A decorative field symbolizing a neural network: [network/nexusNetwork.ts](network/nexusNetwork.ts) (renderer) and [network/NexusNetworkBackground.svelte](network/NexusNetworkBackground.svelte) (Svelte 5 wrapper).

**What it draws**

- A lattice of nodes with alternate rows offset by half a step, so neighbors form triangles that echo the mark.
- The lattice rides a slow two-component 3D wave (phase speeds 0.17-0.32 rad/s, roughly 20-37 s per cycle). Wave height displaces nodes radially from the center (a perspective cue) and lifts them. Higher nodes are larger and brighter, lower nodes smaller and dimmer.
- A click or tap (`pointerdown`, primary button for mice) sends a ring outward from that point at 360 px/s. Inside the ring (115 px half-width, a smooth bell around the wavefront) nodes lift and brighten and links between neighbors light up; it fades out over 2.6 s. At most three waves run at once (one in low power). With no wave in flight no links are drawn at all, so steady-state cost is the node pass only. A click on a control also sends a wave (maintainer decision).

**Rules**

- Decorative: `aria-hidden="true"`, `pointer-events: none`, behind all content. It conveys no information.
- The wrapper's canvas is `fixed` at `z-0` as the first child of the root, and the interactive shell is a sibling `relative z-10` container (audit AUD-02). Ancestors between the root and the canvas must stay transparent. The canvas color belongs on the root element (`.nexus-canvas`).
- The lattice extends past every edge by more than the wave's largest inward pull, so no gap opens at the borders on large displays. The renderer also rebuilds when the window moves to a display with another pixel ratio.
- A hovering mouse or pen lights a small, faint spotlight: radius 110 px, 35 % strength (links at most 0.125 alpha), nodes brighten without lifting. Touch has no spotlight. It is kept deliberately weaker than the wave so reaching for a control does not drag a glow behind the pointer (audit AUD-10, softened by the maintainer).
- `prefers-reduced-motion: reduce` draws one still frame and registers no pointer listener: no wave and no spotlight. Both are motion started by interaction (WCAG 2.3.3), and a moving effect over a frozen lattice would look broken.
- `lowPower`: lattice spacing ×1.4, device-pixel ratio 1, 24 fps cap, one wave at a time. The surfaces also switch to the flat fallback (section 3).
- The loop stops while the tab is hidden and restarts when it becomes visible. It reacts to resize via `ResizeObserver`.
- Use it on Home, empty states and onboarding. **Do not put it behind chat transcripts or long-form editing,** where moving texture under text costs legibility and battery.

**Cost**

- Measured before the click-wave change (the old hover version drew links within 170 px every frame the pointer was inside the window; the current version draws links only inside a wave ring or the smaller 110 px spotlight), on this desktop in headless Edge at 1920×1080 (80 samples, each one full rebuild plus draw, which is more than a steady-state frame): median 2.8 ms, p95 4.3 ms. With `lowPower`: median 1.4 ms, p95 1.8 ms. Mobile devices and the Tauri webviews were **not** measured. Measure on the Note 9 class of device before choosing defaults there.
- **Blur over animation is the real cost.** Every `backdrop-filter` surface above a moving canvas must re-blur every frame. On constrained devices, prefer `lowPower`, which removes the blur, or a static background frame.

## 7. Accessibility

- **Text alternative is mandatory.** `NexusStatusMark` renders the SVG with `aria-hidden="true"` and the status as text inside `role="status"`. The text is visually hidden by default (`showLabel` reveals it), so screen readers announce status changes politely. A run can change status several times a second; the caller should pass a label that changes only when the change matters to the person, or the announcements become noise.
- Status text comes from the caller (translated) with English fallbacks in `brandStatus.ts`. i18n wiring is pending until a screen uses the component; non-English strings belong to the translator.
- **Focus ring:** `outline: 2px solid var(--nexus-ring)` with a 2px offset on `:focus-visible` (`.nexus-focus`). It contrasts 14.69:1 with the canvas. Never remove an outline without replacing it.
- **Reduced motion:** status loops stop at their still pose, and status changes snap instead of morphing (opacity still fades). Entry animations become a pure fade, and the breathe animation stops; both changes apply to the `.nexus-enter` class and the `animate-nexus-*` utilities, which read the same variables. The network background becomes a still frame.
- **Reduced transparency:** flat surfaces instead of blurred glass.

## 8. Low-power and webview rules

Tauri renders through the platform webview: WebView2 (Chromium) on Windows, WKWebView on macOS and iOS, WebKitGTK on Linux and Android System WebView on Android. Backdrop blur is the expensive and least uniform feature, especially on WebKitGTK and older Android devices.

- One low-power switch, a `nexus-low-power` class on a root element, set by the future app shell for mobile and constrained webviews. It flattens the surfaces and is passed as `lowPower` to the status mark (no blurred glow, one copy of each repeated layer) and to the network background.
- The mark's motion was verified only in Chromium. The side moves no longer use `var()` inside keyframes (each side has its own keyframes with precomputed offsets, audit AUD-07), but `transform-box: view-box` on SVG children still needs a device check on WKWebView and WebKitGTK before wiring.
- Low power hides the glow, so `done` and `idle` cannot differ by glow alone: `done` also turns the frame ring cyan (`#7fe9ff`) and enlarges the centre (audit AUD-03).
- `still` on the mark stops its loops. Use it wherever many marks show at once, such as a list of runs, and animate only the one that matters.
- Never put `backdrop-blur` on a scrolling list item. Blur large, static containers only.
- The mark never animates while its status is idle; idle means no mark or a static one.

## 9. Component boundary

- `NexusStatusMark` takes `status: BrandStatus`, plus optional `label`, `size`, `showLabel`, `lowPower`, `still`, `progress` (0 to 1: an outer triangular ring for counted work at 40 px and up, the percentage as text below that; audit AUD-04, review F-1) and `tone` (`'light'` for light color schemes). `BrandStatus` is `'idle'` or a `RunActivity`, `RunOutcome` or `DataActivity` (see `brand/brandStatus.ts`). `status` is meant to come from a future run object (run identity and state per planning section 5) and the in-flight registries, not from a chat loading flag. [STATUS_INVENTORY.md](STATUS_INVENTORY.md) maps each status to the signals the app already has.
- Ids inside the SVG are made unique per instance with `$props.id()`, so any number of marks can share a page.
- The mark is a status indicator usable on Home, settings, navigation and task feedback. The mockup shows only one placement.
- The frame and mid triangle are white by default. On light color schemes pass `tone="light"` (or put `.nexus-mark-light` on an ancestor): the frame and centre become `#0f172a`, outlines and the `done` tint `#0e7490`, the error centre `#be123c` (audit AUD-01). The app has no `data-theme` attribute; drive `tone` from `ColorSchemeTypeStore`.
- Nothing in this package touches storage, `DBState`, `colorscheme.ts` or the campaign files, and no existing app screen imports any of it. The `nexus` color-scheme preset (approved 2026-10-16, default for new installs) is [theme/nexus-colorscheme.ts](theme/nexus-colorscheme.ts); integration is [AUDIT_RESPONSE.md](AUDIT_RESPONSE.md) R-01.
