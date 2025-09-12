# Viewer-Distance Based Clustering System

## Overview
A hierarchical text clustering system that dynamically adjusts level of detail based on viewer distance and zoom level.

## Core Concept
**The farther you are from content, the more aggressively we merge clusters**

## Distance Calculation
```javascript
// Distance from viewport center to cluster center
viewerDistance = distance(viewportCenter, clusterCenter)

// Dynamic merge radius based on distance
mergeRadius = baseRadius * (1 + viewerDistance / 1000)
```

## Clustering Levels

### Level 1: Very Close (< 100 units from viewport)
- **Behavior**: Show all fine details
- **Merge Strategy**: No merging
- **Use Case**: Reading/editing specific text
- **Visual**: Thin green dashed lines around individual text blocks

### Level 2: Medium Distance (100-500 units)
- **Behavior**: Progressive cluster merging
- **Merge Strategy**: Combine clusters within `mergeRadius`
- **Use Case**: Browsing related sections
- **Visual**: Medium blue dashed lines around grouped content

### Level 3: Far Away (500-2000 units)
- **Behavior**: Aggressive section merging
- **Merge Strategy**: Large radius merging, entire sections combine
- **Use Case**: Document navigation
- **Visual**: Thick purple dashed lines around major regions

### Level 4: Very Far (2000+ units)
- **Behavior**: Ultra-aggressive merging
- **Merge Strategy**: "Just show me a box" - entire documents merge
- **Use Case**: High-level document overview
- **Visual**: Solid thick lines around massive regions

## Smart Features

### Progressive Merging
- Smooth transitions as you pan/zoom
- No jarring cluster jumps
- Interpolated merge states

### Directional Awareness
- Clusters in your movement direction stay detailed longer
- Anticipatory loading of detail
- Preserves context in navigation direction

### Performance Optimizations
- Only process clusters in/near viewport
- Lazy evaluation of distant clusters
- Caching of merge states

## Implementation Strategy

### Phase 1: Basic Distance-Based Merging
```javascript
function getMergeRadius(viewerDistance) {
    const baseRadius = 50; // characters
    return baseRadius * (1 + viewerDistance / 1000);
}

function shouldMerge(cluster1, cluster2, viewerPos) {
    const dist = distance(viewerPos, midpoint(cluster1, cluster2));
    const mergeRadius = getMergeRadius(dist);
    return distance(cluster1, cluster2) < mergeRadius;
}
```

### Phase 2: Zoom Integration
```javascript
function getEffectiveMergeRadius(viewerDistance, zoomLevel) {
    const distanceFactor = 1 + viewerDistance / 1000;
    const zoomFactor = 1 / zoomLevel; // More merging when zoomed out
    return baseRadius * distanceFactor * zoomFactor;
}
```

### Phase 3: Hierarchical Structure
- Parent-child cluster relationships
- Cached merge hierarchies
- Efficient tree traversal

## Visual Design

### Frame Styles by Level
| Level | Style | Color | Line |
|-------|-------|-------|------|
| 1 | Fine Detail | Green (#00FF00) | Thin dashed |
| 2 | Grouped | Blue (#0088FF) | Medium dashed |
| 3 | Sections | Purple (#8800FF) | Thick dashed |
| 4 | Document | Red (#FF0088) | Thick solid |

### Transition Effects
- Fade in/out during merge transitions
- Smooth frame boundary morphing
- Optional animation toggles

## User Controls

### Commands
- `/frames` - Toggle frame visibility
- `/frames detail [high|medium|low]` - Force detail level
- `/frames merge [aggressive|normal|minimal]` - Adjust merge behavior

### Keyboard Shortcuts
- `Ctrl+D` - Cycle detail levels
- `Ctrl+M` - Toggle merge animations

## Benefits

1. **Natural Spatial Grouping**: Respects document layout
2. **Performance**: Only detailed rendering where needed
3. **Context Preservation**: See overview while maintaining local detail
4. **Smooth Navigation**: Progressive detail adjustment
5. **No AI Required**: Pure spatial algorithm for base functionality

## Future Enhancements

### Semantic Awareness
- Combine distance-based with semantic clustering
- Smart merge decisions based on content type
- Preserve important boundaries regardless of distance

### Custom Merge Rules
- User-defined merge boundaries
- Protected regions that never merge
- Domain-specific clustering rules

### Visual Improvements
- Heat maps showing merge intensity
- Animated cluster breathing
- 3D depth effects for hierarchy