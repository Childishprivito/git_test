// Adjusts app.json for local builds.
// FOODLOG_NO_HEALTHKIT=1 leaves Apple Health out, for building with a free
// Apple ID (free accounts may not be allowed the Health permission).
module.exports = ({ config }) => {
  if (process.env.FOODLOG_NO_HEALTHKIT === '1') {
    config.plugins = config.plugins.filter((p) => (Array.isArray(p) ? p[0] : p) !== '@kingstinct/react-native-healthkit');
    config.extra = { ...config.extra, healthKit: false };
  }
  return config;
};
