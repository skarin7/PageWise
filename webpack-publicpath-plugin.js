/**
 * Webpack plugin to set publicPath for browser extensions
 * This ensures chunks are loaded from extension origin, not page origin
 */

class WebpackPublicPathPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('WebpackPublicPathPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'WebpackPublicPathPlugin',
          stage: compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        (assets) => {
          // Only process content-script.js
          if (assets['content-script.js']) {
            const asset = assets['content-script.js'];
            let source = asset.source();
            
            // Inject publicPath fix at the very beginning of the file
            const publicPathFix = `
// Fix webpack publicPath for browser extension
(function() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    try {
      if (typeof __webpack_require__ !== 'undefined' && __webpack_require__.p !== undefined) {
        __webpack_require__.p = chrome.runtime.getURL('/');
      }
    } catch(e) {}
  }
})();
`;
            
            source = publicPathFix + source;
            compilation.updateAsset('content-script.js', new compiler.webpack.sources.RawSource(source));
          }
        }
      );
    });
  }
}

module.exports = WebpackPublicPathPlugin;
