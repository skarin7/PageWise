const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    'content-script': './src/extension/content-script.ts',
    'background': './src/extension/background.ts',
    'worker': './src/extension/worker.ts',
    'popup': './src/extension/popup/popup.ts',
    'sidebar': './src/extension/sidebar/sidebar.ts',
    'options': './src/extension/options/options.ts',
    'test-bundle': './src/test-bundle.ts' // For console testing
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
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
    })
  ],
  devtool: 'source-map'
};

