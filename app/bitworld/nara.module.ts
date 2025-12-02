// Nara Python module definition
// This is injected into Pyodide scripts to provide nara.* functions
// Can also be used by MCP server for consistent API

export const NARA_MODULE_PYTHON = `
import sys

class NaraModule:
    def __init__(self):
        self._table_output = None
        self._outputs = []  # For multiple outputs
        self._tables = {}  # Injected table data: name -> list of lists
        self._table_updates = {}  # Updates to existing tables: name -> list of lists

    def read_table(self, name):
        """
        Read a named data table.

        Args:
            name: The name given to the data note via /name command

        Returns:
            pandas DataFrame if pandas available, otherwise list of lists
        """
        if name not in self._tables:
            raise ValueError(f"No table named '{name}' found. Use /name to name a data note first.")

        data = self._tables[name]

        try:
            import pandas as pd
            # First row is headers
            if len(data) > 1:
                return pd.DataFrame(data[1:], columns=data[0])
            elif len(data) == 1:
                return pd.DataFrame(columns=data[0])
            else:
                return pd.DataFrame()
        except ImportError:
            return data

    def cell(self, name, row, col=None):
        """
        Read a single cell from a named table.

        Args:
            name: Table name
            row: Row index (0-based) or spreadsheet-style like "A1"
            col: Column index (0-based), not needed if row is spreadsheet-style

        Returns:
            Cell value as string
        """
        if name not in self._tables:
            raise ValueError(f"No table named '{name}' found.")

        data = self._tables[name]

        # Parse spreadsheet-style reference like "A1", "B2"
        if isinstance(row, str) and col is None:
            import re
            match = re.match(r'^([A-Za-z]+)(\d+)$', row)
            if match:
                col_letters = match.group(1).upper()
                row_num = int(match.group(2)) - 1  # 1-indexed to 0-indexed

                # Convert column letters to index (A=0, B=1, ..., Z=25, AA=26, etc)
                col_idx = 0
                for char in col_letters:
                    col_idx = col_idx * 26 + (ord(char) - ord('A') + 1)
                col_idx -= 1  # 0-indexed

                row = row_num
                col = col_idx
            else:
                raise ValueError(f"Invalid cell reference: {row}. Use 'A1' style or (row, col) indices.")

        if row < 0 or row >= len(data):
            raise IndexError(f"Row {row} out of range (0-{len(data)-1})")
        if col < 0 or col >= len(data[row]):
            raise IndexError(f"Column {col} out of range (0-{len(data[row])-1})")

        return data[row][col]

    def tables(self):
        """List all available table names."""
        return list(self._tables.keys())

    def write_table(self, name, data):
        """
        Update an existing named table in place.

        Args:
            name: The name of the table to update
            data: pandas DataFrame or list of lists (first row = headers)

        Returns:
            The data passed in (for chaining)
        """
        import io

        if name not in self._tables:
            raise ValueError(f"No table named '{name}' found. Use output_table() to create new tables.")

        # Convert to list of lists for storage
        try:
            import pandas as pd
            if isinstance(data, pd.DataFrame):
                # Include headers as first row
                headers = list(data.columns)
                rows = data.values.tolist()
                table_data = [headers] + [[str(cell) for cell in row] for row in rows]
            elif isinstance(data, list):
                table_data = [[str(cell) for cell in row] for row in data]
            else:
                raise ValueError("Data must be DataFrame or list of lists")
        except ImportError:
            if isinstance(data, list):
                table_data = [[str(cell) for cell in row] for row in data]
            else:
                raise ValueError("Data must be list of lists")

        self._table_updates[name] = table_data
        return data

    def set_cell(self, name, row, col, value):
        """
        Update a single cell in a named table.

        Args:
            name: Table name
            row: Row index or "A1" style reference
            col: Column index (not needed if row is "A1" style)
            value: New value for the cell
        """
        if name not in self._tables:
            raise ValueError(f"No table named '{name}' found.")

        # Get current data (from updates if exists, otherwise from original)
        if name in self._table_updates:
            data = self._table_updates[name]
        else:
            data = [row[:] for row in self._tables[name]]  # Deep copy

        # Parse spreadsheet-style reference
        if isinstance(row, str) and col is None:
            import re
            match = re.match(r'^([A-Za-z]+)(\d+)$', row)
            if match:
                col_letters = match.group(1).upper()
                row_num = int(match.group(2)) - 1
                col_idx = 0
                for char in col_letters:
                    col_idx = col_idx * 26 + (ord(char) - ord('A') + 1)
                col_idx -= 1
                row = row_num
                col = col_idx
            else:
                raise ValueError(f"Invalid cell reference: {row}")

        if row < 0 or row >= len(data):
            raise IndexError(f"Row {row} out of range")
        if col < 0 or col >= len(data[row]):
            raise IndexError(f"Column {col} out of range")

        data[row][col] = str(value)
        self._table_updates[name] = data

    def output_table(self, data, name=None):
        """
        Output a DataFrame or list of dicts as a data note.

        Args:
            data: pandas DataFrame, list of dicts, or list of lists
            name: optional name for the output (not used yet)

        Returns:
            The data passed in (for chaining)
        """
        import io

        # Convert to DataFrame if needed
        try:
            import pandas as pd
            if isinstance(data, pd.DataFrame):
                df = data
            elif isinstance(data, list):
                # If list of lists, treat first row as headers
                if len(data) > 1 and isinstance(data[0], (list, tuple)):
                    df = pd.DataFrame(data[1:], columns=data[0])
                elif len(data) == 1 and isinstance(data[0], (list, tuple)):
                    df = pd.DataFrame(columns=data[0])
                else:
                    df = pd.DataFrame(data)
            else:
                df = pd.DataFrame([data])
        except ImportError:
            # No pandas - convert manually
            if isinstance(data, list) and len(data) > 0:
                if isinstance(data[0], dict):
                    # List of dicts
                    headers = list(data[0].keys())
                    rows = [[str(row.get(h, '')) for h in headers] for row in data]
                    csv_lines = [','.join(headers)]
                    csv_lines.extend([','.join(row) for row in rows])
                    self._table_output = '\\n'.join(csv_lines)
                    return data
                elif isinstance(data[0], (list, tuple)):
                    # List of lists
                    csv_lines = [','.join(str(cell) for cell in row) for row in data]
                    self._table_output = '\\n'.join(csv_lines)
                    return data
            raise ValueError("Cannot convert data to table format")

        # Convert DataFrame to CSV
        csv_buffer = io.StringIO()
        df.to_csv(csv_buffer, index=False)
        self._table_output = csv_buffer.getvalue()

        return data

    def sample(self, data, n=5, seed=None):
        """
        Random sample from data.

        Args:
            data: list or DataFrame to sample from
            n: number of samples
            seed: random seed for reproducibility
        """
        import random
        if seed is not None:
            random.seed(seed)

        try:
            import pandas as pd
            if isinstance(data, pd.DataFrame):
                return data.sample(n=min(n, len(data)), random_state=seed)
        except ImportError:
            pass

        if isinstance(data, list):
            return random.sample(data, min(n, len(data)))
        return data

    def random_table(self, rows=10, cols=3, seed=None):
        """
        Generate a random table with numeric data.

        Args:
            rows: number of rows
            cols: number of columns
            seed: random seed for reproducibility

        Returns:
            pandas DataFrame with random data
        """
        import random
        if seed is not None:
            random.seed(seed)

        try:
            import pandas as pd
            import numpy as np
            if seed is not None:
                np.random.seed(seed)

            data = np.random.randn(rows, cols)
            columns = [f'col_{i}' for i in range(cols)]
            return pd.DataFrame(data, columns=columns)
        except ImportError:
            # Fallback without pandas/numpy
            data = [[random.random() for _ in range(cols)] for _ in range(rows)]
            return data

    def randint(self, low=0, high=100, size=None):
        """
        Generate random integers.

        Args:
            low: minimum value (inclusive)
            high: maximum value (exclusive)
            size: if int, returns list of that size. If tuple (rows, cols), returns 2D list.
        """
        import random

        if size is None:
            return random.randint(low, high - 1)
        elif isinstance(size, int):
            return [random.randint(low, high - 1) for _ in range(size)]
        elif isinstance(size, tuple) and len(size) == 2:
            return [[random.randint(low, high - 1) for _ in range(size[1])] for _ in range(size[0])]
        return random.randint(low, high - 1)

    def choice(self, items, size=None, seed=None):
        """
        Random choice from a list.

        Args:
            items: list to choose from
            size: number of choices to make
            seed: random seed
        """
        import random
        if seed is not None:
            random.seed(seed)

        if size is None:
            return random.choice(items)
        return [random.choice(items) for _ in range(size)]

    def linspace(self, start, stop, num=50):
        """
        Generate evenly spaced numbers.

        Args:
            start: start value
            stop: end value
            num: number of values
        """
        if num == 1:
            return [start]
        step = (stop - start) / (num - 1)
        return [start + i * step for i in range(num)]

    def arange(self, start, stop=None, step=1):
        """
        Generate range of numbers.

        Args:
            start: start value (or stop if stop is None)
            stop: end value (exclusive)
            step: step size
        """
        if stop is None:
            stop = start
            start = 0
        result = []
        val = start
        while val < stop:
            result.append(val)
            val += step
        return result

# Create global nara instance
nara = NaraModule()
sys.modules['nara'] = nara
`;

// JavaScript version of nara module for JS scripts
export const NARA_MODULE_JS = {
    _tableOutput: null as string | null,

    outputTable(data: any[][]): any[][] {
        // Convert 2D array to CSV
        const csv = data.map(row => row.map(cell => String(cell)).join(',')).join('\n');
        this._tableOutput = csv;
        return data;
    },

    randomTable(rows: number = 10, cols: number = 3, seed?: number): number[][] {
        // Simple seedable RNG
        let rng = seed !== undefined ? mulberry32(seed) : Math.random;
        const data: number[][] = [];
        for (let i = 0; i < rows; i++) {
            const row: number[] = [];
            for (let j = 0; j < cols; j++) {
                row.push((rng() * 2 - 1).toFixed(4) as any);
            }
            data.push(row);
        }
        return data;
    },

    randint(low: number = 0, high: number = 100, size?: number): number | number[] {
        if (size === undefined) {
            return Math.floor(Math.random() * (high - low)) + low;
        }
        return Array.from({ length: size }, () => Math.floor(Math.random() * (high - low)) + low);
    },

    choice<T>(items: T[], size?: number): T | T[] {
        if (size === undefined) {
            return items[Math.floor(Math.random() * items.length)];
        }
        return Array.from({ length: size }, () => items[Math.floor(Math.random() * items.length)]);
    },

    linspace(start: number, stop: number, num: number = 50): number[] {
        if (num === 1) return [start];
        const step = (stop - start) / (num - 1);
        return Array.from({ length: num }, (_, i) => start + i * step);
    },

    arange(start: number, stop?: number, step: number = 1): number[] {
        if (stop === undefined) {
            stop = start;
            start = 0;
        }
        const result: number[] = [];
        for (let val = start; val < stop; val += step) {
            result.push(val);
        }
        return result;
    },

    getTableOutput(): string | null {
        const output = this._tableOutput;
        this._tableOutput = null;
        return output;
    }
};

// Simple seedable PRNG
function mulberry32(seed: number): () => number {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
