import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertRuntimeMetadataFinalized, loadConfig, loadTokens } from './config.js';
import { describeDryRun, runLoadTest } from './runner.js';

type Command = 'run' | 'dry-run' | 'validate';

const usage = (): never => {
    process.stderr.write('usage: cli.ts <validate|dry-run|run> --config <file> [--tokens <0600-gitignored-file>] [--output <new-json-file>]\n');
    process.exit(64);
};

const parseArguments = (argv: readonly string[]): { command: Command; config: string; tokens?: string; output?: string } => {
    const command = argv[0];
    if (!['run', 'dry-run', 'validate'].includes(command ?? '')) usage();
    const values = new Map<string, string>();
    for (let index = 1; index < argv.length; index += 2) {
        const flag = argv[index];
        const value = argv[index + 1];
        if (!flag || !['--config', '--tokens', '--output'].includes(flag) || !value) usage();
        values.set(flag, value);
    }
    const config = values.get('--config');
    if (!config) usage();
    if (command === 'run' && (!values.get('--tokens') || !values.get('--output'))) usage();
    if (command === 'validate' && (values.has('--tokens') || values.has('--output'))) usage();
    if (command === 'dry-run' && values.has('--output')) usage();
    return {
        command: command as Command,
        config: config!,
        ...(values.get('--tokens') ? { tokens: values.get('--tokens')! } : {}),
        ...(values.get('--output') ? { output: values.get('--output')! } : {}),
    };
};

const main = async (): Promise<void> => {
    const args = parseArguments(process.argv.slice(2));
    const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
    const { config, sha256 } = await loadConfig(args.config);
    if (args.command === 'validate') {
        process.stdout.write(`${JSON.stringify({ valid: true, name: config.name, configSha256: sha256 })}\n`);
        return;
    }
    const tokens = args.tokens ? await loadTokens(args.tokens, workspaceRoot, config.capacity.authenticatedViewers) : null;
    if (args.command === 'dry-run') {
        process.stdout.write(`${JSON.stringify({ valid: true, tokenFileValidated: tokens !== null, configSha256: sha256, plan: describeDryRun(config) }, null, 2)}\n`);
        return;
    }
    assertRuntimeMetadataFinalized(config);
    const output = path.resolve(args.output!);
    await mkdir(path.dirname(output), { recursive: true });
    const result = await runLoadTest({ config, configSha256: sha256, tokens: tokens!, workspaceRoot });
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const failedRequests = result.phases.reduce((total, phase) => total + Object.values(phase.metrics.http.errors).reduce((sum, count) => sum + count, 0), 0);
    process.stdout.write(`${JSON.stringify({ completed: true, phases: result.phases.length, failedRequests, outputWritten: true })}\n`);
};

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown load-test error';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
