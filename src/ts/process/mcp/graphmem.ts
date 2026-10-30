import { getChatVar, setChatVar } from "src/ts/parser/chatVar.svelte";
import { MCPClientLike } from "./internalmcp";
import type { MCPTool, RPCToolCallContent } from "./mcplib";
import { HypaProcesser } from "../memory/hypamemory";
import type { RunSubject } from "../chatOrigin";

type GraphIndex = {
    name: string;
    summary: string;
    connections: string[];
};

// A search ranks every stored entry; each query term and each connection hop keeps only its closest few.
const TOP_MATCHES_PER_SEARCH = 3;

// A chat with no stored graph, or one that is not a list, has an empty graph.
function readGraph(subject?: RunSubject): GraphIndex[] {
    try {
        const graph = JSON.parse(getChatVar("graphmem_graph", subject));
        return Array.isArray(graph) ? graph as GraphIndex[] : [];
    } catch (error) {
        return [];
    }
}

export class GraphMemClient extends MCPClientLike {
    constructor() {
        super("internal:graphmem");
        this.serverInfo.serverInfo.name = "GraphMem";
        this.serverInfo.serverInfo.version = "1.0.0";
        this.serverInfo.instructions = "Memory management using graph database.";
    }

    async getToolList(): Promise<MCPTool[]> {
        return [{
            name: 'writeMemory',
            description: 'Write a memory entry to the graph database.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'The name of the memory entry.'
                    },
                    summary: {
                        type: 'string',
                        description: 'A brief summary of the memory entry.'
                    },
                    connections: {
                        type: 'array',
                        items: {
                            type: 'string',
                            description: 'Names of related memory entries.'
                        },
                        description: 'Connections to other memory entries.'
                    }
                },
                required: ['name', 'summary']
            }
        }, {
            name: 'readMemory',
            description: 'Read a memory entry from the graph database.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'array',
                        items: {
                            type: 'string'
                        },
                        description: 'The query terms to search for memory entries.'
                    },
                    search_depth: {
                        type: 'number',
                        description: 'The depth of connections to explore in the graph. default is 2.',
                    }
                },
                required: ['query']
            }
        }];
    }

    async callTool(toolName: string, args: any, ctx?: { subject?: RunSubject }): Promise<RPCToolCallContent[]> {
        try {
            switch (toolName) {
                case "writeMemory": {
                    return await this.handleWriteMemory(args, ctx?.subject);
                }
                case "readMemory": {
                    return await this.handleReadMemory(args, ctx?.subject);
                }
                default:
                    return [{ type: 'text', text: `Unknown tool: ${toolName}` }];
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            return [{ type: 'text', text: `Error: ${errorMessage}` }];
        }
    }

    private async handleWriteMemory(args: any, subject?: RunSubject): Promise<RPCToolCallContent[]> {
        
        const {
            name,
            summary,
            connections = []
        }: {
            name: string;
            summary: string;
            connections: string[];
        } = args;
        
        // A subject that resolves to nothing must store nothing: its owner or chat is gone, or ambiguous (an id held
        // twice, unless the subject is a send and one holder is the object the send started from).
        if(subject && !subject.resolve()){
            return [{ type: 'text', text: 'Error: The chat this memory belongs to could not be found; the memory entry was not saved.' }];
        }

        const graph = readGraph(subject);

        graph.push({ name, summary, connections });

        setChatVar("graphmem_graph", JSON.stringify(graph), subject);
        return [{ type: 'text', text: `Memory entry "${name}" written successfully.` }];
    }

    private async handleReadMemory(args: any, subject?: RunSubject): Promise<RPCToolCallContent[]> {
        const {
            query,
            search_depth = 2,
        }: {
            query: string[];
            search_depth?: number;
            threshold?: number;
        } = args;

        const graph = readGraph(subject);

        if(!Array.isArray(query) || query.length === 0){
            return [{ type: 'text', text: `Query must be a non-empty array of strings.` }];
        }

        if(!Array.isArray(graph) || graph.length === 0){
            return [{ type: 'text', text: `No memory entries found in the graph database.` }];
        }

        // The search ranks only what `addText` has stored, and it stores a repeated name once per occurrence,
        // so each name is added once.
        const processer = new HypaProcesser();
        await processer.addText([...new Set(graph.map(g => g.name))]);

        let results: {
            queryTerm: string;
            entries: GraphIndex[];
        }[] = [];
        for(let i=0;i<query.length;i++){
            
            let currentEntries: GraphIndex[] = [];
            let toSearch: string[] = [query[i]];
            for(let depth = 0; depth < search_depth; depth++){
                const newEntries: GraphIndex[] = [];
                for(const searchTerm of toSearch){
                    const searched = (await processer.similaritySearch(searchTerm)).slice(0, TOP_MATCHES_PER_SEARCH);
                    for(const entry of searched){
                        const found = graph.find(g => g.name === entry);
                        if(found && !currentEntries.includes(found) && !newEntries.includes(found)){
                            newEntries.push(found);
                        }
                    }
                }
                currentEntries = currentEntries.concat(newEntries);
                toSearch = newEntries.flatMap(e => e.connections);
            }

            results.push({ queryTerm: query[i], entries: currentEntries });
        }

        return [{ type: 'text', text: JSON.stringify(results, null, 2) }];
    }
}