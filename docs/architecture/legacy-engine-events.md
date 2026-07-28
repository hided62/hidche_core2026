# Legacy Event System

This document summarizes how the legacy event system executes scenario- and
turn-based events, and how static event hooks are wired into commands. Primary
references include `legacy/hwe/sammo/TurnExecutionHelper.php`,
`legacy/hwe/sammo/Event/*`, and `legacy/hwe/sammo/StaticEventHandler.php`.

## Entry Points

- `TurnExecutionHelper::runEventHandler(EventTarget $eventTarget)`
    - Loads `event` table rows by target and priority, evaluates conditions, and
      runs actions.
- `StaticEventHandler::handleEvent(...)`
    - Invoked by many commands and API handlers to run per-action static hooks.

## Event Table Schema

`event` rows are stored in the legacy DB schema (`legacy/hwe/sql/schema.sql`):

- `id`: auto-increment primary key
- `target`: enum of `PRE_MONTH`, `MONTH`, `OCCUPY_CITY`, `DESTROY_NATION`, `UNITED`
- `priority`: higher first (default 1000)
- `condition`: JSON array (condition DSL)
- `action`: JSON array (action DSL)

Indexes: `(target, priority, id)` for dispatch ordering. Both `condition` and
`action` are JSON-validated by DB constraints.

## Event Table Dispatch

`runEventHandler()` drives the dynamic event pipeline:

1. Query `event` rows with `target = {PRE_MONTH|MONTH|OCCUPY_CITY|DESTROY_NATION|UNITED}`
   (ordered by `priority DESC, id ASC`).
2. Decode `condition` and `action` JSON.
3. Build a `Event\EventHandler` with condition + action lists.
4. Execute `tryRunEvent($env)` where `$env` is `game_env` KV storage plus
   `currentEventID`.

Events are used inside the monthly pipeline and in special moments like
city occupation (`EventTarget::OCCUPY_CITY`, called by some commands).

### Rewrite runtime status

`app/game-engine/src/turn/monthlyEventHandler.ts` now dispatches persisted
`event` rows for `pre_month` and `month`. It preserves the legacy
`priority DESC, id ASC` order, evaluates `Date`, `DateRelative`, `RemainNation`,
and the boolean logic operators, and records `DeleteEvent` through the normal
turn dirty-state transaction.

The calendar calls `pre_month` before changing the world date and `month`
after changing it. Action names are resolved through an explicit registry.
An unported action stops the turn with its action name and event id instead of
being silently ignored. The runtime registry currently covers
`ProcessIncome`, `NoticeToHistoryLog`, `NewYear`, and `ResetOfficerLock`;
the remaining legacy action catalog must be migrated before full event-action
parity can be claimed.

## Condition and Action DSL

`Event\Condition::build()` and `Event\Action::build()` decode JSON arrays into
class instances:

- **Condition**
    - Supports logic combinators (`and`, `or`, `xor`, `not`) via
      `Event\Condition\Logic`.
    - Built-in condition types include:
        - `Date`, `DateRelative`, `Interval`
        - `RemainNation`
        - `ConstBool`
    - Conditions return `{ value, chain }` for tracing.

- **Action**
    - Actions are classes under `Event/Action/` with `run(array $env)`.
    - The dispatcher instantiates them from `action` arrays like
      `['ProcessIncome', 'gold']`.

## Common Event Actions (Examples)

These are the action modules observed in the legacy tree:

- **Economy & upkeep**: `ProcessIncome`, `ProcessSemiAnnual`, `ProcessWarIncome`
- **World state**: `UpdateCitySupply`, `UpdateNationLevel`, `RandomizeCityTradeRate`
- **NPC/Invader flow**: `RaiseInvader`, `RaiseNPCNation`, `ProvideNPCTroopLeader`
- **Betting & unique items**: `OpenNationBetting`, `FinishNationBetting`,
  `LostUniqueItem`, `MergeInheritPointRank`
- **Event lifecycle**: `DeleteEvent`, `NoticeToHistoryLog`

All action execution uses the event environment (`year`, `month`, `startyear`,
`turnterm`, etc.) coming from `game_env`.

## Static Events (Command Hooks)

Static events are hooks triggered directly by commands/APIs:

- `StaticEventHandler::handleEvent()` looks up handler names from
  `GameConst::$staticEventHandlers[$eventType]`.
- Handlers live under `legacy/hwe/sammo/StaticEvent/` and implement
  `BaseStaticEvent::run()`.
- These hooks are used to extend command behavior without modifying the
  command code itself (e.g., troop join/exit side effects).

### Static Handler Map Sources

`GameConst::$staticEventHandlers` defaults to an empty array in
`legacy/hwe/sammo/GameConstBase.php`. Scenario JSON can override it:

- `legacy/hwe/scenario/scenario_911.json` (only observed override in repo)
    - `sammo\\API\\Troop\\JoinTroop` → `event_부대탑승즉시이동`
    - `sammo\\Command\\Nation\\che_발령` → `event_부대발령즉시집합`

Static handler names should map to classes in `legacy/hwe/sammo/StaticEvent/`
(class name matches handler key).

## RNG Notes

Dynamic event actions can use deterministic RNG by constructing
`LiteHashDRBG` with `UniqueConst::$hiddenSeed` and an event-specific tag.
Examples include `RandomizeCityTradeRate` and `UpdateNationLevel`.

core2026의 authoritative game-state 계산에서는 `Math.random()`을 사용하지
않는다. 레거시 PHP 전역 `shuffle()`을 사용하던 다음 경로도 입력별 독립
`LiteHashDRBG` substream으로 고정한다.

- `RaiseNPCNation`: `hiddenSeed, "RaiseNPCNation", year, month,
  "emptyCities"`
- `RaiseInvader`: `hiddenSeed, "RaiseInvader", year, month,
  "martialDex"`
- 빈 tournament pattern: `hiddenSeed, "monthly", previousYear,
  previousMonth, "tournamentPattern"`
- scenario general 사망월: scenario title/start year, source group,
  general id/name/death year와 `"deathMonth"`

독립 substream을 쓰는 이유는 레거시 전역 shuffle의 비결정성만 제거하고
이미 호환 검증된 action/monthly RNG의 후속 소비 위치는 바꾸지 않기
위해서다. 테스트는 해당 경로에서 `Math.random()`을 호출하면 즉시
실패한다. 인증 token, request/event correlation ID 같은 보안·운영 식별자의
`crypto` RNG와 사용자가 랜덤 능력치 버튼으로 만드는 클라이언트 입력은
이 게임-state 재현 계약과 구분한다.

root ESLint 설정도 `app/game-engine/src`와 `packages/logic/src`에서
`Math.random` property 사용을 오류로 처리하므로 새 authoritative 경로가
같은 결함을 다시 도입할 수 없다.

## Open Questions / Follow-ups

- `Event\Engine` is a stub with a TODO; it is not currently used in the main
  turn pipeline.
- Verify whether any runtime code injects additional static handlers beyond
  scenario JSON overrides.
