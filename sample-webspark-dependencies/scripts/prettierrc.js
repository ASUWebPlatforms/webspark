const baseConfig = require('./docroot/core/.prettierrc.json');

/**
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 */
const config = {
  ...baseConfig,
  // Add or override settings here
  // For example:
  // printWidth: 100,
  // You can also merge/override overrides:
  // overrides: [
  //   ...(baseConfig.overrides || []),
  //   {
  //     files: '*.js',
  //     options: { semi: false },
  //   },
  // ],
};
module.exports = config;
