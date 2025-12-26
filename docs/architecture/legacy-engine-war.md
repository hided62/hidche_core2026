# Legacy Battle and War Resolution

This document summarizes the legacy battle pipeline centered on
`legacy/hwe/process_war.php`, `legacy/hwe/sammo/WarUnit.php`,
`legacy/hwe/sammo/WarUnitGeneral.php`, and `legacy/hwe/sammo/WarUnitCity.php`.

## Entry Point: `processWar`

Inputs:

- `warSeed` (string): battle RNG seed
- `attackerGeneral`: `General`
- `rawAttackerNation`: nation row (snapshot)
- `rawDefenderCity`: city row (snapshot)

Setup steps:

1. Initialize RNG with `warSeed` (`LiteHashDRBG`).
2. Load defender nation row (or default neutral nation if `nation = 0`).
3. Build `WarUnitGeneral` (attacker) and `WarUnitCity` (defender city).
4. Collect defender generals in the city, filter with `extractBattleOrder()`.
5. Optionally append city as defender if city order > 0.
6. Sort defenders by battle order, iterate via `getNextDefender()`.
7. Run `processWar_NG()`; update DB and nation/city stats.

## Battle Order (`extractBattleOrder`)

For defender generals:

- Must have crew > 0
- Must have rice > crew/100
- `train` and `atmos` must meet `defence_train`
- Battle order uses:
  - `totalStat = (realStat + fullStat) / 2`
  - `totalCrew = crew / 1_000_000 * (train * atmos) ^ 1.5`
  - `totalStat + totalCrew / 100`

For cities:

- Uses attacker `onCalcOpposeStat('cityBattleOrder', -1)`.

## Battle Loop (`processWar_NG`)

1. Log start, include seed in battle logs.
2. If no defenders remain, set defender = city and switch to siege.
3. **Initial engagement**
   - `setOppose()` for attacker/defender
   - `addTrain(1)` for both
   - Fire battle-init triggers
4. **Per phase**
   - `beginPhase()` computes war power
   - Fire battle-phase triggers
   - `calcDamage()` on both sides
   - Clamp damage if it exceeds HP ratios
   - Apply damage, increase killed/dead counters
   - Log phase results
5. **Continuation checks**
   - `continueWar()` fails on no rice or HP <= 0
   - On retreat/defeat: log, apply win/lose, try wound
   - If defender removed, move to next defender (or city siege)
6. **Finish**
   - `logBattleResult()` for last phase if needed
   - `finishBattle()` for attacker/defender
   - City conflict tracking and history logs

## Post-Battle Updates (`processWar`)

After `processWar_NG()`:

- Apply attacker DB updates
- Update nation rice (supply and siege rules)
- Distribute city `dead` counts (40% attacker city, 60% defender city)
- Increase nation tech based on killed/dead and nation size adjustments
- Update `diplomacy.dead` for both sides
- If city conquered: call `ConquerCity()`

## `WarUnitGeneral` Highlights

- Train/atmos bonuses depend on city level and attacker/defender role.
- War power:
  - Base attack/defence from crew type + tech
  - Adjusted by train/atmos, dex (`getDex()`), crew type coefficients
  - Experience level scales war power and counter-scales opponent
  - `General::getWarPowerMultiplier()` applies special multipliers
- Rice consumption on kills: proportional to damage, tech cost, unit rice
- Wound chance: 5% unless `부상무효` / `퇴각부상무효` triggered
- `finishBattle()` updates rank stats, rounds values, and checks stat changes

## `WarUnitCity` Highlights

- Uses `DummyGeneral` with `CREWTYPE_CASTLE`
- HP = `def * 10`
- Computed attack/defence = `(def + wall * 9) / 500 + 200`
- City train/atmos scales with elapsed years since `startYear`
- Siege state:
  - Non-siege battle ends after one exchange
  - Siege continues until HP <= 0
- `heavyDecreaseWealth()` halves `agri/comm/secu` on supply-based rout
- `addConflict()` records contribution in `city.conflict` JSON

## Deterministic RNG

- Main battle uses `warSeed` directly.
- City conquest uses `hiddenSeed + 'ConquerCity' + year + month + nationID + generalID + cityID`.

## Open Questions / Follow-ups

- Detailed conquest outcomes (nation collapse, officer handling) extend beyond
  the summary here; see `ConquerCity()` in `legacy/hwe/process_war.php`.
