/**
 * Webpack plugin to prevent chunk creation for content-script
 * This forces all dynamic imports to be inlined into the main bundle
 */

class InlineDynamicImportsPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('InlineDynamicImportsPlugin', (compilation) => {
      // Hook into chunk graph to prevent async chunks for content-script
      compilation.hooks.optimizeChunks.tap('InlineDynamicImportsPlugin', (chunks) => {
        const contentScriptChunk = Array.from(chunks).find(chunk => chunk.name === 'content-script');
        
        if (contentScriptChunk) {
          const chunkGraph = compilation.chunkGraph;
          
          // Get all async chunks that would be loaded by content-script
          const asyncChunks = Array.from(contentScriptChunk.getAllAsyncChunks());
          
          // Move all modules from async chunks into content-script chunk
          asyncChunks.forEach(asyncChunk => {
            try {
              // Get all modules from the async chunk
              // Try different webpack API methods
              let modules = [];
              
              // Try getChunkModulesIterable first (webpack 5)
              if (chunkGraph.getChunkModulesIterable) {
                modules = Array.from(chunkGraph.getChunkModulesIterable(asyncChunk));
              } 
              // Fallback to getChunkModules if available
              else if (chunkGraph.getChunkModules) {
                modules = chunkGraph.getChunkModules(asyncChunk);
              }
              // Last resort: iterate over modulesIterable
              else if (asyncChunk.modulesIterable) {
                modules = Array.from(asyncChunk.modulesIterable);
              }
              
              modules.forEach(module => {
                // Check if module is already in content-script chunk
                if (chunkGraph.isModuleInChunk && !chunkGraph.isModuleInChunk(module, contentScriptChunk)) {
                  // Add module to content-script chunk
                  chunkGraph.connectChunkAndModule(contentScriptChunk, module);
                }
              });
              
              // Remove the async chunk
              if (chunkGraph.disconnectChunk) {
                chunkGraph.disconnectChunk(asyncChunk);
              }
              chunks.delete(asyncChunk);
            } catch (error) {
              // If API methods don't exist, just log and continue
              console.warn('[InlineDynamicImportsPlugin] Error processing async chunk:', error.message);
            }
          });
        }
      });
    });
  }
}

module.exports = InlineDynamicImportsPlugin;
