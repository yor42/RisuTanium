# CHORE-631 capture recipe: what to note when the module popup flickers after a cold restart

Status: RECORDED 2026-11-04 (batch 47); for the maintainer, who has no adb on his phone; nothing here was tested.

**When it happens (next time you see it)**
1. Start a screen recording BEFORE you open the app (Android's built-in screen recorder, with no audio). Force-stop the app, open it, and open the chat as you normally do. Keep recording until the flicker stops, or for 60 seconds. Keep the file; do not trim it.
2. Note right away, in your own words: roughly how many seconds after launching the app it flickered, and how many seconds it kept going.
3. Note how you reached the chat: the app reopened it by itself, you picked it from the list, or you switched to it.
4. Note what flickered: only the popup, the whole message, or the whole chat screen. Note whether the colours or theme of the popup changed during the flicker (for example plain colours first, then your chosen theme and brightness), or whether it only appeared and disappeared.
5. Note whether the popup was open because you opened it, or opened by itself, and whether you had touched the screen when it closed.
6. Note whether it also happens on the second cold restart in a row, and whether it stops after you visit Settings and return.
7. Note how many modules are enabled for this chat and how many are enabled globally, and which module (or regex or trigger script) owns the popup.
8. Note the app build you are running (the commit or the APK name).

**What would help most**
- The screen recording, the exported module(s) that contain the popup scripts and the toggles `lb-mini.darkness` and `lb-mini.theme` (as a `.risum` file), and the exported chat or character with its module list, with nothing private in them.
- If you can, one more recording from a cold restart where the same chat has only the popup module and its toggle module enabled: it tells us whether the number of modules matters.

**What we will do with it**
- Build a fixture from the real module and the same module list, then run the same cold-start check on a Note 9 with a probe on the popup and the style text. The earlier runs (`trig-device1` to `trig-device3`) used abridged CSS and synthetic modules and found nothing.
