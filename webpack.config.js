const path = require('path');

/**@type {import('webpack').Configuration}*/
const extensionConfig = {
  target: 'node',
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode',
    // Exclude tree-sitter native bindings from webpack
    'tree-sitter': 'commonjs tree-sitter',
    'tree-sitter-rust': 'commonjs tree-sitter-rust'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: 'tsconfig.json'
            }
          }
        ]
      }
    ]
  },
  optimization: {
    minimize: process.env.NODE_ENV === 'production',
    // Keep readable function names for better error messages
    minimizer: [
      new (require('terser-webpack-plugin'))({
        terserOptions: {
          keep_classnames: true,
          keep_fnames: true
        }
      })
    ]
  },
  devtool: process.env.NODE_ENV === 'production' ? false : 'nosources-source-map',
  infrastructureLogging: {
    level: "log"
  }
};

/**@type {import('webpack').Configuration}*/
const webviewConfig = {
  target: 'web',
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'none',
  entry: './webview/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'webview.js',
    // Clean output directory before build
    clean: false
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    // Ensure proper resolution for Hydroscope and its dependencies
    alias: {
      // Prevent duplicate React instances
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom')
    },
    fallback: {
      // Polyfills for Node.js modules used by ELK
      'web-worker': false,
      'fs': false,
      'path': false
    }
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: 'tsconfig.webview.json',
              transpileOnly: true // Faster builds
            }
          }
        ]
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        // Handle assets from Hydroscope and dependencies
        test: /\.(png|jpg|jpeg|gif|svg|woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource'
      }
    ]
  },
  // Optimize bundle size for webview context
  optimization: {
    minimize: process.env.NODE_ENV === 'production',
    usedExports: true,
    sideEffects: false,
    splitChunks: false // Don't split chunks for webview
  },
  plugins: [
    new (require('webpack')).DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      'process': JSON.stringify({
        env: { NODE_ENV: process.env.NODE_ENV || 'development' }
      })
    })
  ],
  performance: {
    // Increase size limits for webview bundle (includes Hydroscope + React + ReactFlow)
    maxEntrypointSize: 5000000, // 5MB
    maxAssetSize: 5000000,
    hints: process.env.NODE_ENV === 'production' ? 'warning' : false
  },
  devtool: process.env.NODE_ENV === 'production' ? false : 'nosources-source-map',
  infrastructureLogging: {
    level: "log"
  }
};

module.exports = [extensionConfig, webviewConfig];
