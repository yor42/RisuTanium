// Test-only oracle for what the classic editor cannot be driven to produce. No application file imports this
// module.

/**
 * The classic default of an Else row, copied from the classic editor's default-effect switch. No picker category
 * contains `v2Else`, so the picker cannot record it.
 */
export const CLASSIC_V2ELSE_DEFAULT = {
    type: 'v2Else',
    indent: 0,
} as const
