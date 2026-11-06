# CBS: Assets and Media

This page belongs to [[Curly-Brased-Syntaxes]]. The functions on this page embed the additional assets, emotion images, background music, or profile pictures of a character. Most of them make sense only when the chat window *displays* them. When the app builds the prompt for the AI request, these functions still resolve to a URL or base64 path, an HTML tag, or an empty string. Do not use the functions that produce HTML inside text that the app sends to the model.

Lookups of asset names are case-insensitive. If no additional asset matches the given name exactly, the client uses a fuzzy match. The fuzzy match compares the name with the file names without extensions, using the Levenshtein distance. The client accepts a match only when the distance is within the **Asset Max Difference** setting. If no asset matches, the function returns an empty string. <!-- src/ts/parser/parser.svelte.ts:553-566,627-657 -->

When **Hide All Images** is on, every function in this section that normally emits an image, video, or background element returns an empty string. <!-- src/ts/parser/parser.svelte.ts:507,528-530 -->

## Additional assets

| Syntax | Output | Notes |
|---|---|---|
| `{{asset::name}}` | `<img>`, or `<video>` if the extension of the asset is a video type | The generic tag that displays an asset. <!-- src/ts/cbs.ts:2263-2268 --> |
| `{{img::name}}` | `<img>` without styling | <!-- src/ts/cbs.ts:2319-2324 --> |
| `{{image::name}}` | `<img>` inside a `.risu-inlay-image` div | <!-- src/ts/cbs.ts:2312-2317 --> |
| `{{video::name}}` | `<video controls autoplay loop>` | <!-- src/ts/cbs.ts:2298-2303 --> |
| `{{video-img::name}}` | `<video autoplay muted loop>`. It has no controls. Use it like an animated image. | <!-- src/ts/cbs.ts:2305-2310 --> |
| `{{audio::name}}` | `<audio controls autoplay loop>` | <!-- src/ts/cbs.ts:2277-2282 --> |
| `{{bg::name}}` | A background element. It renders only while the app renders the background image of the character. At other times, it resolves to nothing. | <!-- src/ts/parser/parser.svelte.ts:595-599 -->|
| `{{bgm::name}}` | A hidden control div (`risu-ctrl="bgm___auto___<url>"`). The player reads it and starts background music. | <!-- src/ts/cbs.ts:2291-2296 --> |
| `{{path::name}}` / `{{raw::name}}` | The resolved file path or URL, without markup. | <!-- src/ts/cbs.ts:2326-2331 --> |
| `{{emotion::name}}` | `<img>` with a source from the **emotion images** of the character. Emotion images are a separate namespace from additional assets. | <!-- src/ts/cbs.ts:2270-2275 --> |

The app resolves these tags in one dedicated asset pass. It also resolves `{{source::...}}` in this pass. See **Profile pictures** below. The pass is separate from the general lookup of CBS functions. <!-- src/ts/parser/parser.svelte.ts:408,523 -->

### Asset name resolution and module/character collisions

Sometimes a module and the active character both provide an asset with the same name. In that case, the asset of the character always wins. The app adds the asset of the module only if the character has not claimed that name. <!-- src/ts/parser/parser.svelte.ts:470-484 -->

## Inlay assets

Inlays are assets that belong to a chat message, for example pasted images. They do not belong to the character.

| Syntax | Behavior |
|---|---|
| `{{inlay::id}}` | An inlay without styling. The app does **not** send it to the model. |
| `{{inlayed::id}}` | A styled inlay, inside `.risu-inlay-image`. The app does **not** send it to the model. |
| `{{inlayeddata::id}}` | A styled inlay that the app **does** send to the model. |

<!-- src/ts/cbs.ts:2333-2338,2340-2345,2347-2352 -->

The app resolves inlays in their own pass, after the main CBS pass. Image inlays become `<img>`, video inlays become `<video>`, and audio inlays become `<audio>`. Each tag points to a blob URL. The app caches that URL for each inlay id. <!-- src/ts/parser/parser.svelte.ts:694-729 -->

## Profile pictures

`{{source::user}}` returns the raw source URL or data of the persona icon of the user. `{{source::char}}` returns the same for the avatar image of the character. The app does not recognize any other argument. The app resolves this as a placeholder. It substitutes the placeholder at the very end of asset processing, after the app resolves everything else. <!-- src/ts/cbs.ts:2354-2359; src/ts/parser/parser.svelte.ts:541-551,612-622 -->

## Character/module asset listings

| Syntax | Returns |
|---|---|
| `{{emotionlist}}` | A JSON array of the emotion-image names of the current character. |
| `{{assetlist}}` | A JSON array of the additional-asset names of the current character. The array is empty for groups. |
| `{{chardisplayasset}}` | A JSON array of additional-asset names. The array leaves out the assets that the asset list of the character excludes. The function returns it only when **Insert Asset Prompt** is on. |
| `{{moduleassetlist::namespace}}` (alias `{{module_assetlist}}`) | A JSON array of the asset names of the module that has the given namespace. |

<!-- src/ts/cbs.ts:1316-1329,1331-1344,1477-1497,1607-1622 -->

For `{{moduleenabled}}`, see [[CBS-Functions]].
