/**
 * Unit tests for environment detection utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isExtensionEnvironment,
  isTestEnvironment,
  isChromeMocked,
  getEnvironmentType,
} from '../environment';

describe('environment', () => {
  const originalChrome = typeof globalThis !== 'undefined' ? (globalThis as any).chrome : undefined;
  const originalWindowKeys: string[] = [];

  afterEach(() => {
    if (originalChrome !== undefined) {
      (globalThis as any).chrome = originalChrome;
    } else {
      delete (globalThis as any).chrome;
    }
    originalWindowKeys.forEach((k) => delete (window as any)[k]);
    originalWindowKeys.length = 0;
  });

  describe('isExtensionEnvironment', () => {
    it('returns false when chrome is undefined', () => {
      (globalThis as any).chrome = undefined;
      expect(isExtensionEnvironment()).toBe(false);
    });

    it('returns false when chrome.runtime is missing', () => {
      (globalThis as any).chrome = {};
      expect(isExtensionEnvironment()).toBe(false);
    });

    it('returns false when chrome.runtime.id is empty string', () => {
      (globalThis as any).chrome = { runtime: { id: '' } };
      expect(isExtensionEnvironment()).toBe(false);
    });

    it('returns false when chrome.runtime.id is undefined', () => {
      (globalThis as any).chrome = { runtime: {} };
      expect(isExtensionEnvironment()).toBe(false);
    });

    it('returns true when chrome.runtime.id is a non-empty string', () => {
      (globalThis as any).chrome = { runtime: { id: 'abcdefghij' } };
      expect(isExtensionEnvironment()).toBe(true);
    });

    it('returns false when accessing runtime.id throws', () => {
      (globalThis as any).chrome = {
        runtime: {
          get id() {
            throw new Error('mock throw');
          },
        },
      };
      expect(isExtensionEnvironment()).toBe(false);
    });
  });

  describe('isTestEnvironment', () => {
    it('returns true when not in extension environment', () => {
      (globalThis as any).chrome = undefined;
      expect(isTestEnvironment()).toBe(true);
    });

    it('returns false when in extension environment', () => {
      (globalThis as any).chrome = { runtime: { id: 'ext-id' } };
      expect(isTestEnvironment()).toBe(false);
    });
  });

  describe('isChromeMocked', () => {
    it('returns true when window.chromeMessageHistory is defined', () => {
      (window as any).chromeMessageHistory = [];
      originalWindowKeys.push('chromeMessageHistory');
      expect(isChromeMocked()).toBe(true);
    });

    it('returns true when window.chromeMock is defined', () => {
      (window as any).chromeMock = {};
      originalWindowKeys.push('chromeMock');
      expect(isChromeMocked()).toBe(true);
    });

    it('returns false when window has no mock markers', () => {
      expect(isChromeMocked()).toBe(false);
    });
  });

  describe('getEnvironmentType', () => {
    it('returns "extension" when chrome has valid runtime.id', () => {
      (globalThis as any).chrome = { runtime: { id: 'ext-123' } };
      expect(getEnvironmentType()).toBe('extension');
    });

    it('returns "test" when not extension and chrome is mocked', () => {
      (globalThis as any).chrome = undefined;
      (window as any).chromeMessageHistory = [];
      originalWindowKeys.push('chromeMessageHistory');
      expect(getEnvironmentType()).toBe('test');
    });

    it('returns "test" when chrome is undefined (no extension)', () => {
      (globalThis as any).chrome = undefined;
      // isTestEnvironment() is true when not extension, so type is 'test'
      expect(getEnvironmentType()).toBe('test');
    });
  });
});
