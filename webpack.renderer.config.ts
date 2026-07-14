import type { Configuration } from 'webpack';

import { rules } from './webpack.rules';

const rendererConfig: Configuration = {
  module: {
    rules,
  },
  output: {
    publicPath: '../',
  },
  resolve: {
    extensions: ['.js', '.json', '.ts', '.tsx'],
    symlinks: false,
  },
};

export default rendererConfig;
