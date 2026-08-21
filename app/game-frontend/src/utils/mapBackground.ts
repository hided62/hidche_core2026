export type MapSeason = 'spring' | 'summer' | 'fall' | 'winter';

const FIXED_BACKGROUND_PATHS: Readonly<Record<string, string>> = {
    ludo_rathowm: 'map/ludo_rathowm/back.jpg',
    chess: 'map/chess/chessboard.png',
    pokemon_v1: 'map/pokemon_v1/back_pal8.png',
    cr: 'map/cr/bg-fs8.png',
};

const NEXT_SEASON: Readonly<Record<MapSeason, MapSeason>> = {
    spring: 'summer',
    summer: 'fall',
    fall: 'winter',
    winter: 'spring',
};

export const resolveMapSeason = (month: number): MapSeason => {
    if (month <= 3) return 'spring';
    if (month <= 6) return 'summer';
    if (month <= 9) return 'fall';
    return 'winter';
};

export const resolveNextMapSeason = (season: MapSeason): MapSeason => NEXT_SEASON[season];

export const resolveMapBackgroundPath = (theme: string, season: MapSeason): { path: string; seasonal: boolean } => {
    const fixedPath = FIXED_BACKGROUND_PATHS[theme];
    if (fixedPath) {
        return { path: fixedPath, seasonal: false };
    }

    // Ref uses the CHE seasonal backgrounds for CHE, mini-CHE variants, and
    // unknown legacy-compatible themes that do not define their own backdrop.
    return { path: `map/che/bg_${season}.jpg`, seasonal: true };
};
