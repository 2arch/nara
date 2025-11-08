# Selection Validation Mechanism

## How It Works

### The Flow:

1. **User executes a command** (e.g., `/label`, `/note`, `/upload`)
2. **Command execution triggers `onCommandExecuted` callback**
3. **Callback passes:** `command`, `args`, and `worldState` (includes selection)
4. **Tutorial validator receives worldState** with selection info
5. **Validator checks if selection exists and validates command**

### The WorldState Object:

```typescript
const worldState = {
    worldData,              // All canvas data
    selectionStart,         // { x: number, y: number } | null
    selectionEnd,           // { x: number, y: number } | null
    hasSelection           // boolean (true if both start/end exist)
};
```

## Example Tutorial Steps with Selection Validation

### Step 1: Teach Selection (No Command)

```typescript
{
  id: 'learn_selection',
  text: 'Selections let you work with specific areas. \n \n Hold Shift and click+drag to select.',
  expectsInput: false,
  requiresChatMode: false,
  nextMessageId: 'practice_selection'
}
```

### Step 2: Validate Selection Was Made

```typescript
{
  id: 'practice_selection',
  text: 'Try it now! Hold Shift, click, and drag to create a selection. \n \n Then press Enter.',
  expectsInput: true,
  requiresChatMode: false,
  expectedCommand: 'selection', // Custom "command" for selection validation
  commandValidator: (cmd, args, worldState) => {
    // Check if a selection exists
    if (!worldState || !worldState.hasSelection) {
      return false;
    }

    // Ensure it's more than a single cell
    const { selectionStart, selectionEnd } = worldState;
    const hasArea = selectionStart.x !== selectionEnd.x ||
                    selectionStart.y !== selectionEnd.y;

    return hasArea;
  },
  nextMessageId: 'selection_success'
}
```

**Note:** This requires a special handler in world.engine.ts to detect Enter key and call validation without a real command.

### Step 3: Use Selection with Label Command

```typescript
{
  id: 'learn_label_with_selection',
  text: 'With your selection active, type: /label',
  expectsInput: true,
  requiresChatMode: false,
  expectedCommand: 'label',
  commandValidator: (cmd, args, worldState) => {
    // Validate that:
    // 1. Command is 'label'
    // 2. A selection existed when command was executed
    return cmd === 'label' &&
           worldState &&
           worldState.hasSelection;
  },
  nextMessageId: 'label_success'
}
```

### Step 4: Note Command (Requires Selection)

```typescript
{
  id: 'learn_note',
  text: 'First, make a selection where you want the note. \n \n Then type: /note',
  expectsInput: true,
  requiresChatMode: false,
  expectedCommand: 'note',
  commandValidator: (cmd, args, worldState) => {
    return cmd === 'note' &&
           worldState &&
           worldState.hasSelection;
  },
  nextMessageId: 'note_success'
}
```

### Step 5: Image Generation with Selection Area

```typescript
{
  id: 'prepare_image_area',
  text: 'Images need a place to appear. Make a selection for the image area. \n \n (Bigger selection = bigger image)',
  expectsInput: true,
  requiresChatMode: false,
  expectedCommand: 'selection_for_image',
  commandValidator: (cmd, args, worldState) => {
    if (!worldState || !worldState.hasSelection) return false;

    // Ensure selection is at least 10x10 cells for image
    const { selectionStart, selectionEnd } = worldState;
    const width = Math.abs(selectionEnd.x - selectionStart.x);
    const height = Math.abs(selectionEnd.y - selectionStart.y);

    return width >= 10 && height >= 10;
  },
  nextMessageId: 'enter_chat_for_image'
},
{
  id: 'enter_chat_for_image',
  text: 'Perfect! Now enter chat mode: /chat',
  expectsInput: true,
  requiresChatMode: false,
  expectedCommand: 'chat',
  commandValidator: (cmd, args, worldState) => {
    // Chat should preserve the selection
    return cmd === 'chat' &&
           worldState &&
           worldState.hasSelection;
  },
  nextMessageId: 'prompt_for_image'
}
```

## Implementation Details

### Modified Validation Calls:

**In world.engine.ts (line 1318-1328):**
```typescript
onCommandExecuted: (command: string, args: string[]) => {
    if (commandValidationHandlerRef.current) {
        // Pass worldData plus selection state for validation
        const worldState = {
            worldData,
            selectionStart,
            selectionEnd,
            hasSelection: selectionStart !== null && selectionEnd !== null
        };
        commandValidationHandlerRef.current(command, args, worldState);
    }
}
```

**In world.engine.ts (for /chat, /label, etc):**
```typescript
if (commandValidationHandlerRef.current) {
    const worldState = {
        worldData,
        selectionStart,
        selectionEnd,
        hasSelection: selectionStart !== null && selectionEnd !== null
    };
    commandValidationHandlerRef.current('chat', exec.args, worldState);
}
```

## Validation Patterns

### Pattern 1: Command Requires Selection
```typescript
commandValidator: (cmd, args, worldState) => {
  return cmd === 'note' && worldState?.hasSelection === true;
}
```

### Pattern 2: Selection with Minimum Size
```typescript
commandValidator: (cmd, args, worldState) => {
  if (!worldState?.hasSelection) return false;

  const width = Math.abs(worldState.selectionEnd.x - worldState.selectionStart.x);
  const height = Math.abs(worldState.selectionEnd.y - worldState.selectionStart.y);

  return width * height >= 100; // At least 100 cells
}
```

### Pattern 3: Command Works With OR Without Selection
```typescript
commandValidator: (cmd, args, worldState) => {
  // /label can work with text args OR selection
  return cmd === 'label' &&
         (args.length > 0 || worldState?.hasSelection === true);
}
```

### Pattern 4: Selection-Only Validation (No Command)
```typescript
// For teaching selection before any command
commandValidator: (cmd, args, worldState) => {
  // Just validate a selection exists
  return worldState?.hasSelection === true;
}
```

## Special Handling Needed

### For Selection-Only Steps:

You'll need to add a handler in world.engine.ts to detect Enter key during tutorial and trigger validation without a real command:

```typescript
// In handleKeyDown
if (key === 'Enter' && hostMode.isActive && currentTutorialStep.requiresSelection) {
    if (commandValidationHandlerRef.current) {
        const worldState = {
            worldData,
            selectionStart,
            selectionEnd,
            hasSelection: selectionStart !== null && selectionEnd !== null
        };
        commandValidationHandlerRef.current('selection', [], worldState);
    }
    return true;
}
```

## Benefits

✅ **Validate selections exist before command execution**
✅ **Check selection size/dimensions**
✅ **Ensure proper setup for commands that need selections**
✅ **Teach spatial interaction patterns**
✅ **Prevent user confusion ("why didn't my command work?")**
✅ **Guide users through complex multi-step interactions**

## Commands That Benefit from Selection Validation

| Command | Selection Required? | Validation Notes |
|---------|-------------------|------------------|
| `/label` | Optional | Works with text OR selection |
| `/note` | **Required** | Must have selection area |
| `/upload` | **Required** | Defines image placement area |
| `/link` | **Required** | Links selected text regions |
| `/clip` | Recommended | Saves selected text |
| `/transform` | **Required** | Transforms selected text |
| Image gen (chat) | **Required** | Defines where image appears |
| `/bound` | **Required** | Creates boundary from selection |

## Summary

The selection validation mechanism is already built into your system:

1. ✅ Commands pass `worldState` with selection info
2. ✅ Validators can check `worldState.hasSelection`
3. ✅ Validators can check selection coordinates
4. ✅ Works for all commands that call `onCommandExecuted`

**What you need:**
- Add tutorial steps that teach selection (Shift+drag)
- Use `worldState.hasSelection` in validators
- Guide users to make selections BEFORE commands that need them
