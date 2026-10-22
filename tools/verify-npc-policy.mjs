import { spawnSync } from 'node:child_process';

// 개발 전용 .env.ci를 node --env-file로 전달한다. 매번 새 schema를 만들며
// 기존 게임 schema·Redis key를 초기화하거나 volume을 삭제하지 않는다.
for (const key of [
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_DB',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'REDIS_URL',
]) {
    if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
}
const schema = `ci_${Date.now()}_${process.pid}_npc_policy_fixture`;
const url = new URL('postgresql://localhost');
url.hostname = process.env.POSTGRES_HOST;
url.port = process.env.POSTGRES_PORT;
url.username = process.env.POSTGRES_USER;
url.password = process.env.POSTGRES_PASSWORD;
url.pathname = `/${process.env.POSTGRES_DB}`;
url.searchParams.set('schema', schema);
const env = { ...process.env, DATABASE_URL: url.href, NPC_POLICY_DATABASE_URL: url.href, POSTGRES_SCHEMA: schema };
console.info(`NPC policy verification schema: ${schema}`);
for (const args of [
    ['--filter', '@sammo-ts/infra', 'prisma:migrate:deploy:game'],
    ['--filter', '@sammo-ts/infra', 'prisma:migrate:deploy:game'],
    ['--filter', '@sammo-ts/game-api', 'test', 'npcPolicyLifecycle.integration.test.ts'],
]) {
    const result = spawnSync('pnpm', args, { env, stdio: 'inherit' });
    if (result.error) throw new Error(`Could not start verification command: ${result.error.code}`);
    if (result.status !== 0) process.exit(result.status ?? 1);
}
