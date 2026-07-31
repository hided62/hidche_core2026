const normalizedBasePath = (process.env.PLAYWRIGHT_GAME_BASE_PATH ?? 'che').replace(/^\/+|\/+$/g, '');

export const gameBasePath = `/${normalizedBasePath}`;
export const gameProfile = process.env.PLAYWRIGHT_GAME_PROFILE ?? 'che:default';
export const gameTrpcRoute = `**${gameBasePath}/api/trpc/**`;
export const gamePath = (suffix = ''): string => `${gameBasePath}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
