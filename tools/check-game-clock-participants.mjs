import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'packages/infra/prisma/game.prisma');
const inventoryPath = path.join(root, 'docs/architecture/game-clock-participants.json');
const [schema, inventoryText] = await Promise.all([
    readFile(schemaPath, 'utf8'),
    readFile(inventoryPath, 'utf8'),
]);
const inventory = JSON.parse(inventoryText);
const covered = new Set(inventory.coveredFields ?? []);
const policies = new Set(inventory.policies ?? []);
const failures = [];

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
    if (!policies.has(participant.policy)) {
        failures.push(`participant ${participant.key} has unknown policy ${participant.policy}`);
    }
    if (!participant.owner || !Array.isArray(participant.authorityFields)) {
        failures.push(`participant ${participant.key} is missing owner or authorityFields`);
    }
}
for (const requiredKey of [
    'world-clock',
    'turn-cursor',
    'general-next-turn',
    'auction-deadline',
    'message-expiry',
    'vote-end-deadline',
    'select-pool-reservation',
    'npc-selection-window',
    'tournament-deadlines',
    'unification-wait',
]) {
    if (!(inventory.participants ?? []).some((participant) => participant.key === requiredKey)) {
        failures.push(`required participant is missing: ${requiredKey}`);
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
