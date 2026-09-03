import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'packages/infra/prisma/game.prisma');
const inventoryPath = path.join(root, 'docs/architecture/game-clock-participants.json');
const [schema, inventoryText] = await Promise.all([readFile(schemaPath, 'utf8'), readFile(inventoryPath, 'utf8')]);
const inventory = JSON.parse(inventoryText);
const covered = new Set(inventory.coveredFields ?? []);
const policies = new Set(inventory.policies ?? []);
const failures = [];
const participantKeys = new Set();

if (inventory.tickPerTurn !== 36_000_000) {
    failures.push(`tickPerTurn must remain 36000000, found ${inventory.tickPerTurn}`);
}

const discovered = [];
for (const modelMatch of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const [, modelName, body] = modelMatch;
    const table = body.match(/@@map\("([^"]+)"\)/)?.[1] ?? modelName;
    for (const fieldMatch of body.matchAll(/^\s*(\w+)\s+BigInt\??[^\n]*@map\("([^"]+)"\)/gm)) {
        const databaseField = fieldMatch[2];
        if (
            databaseField.endsWith('_tick') ||
            databaseField === 'clock_revision' ||
            databaseField === 'deadline_generation' ||
            (table.startsWith('clock_') && databaseField.endsWith('_revision'))
        ) {
            discovered.push(`${table}.${databaseField}`);
        }
    }
}

for (const field of discovered) {
    if (!covered.has(field)) {
        failures.push(`unregistered authoritative clock field: ${field}`);
    }
}
for (const participant of inventory.participants ?? []) {
    if (participantKeys.has(participant.key)) {
        failures.push(`duplicate participant key: ${participant.key}`);
    }
    participantKeys.add(participant.key);
    if (!policies.has(participant.policy)) {
        failures.push(`participant ${participant.key} has unknown policy ${participant.policy}`);
    }
    if (participant.policy === 'FORBID') {
        failures.push(`active participant must not remain FORBID: ${participant.key}`);
    }
    if (!participant.owner || !Array.isArray(participant.authorityFields)) {
        failures.push(`participant ${participant.key} is missing owner or authorityFields`);
    }
}
for (const requiredKey of [
    'world-clock',
    'turn-cursor',
    'general-next-turn',
    'general-recent-war-occurrence',
    'auction-open-occurrence',
    'auction-deadline',
    'auction-finalizing-recovery',
    'message-occurrence',
    'message-expiry',
    'vote-start-occurrence',
    'vote-end-deadline',
    'select-pool-reservation',
    'npc-selection-window',
    'accepted-command-coordinate',
    'tournament-deadlines',
    'movable-json-rule-anchors',
    'unification-wait',
    'clock-operation-ledger',
]) {
    if (!participantKeys.has(requiredKey)) {
        failures.push(`required participant is missing: ${requiredKey}`);
    }
}

const redisKeyPatterns = new Set();
for (const entry of inventory.redis ?? []) {
    if (!entry.keyPattern) {
        failures.push('Redis participant is missing keyPattern');
        continue;
    }
    if (redisKeyPatterns.has(entry.keyPattern)) {
        failures.push(`duplicate Redis participant: ${entry.keyPattern}`);
    }
    redisKeyPatterns.add(entry.keyPattern);
    if (!policies.has(entry.policy) || entry.policy === 'FORBID') {
        failures.push(`Redis participant ${entry.keyPattern} has invalid policy ${entry.policy}`);
    }
    if (typeof entry.status !== 'string' || !entry.status.startsWith('implemented-')) {
        failures.push(`Redis participant ${entry.keyPattern} is not implemented: ${entry.status ?? 'missing status'}`);
    }
}
for (const requiredKeyPattern of [
    'sammo:{profile}:clock:active-revision',
    'sammo:{profile}:auction:timer',
    'sammo:{profile}:tournament:state',
]) {
    if (!redisKeyPatterns.has(requiredKeyPattern)) {
        failures.push(`required Redis participant is missing: ${requiredKeyPattern}`);
    }
}

if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
} else {
    console.log(
        `Validated ${discovered.length} authoritative clock fields and ${inventory.participants.length} participants.`
    );
}
