// Ref GameConstBase::$maxLevel. Scenario `stat.max` is a separate join-time
// allocation rule and must not be used as this runtime fallback.
export const LEGACY_DEFAULT_MAX_LEVEL = 255;

// Ref ResetHelper는 시나리오의 nullable 등장 기준과 게임 달력을 분리한다.
// 원본 startYear=null은 영웅 일괄 등장에 사용하므로 원본을 덮어쓰지 않는다.
export const LEGACY_DEFAULT_START_YEAR = 180;
export const LEGACY_DEFAULT_OPENING_PART_YEAR = 3;

export const resolveScenarioStartYear = (startYear: unknown): number =>
    typeof startYear === 'number' && Number.isFinite(startYear) ? startYear : LEGACY_DEFAULT_START_YEAR;
