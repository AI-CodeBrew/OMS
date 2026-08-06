const FLAGS = new Set(
  (process.env.NEXT_PUBLIC_FEATURE_FLAGS || "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
);

export function isFeatureEnabled(featureName) {
  if (!featureName) return false;
  return FLAGS.has(featureName);
}

export default isFeatureEnabled;
