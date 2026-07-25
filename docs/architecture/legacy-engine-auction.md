# Legacy Auctions and Betting

This document covers the auction and betting systems: how auctions open/close,
what resources they trade, and how betting payouts are calculated. References
include `legacy/hwe/sammo/Auction*.php`, `legacy/hwe/func_auction.php`, and
`legacy/hwe/sammo/Betting.php`.

## Auction Types and Entry Points

- `Auction` (base class): shared bid logic and close-date extensions.
- `AuctionBuyRice`: sell rice for gold.
- `AuctionSellRice`: sell gold for rice.
- `AuctionUniqueItem`: bids use inheritance points for unique items.
- `processAuction()` in `legacy/hwe/func_auction.php` closes finished auctions.
- `registerAuction()` creates neutral (NPC-hosted) buy/sell auctions.

## Auction Data Model

Primary tables:

- `ng_auction`: auction metadata (type, target, host, close date, detail).
- `ng_auction_bid`: per-bid rows for each auction.

The `AuctionInfo` and `AuctionInfoDetail` DTOs are serialized into
`ng_auction` columns for structured access.

## Core Auction Flow

1. **Open**
    - `AuctionBasicResource::openResourceAuction()` validates amounts and
      host resources, then inserts `ng_auction`.
    - `AuctionUniqueItem::openItemAuction()` checks availability, reserves
      unique items, and posts a global history notice.
2. **Bid**
    - Bids are inserted into `ng_auction_bid` and can extend the close date.
    - Reverse auctions (when `detail->isReverse`) sort by lowest bid.
3. **Close** (`tryFinish()` from the concrete auction)
    - If no bids: `rollbackAuction()` returns resources to host and logs.
    - With bids: `finishAuction()` transfers resources, logs, and sends messages.
4. **Processing**
    - `processAuction()` scans auctions past `close_date` and finishes them.

## Unique Item Auctions

- Currency: inheritance points (`ResourceType::inheritancePoint`).
- Host identity is obfuscated using `genObfuscatedName()` and a deterministic
  shuffled name pool stored in `game_env.obfuscatedNamePool`.
- Limits and availability are enforced against `GameConst::$allItems` and
  existing ownership in `general` rows.

## Betting System

Betting is an independent KV-backed system:

- `Betting::openBetting()` stores `BettingInfo` in KV storage (`betting`).
- `Betting::bet()` inserts or updates `ng_betting` rows and charges either
  gold or inheritance points.
- `Betting::giveReward()` distributes payouts to winners (exclusive or shared).

Event actions controlling lifecycle:

- `OpenNationBetting`: opens a nation-strength bet and registers a
  `DESTROY_NATION` event to close it.
- `FinishNationBetting`: evaluates winners when only N nations remain.

## RNG Notes

- `Auction::genObfuscatedName()` uses `hiddenSeed + 'obfuscatedNamePool'` to
  shuffle the name pool once and reuse it from `game_env`.
- `registerAuction()` relies on an injected RNG to randomize neutral auctions.

## Open Questions / Follow-ups

- `registerAuction()` is called from legacy `func_gamerule.php` during the
  monthly game-rule pass. Player-hosted auctions are implemented in core2026;
  neutral merchant auction generation remains a separate compatibility item.
- Scenario-specific overrides of unique auction timing have not been found.
  Core2026 currently applies the legacy constants against `tickSeconds`.

## core2026 compatibility implementation (2026-07-25)

| Contract | core2026 path | Status |
| --- | --- | --- |
| Resource auction list/open/bid | `game-frontend/AuctionView.vue` → `game-api/router/auction` → `auctionOpen`/`auctionBid` engine commands | Confirmed by integration test |
| Resource reservation/refund/settlement | opener reserves host gold/rice; bidder reserves and refunds the previous top bid; finalizer transfers or returns resources | Confirmed by integration test |
| Unique list/detail privacy | API replaces host and bidder identity with deterministic aliases and never returns unique-auction general IDs | Confirmed by API implementation and typecheck |
| Unique open | engine validates configured quantity, slot ownership, one active host/item auction, and atomically inserts the host's first bid while deducting `inheritance_point.previous` | Confirmed by integration test |
| Unique bid | row-locked auction, minimum `max(1%, 10)`, conditional point deduction, previous-top-bid refund, slot/top-bid conflict checks | Confirmed by integration test |
| Unique finalization | requested extension, per-slot and total ownership-limit extension, host neutralization, item inventory update | Confirmed by integration test |
| Timer/worker | API updates the Redis timer after open/bid; existing scheduler claims due rows and sends durable `auctionFinalize` commands | Confirmed by integration test for timer seed and durable command finalization |
| Neutral merchant registration | legacy monthly probabilistic `registerAuction()` | Not implemented |

Unique auction mutations deliberately run in the turn-engine database
transaction. Point reads use row locks and deductions use conditional updates,
so simultaneous requests cannot spend the same previous-season inheritance
points twice. A failed open command creates neither an auction nor an orphaned
inheritance request marker.
