const gatewayPort = process.env.FRONTEND_PARITY_GATEWAY_PORT ?? '15100';
const gamePort = process.env.FRONTEND_PARITY_GAME_PORT ?? '15102';

export const gatewayOrigin = `http://127.0.0.1:${gatewayPort}`;
export const gameOrigin = `http://127.0.0.1:${gamePort}`;
export const gatewayUrl = (suffix = '/'): string => `${gatewayOrigin}/gateway${suffix}`;
export const gameUrl = (suffix = '/'): string => `${gameOrigin}/che${suffix}`;
