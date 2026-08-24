import { describe, expect, it } from 'vitest';

import { PnpmBuildRunner } from '../src/orchestrator/buildRunner.js';
import { buildProfileMigrationPreflightCommand } from '../src/orchestrator/gatewayOrchestrator.js';

const utcDatabaseUrl = process.env.PROFILE_MIGRATION_UTC_DATABASE_URL?.trim();

describe('profile migration timezone preflight', () => {
    it.skipIf(!utcDatabaseUrl)('rejects an actual database role whose default session timezone is UTC', async () => {
        if (!utcDatabaseUrl) throw new Error('PROFILE_MIGRATION_UTC_DATABASE_URL is required');
        const path = process.env.PATH;
        if (!path) throw new Error('PATH is required');
        const command = buildProfileMigrationPreflightCommand(process.cwd(), utcDatabaseUrl, { PATH: path });

        const result = await new PnpmBuildRunner().run([command]);

        expect(result.ok).toBe(false);
        expect(result.output).toContain('database session TimeZone does not match the required migration contract');
        expect(result.output).not.toContain(utcDatabaseUrl);
        const password = decodeURIComponent(new URL(utcDatabaseUrl).password);
        if (password) expect(result.output).not.toContain(password);
    });
});
