/**
 * Type declarations for window properties added by debug utilities and test mocks
 */

interface Window {
  // Debug flags for conditional breakpoints
  __DEBUG_SEARCH__?: boolean;
  __DEBUG_RAG_SEARCH__?: boolean;
  __DEBUG_RAG_RESULTS__?: boolean;
  __DEBUG_LLM_CALL__?: boolean;
  __DEBUG_LLM_RESULT__?: boolean;
  __DEBUG_LLM_ERROR__?: boolean;
  __DEBUG_RESPONSE__?: boolean;
  __DEBUG_MESSAGES__?: boolean;
  __DEBUG_SEARCH_ERROR__?: boolean;
  
  // Debug helper functions
  debugSearch?: (query: string, options?: any) => Promise<any>;
  debugRAG?: () => any;
  debugMessages?: () => any[];
  debugLLM?: (prompt: string, config?: any) => Promise<any>;
  handleSearchMessage?: (message: any, sender: any, sendResponse: any) => any;
  
  // Chrome API mock properties (for test environment)
  chromeMessageHistory?: Array<{
    type: string;
    message?: any;
    tabId?: number;
    timestamp: number;
    direction: string;
  }>;
  chromeMessageListeners?: {
    runtime: Array<Function>;
    tabs: Array<Function>;
  };
  chromeMock?: any;
  contentScriptMessageHandler?: (message: any, sender: any, sendResponse: any) => any;
  
  // Test RAG instance
  testRAG?: any;
  
  // LLM config helpers
  configureLLMExtraction?: (config: any) => Promise<any>;
  getLLMConfig?: () => Promise<any>;
  
  // Logging helpers
  ragToggleLogging?: () => boolean;
  ragEnableLogging?: () => void;
  ragDisableLogging?: () => void;
  ragIsLoggingEnabled?: () => boolean;
  ragSetLogLevel?: (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') => void;
  ragGetLogLevel?: () => 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  enableDebugLogging?: () => void;
  
  // Chrome mock debug functions
  debugChromeMessages?: () => any[];
  clearChromeMessageHistory?: () => void;
  getChromeMessageListeners?: () => { runtime: number; tabs: number };
  triggerChromeMessage?: (message: any, sender?: any, callback?: Function) => void;
  
  // Environment detection functions
  isExtensionEnvironment?: () => boolean;
  isTestEnvironment?: () => boolean;
  isChromeMocked?: () => boolean;
  getEnvironmentType?: () => 'extension' | 'test' | 'unknown';
  logEnvironmentInfo?: () => void;
}
