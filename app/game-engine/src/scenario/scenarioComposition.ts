import path from 'node:path';

export type ScenarioResourceReader = (relativePath: string) => Promise<unknown>;

type JsonObject = Record<string, unknown>;

const MAX_COMPOSITION_DEPTH = 64;

const isJsonObject = (value: unknown): value is JsonObject =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeResourcePath = (resourcePath: string, sourcePath?: string): string => {
    if (!resourcePath || resourcePath.includes('\\') || path.posix.isAbsolute(resourcePath)) {
        throw new Error(`Scenario extension path is invalid: ${resourcePath || '<empty>'}.`);
    }
    const basePath = sourcePath ? path.posix.dirname(sourcePath) : '.';
    const normalized = path.posix.normalize(path.posix.join(basePath, resourcePath));
    if (normalized === '..' || normalized.startsWith('../') || !normalized.endsWith('.json')) {
        throw new Error(`Scenario extension path escapes the scenario resource root: ${resourcePath}.`);
    }
    return normalized;
};

const readExtensionPaths = (value: unknown, sourcePath: string): string[] => {
    if (value === undefined) {
        return [];
    }
    const entries = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(entries) || entries.length === 0 || entries.some((entry) => typeof entry !== 'string')) {
        throw new Error(`Scenario resource ${sourcePath} has an invalid extends field.`);
    }
    return entries.map((entry) => normalizeResourcePath(entry as string, sourcePath));
};

export const mergeScenarioResources = (base: unknown, override: unknown): unknown => {
    if (!isJsonObject(base) || !isJsonObject(override)) {
        return override;
    }

    const merged: JsonObject = { ...base };
    for (const [key, value] of Object.entries(override)) {
        Object.defineProperty(merged, key, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: key in merged ? mergeScenarioResources(merged[key], value) : value,
        });
    }
    return merged;
};

/**
 * `extends`를 왼쪽부터 합성하고 마지막에 현재 파일을 적용합니다.
 * 객체는 재귀 병합하고 배열과 scalar는 뒤 레이어의 값으로 교체합니다.
 */
export const composeScenarioResource = async (
    entryPath: string,
    readResource: ScenarioResourceReader
): Promise<JsonObject> => {
    const rootEntry = normalizeResourcePath(entryPath);

    const compose = async (resourcePath: string, stack: string[]): Promise<JsonObject> => {
        if (stack.length >= MAX_COMPOSITION_DEPTH) {
            throw new Error(`Scenario composition exceeds ${MAX_COMPOSITION_DEPTH} layers at ${resourcePath}.`);
        }
        if (stack.includes(resourcePath)) {
            throw new Error(`Scenario composition cycle: ${[...stack, resourcePath].join(' -> ')}.`);
        }

        const raw = await readResource(resourcePath);
        if (!isJsonObject(raw)) {
            throw new Error(`Scenario resource ${resourcePath} must be a JSON object.`);
        }

        let result: unknown = {};
        const nextStack = [...stack, resourcePath];
        for (const extensionPath of readExtensionPaths(raw.extends, resourcePath)) {
            result = mergeScenarioResources(result, await compose(extensionPath, nextStack));
        }
        const resourceBody = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'extends'));
        result = mergeScenarioResources(result, resourceBody);
        if (!isJsonObject(result)) {
            throw new Error(`Scenario resource ${resourcePath} did not compose to a JSON object.`);
        }
        return result;
    };

    return compose(rootEntry, []);
};
