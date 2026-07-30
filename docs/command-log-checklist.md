Compare command logs (mode: action, strict: off, keepDate: off, excludeGuards: on, excludeTarget: on, countSensitive: off)
PHP commands: 87
TS commands: 84
Matched commands: 87
Mismatched commands: 0
Missing in TS: 0
Missing in PHP: 0
Ignored mismatches: 17

Shared TS log implementations excluded from per-command extraction:
- Nation/che_불가침수락: logs are emitted by
  `packages/logic/src/diplomacy/instantResponse.ts` and verified by
  `instantDiplomacyReference.integration.test.ts`.
- Nation/che_불가침파기수락: logs are emitted by
  `packages/logic/src/diplomacy/instantResponse.ts` and verified by
  `instantDiplomacyReference.integration.test.ts`.
- Nation/che_종전수락: logs are emitted by
  `packages/logic/src/diplomacy/instantResponse.ts` and verified by
  `instantDiplomacyReference.integration.test.ts`.

# Command Log Checklist

Mode: action
Strict: off
Keep date: off
Exclude guards: on
Exclude target: on
Ignore file: tools/compare-command-logs.ignore.json

- [x] All command logs match.
