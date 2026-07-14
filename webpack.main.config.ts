import type { Configuration } from 'webpack';

import { rules } from './webpack.rules';

const mainConfig: Configuration = {
  entry: {
    index: './src/main/index.ts',
    utility: './src/utility/index.ts',
  },
  module: {
    rules,
  },
  output: {
    filename: '[name].js',
  },
  resolve: {
    extensions: ['.js', '.json', '.ts', '.tsx'],
    symlinks: false,
  },
  target: 'electron-main',
};

export default mainConfig;
