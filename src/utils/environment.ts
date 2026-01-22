/**
 * Environment detection utilities
 * Helps differentiate between real extension environment and test environment
 */

/**
 * Check if running in a real browser extension environment
 * vs a test environment with mocked Chrome APIs
 */
export function isExtensionEnvironment(): boolean {
  // In real extension: chrome.runtime.id exists and is a string
  // In test: chrome might be mocked and runtime.id might not exist or be different
  if (typeof chrome === 'undefined') {
    return false;
  }
  
  if (!chrome.runtime) {
    return false;
  }
  
  // Real Chrome extensions have a runtime.id
  // Mocked chrome might not have this or it might be undefined
  try {
    const runtimeId = chrome.runtime.id;
    // Real extension IDs are non-empty strings
    // Mock might return undefined, empty string, or a test value
    return typeof runtimeId === 'string' && runtimeId.length > 0;
  } catch (e) {
    // If accessing id throws an error, we're likely in a test environment
    return false;
  }
}

/**
 * Check if running in test environment
 */
export function isTestEnvironment(): boolean {
  return !isExtensionEnvironment();
}

/**
 * Check if Chrome APIs are mocked
 */
export function isChromeMocked(): boolean {
  // If chromeMock exists, it means we're in test but real chrome also exists
  // If chrome exists but chromeMessageHistory exists, it's likely mocked
  if (typeof window !== 'undefined') {
    // Test environment adds chromeMessageHistory
    if ((window as any).chromeMessageHistory !== undefined) {
      return true;
    }
    // If chromeMock exists alongside chrome, we're in a hybrid environment
    if ((window as any).chromeMock) {
      return true;
    }
  }
  return false;
}

/**
 * Get the environment type
 */
export function getEnvironmentType(): 'extension' | 'test' | 'unknown' {
  if (isExtensionEnvironment()) {
    return 'extension';
  }
  if (isTestEnvironment() || isChromeMocked()) {
    return 'test';
  }
  return 'unknown';
}

/**
 * Log environment information (useful for debugging)
 */
export function logEnvironmentInfo(): void {
  const env = getEnvironmentType();
  const chromeMocked = isChromeMocked();
  const hasChrome = typeof chrome !== 'undefined';
  const hasRuntime = hasChrome && typeof chrome.runtime !== 'undefined';
  const runtimeId = hasRuntime ? (chrome.runtime as any).id : 'N/A';
  const hasMessageHistory = typeof window !== 'undefined' && (window as any).chromeMessageHistory !== undefined;
  
  console.log('[Environment] Type:', env);
  console.log('[Environment] Chrome available:', hasChrome);
  console.log('[Environment] Chrome runtime available:', hasRuntime);
  console.log('[Environment] Runtime ID:', runtimeId);
  console.log('[Environment] Chrome mocked:', chromeMocked);
  console.log('[Environment] Message history available:', hasMessageHistory);
}

// Make functions available globally for console access
if (typeof window !== 'undefined') {
  (window as any).isExtensionEnvironment = isExtensionEnvironment;
  (window as any).isTestEnvironment = isTestEnvironment;
  (window as any).isChromeMocked = isChromeMocked;
  (window as any).getEnvironmentType = getEnvironmentType;
  (window as any).logEnvironmentInfo = logEnvironmentInfo;
}
