# Tutorial Flow - Complete Breakdown

## Overview

The tutorial flow is an **interactive command learning system** that teaches users the basics of Nara's spatial writing commands.

**Key Feature:** `requiresChatMode: false` - Users execute commands directly on the canvas, not through chat input.

---

## Full Dialogue Sequence

### **Step 1: Welcome**
```
Message ID: tutorial_welcome
Text: "Welcome to the Nara tutorial!

       I'll teach you the basics of spatial writing."

Interaction: None (auto-advances)
Chat Mode: Disabled
```

---

### **Step 2: Learn Background Color**
```
Message ID: learn_background
Text: "Let's start by changing the background color.

       Type: /bg chalk"

Interaction: User must execute command
Expected Command: /bg chalk
Validator: Checks cmd === 'bg' && args[0] === 'chalk'
Chat Mode: Disabled (direct canvas input)
```

**What happens:**
- User types `/bg chalk` on the canvas
- Command validator checks if it's correct
- If correct → advances to next step
- If wrong → stays on this step (no error shown)

---

### **Step 3: Background Success**
```
Message ID: background_success
Text: "Perfect! You changed the background to red.

       Next, let's learn about text colors."

Interaction: None (auto-advances)
Chat Mode: Disabled
```

**Note:** Message says "red" but user typed "chalk" - this is a **bug** (should say "chalk blue").

---

### **Step 4: Learn Text Color**
```
Message ID: learn_color
Text: "Now change your text color.

       Type: /text garden"

Interaction: User must execute command
Expected Command: /text garden
Validator: Checks cmd === 'text' && args[0] === 'garden'
Chat Mode: Disabled
```

---

### **Step 5: Color Success**
```
Message ID: color_success
Text: "Great! Your text is now garden green.

       Let's create a label to organize your thoughts."

Interaction: None (auto-advances)
Chat Mode: Disabled
```

---

### **Step 6: Learn Labels**
```
Message ID: learn_label
Text: "Labels help you mark important points in space.

       First, select a location by clicking and dragging on the canvas.

       Then, type: /label "

Interaction: User must execute command
Expected Command: /label [any text]
Validator: Checks cmd === 'label' && args.length > 0
Chat Mode: Disabled
```

**What happens:**
- User selects an area (click + drag)
- User types `/label My Label Text`
- Creates a label at selected location

---

### **Step 7: Label Success**
```
Message ID: label_success
Text: "Excellent! You created a label.

       Labels appear as arrows pointing to that location."

Interaction: None (auto-advances)
Chat Mode: Disabled
```

---

### **Step 8: Tutorial Complete**
```
Message ID: tutorial_complete
Text: "You've completed the basics!

       Type /help anytime to see all commands. Happy writing!"

Interaction: None (flow ends)
Chat Mode: Disabled
```

---

## Rendering & Display

### **Where is it rendered?**

Tutorial messages are displayed in the **host dialogue system**:

```
Location: app/bitworld/bit.canvas.tsx
Component: Host dialogue overlay
Position: Center of viewport
Style: Monospace text on semi-transparent background
```

### **Visual Flow:**

```
┌─────────────────────────────────────┐
│                                     │
│   ┌─────────────────────────────┐   │
│   │  Tutorial Message Text      │   │ <- Host dialogue box
│   │  (centered on screen)       │   │
│   └─────────────────────────────┘   │
│                                     │
│                                     │
│        Canvas (user types here)     │ <- Direct input
│                                     │
└─────────────────────────────────────┘
```

---

## Command Validation System

### **How it works:**

1. **User types command** (e.g., `/bg chalk`)
2. **Command executes** (background changes)
3. **Validator checks** if it matches expected command
4. **If valid** → Auto-advance to next tutorial step
5. **If invalid** → Stay on current step

### **Code location:**

```typescript
// app/bitworld/host.dialogue.ts (line 1219-1256)
const validateCommand = (
  executedCommand: string,
  args: string[],
  worldState?: any
): boolean => {
  const currentMessage = getCurrentMessage();

  // Check if command matches expected
  if (currentMessage.expectedCommand === executedCommand) {
    // Run validator
    const isValid = currentMessage.commandValidator(
      executedCommand,
      args,
      worldState
    );

    // If valid, advance to next message
    if (isValid && currentMessage.nextMessageId) {
      advanceToNextMessage();
    }

    return isValid;
  }

  return false;
}
```

---

## Tutorial Flow State

### **Activation:**

The tutorial is NOT active by default. It must be triggered by:

1. **User command:** `/tutorial` (if implemented)
2. **Programmatic call:** `hostDialogue.startFlow('tutorial')`

### **Current Usage:**

Currently, the tutorial flow is **defined but not actively used** in the app. It's available but needs to be triggered manually.

---

## Key Features

### **1. Direct Canvas Input**
```typescript
requiresChatMode: false
```
- Commands typed directly on canvas
- No chat overlay needed
- Feels more native to spatial writing

### **2. Command Validation**
```typescript
commandValidator: (cmd, args) => {
  return cmd === 'bg' && args[0] === 'chalk';
}
```
- Checks exact command match
- Validates arguments
- Auto-advances on success

### **3. Sequential Learning**
```
Step 1: Background color (/bg)
Step 2: Text color (/text)
Step 3: Labels (/label)
```
- Progressive difficulty
- Builds on previous steps
- Clear success feedback

---

## Commands Taught

### **1. Background Color (`/bg`)**
```
Usage: /bg [color]
Example: /bg chalk
Result: Changes canvas background color
```

### **2. Text Color (`/text`)**
```
Usage: /text [color]
Example: /text garden
Result: Changes text color for new typing
```

### **3. Labels (`/label`)**
```
Usage: /label [text]
Example: /label My Label
Result: Creates label at selected area
```

---

## Issues Found

### **Bug 1: Incorrect feedback text**
```
Location: background_success message (line 408)
Current: "Perfect! You changed the background to red."
Expected: "Perfect! You changed the background to chalk blue."
```

The message says "red" but user typed "chalk" (which is blue).

---

## Integration Points

### **Where commands are executed:**

```typescript
// app/bitworld/world.engine.ts
// Command execution happens in the world engine

// Tutorial flow intercepts commands via:
commandValidationHandlerRef.current(command, args, worldState)
```

### **Where validation happens:**

```typescript
// app/bitworld/host.dialogue.ts
const validateCommand = useCallback((executedCommand, args, worldState) => {
  // Checks if command matches tutorial expectations
  // Auto-advances if valid
}, [getCurrentMessage, state]);
```

### **Where it's registered:**

```typescript
// app/bitworld/bit.canvas.tsx (line 656)
const tutorialFlowHandlerRef = useRef<(() => void) | null>(null);

// app/bitworld/host.flows.ts (line 524-530)
export const HOST_FLOWS: Record<string, HostFlow> = {
  'intro': introFlow,
  'welcome': welcomeFlow,
  'verification': verificationFlow,
  'upgrade': upgradeFlow,
  'tutorial': tutorialFlow,  // <- Registered here
  'password_reset': passwordResetFlow
};
```

---

## Potential Improvements

### **1. Add Tutorial Trigger**
```typescript
// Add /tutorial command to start the flow
case 'tutorial':
  hostDialogue.startFlow('tutorial');
  break;
```

### **2. Fix Feedback Text**
```typescript
'background_success': {
  text: 'Perfect! You changed the background to chalk blue. \n \n Next...'
}
```

### **3. Add More Commands**
```
- /note (create text note)
- /image (upload image)
- /pan (navigation)
- /zoom (zoom controls)
```

### **4. Add Progress Indicator**
```
"Step 1 of 3: Background Color"
"Step 2 of 3: Text Color"
"Step 3 of 3: Labels"
```

### **5. Add Skip Option**
```
"Press ESC to skip tutorial"
```

---

## Performance Notes

**Tutorial flow is lightweight:**
- No network requests
- No Firebase reads/writes
- Pure client-side validation
- Instant feedback

**Memory footprint:**
- ~5KB of flow definitions
- Minimal state overhead
- Reuses existing command system

---

## Usage Example

### **To activate tutorial:**

```typescript
// In any command handler or button click:
hostDialogue.startFlow('tutorial');
```

### **To check if tutorial is active:**

```typescript
if (hostDialogue.hostState.currentFlowId === 'tutorial') {
  // Tutorial is running
}
```

---

## Summary

The tutorial flow is a **well-designed, interactive learning system** that:

✅ Teaches core Nara commands
✅ Uses direct canvas input (no chat mode)
✅ Validates commands automatically
✅ Provides clear feedback
✅ Progressively builds skills

⚠️ Currently **not triggered** anywhere in the app
⚠️ Has a minor **text bug** in background_success message

It's production-ready and just needs to be activated via a `/tutorial` command or onboarding flow trigger.
