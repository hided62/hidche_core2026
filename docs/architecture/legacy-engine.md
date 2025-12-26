# Legacy Engine Map

The legacy engine lives in `legacy/hwe/sammo/` and follows domain-first
organization rather than endpoint-first routing.

## Core Domains

- `Command/`: turn actions (general/nation commands) and resolution rules
- `API/`: engine operations for UI and automation
- `Event/`, `StaticEvent/`: dynamic and scheduled event processing
- `General*`, `Nation*`, `WarUnit*`, `City*`: entities and combat/city state
- `Action*`, `Special*`: traits, personalities, special actions, scenario effects
- `Trigger*`, `*Trigger`: conditional logic and state transitions
- `Scenario/`, `Scenario.php`: scenario loading and rulesets
- `DTO/`, `VO/`, `Enums/`, `Constraint/`: shared types and validation

## Endpoint Patterns

- JSON APIs: `legacy/hwe/j_*.php`
- Vue multi-entry pages: `legacy/hwe/v_*.php`
- PHP + jQuery pages: `legacy/hwe/b_*.php` and handlers `legacy/hwe/c_*.php`
- Modern router: `legacy/hwe/api.php` dispatches into `legacy/hwe/API/`

## Frontend and Assets

- Vue/TypeScript UI: `legacy/hwe/ts/`
- Shared components: `legacy/hwe/ts/components/`
- Styles: `legacy/css/` and `legacy/hwe/scss/`
- Templates: `legacy/hwe/templates/`

## Trigger Composition for Generals (Outline)

- Trigger evaluation order and priority rules
- "attempt" then "execute" phases
- Common trigger categories (traits, specials, scenario effects)
- How triggers combine when multiple sources apply
