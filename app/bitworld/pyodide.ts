// Pyodide loader - lazy loads Python runtime on first use
// Pyodide is ~10MB, so we only load it when needed

import { NARA_MODULE_PYTHON } from './nara.module';

declare global {
    interface Window {
        loadPyodide?: (options?: { indexURL?: string }) => Promise<any>;
    }
}

let pyodideInstance: any = null;
let pyodideLoading: Promise<any> | null = null;

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/';

/**
 * Load the Pyodide script from CDN
 */
function loadPyodideScript(): Promise<void> {
    return new Promise((resolve, reject) => {
        // Check if already loaded
        if (window.loadPyodide) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = `${PYODIDE_CDN}pyodide.js`;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Pyodide script'));
        document.head.appendChild(script);
    });
}

/**
 * Get or initialize Pyodide instance (lazy loading)
 */
export async function getPyodide(): Promise<any> {
    // Return cached instance
    if (pyodideInstance) {
        return pyodideInstance;
    }

    // Return loading promise if already loading
    if (pyodideLoading) {
        return pyodideLoading;
    }

    // Start loading
    pyodideLoading = (async () => {
        console.log('Loading Pyodide...');

        // Load the script first
        await loadPyodideScript();

        // Initialize Pyodide
        if (!window.loadPyodide) {
            throw new Error('Pyodide script loaded but loadPyodide not found');
        }

        pyodideInstance = await window.loadPyodide({
            indexURL: PYODIDE_CDN,
        });

        console.log('Pyodide loaded successfully');

        // Set up stdout/stderr capture
        pyodideInstance.setStdout({
            batched: (text: string) => {
                console.log('[Python stdout]', text);
            }
        });
        pyodideInstance.setStderr({
            batched: (text: string) => {
                console.error('[Python stderr]', text);
            }
        });

        return pyodideInstance;
    })();

    try {
        const result = await pyodideLoading;
        return result;
    } catch (error) {
        pyodideLoading = null;
        throw error;
    }
}

/**
 * Check if Pyodide is already loaded
 */
export function isPyodideLoaded(): boolean {
    return pyodideInstance !== null;
}

// Track if pandas has been loaded
let pandasLoaded = false;

// Track if nara module has been initialized
let naraModuleInitialized = false;

/**
 * Load pandas via micropip (lazy, on first use)
 */
async function ensurePandas(): Promise<void> {
    if (pandasLoaded) return;

    const pyodide = await getPyodide();
    console.log('Loading pandas...');

    await pyodide.loadPackage('micropip');
    const micropip = pyodide.pyimport('micropip');
    await micropip.install('pandas');

    pandasLoaded = true;
    console.log('Pandas loaded successfully');
}

/**
 * Execute Python code and capture output
 * Returns tableOutput if the script calls nara.output_table()
 *
 * @param code - Python code to execute
 * @param tables - Named tables to inject (from /name command): { name: [[row], [row], ...] }
 */
export async function runPython(code: string, tables?: Record<string, string[][]>): Promise<{
    result: any;
    stdout: string[];
    stderr: string[];
    error?: string;
    tableOutput?: string; // CSV data if output_table() was called
    tableUpdates?: Record<string, string[][]>; // Updates to existing tables from write_table()
}> {
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
        const pyodide = await getPyodide();

        // Check if code uses pandas or nara table functions
        const usesPandas = /import\s+pandas|from\s+pandas|\.DataFrame|nara\.output_table|nara\.read_table|nara\.random_table|nara\.write_table/.test(code);
        if (usesPandas) {
            await ensurePandas();
        }

        // Redirect stdout/stderr to capture arrays
        pyodide.setStdout({
            batched: (text: string) => {
                stdout.push(text);
                console.log('[Python]', text);
            }
        });
        pyodide.setStderr({
            batched: (text: string) => {
                stderr.push(text);
                console.error('[Python Error]', text);
            }
        });

        // Set up the nara module with output_table function (only once)
        // This stores CSV data that we can retrieve after execution
        if (!naraModuleInitialized) {
            console.log('Initializing nara module...');
            await pyodide.runPythonAsync(NARA_MODULE_PYTHON);
            naraModuleInitialized = true;
            console.log('Nara module initialized');
        } else {
            // Reset the table output for this run
            await pyodide.runPythonAsync(`nara._table_output = None`);
        }

        // Inject tables data if provided
        if (tables && Object.keys(tables).length > 0) {
            const tablesJson = JSON.stringify(tables);
            await pyodide.runPythonAsync(`
import json
nara._tables = json.loads('''${tablesJson}''')
            `);
            console.log('Injected tables:', Object.keys(tables));
        } else {
            // Clear any previous tables
            await pyodide.runPythonAsync(`nara._tables = {}`);
        }

        // Run the user's code
        console.log('Running user code:', code);
        const result = await pyodide.runPythonAsync(code);

        // Check if output_table was called
        const tableOutput = await pyodide.runPythonAsync(`nara._table_output`);
        const tableOutputStr = tableOutput?.toString?.() ?? null;

        // Check if write_table was called (in-place updates)
        const tableUpdatesRaw = await pyodide.runPythonAsync(`
import json
json.dumps(nara._table_updates) if nara._table_updates else '{}'
        `);
        let tableUpdates: Record<string, string[][]> | undefined;
        try {
            const updatesStr = tableUpdatesRaw?.toString?.() ?? '{}';
            if (updatesStr && updatesStr !== '{}') {
                tableUpdates = JSON.parse(updatesStr);
            }
        } catch (e) {
            console.error('Failed to parse table updates:', e);
        }

        // Reset table updates for next run
        await pyodide.runPythonAsync(`nara._table_updates = {}`);

        return {
            result: result?.toJs?.() ?? result,
            stdout,
            stderr,
            tableOutput: tableOutputStr && tableOutputStr !== 'None' ? tableOutputStr : undefined,
            tableUpdates: tableUpdates && Object.keys(tableUpdates).length > 0 ? tableUpdates : undefined,
        };
    } catch (error: any) {
        return {
            result: undefined,
            stdout,
            stderr,
            error: error.message || String(error),
        };
    }
}
