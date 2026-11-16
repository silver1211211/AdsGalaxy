import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('Testing Monthly Users calculation and Dashboard placement...');

// 1. Check dashboard_summary_route.ts
const summaryPath = '/workspace/src/app/api/admin/dashboard/summary/route.ts';
const summaryContent = fs.readFileSync(summaryPath, 'utf8');

assert.ok(
  summaryContent.includes('COUNT(DISTINCT CASE'),
  'dashboard/summary route must calculate COUNT(DISTINCT CASE ...)'
);
assert.ok(
  summaryContent.includes('official_bot_started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)'),
  'dashboard/summary route must include users who started the official bot in last 30 days'
);
assert.ok(
  summaryContent.includes('last_active_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)'),
  'dashboard/summary route must include users who loaded the app in last 30 days'
);
assert.ok(
  summaryContent.includes('created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)'),
  'dashboard/summary route must include users created in last 30 days'
);
assert.ok(
  summaryContent.includes('monthly_users: Number(user.monthly_users || 0)'),
  'dashboard/summary route must return monthly_users in the users object'
);
console.log('✔ dashboard/summary route correctly implements deduplicated monthly_users metric');

// 2. Check dashboard_route.ts
const dashboardPath = '/workspace/src/app/api/admin/dashboard/route.ts';
const dashboardContent = fs.readFileSync(dashboardPath, 'utf8');

assert.ok(
  dashboardContent.includes('COUNT(DISTINCT CASE'),
  'dashboard route must calculate COUNT(DISTINCT CASE ...)'
);
assert.ok(
  dashboardContent.includes('monthly_users: usersMonthly.count'),
  'dashboard route must return monthly_users in the users payload'
);
console.log('✔ dashboard route correctly implements deduplicated monthly_users metric');

// 3. Check admin/page.tsx
const adminPagePath = '/workspace/src/app/admin/page.tsx';
const adminPageContent = fs.readFileSync(adminPagePath, 'utf8');

assert.ok(
  adminPageContent.includes('Monthly Users'),
  'admin dashboard page must display Monthly Users label'
);
assert.ok(
  adminPageContent.includes('Platform Overview'),
  'admin dashboard page must retain Platform Overview header'
);
assert.ok(
  adminPageContent.includes('viewStats.users?.monthly_users != null'),
  'admin dashboard page must display formatted monthly_users value'
);
assert.ok(
  adminPageContent.includes('sm:justify-between'),
  'admin dashboard page must place Monthly Users aligned to the right side on desktop'
);
console.log('✔ admin dashboard page correctly places Monthly Users at top right side');

console.log('\nAll 3 source verifications passed successfully!');
