// Description: Unit tests for utility functions

import { describe, it, expect } from 'vitest';
import { isRecord, asError } from '../../../src/lib/utils';

describe('Utils', () => {
  describe('isRecord', () => {
    it('should return true for plain objects', () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ key: 'value' })).toBe(true);
      expect(isRecord({ nested: { object: true } })).toBe(true);
    });

    it('should return false for null', () => {
      expect(isRecord(null)).toBe(false);
    });

    it('should return false for primitive types', () => {
      expect(isRecord(undefined)).toBe(false);
      expect(isRecord('string')).toBe(false);
      expect(isRecord(123)).toBe(false);
      expect(isRecord(true)).toBe(false);
      expect(isRecord(false)).toBe(false);
    });

    it('should return true for arrays', () => {
      expect(isRecord([])).toBe(true);
      expect(isRecord([1, 2, 3])).toBe(true);
    });

    it('should return true for Date objects', () => {
      expect(isRecord(new Date())).toBe(true);
    });

    it('should return false for function objects', () => {
      // In JavaScript, functions are not considered plain objects
      expect(isRecord(() => {})).toBe(false);
    });

    describe('asError', () => {
      it('should return the same Error object when passed an Error', () => {
        const originalError = new Error('Test error');
        const result = asError(originalError);
        expect(result).toBe(originalError);
      });

      it('should convert string to Error', () => {
        const result = asError('Test string error');
        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('Test string error');
      });

      it('should convert number to Error', () => {
        const result = asError(42);
        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('42');
      });

      it('should convert boolean to Error', () => {
        const result = asError(true);
        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('true');
      });

      it('should convert null to Error', () => {
        const result = asError(null);
        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('null');
      });

      it('should convert undefined to Error', () => {
        const result = asError(undefined);
        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('undefined');
      });

      it('should convert object to Error', () => {
        const obj = { key: 'value' };
        const result = asError(obj);
        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('[object Object]');
      });

      it('should convert array to Error', () => {
        const arr = [1, 2, 3];
        const result = asError(arr);
        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('1,2,3');
      });
    });
  });

  describe('asError', () => {
    // : Add test cases
  });
});
