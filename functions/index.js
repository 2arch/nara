const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.database();

/**
 * Cloud Function to process world data operations serially
 * This eliminates client-side race conditions by applying all operations server-side
 */
exports.applyWorldOperation = functions.database
  .ref('/worlds/{userUid}/{worldId}/operations/{opId}')
  .onCreate(async (snapshot, context) => {
    const { userUid, worldId, opId } = context.params;
    const operation = snapshot.val();

    if (!operation) {
      console.error('Invalid operation:', opId);
      await snapshot.ref.remove();
      return;
    }

    const { type, key, value, clientId, timestamp } = operation;

    try {
      // Apply operation to canonical world data
      const worldDataRef = db.ref(`/worlds/${userUid}/${worldId}/data/${key}`);

      switch (type) {
        case 'set':
          if (value === null || value === undefined) {
            // Delete operation
            await worldDataRef.remove();
          } else {
            // Set operation
            await worldDataRef.set(value);
          }
          break;

        case 'update':
          // Update specific fields
          await worldDataRef.update(value);
          break;

        case 'delete':
          await worldDataRef.remove();
          break;

        default:
          console.error('Unknown operation type:', type);
      }

      // Mark operation as processed
      await snapshot.ref.update({ processed: true, processedAt: admin.database.ServerValue.TIMESTAMP });

      // Clean up processed operation after 5 seconds
      setTimeout(async () => {
        await snapshot.ref.remove();
      }, 5000);

    } catch (error) {
      console.error('Error applying operation:', operation, error);

      // Mark operation as failed
      await snapshot.ref.update({
        failed: true,
        error: error.message,
        failedAt: admin.database.ServerValue.TIMESTAMP
      });
    }
  });

/**
 * Batch operation processor for better performance
 * Processes multiple operations in a single transaction
 */
exports.applyBatchOperation = functions.database
  .ref('/worlds/{userUid}/{worldId}/batch_operations/{batchId}')
  .onCreate(async (snapshot, context) => {
    const { userUid, worldId, batchId } = context.params;
    const batch = snapshot.val();

    if (!batch || !batch.operations) {
      console.error('Invalid batch:', batchId);
      await snapshot.ref.remove();
      return;
    }

    const { operations, clientId } = batch;

    try {
      // Apply all operations in batch
      const updates = {};

      for (const op of operations) {
        const { key, value } = op;
        if (value === null || value === undefined) {
          updates[`/worlds/${userUid}/${worldId}/data/${key}`] = null;
        } else {
          updates[`/worlds/${userUid}/${worldId}/data/${key}`] = value;
        }
      }

      // Apply all updates atomically
      await db.ref().update(updates);

      // Mark batch as processed
      await snapshot.ref.update({
        processed: true,
        processedAt: admin.database.ServerValue.TIMESTAMP
      });

      // Clean up
      setTimeout(async () => {
        await snapshot.ref.remove();
      }, 5000);

    } catch (error) {
      console.error('Error applying batch:', batch, error);
      await snapshot.ref.update({
        failed: true,
        error: error.message,
        failedAt: admin.database.ServerValue.TIMESTAMP
      });
    }
  });
