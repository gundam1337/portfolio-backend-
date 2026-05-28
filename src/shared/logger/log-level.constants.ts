export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export const LogLevels = {
  /** Full execution trace — embeddings, raw chunks, every field. */
  TRACE: 'trace' as LogLevel,
  /** Internal values useful while building or debugging a pipeline step. */
  DEBUG: 'debug' as LogLevel,
  /** A major pipeline step completed successfully. */
  INFO: 'info' as LogLevel,
  /** Retrieval quality issue or degraded result, but the system still answered. */
  WARN: 'warn' as LogLevel,
  /** Something failed and the request cannot continue. */
  ERROR: 'error' as LogLevel,
} as const;

/** Change this single line to switch verbosity during development. */
export const ACTIVE_LOG_LEVEL: LogLevel = 'debug';
