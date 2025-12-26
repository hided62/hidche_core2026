# Architecture TODOs

This list tracks optional extensions and follow-up items for documentation.
Move items into the main docs once they are finalized.

## Runtime and Operations

- Turn daemon scheduling details and preemption rules
- Turn daemon vs API server priority policy under load
- In-memory state lifecycle and DBMS flush checkpoints
- Recovery behavior after partial flush or crash
- Observability: metrics, logs, and alerts for turn processing

## Game Logic and Testing

- Input snapshot format (seed, scenario, trigger inputs, game time)
- Output comparison rules (sorting, tolerances, diff granularity)
- Unit test vs simulation test split and responsibilities
- Deterministic RNG test harness guidelines

## Trigger System

- Trigger evaluation order and priority conflicts
- Composition rules across traits, specials, and scenario effects
- Example trigger sets per scenario or rule pack

## Data and Profiles

- "Next-turn intent" (예턴) data schema and lifecycle
- Profile selection workflow and deployment mapping
