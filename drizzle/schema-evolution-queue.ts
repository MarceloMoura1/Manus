/**
 * Compatibility exports for historical imports. The internal Evolution retry
 * queue belongs to the MegaDesk main database and is declared exactly once in
 * schema.ts. The external Evolution API database is not managed here.
 */
export {
  evolutionFailedMessages,
  evolutionQueueConfig,
  evolutionQueueMetrics,
  evolutionRetryHistory,
} from "./schema";
