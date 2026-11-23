// The decorator names the lorebook scan's own callback handles. The scan switches on `name as LoreScanDecoratorName`, so a
// `case` label outside this tuple is a type error, and a drift test requires every listed name to be classified by the
// lore recall rules.

export const LORE_SCAN_DECORATORS = [
    'end',
    'activate_only_after',
    'activate_only_every',
    'keep_activate_after_match',
    'dont_activate_after_match',
    'depth',
    'reverse_depth',
    'instruct_depth',
    'reverse_instruct_depth',
    'instruct_scan_depth',
    'role',
    'scan_depth',
    'is_greeting',
    'position',
    'inject_lore',
    'inject_at',
    'inject_replace',
    'inject_prepend',
    'ignore_on_max_context',
    'additional_keys',
    'exclude_keys',
    'exclude_keys_all',
    'match_full_word',
    'match_partial_word',
    'is_user_icon',
    'activate',
    'dont_activate',
    'disable_ui_prompt',
    'probability',
    'priority',
    'unrecursive',
    'recursive',
    'no_recursive_search',
] as const

export type LoreScanDecoratorName = typeof LORE_SCAN_DECORATORS[number]
