import { formatServerDateTime } from '@sammo-ts/common';

export const formatSeoulDateTime = (value: string | Date): string => formatServerDateTime(value);

export const formatSeoulHourMinute = (value: string | Date): string =>
    formatServerDateTime(value, { format: 'hourMinute' });
