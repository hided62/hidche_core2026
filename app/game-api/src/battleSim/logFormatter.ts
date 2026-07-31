import { formatLegacyLogHtml } from '@sammo-ts/common';

export const convertLog = (value: string, type = 1): string => formatLegacyLogHtml(value, { colorize: type > 0 });
