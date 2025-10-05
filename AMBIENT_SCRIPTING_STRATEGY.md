# Ambient Scripting Strategy for bit.canvas
## Background Intelligence: Computation Without Interruption

---

## Executive Summary

While explicit code cells provide user-directed computation, **ambient scripting** creates a continuously-running background intelligence layer that:
- Monitors canvas state and user activity
- Automatically processes and enriches content
- Provides real-time updates and suggestions
- Executes without explicit user commands
- Feels invisible yet indispensable

This document outlines the architecture for ambient computation that makes bit.canvas feel **alive and intelligent**.

---

## 1. Philosophy: Ambient vs Explicit Computation

### Explicit Computation (Code Cells)
```
> df.describe()  [Click Run]
→ User triggers
→ Result appears
→ Done
```
- **User control:** Direct, intentional
- **Timing:** On-demand
- **Feedback:** Immediate, visible

### Ambient Computation (Background Scripts)
```
User types: "revenue in Q1 was $10,000"
→ Background recognizes number
→ Auto-creates extractable data point
→ Links to related mentions
→ Updates calculations that reference it
→ All invisible, instantaneous
```
- **User control:** Indirect, contextual
- **Timing:** Continuous, reactive
- **Feedback:** Subtle, integrated

---

## 2. Ambient Scripting Capabilities

### Tier 1: Content Monitoring (Always Active)

#### Auto-Linking
```
User writes: "See analysis from last week"
→ Detects temporal reference
→ Searches canvas for content from that timeframe
→ Creates subtle link indicator
→ Click to navigate
```

**Implementation:**
```typescript
class ContentMonitor {
  async onTextChange(text: string, position: Position) {
    // Extract entities
    const entities = this.extractEntities(text);

    // Find related content
    const related = await this.findRelated(entities);

    // Create ambient links (non-intrusive)
    if (related.length > 0) {
      this.createAmbientLink(position, related);
    }
  }

  extractEntities(text: string) {
    return {
      dates: extractDates(text),
      numbers: extractNumbers(text),
      references: extractReferences(text),
      concepts: extractConcepts(text)
    };
  }
}
```

#### Live Calculations
```
User types: "Revenue: $10,000  Cost: $3,000"
→ Detects numeric pattern
→ Recognizes calculation opportunity
→ Shows subtle suggestion: "Profit: $7,000"
→ Click to insert
```

**Visual Indicator:**
```
Revenue: $10,000
Cost: $3,000
         ┌─────────────────┐
         │ ✨ Profit: $7k  │ ← Ambient suggestion
         └─────────────────┘
```

#### Data Extraction
```
User pastes CSV data
→ Automatically recognizes tabular structure
→ Offers to create dataframe
→ Suggests visualizations
→ All in background, no interruption
```

### Tier 2: Real-Time Updates (Event-Driven)

#### Live Data Feeds
```typescript
// Ambient script definition
~live price = fetch('api/stock/AAPL')
     .every(5000)  // ms
     .show('minimal')

// On canvas:
AAPL: $178.32 ↑  ← Updates every 5 seconds
      ┗━ subtle pulse on change
```

**Configuration:**
```typescript
interface AmbientScript {
  id: string;
  type: 'live-data' | 'monitor' | 'automation';
  trigger: 'interval' | 'change' | 'event';
  code: string;
  updateMode: 'minimal' | 'highlight' | 'notify';
  active: boolean;
}
```

#### Reactive Spreadsheet Updates
```
User changes:
Revenue: 10000 → 15000

Ambient system automatically updates:
- All formulas that reference "revenue"
- All charts showing revenue
- All text mentioning revenue metrics
- Related calculations cascade

User sees:
- Subtle highlight on changed values (1 second)
- No explicit "recalculate" needed
```

#### Collaboration Awareness
```
Another user edits nearby
→ Show their cursor + name
→ Highlight their selection
→ Update your view in real-time
→ Prevent edit conflicts
→ All seamless
```

### Tier 3: AI-Powered Assistance (Context-Aware)

#### Smart Autocomplete
```
User types: "The total revenue across all regi"
→ AI completes: "regions was $150k"
→ Based on actual data on canvas
→ Not generic LLM completion
→ Grounded in workspace context
```

#### Contextual Suggestions
```
User creates list of customer names
→ Detects pattern: list of entities
→ Suggests: "Import full customer data?"
→ Offers: "Create contact cards?"
→ Shows: "Link to CRM integration?"
```

#### Automatic Summarization
```
User writes long analysis in bounds
→ AI generates summary chip
→ Positioned at top
→ Updates as document evolves
→ Click to edit or remove
```

**Visual:**
```
┌────────────────────────────────┐
│ 📄 Summary                     │
│ This analysis shows Q1 revenue │
│ grew 23% YoY driven by...      │
│                    [✏️ Edit]    │
└────────────────────────────────┘

[Long analysis document below...]
```

#### Semantic Search
```
User types: "@find analysis about churn"
→ Searches entire canvas
→ Ranks by semantic similarity
→ Shows results as you type
→ No explicit search box needed
```

---

## 3. Ambient Script Types

### Type 1: Monitors (Watch & React)

```javascript
// Monitor pattern
~monitor customerMentions {
  watch: textContaining('customer', 'client', 'user')
  action: (match) => {
    highlightEntity(match);
    linkToCustomerDB(match);
  }
  interval: 'onChange'
}
```

**Use cases:**
- Entity extraction (people, places, companies)
- Pattern detection (dates, currency, metrics)
- Link creation (cross-references)
- Data validation (flag inconsistencies)

### Type 2: Automations (Do Without Asking)

```javascript
// Automation pattern
~automate organizeByDate {
  trigger: 'fileUpload'
  condition: file.type === 'csv' && file.hasColumn('date')
  action: (file) => {
    const df = parseCSV(file);
    const grouped = df.groupby('date');
    createVisualTimeline(grouped);
  }
  confirm: false  // Run automatically
}
```

**Use cases:**
- Auto-format imported data
- Generate visualizations
- Create backups
- Sync to cloud
- Export reports

### Type 3: Enrichers (Add Context)

```javascript
// Enrichment pattern
~enrich companyNames {
  detect: /\b[A-Z][a-z]+ (Inc|LLC|Corp)\b/
  fetch: (name) => companyAPI.lookup(name)
  display: 'tooltip'  // Show on hover
  cache: true         // Don't re-fetch
}
```

**Use cases:**
- Company info lookup
- Definition expansion
- Translation
- Citation retrieval
- Image enhancement

### Type 4: Live Feeds (Continuous Updates)

```javascript
// Live feed pattern
~live cryptoPrices {
  source: 'wss://crypto.com/feed'
  update: (data) => {
    updateChip('BTC', data.price);
    if (data.change > 5%) {
      notify('BTC moved 5%!');
    }
  }
  interval: 1000
}
```

**Use cases:**
- Stock/crypto prices
- Weather updates
- API monitoring
- Social media feeds
- Sensor data

---

## 4. User Interface for Ambient Scripts

### Discovery & Control Panel

```
┌─────────────────────────────────────┐
│ ⚡ Ambient Scripts                   │
├─────────────────────────────────────┤
│ 🟢 Live Data (3 active)             │
│   • Stock prices      [Edit] [Off]  │
│   • Weather           [Edit] [Off]  │
│   • Server status     [Edit] [Off]  │
│                                      │
│ 🟢 Monitors (5 active)               │
│   • Auto-link dates   [Edit] [Off]  │
│   • Extract emails    [Edit] [Off]  │
│   • Detect numbers    [Edit] [Off]  │
│   • Find patterns     [Edit] [Off]  │
│   • Link references   [Edit] [Off]  │
│                                      │
│ 🟡 Automations (2 active)            │
│   • CSV → DataFrame   [Edit] [Off]  │
│   • Auto-backup       [Edit] [Off]  │
│                                      │
│ + New Ambient Script                │
└─────────────────────────────────────┘
```

### Visual Indicators

**Minimal Mode (Default):**
- Subtle dot indicator: `Revenue: $10k •` ← being monitored
- Faint pulse on update
- No interruption

**Highlight Mode:**
- Brief highlight on change
- Fades after 1 second
- Shows what changed

**Notify Mode:**
- Toast notification
- For important updates only
- User-configurable threshold

### Activity Log
```
┌─────────────────────────────────────┐
│ 📊 Ambient Activity (last hour)     │
├─────────────────────────────────────┤
│ 14:32 • Updated 3 stock prices      │
│ 14:30 • Auto-linked 2 references    │
│ 14:28 • Extracted 1 email address   │
│ 14:25 • CSV imported → DataFrame    │
│ 14:20 • Backed up to cloud          │
│                                      │
│ View All Activity →                 │
└─────────────────────────────────────┘
```

---

## 5. Implementation Architecture

### Core Engine

```typescript
class AmbientScriptEngine {
  scripts: Map<string, AmbientScript>;
  monitors: Map<string, Monitor>;
  workers: Map<string, Worker>;

  constructor() {
    this.setupEventListeners();
    this.startScheduler();
  }

  // Listen to all canvas events
  setupEventListeners() {
    canvas.on('textChange', this.onTextChange.bind(this));
    canvas.on('fileUpload', this.onFileUpload.bind(this));
    canvas.on('selection', this.onSelection.bind(this));
    canvas.on('cursorMove', this.onCursorMove.bind(this));
  }

  // Event handlers trigger ambient scripts
  async onTextChange(change: TextChange) {
    // Find applicable monitors
    const monitors = this.getMonitorsFor('textChange');

    // Run in parallel, non-blocking
    await Promise.all(
      monitors.map(m => this.runMonitor(m, change))
    );
  }

  // Scheduler for interval-based scripts
  startScheduler() {
    setInterval(() => {
      const dueScripts = this.getScriptsDueToRun();
      dueScripts.forEach(s => this.executeScript(s));
    }, 1000);
  }

  // Execute in Web Worker (non-blocking)
  async executeScript(script: AmbientScript) {
    const worker = this.getWorker(script.id);
    const result = await worker.run(script.code);

    // Update UI based on updateMode
    this.applyUpdate(result, script.updateMode);
  }

  // Apply updates subtly
  applyUpdate(result: any, mode: UpdateMode) {
    switch (mode) {
      case 'minimal':
        this.pulseIndicator(result.position);
        break;
      case 'highlight':
        this.highlightChange(result.position, 1000);
        break;
      case 'notify':
        this.showToast(result.message);
        break;
    }
  }
}
```

### Web Worker Isolation

```typescript
// ambient-worker.ts
self.onmessage = async (e) => {
  const { scriptId, code, context } = e.data;

  try {
    // Sandboxed execution
    const result = await executeInSandbox(code, context);

    // Send result back to main thread
    self.postMessage({
      scriptId,
      success: true,
      result
    });
  } catch (error) {
    self.postMessage({
      scriptId,
      success: false,
      error: error.message
    });
  }
};

function executeInSandbox(code: string, context: any) {
  // Limited API surface (no DOM access, etc.)
  const sandbox = {
    fetch,
    console: { log: (...args) => console.log('[Worker]', ...args) },
    canvas: createCanvasAPI(context)
  };

  const fn = new Function(...Object.keys(sandbox), code);
  return fn(...Object.values(sandbox));
}
```

### Performance Considerations

```typescript
class ThrottleManager {
  // Prevent script spam
  throttle(scriptId: string, fn: Function, interval: number) {
    const lastRun = this.lastRunTimes.get(scriptId);
    const now = Date.now();

    if (!lastRun || now - lastRun > interval) {
      this.lastRunTimes.set(scriptId, now);
      return fn();
    }
  }

  // Batch updates
  batchUpdates(updates: Update[]) {
    requestAnimationFrame(() => {
      updates.forEach(u => this.applyUpdate(u));
    });
  }

  // Debounce rapid changes
  debounce(scriptId: string, fn: Function, delay: number) {
    clearTimeout(this.timers.get(scriptId));
    this.timers.set(
      scriptId,
      setTimeout(fn, delay)
    );
  }
}
```

---

## 6. Example Ambient Scripts

### Auto-Linking Related Content

```typescript
~monitor autoLink {
  watch: 'textChange'
  action: async (text, position) => {
    // Extract meaningful phrases
    const phrases = extractKeyPhrases(text);

    // Search canvas for related content
    const related = await semanticSearch(phrases);

    if (related.length > 0) {
      // Create subtle link indicator
      createAmbientLink(position, related, {
        style: 'dot',  // Small dot indicator
        color: 'rgba(100,100,100,0.3)',
        hoverPreview: true
      });
    }
  }
}
```

**User Experience:**
```
User types: "As mentioned in the Q1 report"
                                      ^
                                      └─• ← Subtle dot appears

Hover over dot:
┌─────────────────────────┐
│ 📄 Q1 Financial Report  │
│ Created: 2 weeks ago    │
│ Click to navigate →     │
└─────────────────────────┘
```

### Live Stock Ticker

```typescript
~live stockTicker {
  symbols: ['AAPL', 'GOOGL', 'MSFT']
  source: 'https://api.stocks.com/quotes'
  interval: 5000  // 5 seconds

  update: (data) => {
    // Find all stock mentions on canvas
    const mentions = findText(/\b(AAPL|GOOGL|MSFT)\b/);

    mentions.forEach(mention => {
      const symbol = mention.text;
      const price = data[symbol];

      // Update chip next to mention
      updateChip(mention.position, {
        text: `$${price.toFixed(2)}`,
        color: price > lastPrice ? 'green' : 'red',
        animation: 'pulse'
      });
    });
  }
}
```

**User Experience:**
```
User writes: "AAPL is performing well"

Canvas shows: AAPL is performing well [$178.32 ↑]
                                       └─ Updates every 5s
                                          Pulses green on increase
```

### Smart Data Detection

```typescript
~monitor detectData {
  watch: 'paste'
  action: async (pastedText) => {
    // Check if tabular data
    if (isCSV(pastedText) || isTSV(pastedText)) {
      // Parse immediately
      const df = parseTable(pastedText);

      // Show suggestion
      showAmbientSuggestion({
        title: 'Table detected',
        actions: [
          {
            label: 'Create DataFrame',
            action: () => createDataFrame(df)
          },
          {
            label: 'Create Chart',
            action: () => suggestCharts(df)
          },
          {
            label: 'Keep as text',
            action: () => dismiss()
          }
        ],
        timeout: 5000  // Auto-dismiss
      });
    }
  }
}
```

### Automatic Summarization

```typescript
~monitor autoSummarize {
  watch: 'bounds'  // Trigger on bounded documents
  condition: (bounds) => bounds.lineCount > 50
  action: async (bounds) => {
    // Extract text
    const text = bounds.getAllText();

    // Generate summary with LLM
    const summary = await llm.summarize(text, {
      maxLength: 100,
      style: 'bullet-points'
    });

    // Create summary chip at top of bounds
    createChip(bounds.startPosition, {
      type: 'summary',
      content: summary,
      icon: '📄',
      editable: true,
      collapsible: true
    });
  },
  debounce: 5000  // Wait 5s after typing stops
}
```

### Auto-Backup

```typescript
~automate backup {
  trigger: 'change'
  interval: 60000  // Every minute
  action: async () => {
    // Get current workspace state
    const state = exportWorkspace();

    // Save to IndexedDB
    await db.save('backup_' + Date.now(), state);

    // Keep only last 10 backups
    await db.cleanup({ keep: 10 });

    // Optional cloud sync
    if (user.cloudSyncEnabled) {
      await cloudSync.upload(state);
    }

    // Subtle indicator
    showStatus('Auto-saved', 1000);
  }
}
```

---

## 7. User Control & Privacy

### Transparency

**Always visible what's running:**
```
Status bar: ⚡ 8 ambient scripts active
           Click to view/manage
```

**Activity log:**
```
Recent ambient activity:
• 14:32 - Stock prices updated
• 14:30 - Auto-linked 2 references
• 14:28 - Backed up workspace
```

### Granular Control

```typescript
interface ScriptPermissions {
  canRead: boolean;        // Read canvas content
  canWrite: boolean;       // Modify canvas content
  canNetwork: boolean;     // Make API calls
  canNotify: boolean;      // Show notifications
  canExecuteCode: boolean; // Run arbitrary code
}
```

**User permissions UI:**
```
┌─────────────────────────────────────┐
│ Stock Ticker Script                 │
├─────────────────────────────────────┤
│ Permissions:                        │
│ ✅ Read canvas content              │
│ ✅ Write updates (prices)           │
│ ✅ Network access (API calls)       │
│ ❌ Execute code                     │
│ ❌ Send notifications               │
│                                      │
│ [Approve] [Deny] [Customize]        │
└─────────────────────────────────────┘
```

### Data Isolation

```typescript
// Scripts can't access everything
class ScriptSandbox {
  // Only expose safe APIs
  getAllowedAPIs(script: AmbientScript) {
    const base = {
      canvas: {
        findText: this.canvas.findText,
        createChip: this.canvas.createChip,
        // NO: deleteAll, exportSecrets, etc.
      },
      utils: {
        fetch: this.limitedFetch,  // Rate-limited
        // NO: eval, require, etc.
      }
    };

    // Add based on permissions
    if (script.permissions.canWrite) {
      base.canvas.updateText = this.canvas.updateText;
    }

    return base;
  }
}
```

---

## 8. Discovery & Marketplace

### Built-in Ambient Scripts

**Shipped with bit.canvas:**
1. Auto-link dates and references
2. Extract emails and URLs
3. Detect numbers and calculations
4. CSV → DataFrame conversion
5. Auto-backup (local)
6. Collaboration cursors
7. Spell check
8. Smart autocomplete

### User-Created Scripts

```typescript
// Create from template
~create myScript from template:monitor {
  watch: 'textChange'
  action: (text) => {
    // Custom logic
  }
}

// Share with workspace
~share myScript to workspace

// Publish to marketplace
~publish myScript {
  name: 'Stock Ticker'
  description: 'Live stock prices'
  category: 'finance'
  permissions: ['read', 'write', 'network']
}
```

### Script Marketplace

```
┌─────────────────────────────────────┐
│ 🏪 Ambient Script Marketplace       │
├─────────────────────────────────────┤
│ 🔥 Trending                         │
│ • Stock Ticker         ⭐ 4.8       │
│ • Weather Widget       ⭐ 4.6       │
│ • Crypto Alerts        ⭐ 4.5       │
│                                      │
│ 💼 Productivity                     │
│ • Auto-Todo Detector   ⭐ 4.7       │
│ • Meeting Notes AI     ⭐ 4.4       │
│ • Time Tracker         ⭐ 4.3       │
│                                      │
│ 📊 Data & Analytics                 │
│ • CSV Visualizer       ⭐ 4.9       │
│ • Spreadsheet Auto     ⭐ 4.6       │
│ • Chart Generator      ⭐ 4.5       │
└─────────────────────────────────────┘
```

---

## 9. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] Ambient script engine core
- [ ] Web Worker execution
- [ ] Event listener system
- [ ] Basic monitors (text change, file upload)
- [ ] Visual indicators (pulse, highlight)

### Phase 2: Built-in Scripts (Week 2-3)
- [ ] Auto-link dates/references
- [ ] Number detection & calculation
- [ ] CSV detection & conversion
- [ ] Auto-backup (local)
- [ ] Activity log

### Phase 3: Live Data (Week 3-4)
- [ ] WebSocket support
- [ ] Interval-based updates
- [ ] Rate limiting
- [ ] Update batching
- [ ] Example: stock ticker

### Phase 4: AI Integration (Week 4-5)
- [ ] LLM integration for summarization
- [ ] Semantic search
- [ ] Smart autocomplete
- [ ] Context-aware suggestions
- [ ] Entity extraction

### Phase 5: User Scripts (Week 5-6)
- [ ] Script editor
- [ ] Template system
- [ ] Permission management
- [ ] Testing/debugging tools
- [ ] Share & publish

### Phase 6: Marketplace (Week 6+)
- [ ] Script discovery
- [ ] Ratings & reviews
- [ ] Installation flow
- [ ] Update mechanism
- [ ] Revenue sharing (optional)

---

## 10. Success Metrics

### Technical Performance
- **Script execution latency:** < 50ms (p95)
- **UI thread blocking:** 0% (all in Workers)
- **Memory usage per script:** < 10MB
- **Battery impact:** < 5% additional drain

### User Engagement
- **Scripts enabled per user:** Median 5-8
- **User-created scripts:** 20%+ of active users
- **Script marketplace usage:** 40%+ browse monthly
- **Permission approval rate:** > 80%

### Value Metrics
- **Time saved:** Track automated actions
- **Error prevention:** Track caught mistakes
- **Data enrichment:** Track added context
- **User satisfaction:** NPS for ambient features

---

## 11. Design Principles

### 1. Invisible Until Needed
- No UI clutter
- Subtle indicators only
- Progressive disclosure
- Show value, not mechanics

### 2. Safe by Default
- Sandboxed execution
- Permission prompts
- Undo/redo support
- Activity logging

### 3. Fast & Lightweight
- Web Workers (non-blocking)
- Efficient diffing (only changed content)
- Rate limiting (prevent spam)
- Lazy loading (on-demand scripts)

### 4. User Control
- Easy on/off toggle
- Granular permissions
- Clear activity log
- Full transparency

### 5. Extensible
- Template system
- Marketplace
- API documentation
- Example scripts

---

## 12. Risk Mitigation

### Security Risks

| Risk | Mitigation |
|------|------------|
| Malicious scripts | Sandboxing, permission system, code review for marketplace |
| Data exfiltration | Network monitoring, permission prompts, audit logs |
| Infinite loops | Execution timeout, Worker termination, resource limits |
| Canvas pollution | Undo/redo, rollback, script disable |

### Performance Risks

| Risk | Mitigation |
|------|------------|
| Too many scripts | Limit concurrent scripts, priority queue, user warnings |
| Memory leaks | Worker restart, periodic cleanup, monitoring |
| CPU overhead | Throttling, debouncing, idle detection |
| Battery drain | Suspend on low battery, background tab throttling |

### UX Risks

| Risk | Mitigation |
|------|------------|
| Confusing automation | Clear indicators, activity log, undo support |
| Overwhelming suggestions | Smart filtering, learn preferences, snooze option |
| Breaking workflows | Easy disable, rollback, offline mode |
| Trust issues | Transparency, open source, security audits |

---

## 13. Competitive Analysis

### vs Zapier/IFTTT (External Automation)
| Feature | Zapier | bit.canvas |
|---------|--------|------------|
| **Context** | External apps | Canvas content |
| **Latency** | Minutes | Milliseconds |
| **Setup** | Complex UI | Simple syntax |
| **Visibility** | Hidden | Integrated |

**bit.canvas advantage:** Instant, contextual, visible

### vs Notion AI (Inline AI)
| Feature | Notion | bit.canvas |
|---------|--------|------------|
| **Trigger** | Manual | Automatic |
| **Scope** | Single block | Entire canvas |
| **Learning** | Generic | Workspace-specific |
| **Customization** | Limited | Full scripts |

**bit.canvas advantage:** Proactive, customizable, workspace-aware

### vs Observable (Reactive Notebooks)
| Feature | Observable | bit.canvas |
|---------|-----------|------------|
| **Execution** | Explicit cells | Ambient + explicit |
| **Background** | No | Yes |
| **Automation** | No | Yes |
| **UI Updates** | On run | Continuous |

**bit.canvas advantage:** Ambient layer, continuous intelligence

---

## 14. Example Use Cases

### Use Case 1: Research Workspace

**Scenario:** User researching climate change

**Ambient Scripts Active:**
1. **Citation Linker:** Auto-detects paper references, adds DOI links
2. **Definition Expander:** Shows definitions on hover for technical terms
3. **Related Finder:** Suggests related notes when writing
4. **Summary Generator:** Creates summaries for long documents
5. **Data Extractor:** Pulls statistics into structured format

**User Experience:**
```
User writes: "According to Smith et al. (2023)..."
→ Ambient script finds paper
→ Shows tooltip: [Full citation] [PDF link]
→ Automatically adds to bibliography
→ No user action needed
```

### Use Case 2: Financial Dashboard

**Scenario:** User tracking investments

**Ambient Scripts Active:**
1. **Stock Ticker:** Updates prices every 5 seconds
2. **Portfolio Calculator:** Auto-calculates total value
3. **Alert System:** Notifies on ±5% moves
4. **News Aggregator:** Pulls relevant headlines
5. **Performance Chart:** Updates visualization live

**User Experience:**
```
Canvas shows:
AAPL: $178.32 ↑ [Live]
GOOGL: $141.23 ↓ [Live]
───────────────────
Total: $45,832.11 [Auto-calculated]

[Chart updates in real-time]

🔔 Alert: AAPL moved +5.2% today
```

### Use Case 3: Project Management

**Scenario:** User managing software project

**Ambient Scripts Active:**
1. **TODO Detector:** Finds "TODO:" and creates tasks
2. **Deadline Tracker:** Highlights approaching due dates
3. **Status Updater:** Syncs with GitHub issues
4. **Team Mentions:** Links @username to profiles
5. **Progress Calculator:** Auto-updates completion %

**User Experience:**
```
User writes: "TODO: Fix login bug by Friday"
→ Auto-extracted to task list
→ Deadline highlighted (3 days away)
→ Linked to GitHub issue #423
→ Progress bar updated: 73% → 78%
→ All automatic
```

---

## 15. Technical Architecture Diagram

```
┌───────────────────────────────────────────────────┐
│                 bit.canvas UI                      │
│         (Infinite Spatial Canvas)                  │
└───────────────┬───────────────────────────────────┘
                │
                ↓
┌───────────────────────────────────────────────────┐
│         Ambient Script Engine (Main Thread)        │
│  • Event listener hub                              │
│  • Script registry & lifecycle                     │
│  • Permission manager                              │
│  • Update coordinator                              │
└───────────┬───────────────────────────────────────┘
            │
            ├─→ [Web Worker 1: Monitor Scripts]
            │     • Text change detection
            │     • Pattern matching
            │     • Link creation
            │
            ├─→ [Web Worker 2: Live Data]
            │     • WebSocket connections
            │     • API polling
            │     • Real-time updates
            │
            ├─→ [Web Worker 3: AI Processing]
            │     • LLM inference
            │     • Semantic search
            │     • Summarization
            │
            └─→ [Web Worker 4: Automation]
                  • File processing
                  • Data transformations
                  • Scheduled tasks

                  ↓ (Results)

┌───────────────────────────────────────────────────┐
│           Update Queue & Throttler                 │
│  • Batch updates (minimize reflows)                │
│  • Rate limit (prevent spam)                       │
│  • Priority queue (important first)                │
└───────────┬───────────────────────────────────────┘
            │
            ↓
┌───────────────────────────────────────────────────┐
│              Canvas Renderer                       │
│  • Minimal mode: subtle indicators                 │
│  • Highlight mode: brief animations                │
│  • Notify mode: toast messages                     │
└───────────────────────────────────────────────────┘
```

---

## 16. Conclusion

Ambient scripting transforms bit.canvas from a **static spatial canvas** into a **living, intelligent workspace**:

### Key Innovations

1. **Background Intelligence**
   - Computation happens invisibly
   - User focuses on thinking, not mechanics
   - Canvas feels alive and responsive

2. **Context-Aware Automation**
   - Scripts understand workspace content
   - Suggestions are specific, not generic
   - Learning happens automatically

3. **Subtle Integration**
   - No modal dialogs or interruptions
   - Visual feedback is minimal but clear
   - User remains in flow state

4. **User Empowerment**
   - Create custom ambient scripts
   - Share with team or marketplace
   - Full transparency and control

### Strategic Positioning

**bit.canvas = Spatial Canvas + Reactive Computation + Ambient Intelligence**

This creates a new category: **Intelligent Spatial Workspace**

- More proactive than Notion
- More spatial than Observable
- More integrated than Zapier
- More continuous than Jupyter

### Next Steps

1. Build ambient engine foundation (Phase 1)
2. Ship with 3-5 essential ambient scripts
3. Validate with power users
4. Open to user-created scripts
5. Launch marketplace

Ambient scripting completes the vision: **Think freely in space, compute continuously in background**.

---

*Last updated: 2025-10-02*
*Version: 1.0 - Ambient Intelligence Strategy*
