#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { createMariaPool, createPostgresPool } from './db.js';
import { isLegacyArchiveProfile, LEGACY_ARCHIVE_PROFILES, migrateGame } from './game.js';
import { migrateGateway } from './gateway.js';
import { hashPasswordForReset } from './password.js';
import { migrateCurrentSeasonFixture } from './currentSeason.js';
import { loadMigrationPlan } from './config.js';
import { fingerprintMariaConnection, type MigrationMode } from './incremental.js';
import { checkMigrationPlan, runMigrationPlan } from './plan.js';

type Command = 'gateway' | 'game' | 'current-season-fixture' | 'reset-password' | 'check-plan' | 'run-plan';

interface CliOptions {
    command: Command;
    apply: boolean;
    profile?: string;
    loginId?: string;
    passwordFile?: string;
    expectedScenario?: number;
    expectedYear?: number;
    expectedMonth?: number;
    replaceCurrentSeason: boolean;
    config?: string;
    mode: MigrationMode;
    sourceKey?: string;
}

const usage = `Usage:
  pnpm --filter @sammo-ts/legacy-db-migration migrate gateway [--apply]
  pnpm --filter @sammo-ts/legacy-db-migration migrate game --profile <profile> [--apply]
  pnpm --filter @sammo-ts/legacy-db-migration migrate check-plan --config <secure-plan.json>
  pnpm --filter @sammo-ts/legacy-db-migration migrate run-plan --config <secure-plan.json> \
    [--mode full|incremental] [--apply]
  pnpm --filter @sammo-ts/legacy-db-migration migrate current-season-fixture --profile <profile> \
    --expected-scenario <id> --expected-year <year> --expected-month <month> \
    [--replace-current-season --apply]
  pnpm --filter @sammo-ts/legacy-db-migration migrate reset-password --login-id <id> --password-file <path> --apply

Environment:
  LEGACY_ROOT_DATABASE_URL   MariaDB URL for the restored root dump
  LEGACY_GAME_DATABASE_URL   MariaDB URL for one restored game-profile dump
  GATEWAY_DATABASE_URL       target PostgreSQL URL for gateway
  GAME_DATABASE_URL          target PostgreSQL URL for the selected game profile

Dry-run is the default. Source and target URLs are accepted only through the environment so
credentials are not exposed in the process list.`;

const parseArguments = (argv: readonly string[]): CliOptions => {
    const command = argv[0];
    if (
        command !== 'gateway' &&
        command !== 'game' &&
        command !== 'current-season-fixture' &&
        command !== 'reset-password' &&
        command !== 'check-plan' &&
        command !== 'run-plan'
    ) {
        throw new Error(usage);
    }
    const options: CliOptions = { command, apply: false, replaceCurrentSeason: false, mode: 'full' };
    for (let index = 1; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--apply') {
            options.apply = true;
            continue;
        }
        if (argument === '--replace-current-season') {
            options.replaceCurrentSeason = true;
            continue;
        }
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            throw new Error(`Missing value for ${argument}\n\n${usage}`);
        }
        if (argument === '--profile') {
            options.profile = next;
        } else if (argument === '--config') {
            options.config = next;
        } else if (argument === '--mode') {
            if (next !== 'full' && next !== 'incremental') {
                throw new Error(`--mode must be full or incremental\n\n${usage}`);
            }
            options.mode = next;
        } else if (argument === '--source-key') {
            options.sourceKey = next;
        } else if (argument === '--login-id') {
            options.loginId = next;
        } else if (argument === '--password-file') {
            options.passwordFile = next;
        } else if (argument === '--expected-scenario') {
            options.expectedScenario = Number(next);
        } else if (argument === '--expected-year') {
            options.expectedYear = Number(next);
        } else if (argument === '--expected-month') {
            options.expectedMonth = Number(next);
        } else {
            throw new Error(`Unknown argument: ${argument}\n\n${usage}`);
        }
        index += 1;
    }
    return options;
};

const requireEnvironment = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`${name} is required`);
    }
    return value;
};

const resolveInvocationPath = (value: string): string =>
    path.resolve(process.env.INIT_CWD?.trim() || process.cwd(), value);

const resetPassword = async (options: CliOptions): Promise<Record<string, unknown>> => {
    if (!options.apply) {
        throw new Error('reset-password requires --apply');
    }
    if (!options.loginId || !options.passwordFile) {
        throw new Error(`reset-password requires --login-id and --password-file\n\n${usage}`);
    }
    const passwordPath = resolveInvocationPath(options.passwordFile);
    const passwordStat = await stat(passwordPath);
    if ((passwordStat.mode & 0o077) !== 0) {
        throw new Error('Password file must not be readable or writable by group/other (expected mode 0600)');
    }
    const password = (await readFile(passwordPath, 'utf8')).replace(/\r?\n$/, '');
    if (!password) {
        throw new Error('Password file is empty');
    }

    const pool = createPostgresPool(requireEnvironment('GATEWAY_DATABASE_URL'));
    try {
        const existing = await pool.query<{ id: string }>('SELECT "id" FROM "app_user" WHERE "login_id" = $1', [
            options.loginId.toLowerCase(),
        ]);
        if (existing.rowCount !== 1) {
            throw new Error('Exactly one migrated account must match --login-id');
        }
        const hashed = await hashPasswordForReset(password);
        await pool.query(
            `UPDATE "app_user"
             SET "password_hash" = $1,
                 "password_salt" = $2,
                 "password_reset_required" = FALSE,
                 "updated_at" = CURRENT_TIMESTAMP
             WHERE "id" = $3`,
            [hashed.hash, hashed.salt, existing.rows[0]!.id]
        );
        return { command: 'reset-password', updated: 1, loginId: options.loginId.toLowerCase() };
    } finally {
        await pool.end();
    }
};

const run = async (): Promise<void> => {
    const argumentsAfterScript = process.argv.slice(2);
    if (argumentsAfterScript[0] === '--') argumentsAfterScript.shift();
    if (argumentsAfterScript[0] === '--help' || argumentsAfterScript[0] === '-h') {
        console.log(usage);
        return;
    }
    const options = parseArguments(argumentsAfterScript);
    if (options.command === 'check-plan' || options.command === 'run-plan') {
        if (!options.config) throw new Error(`${options.command} requires --config\n\n${usage}`);
        const plan = await loadMigrationPlan(resolveInvocationPath(options.config));
        const result =
            options.command === 'check-plan'
                ? await checkMigrationPlan(plan)
                : await runMigrationPlan(plan, options.mode, options.apply);
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    if (options.command === 'reset-password') {
        console.log(JSON.stringify(await resetPassword(options), null, 2));
        return;
    }

    const migratedAt = new Date();
    if (options.command === 'gateway') {
        const sourceUrl = requireEnvironment('LEGACY_ROOT_DATABASE_URL');
        const source = createMariaPool(sourceUrl);
        const targetUrl = process.env.GATEWAY_DATABASE_URL?.trim();
        if (options.apply && !targetUrl) {
            throw new Error('GATEWAY_DATABASE_URL is required with --apply');
        }
        const target = targetUrl ? createPostgresPool(targetUrl) : null;
        try {
            const summary = await migrateGateway(source, target, options.apply, migratedAt, {
                mode: options.mode,
                source: {
                    key: options.sourceKey ?? process.env.LEGACY_SOURCE_KEY?.trim() ?? 'legacy-root',
                    fingerprint: fingerprintMariaConnection(sourceUrl),
                },
            });
            console.log(JSON.stringify(summary, null, 2));
        } finally {
            await source.end();
            await target?.end();
        }
        return;
    }

    if (!options.profile || !/^[a-z][a-z0-9_-]{1,31}$/.test(options.profile)) {
        throw new Error(`${options.command} requires a safe --profile value\n\n${usage}`);
    }
    if (options.command === 'game' && !isLegacyArchiveProfile(options.profile)) {
        throw new Error(`game requires --profile ${LEGACY_ARCHIVE_PROFILES.join('|')}\n\n${usage}`);
    }
    const sourceUrl = requireEnvironment('LEGACY_GAME_DATABASE_URL');
    const source = createMariaPool(sourceUrl);
    const target =
        options.apply || options.mode === 'incremental' || options.command === 'current-season-fixture'
            ? createPostgresPool(requireEnvironment('GAME_DATABASE_URL'))
            : null;
    try {
        if (options.command === 'current-season-fixture') {
            if (
                !Number.isSafeInteger(options.expectedScenario) ||
                !Number.isSafeInteger(options.expectedYear) ||
                !Number.isSafeInteger(options.expectedMonth) ||
                options.expectedMonth! < 1 ||
                options.expectedMonth! > 12
            ) {
                throw new Error(
                    `current-season-fixture requires valid expected scenario/year/month values\n\n${usage}`
                );
            }
            if (options.apply && !options.replaceCurrentSeason) {
                throw new Error('current-season-fixture --apply also requires --replace-current-season');
            }
            const summary = await migrateCurrentSeasonFixture(source, target!, {
                apply: options.apply,
                profile: options.profile,
                expectedScenario: options.expectedScenario!,
                expectedYear: options.expectedYear!,
                expectedMonth: options.expectedMonth!,
                captureUserId: process.env.CURRENT_SEASON_CAPTURE_USER_ID?.trim() || null,
                captureSourceOwner: Number(process.env.CURRENT_SEASON_CAPTURE_SOURCE_OWNER ?? 0),
            });
            console.log(JSON.stringify(summary, null, 2));
            return;
        }
        const summary = await migrateGame(source, target, options.apply, options.profile, {
            mode: options.mode,
            source: {
                key: options.sourceKey ?? process.env.LEGACY_SOURCE_KEY?.trim() ?? `legacy-game-${options.profile}`,
                fingerprint: fingerprintMariaConnection(sourceUrl),
            },
        });
        console.log(JSON.stringify(summary, null, 2));
    } finally {
        await source.end();
        await target?.end();
    }
};

run().catch((error: unknown) => {
    const message = (error instanceof Error ? error.message : String(error))
        .replace(/((?:mariadb|mysql|postgres(?:ql)?):\/\/[^:\s/@]+:)[^@\s/]+@/giu, '$1***@')
        .replace(/([?&](?:pass(?:word)?|secret|token)=)[^&\s]+/giu, '$1***');
    console.error(`[legacy-db-migration] ${message}`);
    process.exitCode = 1;
});
