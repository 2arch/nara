# Sprite Generation V2 API Migration - Reflections

**Date:** November 26, 2025

## Summary

Today we migrated the sprite generation system from the Pixellab V1 API to the V2 API, which introduced an asynchronous job-based architecture. This required significant changes to how we handle character creation and animation, and revealed important insights about API reliability and resilience patterns.

## What We Set Out To Do

1. Fix sprite generation that was stuck in an infinite polling loop
2. Understand the V2 API response structure
3. Implement robust error handling for intermittent API failures

## Key Discoveries

### V2 API Structure Differences

The V2 API has a fundamentally different data structure than we initially assumed:

**Character Creation:**
- Returns `background_job_id` that must be polled
- Job status values: `"processing"` → `"completed"` (not "pending"/"complete")
- Character rotation images are in `job.last_response.images.{direction}.base64`
- NOT in `charData.rotations[i].base64` as we initially coded

**Animation:**
- `animate-character` returns 8 job IDs (one per direction)
- Animation frames are in `job.last_response.images[]` (array of frame objects)
- NOT in `job.frames[]` as we initially coded

### API Reliability Issues

Through CLI testing, we discovered that the Pixellab animation API has significant reliability issues:

```
Test Results (8 directions):
- south, south-west, west: SUCCEED consistently
- north-west, north, north-east, east, south-east: FAIL frequently
```

Pattern observed:
- First ~3-4 directions in a batch tend to succeed
- Later directions in the same batch tend to fail with "Generation failed"
- **Key insight:** Retrying after 10+ seconds with a fresh batch WORKS

## Solutions Implemented

### 1. Fixed Data Access Paths

```typescript
// Animation frames (BEFORE - wrong)
const frames = animJobData.frames?.map((f: any) => f.base64) || [];

// Animation frames (AFTER - correct)
const frames = animJobData.last_response?.images?.map((img: any) => img.base64) || [];

// Character rotations (BEFORE - wrong)
const rotationImage = charData.rotations?.[i]?.base64 || "";

// Character rotations (AFTER - correct)
const rotationImage = charData.last_response?.images?.[direction]?.base64 || "";
```

### 2. Dual-Batch Strategy

To work around the API's tendency to fail on later directions in a batch, we now create TWO animation batches upfront:

```typescript
// Create batch 1
const animateRes1 = await fetchPixellabV2(apiKey, "animate-character", {...});
const animationJobIds1 = animateData1.background_job_ids;

// Wait 2 seconds
await new Promise(resolve => setTimeout(resolve, 2000));

// Create batch 2
const animateRes2 = await fetchPixellabV2(apiKey, "animate-character", {...});
const animationJobIds2 = animateData2.background_job_ids;
```

### 3. Multi-Layer Fallback Chain

For each direction, we try multiple sources before giving up:

```
Batch 1 → Batch 2 → Retry Mechanism (up to 8 attempts)
```

The retry mechanism creates fresh batches with exponential backoff:
- Attempt 1: wait 5s
- Attempt 2: wait 10s
- Attempt 3: wait 15s
- ... up to 8 attempts

### 4. Enhanced Logging

Added detailed logging to track job polling:
```
[pollJob character] Poll #1 - Status: processing, Keys: usage, id, status, created_at, last_response
[pollJob anim-south-b1] Poll #14 - Status: completed
[jobId] Walk south complete (8 frames)
```

## Files Changed

- `/home/ubuntu/nara/functions/src/index.ts` - Firebase Function with V2 API integration

## CLI Test Scripts Created

- `/tmp/test_v2_api.sh` - Basic V2 API character creation test
- `/tmp/test_animation.sh` - Animation endpoint test
- `/tmp/test_full_sprite.sh` - Full 8-direction sprite generation test
- `/tmp/test_retry_failed.sh` - Retry mechanism validation
- `/tmp/test_dual_batch.sh` - Dual-batch strategy test

## Lessons Learned

1. **Always test API responses directly** - Our initial code was based on assumed response structures. Direct CLI testing revealed the actual format.

2. **External APIs need resilience** - The Pixellab API has intermittent failures that require retry logic. A single request is not enough.

3. **Batch operations may have capacity limits** - The pattern of early successes and late failures suggests the API might have per-batch or per-user rate limiting.

4. **Exponential backoff is essential** - Immediate retries don't work. Waiting 10+ seconds before retrying gives the API time to recover.

5. **Redundancy beats speed** - Creating two batches upfront (dual-batch) costs more API calls but significantly improves success rates.

## Current State

The sprite generation system is deployed with:
- Dual-batch animation creation
- 3-layer fallback (batch1 → batch2 → retry)
- Up to 8 retry attempts with exponential backoff
- 1-hour Firebase Function timeout to accommodate retries

Expected behavior:
- Most sprites should complete in 3-5 minutes
- Sprites requiring many retries may take 10+ minutes
- System should eventually succeed given enough retries

## Future Considerations

1. **Parallel polling** - Currently we poll directions sequentially. Polling all 16 jobs (2 batches × 8 directions) in parallel and using whichever completes first could be faster.

2. **Caching successful character IDs** - If character creation succeeds but animations fail repeatedly, we could cache the character ID and retry animations without recreating the character.

3. **User feedback** - Show more detailed progress (e.g., "Retrying north direction, attempt 3/8") in the UI.

4. **API monitoring** - Track success/failure rates over time to identify patterns or API degradation.

## Next Steps

- Test the deployed solution with actual sprite generation
- Monitor Firebase Function logs for success rates
- Consider implementing parallel polling if sequential approach is too slow
