# Tutorial & Membership System Implementation

## Overview
Integration of tutorial system with existing Firebase membership structure:
- **fresh** → **layman** → **member**
- State limits: fresh (1), layman (3), member (unlimited)

## Tutorial Messages & Content

### Welcome Message (fresh users on first load)
```
Welcome to Bitworld! 🌟

I'll guide you through the basics. Start by typing any character to place it on the canvas.
```

### Tutorial Step Messages

#### Step 0: First Character Placement
```
Great! You placed your first character. Try moving with arrow keys.
```

#### Step 1: Cursor Movement  
```
Perfect! Use '/' to access commands.
```

#### Step 2: Command Discovery
```
Excellent! Try /label to create navigation points.
```

#### Step 3: Label Creation
```
Nice! Use /state to save your work.
```

#### Step 4: State Management
```
Tutorial complete! Type /graduate to become a free user.
```

### Graduation Message
```
🎓 Congratulations! You're now a free user!

Features unlocked:
• 3 saved states  
• All commands available
• Community features

Type /upgrade to get unlimited states.
```

### Paywall Messages

#### Fresh User Trying to Create State Before Tutorial
```
Complete the tutorial first! Fresh users get 1 state after tutorial completion.
```

#### Layman User Hitting 3 State Limit
```
Free users limited to 3 states. Use /upgrade for unlimited states.
```

## Implementation TODOs

### High Priority
- [ ] Add membership field to WorldSettings interface
- [ ] Add getUserMembership and updateUserMembership functions to firebase.ts
- [ ] Implement state limit checking in commands.ts
- [ ] Add upgrade command handler
- [ ] Add tutorial commands (tutorial, graduate, skip)

### Medium Priority  
- [ ] Add tutorial step tracking in WorldSettings
- [ ] Implement AI-driven tutorial responses
- [ ] Add tutorial trigger detection in handleKeyDown
- [ ] Create tutorial welcome message on fresh user login

## Firebase Functions to Add

```typescript
export const getUserMembership = async (uid: string): Promise<string | null> => {
  try {
    const snapshot = await get(ref(database, `users/${uid}/membership`));
    return snapshot.exists() ? snapshot.val() : 'fresh';
  } catch (error) {
    console.error('Error fetching membership:', error);
    return 'fresh';
  }
};

export const updateUserMembership = async (uid: string, membership: 'fresh' | 'layman' | 'member'): Promise<boolean> => {
  try {
    await set(ref(database, `users/${uid}/membership`), membership);
    return true;
  } catch (error) {
    console.error('Error updating membership:', error);
    return false;
  }
};
```

## State Limit Logic

```typescript
const getStateLimit = (membership: string): number => {
  switch (membership) {
    case 'fresh': return 1;
    case 'layman': return 3;
    case 'member': return -1; // Unlimited
    default: return 1;
  }
};
```

## Integration Points

1. **Signup**: User gets `membership: 'fresh'` ✅
2. **Tutorial**: Fresh users see welcome message and step-by-step guidance
3. **Graduation**: `/graduate` command updates membership to 'layman'
4. **State Creation**: Check membership limits before allowing new states
5. **Upgrade**: `/upgrade` command for member tier promotion

## Technical Architecture

- Uses existing `addInstantAIResponse` for tutorial messages
- Integrates with existing Firebase user structure
- Leverages existing command system for tutorial progression
- Uses existing ephemeral text system for contextual guidance

## Colors & Styling

- **Tutorial messages**: `#00AA00` (green)
- **Graduation message**: `#FFD700` (gold)  
- **Error/limit messages**: Default dialogue text
- **Longer fade delays**: 5000-15000ms for tutorial content