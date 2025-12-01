/**
 * Terminal Manager - manages headless xterm.js instances for canvas rendering
 *
 * Instead of rendering xterm to DOM, we:
 * 1. Run xterm headless to handle ANSI parsing and buffer management
 * 2. Extract buffer contents (chars + colors) for canvas rendering
 * 3. Route keyboard input to the active terminal
 */

interface TerminalCell {
    char: string;
    fg: string;  // Foreground color as hex
    bg: string;  // Background color as hex
}

interface TerminalBuffer {
    rows: TerminalCell[][];
    cursorX: number;
    cursorY: number;
    cols: number;
    rowCount: number;
}

interface TerminalInstance {
    terminal: any;  // xterm Terminal
    ws: WebSocket | null;
    buffer: TerminalBuffer;
    noteKey: string;
    onUpdate: (() => void) | null;
}

// ANSI 256 color palette (standard colors)
const ANSI_COLORS: string[] = [
    '#000000', '#cc0000', '#00cc00', '#cccc00', '#0000cc', '#cc00cc', '#00cccc', '#cccccc',
    '#666666', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
];

// Generate 216 color cube (colors 16-231)
for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
        for (let b = 0; b < 6; b++) {
            const ri = r ? r * 40 + 55 : 0;
            const gi = g ? g * 40 + 55 : 0;
            const bi = b ? b * 40 + 55 : 0;
            ANSI_COLORS.push(`#${ri.toString(16).padStart(2, '0')}${gi.toString(16).padStart(2, '0')}${bi.toString(16).padStart(2, '0')}`);
        }
    }
}

// Generate 24 grayscale colors (colors 232-255)
for (let i = 0; i < 24; i++) {
    const v = i * 10 + 8;
    ANSI_COLORS.push(`#${v.toString(16).padStart(2, '0')}${v.toString(16).padStart(2, '0')}${v.toString(16).padStart(2, '0')}`);
}

class TerminalManager {
    private instances: Map<string, TerminalInstance> = new Map();
    private xtermModule: any = null;
    private initialized = false;
    private initPromise: Promise<void> | null = null;
    private defaultFg = '#ffffff';
    private defaultBg = '#000000';

    async init(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            this.xtermModule = await import('@xterm/xterm');
            this.initialized = true;
        })();

        return this.initPromise;
    }

    setColors(fg: string, bg: string) {
        this.defaultFg = fg;
        this.defaultBg = bg;
    }

    async createTerminal(
        noteKey: string,
        wsUrl: string,
        cols: number,
        rows: number,
        onUpdate?: () => void
    ): Promise<void> {
        await this.init();

        // Don't recreate if already exists
        if (this.instances.has(noteKey)) {
            console.log('[TerminalManager] Terminal already exists:', noteKey);
            return;
        }

        console.log('[TerminalManager] Creating terminal:', noteKey, 'cols:', cols, 'rows:', rows, 'wsUrl:', wsUrl);

        const { Terminal } = this.xtermModule;

        // Create terminal with no DOM rendering
        const terminal = new Terminal({
            cols,
            rows,
            allowProposedApi: true,
            scrollback: 1000,
        });

        // Create a hidden container for xterm (it needs a DOM element)
        const hiddenContainer = document.createElement('div');
        hiddenContainer.style.position = 'absolute';
        hiddenContainer.style.left = '-9999px';
        hiddenContainer.style.top = '-9999px';
        hiddenContainer.style.width = `${cols * 10}px`;
        hiddenContainer.style.height = `${rows * 20}px`;
        document.body.appendChild(hiddenContainer);
        terminal.open(hiddenContainer);

        const instance: TerminalInstance = {
            terminal,
            ws: null,
            buffer: {
                rows: [],
                cursorX: 0,
                cursorY: 0,
                cols,
                rowCount: rows,
            },
            noteKey,
            onUpdate: onUpdate || null,
        };

        // Connect WebSocket
        console.log('[TerminalManager] Connecting to WebSocket:', wsUrl);
        try {
            const ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log('[TerminalManager] WebSocket connected');
                terminal.write('\x1b[32mConnected to terminal\x1b[0m\r\n');
                ws.send(`\x1b[RESIZE:${cols},${rows}]`);
                this.updateBuffer(noteKey);
            };

            ws.onmessage = (event: MessageEvent) => {
                terminal.write(event.data);
                this.updateBuffer(noteKey);
            };

            ws.onclose = () => {
                terminal.write('\r\n\x1b[31mDisconnected\x1b[0m');
                this.updateBuffer(noteKey);
            };

            ws.onerror = (err) => {
                console.error('[TerminalManager] WebSocket error:', err);
                terminal.write('\r\n\x1b[31mConnection error\x1b[0m\r\n');
                terminal.write('\x1b[33mRun: cd terminal-server && npm start\x1b[0m');
                this.updateBuffer(noteKey);
            };

            instance.ws = ws;
        } catch (err) {
            terminal.write('\x1b[31mFailed to connect\x1b[0m');
            this.updateBuffer(noteKey);
        }

        this.instances.set(noteKey, instance);
        this.updateBuffer(noteKey);
    }

    private updateBuffer(noteKey: string): void {
        const instance = this.instances.get(noteKey);
        if (!instance) return;

        const { terminal, buffer } = instance;
        const activeBuffer = terminal.buffer.active;

        buffer.cursorX = activeBuffer.cursorX;
        buffer.cursorY = activeBuffer.cursorY;
        buffer.rows = [];

        // baseY is the offset to the start of the viewport in the buffer
        // When there's scrollback, baseY > 0
        const baseY = activeBuffer.baseY;

        for (let y = 0; y < terminal.rows; y++) {
            // Read from the viewport position (baseY + y), not absolute y
            const line = activeBuffer.getLine(baseY + y);
            if (!line) {
                // Push empty row if line doesn't exist
                buffer.rows.push([]);
                continue;
            }

            const row: TerminalCell[] = [];
            for (let x = 0; x < terminal.cols; x++) {
                const cell = line.getCell(x);
                if (!cell) {
                    row.push({ char: ' ', fg: this.defaultFg, bg: this.defaultBg });
                    continue;
                }

                const char = cell.getChars() || ' ';
                const fgColor = this.getCellColor(cell, true);
                const bgColor = this.getCellColor(cell, false);

                row.push({
                    char,
                    fg: fgColor,
                    bg: bgColor,
                });
            }
            buffer.rows.push(row);
        }

        // Trigger update callback
        if (instance.onUpdate) {
            instance.onUpdate();
        }
    }

    private getCellColor(cell: any, isForeground: boolean): string {
        const colorMode = isForeground ? cell.getFgColorMode() : cell.getBgColorMode();
        const color = isForeground ? cell.getFgColor() : cell.getBgColor();

        // Color modes: 0 = default, 1 = 16 colors, 2 = 256 colors, 3 = RGB
        if (colorMode === 0) {
            return isForeground ? this.defaultFg : this.defaultBg;
        } else if (colorMode === 1 || colorMode === 2) {
            // 16 or 256 color palette
            if (color >= 0 && color < ANSI_COLORS.length) {
                return ANSI_COLORS[color];
            }
            return isForeground ? this.defaultFg : this.defaultBg;
        } else if (colorMode === 3) {
            // RGB - color is packed as 24-bit RGB
            const r = (color >> 16) & 0xff;
            const g = (color >> 8) & 0xff;
            const b = color & 0xff;
            return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        }

        return isForeground ? this.defaultFg : this.defaultBg;
    }

    getBuffer(noteKey: string): TerminalBuffer | null {
        const instance = this.instances.get(noteKey);
        return instance?.buffer || null;
    }

    sendInput(noteKey: string, data: string): void {
        const instance = this.instances.get(noteKey);
        if (!instance?.ws || instance.ws.readyState !== WebSocket.OPEN) return;
        instance.ws.send(data);
    }

    resize(noteKey: string, cols: number, rows: number): void {
        const instance = this.instances.get(noteKey);
        if (!instance) return;

        instance.terminal.resize(cols, rows);
        instance.buffer.cols = cols;
        instance.buffer.rowCount = rows;

        if (instance.ws?.readyState === WebSocket.OPEN) {
            instance.ws.send(`\x1b[RESIZE:${cols},${rows}]`);
        }

        this.updateBuffer(noteKey);
    }

    destroyTerminal(noteKey: string): void {
        const instance = this.instances.get(noteKey);
        if (!instance) return;

        instance.ws?.close();
        instance.terminal.dispose();

        // Remove hidden container
        const container = instance.terminal.element?.parentElement;
        if (container) {
            container.remove();
        }

        this.instances.delete(noteKey);
    }

    hasTerminal(noteKey: string): boolean {
        return this.instances.has(noteKey);
    }

    getAllTerminalKeys(): string[] {
        return Array.from(this.instances.keys());
    }

    /**
     * Scroll the terminal viewport by a number of lines
     * @param noteKey - The terminal note key
     * @param lines - Number of lines to scroll (positive = down, negative = up)
     */
    scrollLines(noteKey: string, lines: number): void {
        const instance = this.instances.get(noteKey);
        if (!instance) return;

        instance.terminal.scrollLines(lines);
        this.updateBuffer(noteKey);
    }

    /**
     * Scroll to the bottom of the terminal (most recent output)
     */
    scrollToBottom(noteKey: string): void {
        const instance = this.instances.get(noteKey);
        if (!instance) return;

        instance.terminal.scrollToBottom();
        this.updateBuffer(noteKey);
    }
}

// Singleton instance
export const terminalManager = new TerminalManager();
export type { TerminalBuffer, TerminalCell };
