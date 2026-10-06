import { isTauri } from "./platform"

/**
 * Tauri on a desktop OS. The native window commands (maximize, fullscreen) are
 * compiled out of the Tauri mobile runtime and reject there, so every caller of
 * them gates on this rather than on `isTauri`. The user-agent test matches the
 * `isMobile` test in `./platform`; it is repeated here so that this value
 * depends only on `isTauri`.
 */
export const isTauriDesktop: boolean = isTauri && !/Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent)
