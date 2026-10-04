/**
 * How many nested runs a trigger run may start through `runtrigger`,
 * `v2RunTrigger` and the `/trigger` command. The count covers the run's own
 * calls in sequence as well as the depth it inherited, so a loop that starts
 * more nested runs than the limit has its later calls skipped. A nested run
 * beyond the limit is skipped and the run that asked for it continues.
 *
 * A low-level trigger is exempt from the normal limit but still bounded, so a
 * trigger that calls itself cannot nest until the stack overflows.
 */
export const NORMAL_NESTED_TRIGGER_LIMIT = 10
export const LOW_LEVEL_NESTED_TRIGGER_LIMIT = 50
