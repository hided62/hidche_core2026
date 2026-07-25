<?php

declare(strict_types=1);

use sammo\LiteHashDRBG;
use sammo\RandUtil;
use sammo\Util;

if ($argc !== 3) {
    fwrite(STDERR, "usage: php neutral-auction.php <ref-root> <json-input>\n");
    exit(2);
}

$refRoot = rtrim($argv[1], '/');
require $refRoot . '/vendor/autoload.php';

$input = json_decode($argv[2], true, flags: JSON_THROW_ON_ERROR);
$rng = new RandUtil(new LiteHashDRBG(Util::simpleSerialize(
    $input['hiddenSeed'],
    'monthly',
    $input['seedYear'],
    $input['seedMonth'],
)));

for ($idx = 0; $idx < max(0, (int)$input['nationCount']); $idx++) {
    $rng->nextRange(0.95, 1.05);
}
if ($input['consumeTournamentRoll']) {
    $rng->nextBool(0.4);
}

$avgGold = Util::valueFit($input['averageGold'], 1000, 20000);
$avgRice = Util::valueFit($input['averageRice'], 1000, 20000);
$result = [];
$appendIfOpenable = static function (array $plan) use (&$result): void {
    if ($plan['closeTurnCnt'] < 1 || $plan['closeTurnCnt'] > 24) {
        return;
    }
    if ($plan['amount'] < 100 || $plan['amount'] > 10000) {
        return;
    }
    if ($plan['startBidAmount'] < $plan['amount'] * 0.5 || $plan['amount'] * 2 < $plan['startBidAmount']) {
        return;
    }
    if ($plan['finishBidAmount'] < $plan['amount'] * 1.1 || $plan['amount'] * 2 < $plan['finishBidAmount']) {
        return;
    }
    if ($plan['finishBidAmount'] < $plan['startBidAmount'] * 1.1) {
        return;
    }
    $result[] = $plan;
};

$buyRiceCount = max(0, (int)$input['buyRiceAuctionCount']);
if ($rng->nextBool(1 / ($buyRiceCount + 5))) {
    $mul = $rng->nextRangeInt(1, 5);
    $amount = $avgRice / 20 * $mul;
    $cost = $avgGold / 20 * 0.9 * $mul;
    $topv = $amount * 2;
    $cost = Util::valueFit($cost, $amount * 0.8, $amount * 1.2);
    $appendIfOpenable([
        'auctionType' => 'BUY_RICE',
        'amount' => Util::round($amount, -1),
        'startBidAmount' => Util::round($cost, -1),
        'finishBidAmount' => Util::round($topv, -1),
        'closeTurnCnt' => $rng->nextRangeInt(3, 12),
    ]);
}

$sellRiceCount = max(0, (int)$input['sellRiceAuctionCount']);
if ($rng->nextBool(1 / ($sellRiceCount + 5))) {
    $mul = $rng->nextRangeInt(1, 5);
    $amount = $avgGold / 20 * $mul;
    $cost = $avgRice / 20 * 1.1 * $mul;
    $topv = $amount * 2;
    $cost = Util::valueFit($cost, $amount * 0.8, $amount * 1.2);
    $appendIfOpenable([
        'auctionType' => 'SELL_RICE',
        'amount' => Util::round($amount, -1),
        'startBidAmount' => Util::round($cost, -1),
        'finishBidAmount' => Util::round($topv, -1),
        'closeTurnCnt' => $rng->nextRangeInt(3, 12),
    ]);
}

echo json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), PHP_EOL;
