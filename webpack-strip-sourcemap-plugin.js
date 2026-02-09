/**
 * Webpack plugin to strip source map references from bundled vendor code
 * This prevents errors when vendor libraries (like ort-web) have source map
 * references that point to files that don't exist or are blocked by ad blockers
 */
const { sources } = require('webpack');

class StripSourceMapPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('StripSourceMapPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'StripSourceMapPlugin',
          stage: compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE
        },
        (assets) => {
          // Process all chunks
          compilation.chunks.forEach((chunk) => {
            // Only process vendor chunks (chunks from node_modules)
            const isVendorChunk = chunk.name && (
              chunk.name.includes('vendors') ||
              chunk.name.includes('transformers') ||
              chunk.name.includes('ai-sdk') ||
              chunk.name.includes('orama') ||
              chunk.name.includes('zod')
            );

            if (isVendorChunk) {
              chunk.files.forEach((filename) => {
                if (filename.endsWith('.js')) {
                  const asset = compilation.getAsset(filename);
                  if (asset) {
                    let source = asset.source.source();
                    
                    // Remove source map references (both //# and /*# formats)
                    const cleanedSource = source
                      .replace(/\/\/# sourceMappingURL=.*$/gm, '')
                      .replace(/\/\*# sourceMappingURL=.*?\*\//g, '');
                    
                    // Only update if source was actually modified
                    if (cleanedSource !== source) {
                      compilation.updateAsset(
                        filename,
                        new sources.RawSource(cleanedSource)
                      );
                    }
                  }
                }
              });
            }
          });
        }
      );
    });
  }
}

module.exports = StripSourceMapPlugin;
