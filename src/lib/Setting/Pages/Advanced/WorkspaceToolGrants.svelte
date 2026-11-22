<script lang="ts">
    import { onMount } from "svelte";
    import { language } from "src/lang";
    import { listToolGrants, revokeToolGrant } from "src/ts/process/mcp/toolGrants";
    import { DBState } from "src/ts/stores.svelte";
    import Button from "src/lib/UI/GUI/Button.svelte";

    type GrantRow = { workspaceId: string, tool: string, at: number };

    const text = $derived(language.utility.toolGrants);

    let rows = $state<GrantRow[]>([]);
    let failed = $state(false);

    const groups = $derived.by(() => {
        const byWorkspace = new Map<string, GrantRow[]>();
        for (const row of rows) {
            const list = byWorkspace.get(row.workspaceId) ?? [];
            list.push(row);
            byWorkspace.set(row.workspaceId, list);
        }
        return [...byWorkspace].map(([workspaceId, tools]) => ({
            workspaceId,
            name: DBState.db.utilityWorkspaces?.find((workspace) => workspace.id === workspaceId)?.name ?? null,
            tools,
        }));
    });

    async function refresh() {
        rows = await listToolGrants();
    }

    async function revoke(row: GrantRow) {
        failed = !(await revokeToolGrant(row.workspaceId, row.tool));
        await refresh();
    }

    function dateOf(at: number): string {
        return at > 0 ? new Date(at).toLocaleDateString() : "";
    }

    onMount(refresh);
</script>

<div class="mb-4 flex flex-col gap-2 text-textcolor" data-testid="tool-grants">
    <h2 class="text-xl font-bold">{text.heading}</h2>
    <span class="text-sm text-textcolor2">{text.help}</span>
    {#if failed}
        <span class="text-sm text-draculared" role="alert" data-testid="tool-grants-failed">{text.revokeFailed}</span>
    {/if}
    {#if groups.length === 0}
        <span class="text-textcolor2" data-testid="tool-grants-empty">{text.empty}</span>
    {:else}
        {#each groups as group (group.workspaceId)}
            <div class="flex flex-col gap-2 rounded-md border border-darkborderc bg-darkbg p-3" data-testid="tool-grants-workspace">
                <div class="min-w-0 break-words font-bold" data-testid="tool-grants-workspace-name">
                    {group.name ?? text.deletedWorkspace}
                    {#if group.name === null}
                        <span class="break-all text-sm font-normal text-textcolor2" data-testid="tool-grants-workspace-id">{group.workspaceId}</span>
                    {/if}
                </div>
                <ul class="flex flex-col gap-2">
                    {#each group.tools as row (row.tool)}
                        <li class="flex flex-wrap items-center gap-2" data-testid="tool-grants-row">
                            <div class="flex min-w-0 flex-1 flex-col">
                                <bdi class="break-all" data-testid="tool-grants-tool">{row.tool}</bdi>
                                {#if dateOf(row.at) !== ""}
                                    <span class="text-sm text-textcolor2" data-testid="tool-grants-date">{text.grantedOn(dateOf(row.at))}</span>
                                {/if}
                            </div>
                            <Button className="min-h-11 min-w-11" styled="danger" onclick={() => revoke(row)}>
                                <span aria-hidden="true">{text.revoke}</span>
                                <span class="sr-only">{text.revokeLabel(row.tool, group.name ?? text.deletedWorkspace)}</span>
                            </Button>
                        </li>
                    {/each}
                </ul>
            </div>
        {/each}
    {/if}
</div>
