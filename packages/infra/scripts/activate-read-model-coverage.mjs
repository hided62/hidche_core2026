import {
    activateReadModelRevisionCoverage,
    createGamePostgresConnector,
    resolvePostgresConfigFromEnv,
} from '../dist/index.js';

const main = async () => {
    const profile = process.env.READ_MODEL_COVERAGE_PROFILE?.trim();
    const expectedConfirm = profile ? `activate:${profile}:coverage-v1` : '';
    if (!profile || process.env.READ_MODEL_COVERAGE_CONFIRM !== expectedConfirm) {
        throw new Error('confirmation');
    }
    if (!/^[a-zA-Z0-9_-]+$/u.test(profile)) {
        throw new Error('profile');
    }

    const connector = createGamePostgresConnector(resolvePostgresConfigFromEnv({ schema: profile }));
    try {
        await connector.connect();
        const result = await connector.prisma.$transaction((transaction) =>
            activateReadModelRevisionCoverage(transaction)
        );
        process.stdout.write(
            `${JSON.stringify({
                profile,
                previousVersion: result.previousVersion,
                coverageVersion: result.coverageVersion,
                seededHeads: result.seededHeads,
            })}\n`
        );
    } finally {
        await connector.disconnect();
    }
};

await main().catch(() => {
    process.stderr.write(
        'Read-model coverage activation failed. Check the profile confirmation, built infra package, database connectivity, and current coverage version.\n'
    );
    process.exitCode = 1;
});
