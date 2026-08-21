// Ref GameConstBase::$maxLevel. Scenario `stat.max` is a separate join-time
// allocation rule and must not be used as this runtime fallback.
export const LEGACY_DEFAULT_MAX_LEVEL = 255;
