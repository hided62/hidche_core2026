import { resolvePostgresConfigFromEnv, type PostgresConfig } from '@sammo-ts/infra';

export const resolveGatewayPostgresConfigFromEnv = (
    env: NodeJS.ProcessEnv = process.env,
    schema?: string
): PostgresConfig => {
    const gatewayDatabaseUrl = env.GATEWAY_DATABASE_URL?.trim();
    return resolvePostgresConfigFromEnv({
        env: gatewayDatabaseUrl
            ? {
                  ...env,
                  DATABASE_URL: gatewayDatabaseUrl,
              }
            : env,
        schema,
    });
};
