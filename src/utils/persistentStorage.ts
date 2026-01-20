/**
 * Persistent Storage Utility
 * 
 * This module provides storage that persists even after extension uninstall.
 * 
 * IMPORTANT: Browser extensions cannot truly persist data after uninstall using
 * standard extension storage APIs. This module provides alternatives:
 * 
 * 1. IndexedDB in a regular web page context (if you have a web app)
 * 2. Export/Import functionality (recommended)
 * 3. Remote server storage (requires backend)
 * 
 * ⚠️ SECURITY WARNING: Storing API keys in persistent storage that survives
 * extension uninstall can be a security risk. Consider encrypting sensitive data.
 */

export interface PersistentConfig {
  llmConfig?: any;
  preferences?: {
    sidebarOpen?: boolean;
    theme?: string;
    [key: string]: any;
  };
  timestamp?: number;
}

const PERSISTENT_STORAGE_KEY = 'pagewise_user_preferences';
const STORAGE_DB_NAME = 'pagewise_persistent_storage';
const STORAGE_VERSION = 1;

/**
 * Option 1: IndexedDB Storage
 * 
 * ⚠️ IMPORTANT: Extension IndexedDB IS CLEARED on uninstall (Chrome 96+).
 * 
 * This means:
 * - IndexedDB created by extensions is deleted when the extension is uninstalled
 * - This includes databases created via content scripts running in extension context
 * - Only works for persistence if you have a regular web page origin (not extension origin)
 * 
 * For true persistence after uninstall, use Export/Import (Option 2) instead.
 */
class PersistentIndexedDBStorage {
  private dbName: string;
  private storeName: string = 'preferences';

  constructor() {
    this.dbName = STORAGE_DB_NAME;
  }

  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, STORAGE_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' });
        }
      };
    });
  }

  async save(key: string, data: any): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      await store.put({ key, data, timestamp: Date.now() });
    } catch (error) {
      console.warn('[PersistentStorage] Failed to save to IndexedDB:', error);
      throw error;
    }
  }

  async load(key: string): Promise<any | null> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          resolve(request.result?.data || null);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('[PersistentStorage] Failed to load from IndexedDB:', error);
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      await store.delete(key);
    } catch (error) {
      console.warn('[PersistentStorage] Failed to delete from IndexedDB:', error);
    }
  }
}

/**
 * Option 2: Export/Import (Recommended - Most Secure)
 * 
 * Allows users to export their settings and import them later.
 * This is the safest approach as users control their data.
 */
export class PersistentStorage {
  private indexedDB: PersistentIndexedDBStorage;

  constructor() {
    this.indexedDB = new PersistentIndexedDBStorage();
  }

  /**
   * Save preferences with multiple fallback strategies
   */
  async savePreferences(config: PersistentConfig): Promise<void> {
    const dataToSave = {
      ...config,
      timestamp: Date.now(),
      version: '1.0.0'
    };

    // Strategy 1: Try IndexedDB (if available in web context)
    try {
      await this.indexedDB.save(PERSISTENT_STORAGE_KEY, dataToSave);
      console.log('[PersistentStorage] Saved to IndexedDB');
    } catch (error) {
      console.warn('[PersistentStorage] IndexedDB not available, using fallback');
    }

    // Strategy 2: Also save to extension storage (for current session)
    if (typeof chrome !== 'undefined' && chrome.storage) {
      try {
        await chrome.storage.local.set({ [PERSISTENT_STORAGE_KEY]: dataToSave });
      } catch (error) {
        console.warn('[PersistentStorage] Chrome storage failed:', error);
      }
    }

    // Strategy 3: localStorage fallback
    try {
      localStorage.setItem(PERSISTENT_STORAGE_KEY, JSON.stringify(dataToSave));
    } catch (error) {
      console.warn('[PersistentStorage] localStorage failed:', error);
    }
  }

  /**
   * Load preferences with multiple fallback strategies
   */
  async loadPreferences(): Promise<PersistentConfig | null> {
    // Strategy 1: Try IndexedDB first
    try {
      const indexedData = await this.indexedDB.load(PERSISTENT_STORAGE_KEY);
      if (indexedData) {
        console.log('[PersistentStorage] Loaded from IndexedDB');
        return indexedData;
      }
    } catch (error) {
      console.warn('[PersistentStorage] IndexedDB load failed:', error);
    }

    // Strategy 2: Try extension storage
    if (typeof chrome !== 'undefined' && chrome.storage) {
      try {
        const result = await chrome.storage.local.get(PERSISTENT_STORAGE_KEY);
        if (result[PERSISTENT_STORAGE_KEY]) {
          console.log('[PersistentStorage] Loaded from Chrome storage');
          return result[PERSISTENT_STORAGE_KEY];
        }
      } catch (error) {
        console.warn('[PersistentStorage] Chrome storage load failed:', error);
      }
    }

    // Strategy 3: Try localStorage
    try {
      const stored = localStorage.getItem(PERSISTENT_STORAGE_KEY);
      if (stored) {
        console.log('[PersistentStorage] Loaded from localStorage');
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn('[PersistentStorage] localStorage load failed:', error);
    }

    return null;
  }

  /**
   * Export preferences as JSON string (for user to save)
   */
  async exportPreferences(): Promise<string> {
    const prefs = await this.loadPreferences();
    if (!prefs) {
      throw new Error('No preferences to export');
    }

    // Remove sensitive data or encrypt it
    const exportData = {
      ...prefs,
      exportedAt: new Date().toISOString(),
      version: '1.0.0'
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import preferences from JSON string
   */
  async importPreferences(jsonString: string): Promise<void> {
    try {
      const data = JSON.parse(jsonString);
      
      // Validate structure
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid preferences format');
      }

      // Save imported preferences
      await this.savePreferences(data);
      console.log('[PersistentStorage] Preferences imported successfully');
    } catch (error) {
      console.error('[PersistentStorage] Import failed:', error);
      throw new Error(`Failed to import preferences: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Download preferences as a file
   */
  async downloadPreferences(filename: string = 'pagewise-preferences.json'): Promise<void> {
    const json = await this.exportPreferences();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Clear all persistent preferences
   */
  async clearPreferences(): Promise<void> {
    try {
      await this.indexedDB.delete(PERSISTENT_STORAGE_KEY);
    } catch (error) {
      console.warn('[PersistentStorage] Failed to delete from IndexedDB:', error);
    }

    if (typeof chrome !== 'undefined' && chrome.storage) {
      try {
        await chrome.storage.local.remove(PERSISTENT_STORAGE_KEY);
      } catch (error) {
        console.warn('[PersistentStorage] Failed to delete from Chrome storage:', error);
      }
    }

    try {
      localStorage.removeItem(PERSISTENT_STORAGE_KEY);
    } catch (error) {
      console.warn('[PersistentStorage] Failed to delete from localStorage:', error);
    }
  }
}

// Singleton instance
let persistentStorageInstance: PersistentStorage | null = null;

export function getPersistentStorage(): PersistentStorage {
  if (!persistentStorageInstance) {
    persistentStorageInstance = new PersistentStorage();
  }
  return persistentStorageInstance;
}
