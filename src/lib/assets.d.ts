// A .csv import gives the URL of the file, emitted unchanged by the bundler
// (next.config.ts: turbopack rule `type: 'asset'`; vitest.config.mts: `assetsInclude`).
declare module '*.csv' {
  const url: string;
  export default url;
}
