module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // zod 4 ships ESM using `export * as ns from`, which Metro's preset does not transform.
  plugins: ['@babel/plugin-transform-export-namespace-from'],
};
