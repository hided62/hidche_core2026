# Legacy Scenario System

This document explains how scenarios are loaded and how they define the active
rule set, commands, and effects. Core references include
`legacy/hwe/sammo/Scenario.php`, `legacy/hwe/sammo/ResetHelper.php`, and
`legacy/hwe/sammo/GameConstBase.php`.

core2026 리소스는 레거시 JSON 결과를 유지하면서 공통 이벤트와 규칙을
`extends`로 합성할 수 있습니다. 새 시나리오 구성과 합성 순서는
[시나리오 리소스 합성](./scenario-composition.md)을 확인해 주세요.

## Scenario Loading Flow

1. Server reset/init calls `ResetHelper::buildScenario()`.
2. `Scenario` loads `scenario_{id}.json` and merges defaults (`default.json`).
3. `Scenario::buildConf()` generates runtime constants:
    - `d_setting/GameConst.php` from `GameConstBase + scenario.const/map/stat`
    - `d_setting/CityConst.php` from `scenario/map/{mapName}.php`
    - `d_setting/GameUnitConst.php` from `scenario/unit/{unitSet}.php`
4. `Scenario::build()` inserts nations, generals, and events into DB and runs
   `initialEvents` immediately.

`Scenario::getAllScenarios()` is used for listing scenarios without fully
building them (lazy init).

## Scenario JSON Structure (Observed)

Common top-level keys (see `legacy/hwe/scenario/frame.json` and actual
`scenario_*.json` files):

- `title`, `startYear`, `history`, `iconPath`
- `stat`: default stat totals and bounds
- `map`: `mapName`, `unitSet`, `scenarioEffect`
- `const`: overrides for `GameConst` (commands, items, limits, etc.)
- `nation`, `diplomacy`
- `general`, `general_ex`, `general_neutral`
- `events`, `initialEvents`
- `ignoreDefaultEvents` (skip `GameConst::$defaultInitialEvents/$defaultEvents`)

Notes:

- A few files still use `initialActions` or `defaultInitialEvents` keys. The
  engine currently reads `initialEvents` only.
- `general` rows use the tuple format from `Scenario::generateGeneral()`:
  `affinity, name, picture, nationName, city, leadership, strength, intel,
officerLevel, birth, death, ego, char, text`.

## General Icon Paths

Scenario general rows store an explicit path relative to `/image/icons`.
New shared portraits use `장수/<general-name>.<extension>`; scenario-specific
portraits keep their existing directory such as `걸그룹/` or `롤시나리오/`.
This makes active and delayed generals persist the same path without requiring
the legacy image service's runtime `list.json` lookup.

`resources/general-icons.json` records the canonical general name, current
path, retained numeric legacy aliases, and source image. The numeric files in
the image repository remain compatibility aliases for deployed legacy
versions. Run the following from a core2026 checkout whenever scenarios or
portrait assets change:

```sh
pnpm manage:general-icons --image-root /path/to/image --write
pnpm manage:general-icons --image-root /path/to/image
```

The first command synchronizes canonical aliases and scenario paths. The second
is a read-only drift and file-content check. Missing source images stay listed
under the catalog's `unresolved` field and resolve to `default.jpg` when they
were an explicit numeric reference.

## How Scenario Chooses Commands and Effects

Scenario config influences runtime rules via `GameConst` and `ScenarioEffect`:

- `const.availableGeneralCommand` / `const.availableChiefCommand` define the
  commands that appear in UI and can be executed.
- `const.availableSpecialDomestic/War`, `const.availablePersonality`,
  `const.allItems`, `const.availableNationType` control selectable traits/items.
- `map.scenarioEffect` or `const.scenarioEffect` sets
  `GameConst::$scenarioEffect`, which is injected into each `General` as an
  `iAction` (`General::getActionList()`).
- `const.availableInstantAction` merges into
  `GameConst::$availableInstantAction`.

Because `GameConst` is generated from scenario data, a scenario can swap
available commands or replace the action pool entirely.

## Command Prefix Conventions

Prefixes are used to separate rule packs and assets:

- `che_`: default rule set (base commands, specials, items, nation types).
- `cr_`: alternate rule set used by specific scenarios (e.g. `scenario_910`).
- `event_`: scenario-specific extensions (research, extra unit sets, or special
  effects).

Example: `scenario_910.json` uses `mapName=cr` and `unitSet=cr` and overrides
`availableGeneralCommand/availableChiefCommand` to include `cr_건국`,
`cr_맹훈련`, and `cr_인구이동` alongside `che_` commands.

## Scenario Environment Variants (Current Repo)

These are the map/unit/effect variants referenced by existing scenario files.
Defaults are `mapName=che` and `unitSet=che` when not specified.

Map sets (`scenario/map/*.php`):

- `che` (default)
- `miniche`, `miniche_b`, `miniche_clean`
- `cr`
- `chess`
- `pokemon_v1`
- `ludo_rathowm`

Unit sets (`scenario/unit/*.php`):

- `che` (default)
- `che_except_siege`
- `cr`
- `basic`
- `siegetank`
- `event_more_crewtype`
- `ludo_rathowm`

Scenario effects (`sammo/ActionScenarioEffect/*`):

- `event_StrongAttacker`
- `event_UnlimitedDefenceThresholdChange`
- `event_MoreEffect`

## Event Targets

Scenario events are stored in the `event` table and executed via
`TurnExecutionHelper::runEventHandler()` using `EventTarget` values:
`PRE_MONTH`, `MONTH`, `OCCUPY_CITY`, `DESTROY_NATION`, `UNITED`.

Most scenario JSON uses lowercase targets (e.g. `"month"`). The DB enum uses
uppercase values but is case-insensitive, so lowercase targets still match.
