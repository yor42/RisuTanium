import type { Database } from '../../database.svelte'
import { defaultKeyEnv, type KeyEnv } from '../format'
import { builtCommitOf, planScopedEncode } from '../codec/scoped'
import type { ListDerivation } from '../codec/types'
import type { BuiltInstall } from '../firstLife'

/**
 * The install request for a whole resolved tree (`resolveLegacyTree`'s
 * database): every character and the modules are encoded, nothing is carried,
 * and the units take their keys from the staging mint of the marker the
 * installer stands on. Entity ids are minted by the codec from `env`.
 */
export interface WholeTreeInstallOptions {
    lists: ListDerivation
    env?: KeyEnv
    /** `convertedFrom` of the final commit key. */
    convertedFrom: string
}

export async function planWholeTreeInstall(db: Database, options: WholeTreeInstallOptions): Promise<BuiltInstall> {
    const env: KeyEnv = options.env ?? defaultKeyEnv
    const plan = await planScopedEncode(
        db,
        { env, lists: options.lists, seq: 0, createdAt: env.now() },
        { modules: true, characters: 'all' },
    )
    return {
        newUnits: plan.newUnits,
        convertedFrom: options.convertedFrom,
        build: context => builtCommitOf(plan.finalize(context)),
    }
}
