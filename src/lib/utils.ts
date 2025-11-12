// Description: Common utility functions

/**
 * Type guard to check if a value is a non-null object (Record)
 * @param value - Value to check
 * @returns true if value is Record<string, unknown>
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Converts an unknown value to an Error object.
 * If the value is already an Error, it is returned as is.
 * Otherwise, a new Error is created with the string representation of the value.
 * @param e - The unknown value to convert
 * @returns An Error object
 */
export function asError (e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}