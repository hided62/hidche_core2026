import { DatabaseTurnDaemonLease } from '../../src/lifecycle/databaseTurnDaemonLease.ts';

const databaseUrl = process.env.TURN_DAEMON_LEASE_DATABASE_URL;
const profile = process.env.TURN_DAEMON_LEASE_PROFILE;
const ownerId = process.env.TURN_DAEMON_LEASE_OWNER_ID;
const leaseDurationMs = Number(process.env.TURN_DAEMON_LEASE_DURATION_MS);

if (!databaseUrl || !profile || !ownerId || !Number.isInteger(leaseDurationMs)) {
    throw new Error('lease holder requires database URL, profile, owner, and duration');
}

const lease = await DatabaseTurnDaemonLease.connect(databaseUrl, {
    profile,
    ownerId,
    leaseDurationMs,
    heartbeat: true,
});
const token = await lease.acquire();
if (!token) {
    throw new Error('lease holder could not acquire the profile lease');
}

process.stdout.write(
    `${JSON.stringify({
        profile: token.profile,
        ownerId: token.ownerId,
        fencingEpoch: token.fencingEpoch.toString(),
    })}\n`
);

setInterval(() => undefined, 60_000);
