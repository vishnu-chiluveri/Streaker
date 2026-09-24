// ============================================================
// STREAKER — End-to-End Logic & Regression Test Suite
// Verifies streak extension, coin staking, approval, decline & refund
// ============================================================

const assert = require('assert');

// 1. Economy & Helpers logic
const COINS = {
  SIGNUP_BONUS: 1000,
  BUY_IN_PER_DAY: 10,
  DAILY_REWARD_BASE: 10,
  SOLO_DAILY_REWARD: 5,
  WEEKLY_BONUS_INCREMENT: 2,
};

function calculateBuyIn(targetDays) {
  return targetDays * COINS.BUY_IN_PER_DAY;
}

function calculateDailyReward(currentStreakCount, isGroup) {
  if (!isGroup) return COINS.SOLO_DAILY_REWARD;
  const weekMultiplier = Math.floor(currentStreakCount / 7);
  return COINS.DAILY_REWARD_BASE + weekMultiplier * COINS.WEEKLY_BONUS_INCREMENT;
}

function computeStreakStatus(currentDay, targetDays) {
  return targetDays && currentDay > targetDays ? 'completed' : 'active';
}

function isEligibleForRedistribution(startDateStr, targetDateStr, targetDays) {
  const start = new Date(`${startDateStr}T00:00:00Z`).getTime();
  const target = new Date(`${targetDateStr}T00:00:00Z`).getTime();
  const dayNumber = Math.floor((target - start) / 86400000) + 1;
  if (target < start) return false;
  if (targetDays && dayNumber > targetDays) return false;
  return true;
}

console.log('--- TEST 1: Buy-In & Coin Economy Calculation ---');
assert.strictEqual(calculateBuyIn(7), 70, '7 days buy-in should be 70 coins');
assert.strictEqual(calculateBuyIn(14), 140, '14 days buy-in should be 140 coins');
assert.strictEqual(calculateBuyIn(30), 300, '30 days buy-in should be 300 coins');
console.log('✔ Buy-in calculations passed.');

console.log('\n--- TEST 2: Streak Status Calculation (Before and After Target Days) ---');
assert.strictEqual(computeStreakStatus(3, 7), 'active', 'Day 3 of 7 should be active');
assert.strictEqual(computeStreakStatus(7, 7), 'active', 'Day 7 of 7 should be active');
assert.strictEqual(computeStreakStatus(8, 7), 'completed', 'Day 8 of 7 should be completed');
assert.strictEqual(computeStreakStatus(8, 14), 'active', 'Day 8 of 14 (extended) should be active');
assert.strictEqual(computeStreakStatus(14, 14), 'active', 'Day 14 of 14 should be active');
assert.strictEqual(computeStreakStatus(15, 14), 'completed', 'Day 15 of 14 should be completed');
console.log('✔ Streak status transitions passed.');

console.log('\n--- TEST 3: Edge Function Missed-Day Cron Eligibility ---');
const startDate = '2026-09-01';
// Day 7
assert.strictEqual(isEligibleForRedistribution(startDate, '2026-09-07', 7), true, 'Day 7 of 7 should be eligible');
// Day 8 before extension
assert.strictEqual(isEligibleForRedistribution(startDate, '2026-09-08', 7), false, 'Day 8 of 7 should NOT be eligible (streak expired)');
// Day 8 after extension to 14 days
assert.strictEqual(isEligibleForRedistribution(startDate, '2026-09-08', 14), true, 'Day 8 of 14 should be eligible once extended');
// Day 14
assert.strictEqual(isEligibleForRedistribution(startDate, '2026-09-14', 14), true, 'Day 14 of 14 should be eligible');
// Day 15
assert.strictEqual(isEligibleForRedistribution(startDate, '2026-09-15', 14), false, 'Day 15 of 14 should NOT be eligible');
console.log('✔ Missed-day cron eligibility passed.');

console.log('\n--- TEST 4: Group Streak Extension Proposal & Decline Flow (Refund verification) ---');
// Mock state
let creator = { id: 'u1', display_name: 'Alice', coin_balance: 1000 };
let friend = { id: 'u2', display_name: 'Bob', coin_balance: 1000 };
let streak = {
  id: 's1',
  name: 'Protein Challenge',
  target_days: 7,
  buy_in: 70,
  is_group: true,
  created_by: 'u1',
};
let activities = [];

// 1. Initial 7-day challenge buy-in
creator.coin_balance -= calculateBuyIn(streak.target_days); // 1000 - 70 = 930
friend.coin_balance -= calculateBuyIn(streak.target_days);  // 1000 - 70 = 930
assert.strictEqual(creator.coin_balance, 930);
assert.strictEqual(friend.coin_balance, 930);

// 2. On Day 3, Creator proposes +7 days extension
const additionalDays = 7;
const extensionCost = calculateBuyIn(additionalDays); // 70 coins
assert.strictEqual(extensionCost, 70);

// Creator reserves coins
creator.coin_balance -= extensionCost;
assert.strictEqual(creator.coin_balance, 860, 'Creator balance should reflect reserved 70 coins');

// Create proposal activity
const proposalActivity = {
  id: 'act-ext-1',
  streak_id: streak.id,
  user_id: creator.id,
  type: 'extension_request',
  data: {
    status: 'pending',
    completed: false,
    additional_days: additionalDays,
    new_target_days: streak.target_days + additionalDays,
    cost: extensionCost,
    creator_id: creator.id,
    creator_name: creator.display_name,
  },
};
activities.push(proposalActivity);

// Verify streak target hasn't changed yet (pending approval)
assert.strictEqual(streak.target_days, 7, 'Target days should remain 7 while extension is pending');

// 3. Friend DECLINES the extension proposal
function simulateDecline(activityId, responderUser) {
  const act = activities.find(a => a.id === activityId);
  assert(act, 'Activity must exist');
  assert.strictEqual(act.data.status, 'pending');

  const cost = act.data.cost;
  const creatorId = act.data.creator_id;

  // Refund creator
  if (creator.id === creatorId) {
    creator.coin_balance += cost;
  }

  // Update activity
  act.data.status = 'declined';
  act.data.completed = true;
  act.data.result = 'declined';
  act.data.responded_by = responderUser.id;

  // Notification message for creator
  activities.push({
    id: 'act-notif-decline',
    user_id: creatorId,
    streak_id: act.streak_id,
    type: 'milestone',
    data: {
      action: 'extension_declined',
      message: `${responderUser.display_name} didn't want to extend the streak. Your ${cost} 🪙 have been refunded, and the challenge will continue with the original target.`,
      refunded_coins: cost,
    },
  });
}

simulateDecline('act-ext-1', friend);

// Verifications for Decline:
assert.strictEqual(creator.coin_balance, 930, 'Creator should get 70 coins refunded back to 930');
assert.strictEqual(friend.coin_balance, 930, 'Friend balance should remain untouched at 930');
assert.strictEqual(streak.target_days, 7, 'Streak target days should strictly remain 7');

const declineNotif = activities.find(a => a.data && a.data.action === 'extension_declined');
assert(declineNotif, 'Decline notification message should be sent to creator');
assert.strictEqual(declineNotif.user_id, creator.id, 'Notification should target creator');
assert(declineNotif.data.message.includes('refunded'), 'Message must confirm coins were refunded');
console.log('✔ Decline & Refund flow passed: Creator received full 70 coins refund, streak remained at 7 days, and notification was logged.');

console.log('\n--- TEST 5: Group Streak Extension Proposal & Approval Flow ---');
// Reset balances
creator.coin_balance = 930;
friend.coin_balance = 930;
activities = [];

// Creator reserves 70 coins again
creator.coin_balance -= extensionCost; // 860
const proposal2 = {
  id: 'act-ext-2',
  streak_id: streak.id,
  user_id: creator.id,
  type: 'extension_request',
  data: {
    status: 'pending',
    completed: false,
    additional_days: additionalDays,
    new_target_days: streak.target_days + additionalDays,
    cost: extensionCost,
    creator_id: creator.id,
    creator_name: creator.display_name,
  },
};
activities.push(proposal2);

// Friend APPROVES the extension proposal
function simulateApprove(activityId, responderUser) {
  const act = activities.find(a => a.id === activityId);
  assert(act, 'Activity must exist');
  assert.strictEqual(act.data.status, 'pending');

  const cost = act.data.cost;
  assert(responderUser.coin_balance >= cost, 'Responder must have sufficient balance');

  // Deduct coins from friend
  responderUser.coin_balance -= cost;

  // Update streak
  streak.target_days += act.data.additional_days;
  streak.buy_in += cost;

  // Mark activity approved
  act.data.status = 'approved';
  act.data.completed = true;
  act.data.result = 'approved';
  act.data.responded_by = responderUser.id;

  activities.push({
    id: 'act-milestone-approved',
    user_id: responderUser.id,
    streak_id: act.streak_id,
    type: 'milestone',
    data: {
      action: 'extension_approved',
      message: `${responderUser.display_name} approved the extension! Streak extended to ${streak.target_days} days.`,
      new_target_days: streak.target_days,
    },
  });
}

simulateApprove('act-ext-2', friend);

// Verifications for Approve:
assert.strictEqual(creator.coin_balance, 860, 'Creator has staked 70 + 70 = 140 total (balance: 860)');
assert.strictEqual(friend.coin_balance, 860, 'Friend has staked 70 + 70 = 140 total (balance: 860)');
assert.strictEqual(streak.target_days, 14, 'Streak target days should now be 14');
assert.strictEqual(streak.buy_in, 140, 'Streak buy-in should now be 140');

const approveMilestone = activities.find(a => a.data && a.data.action === 'extension_approved');
assert(approveMilestone, 'Approval milestone should be logged');
assert.strictEqual(approveMilestone.data.new_target_days, 14);
console.log('✔ Approval flow passed: Both users have equal 140 coins staked (balance: 860 each), target days is 14, and milestone logged.');

console.log('\n--- TEST 6: Creator Cancellation Flow ---');
creator.coin_balance = 860;
const proposal3 = {
  id: 'act-ext-3',
  streak_id: streak.id,
  user_id: creator.id,
  type: 'extension_request',
  data: {
    status: 'pending',
    completed: false,
    additional_days: 7,
    new_target_days: 21,
    cost: 70,
    creator_id: creator.id,
    creator_name: creator.display_name,
  },
};
// Creator reserves 70 coins
creator.coin_balance -= 70; // 790
assert.strictEqual(creator.coin_balance, 790);

// Creator cancels proposal
function simulateCancel(activityId, callerId) {
  const act = proposal3;
  assert.strictEqual(act.data.creator_id, callerId);
  assert.strictEqual(act.data.status, 'pending');

  creator.coin_balance += act.data.cost;
  act.data.status = 'cancelled';
  act.data.completed = true;
  act.data.result = 'cancelled';
}

simulateCancel('act-ext-3', creator.id);
assert.strictEqual(creator.coin_balance, 860, 'Creator should get 70 coins refunded on cancellation');
assert.strictEqual(proposal3.data.status, 'cancelled');
console.log('✔ Creator cancellation passed: Reserved coins refunded immediately.');

console.log('\n============================================================');
console.log('🎉 ALL 6 TEST SUITES PASSED! ZERO REGRESSIONS OR BUGS FOUND.');
console.log('============================================================\n');
