#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { createMariaPool, createPostgresPool } from './db.js';
import { migrateGame } from './game.js';
import { migrateGateway } from './gateway.js';
import { hashPasswordForReset } from './password.js';

type Command = 'gateway' | 'game' | 'reset-password';

interface CliOptions {
    command: Command;
    apply: boolean;
    profile?: string;
    loginId?: string;
    passwordFile?: string;
}

const usage = `Usage:
  pnpm --filter @sammo-ts/legacy-db-migration migrate gateway [--apply]
  pnpm --filter @sammo-ts/legacy-db-migration migrate game --profile <profile> [--apply]
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
    if (command !== 'gateway' && command !== 'game' && command !== 'reset-password') {
        throw new Error(usage);
    }
    const options: CliOptions = { command, apply: false };
    for (let index = 1; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--apply') {
            options.apply = true;
            continue;
        }
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            throw new Error(`Missing value for ${argument}\n\n${usage}`);
        }
        if (argument === '--profile') {
            options.profile = next;
        } else if (argument === '--login-id') {
            options.loginId = next;
        } else if (argument === '--password-file') {
            options.passwordFile = next;
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

const resetPassword = async (options: CliOptions): Promise<Record<string, unknown>> => {
    if (!options.apply) {
        throw new Error('reset-password requires --apply');
    }
    if (!options.loginId || !options.passwordFile) {
        throw new Error(`reset-password requires --login-id and --password-file\n\n${usage}`);
    }
    const passwordPath = path.resolve(options.passwordFile);
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
             SET "password_hash" = $1, "password_salt" = $2, "updated_at" = CURRENT_TIMESTAMP
             WHERE "id" = $3`,
            [hashed.hash, hashed.salt, existing.rows[0]!.id]
        );
        return { command: 'reset-password', updated: 1, loginId: options.loginId.toLowerCase() };
    } finally {
        await pool.end();
    }
};

const run = async (): Promise<void> => {
    const options = parseArguments(process.argv.slice(2));
    if (options.command === 'reset-password') {
        console.log(JSON.stringify(await resetPassword(options), null, 2));
        return;
    }

    const migratedAt = new Date();
    if (options.command === 'gateway') {
        const source = createMariaPool(requireEnvironment('LEGACY_ROOT_DATABASE_URL'));
        const target = options.apply ? createPostgresPool(requireEnvironment('GATEWAY_DATABASE_URL')) : null;
        try {
            const summary = await migrateGateway(source, target, options.apply, migratedAt);
            console.log(JSON.stringify(summary, null, 2));
        } finally {
            await source.end();
            await target?.end();
        }
        return;
    }

    if (!options.profile || !/^[a-z][a-z0-9_-]{1,31}$/.test(options.profile)) {
        throw new Error(`game requires a safe --profile value\n\n${usage}`);
    }
    const source = createMariaPool(requireEnvironment('LEGACY_GAME_DATABASE_URL'));
    const target = options.apply ? createPostgresPool(requireEnvironment('GAME_DATABASE_URL')) : null;
    try {
        const summary = await migrateGame(source, target, options.apply, options.profile);
        console.log(JSON.stringify(summary, null, 2));
    } finally {
        await source.end();
        await target?.end();
    }
};

run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[legacy-db-migration] ${message}`);
    process.exitCode = 1;
});
