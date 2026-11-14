// The persisted key names of the asset owner fields, and nothing else: importing this file pulls in no runtime
// dependency. Both names carry the fork prefix so an upstream field of the same bare name is never read as ours.
import type { RisuModule } from '../../process/modules'
import type { character } from '../../storage/database.svelte'

/**
 * Holds the asset folder document. It sits on `RisuModule` directly, and on a character inside `extentions`, a
 * free-form bag that gets no type tie.
 */
export const ASSET_FOLDER_KEY = 'risutanium_asset_folders' satisfies keyof RisuModule

/**
 * Holds the paths an owner's asset history retains. It sits on `RisuModule` and on `character` as a top-level field, so
 * the type tie holds the name equal to both declarations.
 */
export const ASSET_RETAINED_KEY = 'risutanium_asset_retained' satisfies keyof RisuModule & keyof character
