# Ambient Script Authoring
## What Does Creating an Ambient Script Actually Look Like?

**Date:** 2025-01-18
**Question:** How do users create, edit, and manage ambient scripts in bit.canvas?

---

## The Core Question

**Traditional scripting:**
```python
# Write code in editor
# Click "Run"
# See output
```

**Ambient scripting:**
```
# Script runs continuously in background
# No explicit "Run" button
# How do you create it?
# How do you debug it?
# How do you see what it's doing?
```

---

## Approach 1: Inline Script Cells (Like Jupyter)

### Visual Syntax

```
┌────────────────────────────────────────┐
│ ~live stockTicker                      │  ← Script declaration
│   every: 5s                            │
│   fetch: api.stocks('AAPL', 'GOOGL')   │
│   display: ticker-widget               │
│                                        │
│   [▶ Active] [Edit] [Logs]            │
└────────────────────────────────────────┘
```

**Written directly on canvas like regular text, but with special `~` prefix**

### Creation Flow

```
1. User types on canvas:
   "~live stockTicker"

2. System recognizes ~ prefix
   → Switches to script mode
   → Shows autocomplete for script types:
     ~live    - Continuous data feed
     ~monitor - Watch for events
     ~auto    - Automatic actions
     ~enrich  - Add context on hover

3. User continues typing:
   "~live stockTicker
    every: 5s"

4. System shows inline suggestions:
   every: 5s
          ↑ Valid interval
   fetch: [suggest: api.stocks, api.weather, api.crypto]

5. User completes script:
   "~live stockTicker
    every: 5s
    fetch: api.stocks('AAPL')
    display: ticker-widget"

6. Script activates automatically
   → Green dot indicator appears: •
   → Widget spawns below script cell
```

### Real Example on Canvas

```
I'm tracking tech stocks for my portfolio:

~live stockTicker                    •  ← Active indicator
  every: 5s
  symbols: ['AAPL', 'GOOGL', 'MSFT']
  fetch: api.stocks(symbols)
  display: ticker-widget

┌──────────────────────────────────┐
│ AAPL  $178.32 ↑ +2.5%            │
│ GOOGL $141.23 ↓ -1.2%            │  ← Widget appears automatically
│ MSFT  $420.50 ↑ +0.8%            │
└──────────────────────────────────┘

Based on today's movement, I should...
```

**It's just text on the canvas, but it becomes executable.**

---

## Approach 2: Command-Based Creation

### Using `/ambient` Command

```bash
# Create new ambient script via command
/ambient new

# System shows template chooser:
┌─────────────────────────────────┐
│ Choose Script Type:             │
│                                 │
│ > Live Data Feed                │
│   Event Monitor                 │
│   Auto-Action                   │
│   Context Enricher              │
│                                 │
│ [Custom Script]                 │
└─────────────────────────────────┘

# User selects "Live Data Feed"
# System creates template at cursor:

~live untitled_feed
  every: 10s
  fetch: /* your code here */
  display: widget

# User edits inline
```

### Quick Script from Selection

```
1. User selects text: "AAPL GOOGL MSFT"

2. User types: /ambient stock-tracker

3. System:
   - Detects selected text is stock symbols
   - Creates script automatically:

~live stock_tracker                    •
  symbols: ['AAPL', 'GOOGL', 'MSFT']  ← Auto-extracted
  every: 5s
  fetch: api.stocks(symbols)
  display: ticker-widget

4. Widget appears immediately
```

---

## Approach 3: Visual Script Builder (GUI)

### Modal Editor

```
User types: /ambient

┌────────────────────────────────────────────────┐
│ Create Ambient Script                          │
├────────────────────────────────────────────────┤
│ Name: stock_tracker                            │
│                                                │
│ Type: ○ Monitor  ● Live Feed  ○ Automation    │
│                                                │
│ ┌────────────────────────────────────────────┐ │
│ │ Trigger                                    │ │
│ │ [✓] Interval: [5] seconds                  │ │
│ │ [ ] On text change                         │ │
│ │ [ ] On label create                        │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ ┌────────────────────────────────────────────┐ │
│ │ Action (JavaScript)                        │ │
│ │                                            │ │
│ │ const data = await fetch(                 │ │
│ │   'api/stocks/AAPL'                        │ │
│ │ );                                         │ │
│ │ return {                                   │ │
│ │   price: data.current,                     │ │
│ │   change: data.change                      │ │
│ │ };                                         │ │
│ │                                            │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ ┌────────────────────────────────────────────┐ │
│ │ Display                                    │ │
│ │ [✓] Create widget                          │ │
│ │     Type: [Ticker ▼]                       │ │
│ │     Position: [Below script ▼]             │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ [Cancel]  [Preview]  [Create & Activate]      │
└────────────────────────────────────────────────┘
```

**Generates script cell on canvas when saved**

---

## Approach 4: File-Based Scripts (Advanced)

### Script Files

```typescript
// .nara/scripts/stock-tracker.ts

export default {
    name: 'Stock Tracker',
    type: 'live',

    trigger: {
        type: 'interval',
        ms: 5000
    },

    async execute(context: ScriptContext) {
        const symbols = context.props.symbols || ['AAPL'];

        const prices = await Promise.all(
            symbols.map(async (symbol) => {
                const response = await fetch(
                    `https://api.stocks.com/${symbol}`
                );
                return response.json();
            })
        );

        // Update component
        context.updateComponent('stock-ticker', {
            prices: prices
        });
    },

    render: {
        component: 'stock-ticker',
        position: 'below-script'
    }
}
```

**Then reference on canvas:**

```
~import stock-tracker
  symbols: ['AAPL', 'GOOGL', 'MSFT']
```

---

## Script Language Design

### Option A: Declarative YAML-like

```yaml
~live stockTicker
  every: 5s
  symbols: [AAPL, GOOGL, MSFT]
  fetch: api.stocks(symbols)
  transform: (data) => ({
    symbol: data.symbol,
    price: data.price,
    change: data.change
  })
  display: ticker-widget
  position: below
```

**Pros:**
- Simple, readable
- No JavaScript knowledge needed
- Safe (limited operations)

**Cons:**
- Limited expressiveness
- Can't do complex logic

### Option B: JavaScript Blocks

```javascript
~live stockTicker {
  interval: 5000,

  async execute() {
    const data = await fetch('api/stocks/AAPL');
    const json = await data.json();

    return {
      symbol: 'AAPL',
      price: json.current,
      change: json.change,
      percentChange: (json.change / json.previous) * 100
    };
  },

  render(result) {
    return {
      component: 'ticker-widget',
      props: result
    };
  }
}
```

**Pros:**
- Full JavaScript power
- Familiar to developers
- Can do complex logic

**Cons:**
- Requires programming knowledge
- Security risks (arbitrary code execution)

### Option C: Hybrid (Recommended)

```javascript
~live stockTicker
  every: 5s
  symbols: [AAPL, GOOGL, MSFT]

  // Simple expression for common case
  fetch: api.stocks(symbols)

  // Optional JavaScript for complex logic
  transform: (data) => {
    return data.map(stock => ({
      ...stock,
      recommendation: stock.change > 0 ? 'buy' : 'hold'
    }));
  }

  display: ticker-widget
```

**Pros:**
- Simple cases are simple
- Complex cases are possible
- Gradual learning curve

---

## Concrete Example: Writing a Stock Tracker Script

### Step-by-Step Creation

**1. User types on canvas:**
```
I'm tracking stocks:
█  ← Cursor
```

**2. User types `~`:**
```
I'm tracking stocks:
~█

Autocomplete appears:
┌─────────────────┐
│ ~live           │
│ ~monitor        │
│ ~auto           │
│ ~enrich         │
└─────────────────┘
```

**3. User selects `~live` and types name:**
```
I'm tracking stocks:
~live stockTracker█

Autocomplete for next line:
┌─────────────────┐
│ every:          │
│ symbols:        │
│ fetch:          │
└─────────────────┘
```

**4. User completes script:**
```
I'm tracking stocks:
~live stockTracker
  every: 5s
  symbols: [AAPL, GOOGL]
  fetch: api.stocks(symbols)
  display: ticker
  █
```

**5. User hits Enter twice → Script activates:**
```
I'm tracking stocks:
~live stockTracker                   •  ← Active
  every: 5s
  symbols: [AAPL, GOOGL]
  fetch: api.stocks(symbols)
  display: ticker

┌──────────────────────────────────┐
│ AAPL  $178.32 ↑ +2.5%            │  ← Widget appears
│ GOOGL $141.23 ↓ -1.2%            │
└──────────────────────────────────┘

Moving forward with investment...
```

**6. User can edit script inline:**
```
~live stockTracker                   •
  every: 5s
  symbols: [AAPL, GOOGL, MSFT]  ← Added MSFT
  fetch: api.stocks(symbols)
  display: ticker
```

Widget updates automatically to show 3 stocks.

---

## Script Controls

### Inline Controls

```
~live stockTracker                   •
  every: 5s
  [▶ Active] [⏸ Pause] [Edit] [Logs] [Delete]
```

**Click "Logs" shows activity:**
```
┌────────────────────────────────────┐
│ Script Logs: stockTracker          │
├────────────────────────────────────┤
│ 14:32:15 - Fetched 3 stocks        │
│ 14:32:10 - Updated widget          │
│ 14:32:05 - Fetched 3 stocks        │
│ 14:32:00 - Updated widget          │
│                                    │
│ [Clear] [Download]                 │
└────────────────────────────────────┘
```

**Click "Edit" enters edit mode:**
```
~live stockTracker                   ⏸ (paused)
  every: 5s█  ← Editing
  symbols: [AAPL, GOOGL]
  fetch: api.stocks(symbols)
  display: ticker

[Save] [Cancel]
```

**Click "Pause" stops execution:**
```
~live stockTracker                   ⏸
  every: 5s
  symbols: [AAPL, GOOGL]
  fetch: api.stocks(symbols)
  display: ticker

┌──────────────────────────────────┐
│ AAPL  $178.32 (stale)            │
│ GOOGL $141.23 (stale)            │  ← No longer updating
└──────────────────────────────────┘
```

---

## Debugging & Monitoring

### Console Output

```javascript
~live stockTracker
  every: 5s

  fetch: (symbols) => {
    console.log('Fetching stocks:', symbols);  // Debug output
    return api.stocks(symbols);
  }
```

**Output appears in logs panel:**
```
[stockTracker] Fetching stocks: ['AAPL', 'GOOGL']
[stockTracker] Response: { AAPL: 178.32, GOOGL: 141.23 }
```

### Error Handling

```javascript
~live stockTracker
  every: 5s

  fetch: async (symbols) => {
    try {
      return await api.stocks(symbols);
    } catch (error) {
      console.error('Failed to fetch stocks:', error);
      return null;  // Return fallback data
    }
  }
```

**Errors show in UI:**
```
~live stockTracker                   ⚠ Error
  every: 5s
  [View Error]

Click "View Error":
┌────────────────────────────────────┐
│ Script Error: stockTracker         │
├────────────────────────────────────┤
│ Failed to fetch stocks:            │
│ Network error: api.stocks.com      │
│ unreachable                        │
│                                    │
│ Last successful run: 14:30:00      │
│ [Retry] [Disable] [Edit]           │
└────────────────────────────────────┘
```

### Performance Monitoring

```
~live stockTracker                   • (6ms avg)
  every: 5s
  [Performance]

Click "Performance":
┌────────────────────────────────────┐
│ Script Performance: stockTracker   │
├────────────────────────────────────┤
│ Avg execution time: 6ms            │
│ Max execution time: 12ms           │
│ Min execution time: 4ms            │
│                                    │
│ Executions: 1,247                  │
│ Errors: 0                          │
│ Success rate: 100%                 │
│                                    │
│ [View Timeline]                    │
└────────────────────────────────────┘
```

---

## Script Marketplace / Library

### Discovery

```
/ambient browse

┌────────────────────────────────────────┐
│ Ambient Script Library                 │
├────────────────────────────────────────┤
│ 🔥 Popular                             │
│                                        │
│ 📈 Stock Ticker                        │
│    Live stock prices from any exchange │
│    [Preview] [Install]                 │
│                                        │
│ 📅 Calendar Widget                     │
│    Interactive calendar component      │
│    [Preview] [Install]                 │
│                                        │
│ 🌐 Website Monitor                     │
│    Check if URLs are up/down           │
│    [Preview] [Install]                 │
│                                        │
│ 📊 Data Visualizer                     │
│    Auto-create charts from data        │
│    [Preview] [Install]                 │
│                                        │
│ [Search Scripts...]                    │
└────────────────────────────────────────┘
```

### Installation

```
User clicks "Install" on "Stock Ticker"

System adds script template to canvas:

~live stockTicker
  every: 5s
  symbols: [AAPL]  ← User customizes
  fetch: api.stocks(symbols)
  display: ticker

[Configure] [Activate]
```

---

## Example Scripts Users Might Write

### 1. Weather Update

```
~live weatherUpdate
  every: 30m
  location: "San Francisco, CA"
  fetch: api.weather(location)
  display: weather-widget
```

### 2. GitHub Issues Monitor

```
~monitor githubIssues
  watch: api.github.issues('myrepo')
  every: 5m
  filter: (issues) => issues.filter(i => i.label === 'bug')
  notify: (issues) => {
    if (issues.length > 10) {
      return `⚠️ ${issues.length} open bugs!`;
    }
  }
  display: issue-list
```

### 3. Auto-Link URLs

```
~monitor urlLinker
  watch: textChange
  pattern: /https?:\/\/[^\s]+/g
  action: (url) => {
    createLink(url, {
      preview: true,
      metadata: await fetchMetadata(url)
    });
  }
```

### 4. Smart Calculator

```
~monitor calculator
  watch: textChange
  pattern: /(\d+)\s*([+\-*/])\s*(\d+)/
  action: (match) => {
    const [_, a, op, b] = match;
    const result = eval(`${a} ${op} ${b}`);

    showSuggestion(`= ${result}`, {
      position: 'after-text',
      clickToInsert: true
    });
  }
```

### 5. Todo → Kanban Converter

```
~monitor todoDetector
  watch: textChange
  pattern: /^- \[ \] (.+)$/gm
  collect: true
  threshold: 3  // At least 3 todos
  action: (todos) => {
    createLabel('Tasks', {
      scriptBinding: 'kanban-generator',
      config: {
        initialTasks: todos.map(t => ({
          title: t[1],
          status: 'todo'
        }))
      }
    });
  }
```

---

## Persistence

### Scripts Save to worldData

```typescript
// worldData structure
{
  "script_100,50_stockTracker": {
    "type": "ambient-script",
    "startX": 100,
    "startY": 50,
    "scriptData": {
      "name": "stockTracker",
      "scriptType": "live",
      "code": "every: 5s\nsymbols: [AAPL]\nfetch: api.stocks(symbols)",
      "active": true,
      "config": {
        "every": 5000,
        "symbols": ["AAPL"]
      }
    },
    "timestamp": 1705555200000
  }
}
```

**Scripts persist across sessions:**
1. User creates script
2. Script saved to Firebase with worldData
3. User refreshes page
4. Script reloads and resumes automatically (if active)

---

## Security Considerations

### Sandboxing

```javascript
// Scripts run in sandboxed context
const scriptContext = {
  // Available APIs
  api: {
    stocks: safeFetch('/api/stocks'),
    weather: safeFetch('/api/weather'),
    // ... whitelisted APIs only
  },

  // Canvas operations
  createLabel: (...args) => { /* safe wrapper */ },
  createWidget: (...args) => { /* safe wrapper */ },

  // NO access to:
  // - window
  // - document
  // - localStorage
  // - fetch (direct)
  // - eval
};

// Execute script in sandbox
executeInSandbox(scriptCode, scriptContext);
```

### Rate Limiting

```javascript
~live aggressiveScript
  every: 100ms  // Too frequent!

System warning:
┌────────────────────────────────────┐
│ ⚠️ Script Rate Limit               │
├────────────────────────────────────┤
│ This script is running too often.  │
│ Minimum interval: 1s               │
│                                    │
│ Suggested: every: 1s               │
│ [Update] [Keep Anyway]             │
└────────────────────────────────────┘
```

---

## Recommended Implementation

**Phase 1: Inline Script Cells (Approach 1)**
- Type `~live` directly on canvas
- Declarative YAML-like syntax
- Auto-activate on completion
- Simple, intuitive

**Phase 2: Command Creation (Approach 2)**
- `/ambient new` for templates
- Quick creation from selection

**Phase 3: Script Library**
- Built-in scripts (stock ticker, weather, etc.)
- `/ambient browse` to discover
- One-click install

**Phase 4: Advanced Features**
- Visual builder (Approach 3) for non-coders
- File-based scripts (Approach 4) for power users
- Script marketplace

---

## Conclusion

**Creating an ambient script should feel like:**
1. **Writing text** - Type `~live scriptName` on canvas
2. **Configuring simply** - `every: 5s`, `fetch: api.stocks()`
3. **Seeing it work** - Widget appears immediately
4. **Editing inline** - Change values, see updates
5. **No compilation** - Just save and it runs

**It's executable text that lives on your canvas.**

---

*Last updated: 2025-01-18*
*Version: 1.0 - Ambient Script Authoring*
