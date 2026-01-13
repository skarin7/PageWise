/**
 * Simple logger utility with on/off toggle
 * Stores preference in localStorage for persistence
 */

const LOG_STORAGE_KEY = 'rag_extension_logging_enabled';

/**
 * Check if logging is enabled (default: true)
 */
function isLoggingEnabled(): boolean {
  try {
    const stored = localStorage.getItem(LOG_STORAGE_KEY);
    if (stored === null) {
      // Default to enabled
      return true;
    }
    return stored === 'true';
  } catch (e) {
    // If localStorage is not available, default to enabled
    return true;
  }
}

/**
 * Enable or disable logging
 */
export function setLoggingEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LOG_STORAGE_KEY, String(enabled));
    console.log(`%c[RAG Logger] Logging ${enabled ? 'ENABLED' : 'DISABLED'}`, 
      `color: ${enabled ? '#28a745' : '#dc3545'}; font-weight: bold;`);
  } catch (e) {
    console.warn('[RAG Logger] Failed to save logging preference:', e);
  }
}

/**
 * Toggle logging on/off
 */
export function toggleLogging(): boolean {
  const newState = !isLoggingEnabled();
  setLoggingEnabled(newState);
  return newState;
}

/**
 * Logger class that respects the enabled/disabled state
 */
class Logger {
  private enabled: boolean;

  constructor() {
    this.enabled = isLoggingEnabled();
  }

  private checkEnabled(): boolean {
    // Re-check on each call in case it was toggled
    this.enabled = isLoggingEnabled();
    return this.enabled;
  }

  log(...args: any[]): void {
    if (this.checkEnabled()) {
      console.log(...args);
    }
  }

  warn(...args: any[]): void {
    if (this.checkEnabled()) {
      console.warn(...args);
    }
  }

  error(...args: any[]): void {
    // Always show errors, even if logging is disabled
    console.error(...args);
  }

  info(...args: any[]): void {
    if (this.checkEnabled()) {
      console.info(...args);
    }
  }

  debug(...args: any[]): void {
    if (this.checkEnabled()) {
      console.debug(...args);
    }
  }
}

// Export singleton instance
export const logger = new Logger();

// Expose toggle functions globally for easy access
if (typeof window !== 'undefined') {
  (window as any).ragToggleLogging = toggleLogging;
  (window as any).ragEnableLogging = () => setLoggingEnabled(true);
  (window as any).ragDisableLogging = () => setLoggingEnabled(false);
  (window as any).ragIsLoggingEnabled = () => isLoggingEnabled();
}

