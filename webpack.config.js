const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const WebpackPublicPathPlugin = require('./webpack-publicpath-plugin');

// Determine if we're in production mode
const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--mode=production');

// Build entry points - conditionally exclude test-bundle in production
const entry = {
  'content-script': './src/extension/content-script.ts',
  'background': './src/extension/background.ts',
  'worker': './src/extension/worker.ts',
  'popup': './src/extension/popup/popup.ts',
  'sidebar': './src/extension/sidebar/sidebar.ts',
  'options': './src/extension/options/options.ts'
};

// Only include test-bundle in development
if (!isProduction) {
  entry['test-bundle'] = './src/test-bundle.ts';
}

module.exports = {
  entry,
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
    // Use JSONP chunk loading instead of eval() to comply with CSP
    // Note: For content-script, we'll inline dynamic imports via module.parser config
    chunkLoading: 'jsonp',
    chunkLoadingGlobal: 'webpackChunkPageWise',
    // For browser extensions, use chrome.runtime.getURL() to get correct extension path
    // This ensures chunks are loaded from extension origin, not page origin
    publicPath: '', // Will be set dynamically at runtime using chrome.runtime.getURL()
    // Disable eval() usage completely for CSP compliance
    environment: {
      arrowFunction: true,
      bigIntLiteral: false,
      const: true,
      destructuring: true,
      dynamicImport: true,
      forOf: true,
      module: true
    }
  },
  resolve: {
    extensions: ['.ts', '.js'],
    // Disable Node.js polyfills that might use Function() or eval()
    fallback: {
      fs: false,
      net: false,
      crypto: false,
      stream: false,
      url: false,
      zlib: false,
      http: false,
      https: false,
      assert: false,
      os: false,
      path: false
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ],
    // Configure parser to handle dynamic imports
    parser: {
      javascript: {
        // Set importExportsPresence to avoid warnings
        importExportsPresence: 'error'
      }
    }
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'public', to: '.' },
        { from: 'test', to: 'test' },
        { from: 'src/extension/popup/popup.html', to: 'popup.html' },
        { from: 'src/extension/sidebar/sidebar.html', to: 'sidebar.html' },
        { from: 'src/extension/options/options.html', to: 'options.html' }
      ]
    }),
    // Fix publicPath for content-script to load chunks from extension origin
    new WebpackPublicPathPlugin()
  ],
  // Disable eval() usage in webpack runtime for CSP compliance
  experiments: {
    topLevelAwait: true
  },
  optimization: {
    splitChunks: {
      // Disable code splitting entirely for content-script to avoid CSP issues
      // Content scripts can't load chunks due to CSP restrictions
      // For other entry points, we allow code splitting
      chunks: (chunk) => {
        // Don't split chunks for content-script (it causes CSP issues)
        // Allow splitting for other entry points (background, popup, sidebar, etc.)
        return chunk.name !== 'content-script';
      },
      minSize: 20000, // 20KB minimum chunk size
      maxSize: 500000, // 500KB maximum chunk size (split larger chunks)
      cacheGroups: {
        // Transformers.js - very large, separate chunk
        transformers: {
          test: /[\\/]node_modules[\\/]@xenova[\\/]/,
          name: 'transformers',
          priority: 30,
          reuseExistingChunk: true,
          enforce: true
        },
        // AI SDK - separate chunk
        aiSdk: {
          test: /[\\/]node_modules[\\/](ai|@ai-sdk|ollama-ai-provider)[\\/]/,
          name: 'ai-sdk',
          priority: 25,
          reuseExistingChunk: true,
          enforce: true
        },
        // Orama (vector search) - separate chunk
        orama: {
          test: /[\\/]node_modules[\\/]@orama[\\/]/,
          name: 'orama',
          priority: 25,
          reuseExistingChunk: true,
          enforce: true
        },
        // Zod (schema validation) - separate chunk
        zod: {
          test: /[\\/]node_modules[\\/]zod[\\/]/,
          name: 'zod',
          priority: 20,
          reuseExistingChunk: true,
          enforce: true
        },
        // Other vendor libraries
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          priority: 10,
          reuseExistingChunk: true,
          minChunks: 2 // Only create vendor chunk if used in 2+ entry points
        }
      }
    },
    usedExports: true
  },
  // Use source-map (not eval-source-map) to avoid CSP violations in browser extensions
  // eval-source-map uses eval() which is blocked by Content Security Policy
  // For browser extensions, we disable source maps completely to avoid any eval() usage
  // Even 'inline-source-map' can cause issues, so we disable it entirely
  devtool: false
};

