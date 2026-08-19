import type { CommandInputField, CommandOption } from './types';

export type CommandArgumentFieldContract = Pick<CommandInputField, 'kind' | 'optionSource'>;

export const commandArgumentFieldContract = (field: CommandInputField): CommandArgumentFieldContract => ({
    kind: field.kind,
    optionSource: field.optionSource,
});

export const shouldPreserveCommandArgumentValue = (
    field: CommandInputField,
    previousField: CommandArgumentFieldContract | undefined,
    values: Readonly<Record<string, unknown>>,
    options: readonly CommandOption[]
): boolean => {
    if (field.kind === 'hidden' || !Object.prototype.hasOwnProperty.call(values, field.key)) return false;
    if (!previousField || previousField.kind !== field.kind || previousField.optionSource !== field.optionSource) {
        return false;
    }
    if (field.kind !== 'select') return true;
    return options.some((option) => option.value === values[field.key]);
};
