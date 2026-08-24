import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultWorkspaceRoot = path.resolve(scriptDirectory, '..');
const defaultRegistryPath = path.join(scriptDirectory, 'conditional-integration-file-registry.tsv');

export const supportedRequirements = new Set([
    'reference_command',
    'reference_full_lifecycle',
    'reference_instant_diplomacy',
    'reference_monthly',
    'reference_snapshot',
    'saved_trace_pair',
]);

const databaseMarkerPattern = /process\.env\.[A-Z0-9_]+_DATABASE_URL/u;
const redisMarkerPattern = /process\.env\.REDIS_URL/u;
const integrationFilePattern = /^test\/[A-Za-z0-9._/-]+\.integration\.test\.ts$/u;

export const parseConditionalIntegrationFileRegistry = (source) => {
    const entries = [];
    const seen = new Set();

    for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
        const line = rawLine.trim();
        if (line === '' || line.startsWith('#')) continue;

        const fields = rawLine.split('\t');
        if (fields.length !== 2) {
            throw new Error(`line ${index + 1} must contain exactly one tab-separated file and requirement`);
        }
        const [file, requirement] = fields.map((field) => field.trim());
        if (!integrationFilePattern.test(file)) {
            throw new Error(`line ${index + 1} has an invalid integration test path: ${file}`);
        }
        if (!supportedRequirements.has(requirement)) {
            throw new Error(`line ${index + 1} has an unsupported environment requirement: ${requirement}`);
        }
        if (seen.has(file)) {
            throw new Error(`line ${index + 1} duplicates integration test path: ${file}`);
        }
        seen.add(file);
        entries.push({ file, requirement });
    }

    return entries;
};

const listIntegrationSources = async (testDirectory) => {
    const sources = [];
    const visit = async (directory) => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(absolute);
            } else if (entry.isFile() && entry.name.endsWith('.integration.test.ts')) {
                sources.push({
                    file: path.relative(path.dirname(testDirectory), absolute).split(path.sep).join('/'),
                    source: await fs.readFile(absolute, 'utf8'),
                });
            }
        }
    };
    await visit(testDirectory);
    return sources.sort((left, right) => left.file.localeCompare(right.file));
};

const isNonDatabaseConditionalReference = (source) => {
    if (!source.includes('describe.skipIf')) return false;
    if (databaseMarkerPattern.test(source) || redisMarkerPattern.test(source)) return false;
    return (
        source.includes('TURN_DIFFERENTIAL_REFERENCE') ||
        (source.includes('TURN_REFERENCE_TRACE') && source.includes('TURN_CORE_TRACE'))
    );
};

const validateRequirementEvidence = ({ file, requirement, source }) => {
    const errors = [];
    const requireToken = (token) => {
        if (!source.includes(token)) errors.push(`${file}: ${requirement} requires source token ${token}`);
    };

    if (requirement.startsWith('reference_')) {
        requireToken('TURN_DIFFERENTIAL_REFERENCE');
    }
    switch (requirement) {
        case 'reference_command':
            requireToken('runReferenceTurnCommandTrace');
            break;
        case 'reference_full_lifecycle':
            requireToken('turn_full_lifecycle_trace.php');
            break;
        case 'reference_instant_diplomacy':
            requireToken('instant_diplomacy_response_trace.php');
            break;
        case 'reference_monthly':
            requireToken('monthly_event_trace.php');
            break;
        case 'reference_snapshot':
            requireToken('readReferenceDatabaseSnapshot');
            break;
        case 'saved_trace_pair':
            requireToken('TURN_REFERENCE_TRACE');
            requireToken('TURN_CORE_TRACE');
            break;
    }
    return errors;
};

export const validateConditionalIntegrationFileRegistry = async ({
    workspaceRoot = defaultWorkspaceRoot,
    registryPath = defaultRegistryPath,
} = {}) => {
    const packageRoot = path.join(workspaceRoot, 'tools/integration-tests');
    const testDirectory = path.join(packageRoot, 'test');
    const registrySource = await fs.readFile(registryPath, 'utf8');
    const entries = parseConditionalIntegrationFileRegistry(registrySource);
    const sources = await listIntegrationSources(testDirectory);
    const sourceByFile = new Map(sources.map((entry) => [entry.file, entry.source]));
    const discovered = sources
        .filter(({ source }) => isNonDatabaseConditionalReference(source))
        .map(({ file }) => file);
    const registered = entries.map(({ file }) => file);
    const errors = [];

    const missing = discovered.filter((file) => !registered.includes(file));
    const stale = registered.filter((file) => !discovered.includes(file));
    if (missing.length > 0) errors.push(`unregistered non-database conditional suite(s): ${missing.join(', ')}`);
    if (stale.length > 0) errors.push(`stale non-database conditional suite(s): ${stale.join(', ')}`);

    for (const entry of entries) {
        const source = sourceByFile.get(entry.file);
        if (source === undefined) continue;
        if (databaseMarkerPattern.test(source) || redisMarkerPattern.test(source)) {
            errors.push(`${entry.file}: file registry overlaps a database/Redis marker suite`);
        }
        errors.push(...validateRequirementEvidence({ ...entry, source }));
    }

    if (errors.length > 0) {
        throw new Error(
            `invalid conditional integration file registry:\n${errors.map((error) => `  ${error}`).join('\n')}`
        );
    }
    return entries;
};

export const selectEnabledConditionalIntegrationFiles = (entries, environment = process.env) => {
    const hasReferenceTrace = Boolean(environment.TURN_REFERENCE_TRACE);
    const hasCoreTrace = Boolean(environment.TURN_CORE_TRACE);
    if (hasReferenceTrace !== hasCoreTrace) {
        throw new Error('TURN_REFERENCE_TRACE and TURN_CORE_TRACE must be provided together');
    }
    return {
        referenceFiles:
            environment.TURN_DIFFERENTIAL_REFERENCE === '1'
                ? entries.filter(({ requirement }) => requirement.startsWith('reference_')).map(({ file }) => file)
                : [],
        savedTraceFiles:
            hasReferenceTrace && hasCoreTrace
                ? entries.filter(({ requirement }) => requirement === 'saved_trace_pair').map(({ file }) => file)
                : [],
    };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    try {
        const entries = await validateConditionalIntegrationFileRegistry();
        selectEnabledConditionalIntegrationFiles(entries);
        process.stdout.write(`conditional integration file registry is valid (${entries.length} files)\n`);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
