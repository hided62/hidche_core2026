# Battle differential fixtures

`basic-infantry.json` is the tracked, deterministic smoke fixture for the Ref ↔ Core battle comparator. Every fixture must explicitly provide a positive integer `city` for the attacker and every defender. The attacker city must equal `attackerCity.city`; each defender city must equal `defenderCity.city`. The runner rejects omitted or inconsistent current-city state before invoking either engine.

The captured corpus test is intentionally conditional. It is skipped unless `BATTLE_CORPUS_PATH` points to an existing JSONL fixture corpus; this repository does not generate or silently substitute a corpus. Each corpus row is validated by the same city contract.

Reference execution can use an already instrumented container through `REF_COMPARE_CONTAINER`, or an instrumentation checkout through `REF_COMPARE_SOURCE_ROOT`. Source-root execution creates only a temporary bind-mounted copy. It discovers the single network of the official reference Compose PHP service, or accepts an existing network named by `REF_COMPARE_NETWORK`. Missing or ambiguous networks fail closed. The runner never removes Compose containers, networks, volumes, or databases.

The Ref trace runner seeds `year`, `month`, and `startyear` only in KVStorage's process-local cache. This is required for legacy battle items that read the game clock from `game_env`; it keeps their fixture time deterministic without writing to the shared reference database.

Precomputed traces are accepted only when `BATTLE_REFERENCE_TRACE_PATH` is accompanied by `BATTLE_REFERENCE_MANIFEST_PATH`, or by a sibling `<trace>.manifest.json`. Manifest schema version 1 requires:

```json
{
    "schemaVersion": 1,
    "fixtureCount": 0,
    "fixtureJsonlSha256": "sha256 of normalized fixture JSONL",
    "traceCount": 0,
    "traceJsonlSha256": "sha256 of the exact trace file bytes"
}
```

Counts and hashes must match exactly. Every trace row must also carry `fixtureIdentity.schemaVersion`, the exact fixture `seed`, and the SHA-256 of that fixture row. Missing, reordered, truncated, appended, or stale trace data is rejected.
