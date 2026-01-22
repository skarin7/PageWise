/**
 * Simple logger utility with on/off toggle and debug levels
 * Stores preference in localStorage for persistence
 */

const LOG_STORAGE_KEY = 'rag_extension_logging_enabled';
const LOG_LEVEL_KEY = 'rag_extension_log_level';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

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
 * Get current log level
 */
function getLogLevel(): LogLevel {
  try {
    const stored = localStorage.getItem(LOG_LEVEL_KEY);
    if (stored && ['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(stored)) {
      return stored as LogLevel;
    }
    return 'INFO'; // Default level
  } catch (e) {
    return 'INFO';
  }
}

/**
 * Set log level
 */
export function setLogLevel(level: LogLevel): void {
  try {
    localStorage.setItem(LOG_LEVEL_KEY, level);
    console.log(`%c[RAG Logger] Log level set to ${level}`, 
      `color: #007bff; font-weight: bold;`);
  } catch (e) {
    console.warn('[RAG Logger] Failed to save log level:', e);
  }
}

/**
 * Logger class that respects the enabled/disabled state and log levels
 */
class Logger {
  private enabled: boolean;
  private level: LogLevel;

  constructor() {
    this.enabled = isLoggingEnabled();
    this.level = getLogLevel();
  }

  private checkEnabled(): boolean {
    // Re-check on each call in case it was toggled
    this.enabled = isLoggingEnabled();
    return this.enabled;
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.checkEnabled()) {
      return false;
    }
    // Re-check log level
    this.level = getLogLevel();
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  log(...args: any[]): void {
    if (this.shouldLog('INFO')) {
      console.log(...args);
    }
  }

  warn(...args: any[]): void {
    if (this.shouldLog('WARN')) {
      console.warn(...args);
    }
  }

  error(...args: any[]): void {
    // Always show errors, even if logging is disabled
    console.error(...args);
  }

  info(...args: any[]): void {
    if (this.shouldLog('INFO')) {
      console.info(...args);
    }
  }

  debug(...args: any[]): void {
    if (this.shouldLog('DEBUG')) {
      console.debug('[DEBUG]', ...args);
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
  (window as any).ragSetLogLevel = setLogLevel;
  (window as any).ragGetLogLevel = getLogLevel;
  (window as any).enableDebugLogging = () => {
    setLoggingEnabled(true);
    setLogLevel('DEBUG');
    console.log('✅ Debug logging enabled with DEBUG level');
  };
}

