/** Model ids the first-run setup assigns, by chosen provider. Each must resolve to a catalog entry that is not retired. */
export const FIRST_RUN_MODELS = {
    claude: 'claude-sonnet-4-6',
    openai: 'gpt4o',
} as const
