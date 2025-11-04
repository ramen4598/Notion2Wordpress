// Description: Common utility functions

/**
 * Type guard to check if a value is a non-null object (Record)
 * @param value - Value to check
 * @returns true if value is Record<string, unknown>
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
