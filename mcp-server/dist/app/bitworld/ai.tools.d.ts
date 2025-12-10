export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
}
export declare const canvasTools: ToolDefinition[];
export interface ToolContext {
    paintCells: (cells: Array<{
        x: number;
        y: number;
        color: string;
    }>) => void;
    eraseCells: (cells: Array<{
        x: number;
        y: number;
    }>) => void;
    getCursorPosition: () => {
        x: number;
        y: number;
    };
    setCursorPosition?: (x: number, y: number) => void;
    getViewport: () => {
        offset: {
            x: number;
            y: number;
        };
        zoomLevel: number;
    };
    setViewport?: (x: number, y: number, zoom?: number) => void;
    getSelection: () => {
        start: {
            x: number;
            y: number;
        } | null;
        end: {
            x: number;
            y: number;
        } | null;
    };
    setSelection?: (startX: number, startY: number, endX: number, endY: number) => void;
    clearSelection?: () => void;
    getAgents: () => Array<{
        id: string;
        x: number;
        y: number;
        spriteName?: string;
    }>;
    getNotes: () => Array<{
        id: string;
        x: number;
        y: number;
        width: number;
        height: number;
        contentType?: string;
        content?: string;
    }>;
    getChips: () => Array<{
        id: string;
        x: number;
        y: number;
        text: string;
        color?: string;
    }>;
    getTextAt?: (x: number, y: number, width: number, height: number) => string[];
    getCanvasInfo?: (region?: {
        x: number;
        y: number;
        width: number;
        height: number;
    }) => any;
    createNote: (x: number, y: number, width: number, height: number, contentType?: string, content?: string, imageData?: {
        src: string;
        originalWidth: number;
        originalHeight: number;
    }, generateImage?: string, scriptData?: {
        language: string;
    }, tableData?: {
        columns: {
            width: number;
        }[];
        rows: {
            height: number;
        }[];
        cells: Record<string, string>;
        frozenRows?: number;
        frozenCols?: number;
        activeCell?: {
            row: number;
            col: number;
        };
        cellScrollOffsets?: Record<string, number>;
    }) => void;
    createChip: (x: number, y: number, text: string, color?: string) => void;
    createAgent: (x: number, y: number, spriteName?: string) => string | null;
    writeText: (x: number, y: number, text: string) => void;
    moveAgents: (agentIds: string[], destination: {
        x: number;
        y: number;
    }) => void;
    moveAgentsPath?: (agentIds: string[], path: Array<{
        x: number;
        y: number;
    }>) => void;
    moveAgentsExpr?: (agentIds: string[], xExpr: string, yExpr: string, vars?: Record<string, number>, duration?: number) => void;
    stopAgentsExpr?: (agentIds: string[]) => void;
    agentAction?: (agentId: string, command: string, selection?: {
        width: number;
        height: number;
    }) => void;
    setAgentMind?: (agentId: string, persona?: string, goals?: string[]) => void;
    agentThink?: (agentId: string) => Promise<{
        thought: string;
        actions?: any[];
    } | null>;
    deleteEntity?: (type: 'note' | 'agent' | 'chip', id: string) => void;
    runCommand: (command: string) => void;
    runScript?: (noteId: string) => Promise<{
        success: boolean;
        output?: string[];
        error?: string;
    }>;
    editNote?: (noteId: string, edit: NoteEdit) => {
        success: boolean;
        error?: string;
    };
}
export interface NoteEditPosition {
    line: number;
    column: number;
}
export interface NoteEditRange {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}
export interface NoteEditCell {
    row: number;
    col: number;
    value: string;
}
export type NoteEdit = {
    operation: 'append';
    text: string;
} | {
    operation: 'insert';
    text: string;
    position: NoteEditPosition;
} | {
    operation: 'delete';
    range: NoteEditRange;
} | {
    operation: 'replace';
    text: string;
    range: NoteEditRange;
} | {
    operation: 'clear';
} | {
    operation: 'cell';
    cell: NoteEditCell;
};
export declare function generateRectCells(x: number, y: number, width: number, height: number, filled: boolean): Array<{
    x: number;
    y: number;
}>;
export declare function generateCircleCells(centerX: number, centerY: number, radius: number, filled: boolean): Array<{
    x: number;
    y: number;
}>;
export declare function generateLineCells(x1: number, y1: number, x2: number, y2: number): Array<{
    x: number;
    y: number;
}>;
export declare function executeTool(toolName: string, args: Record<string, any>, ctx: ToolContext): Promise<{
    success: boolean;
    result?: any;
    error?: string;
}>;
export { canvasTools as tools };
