import test from 'node:test';
import assert from 'node:assert/strict';
import {reportView, shanghaiDate, speedBuckets, liveView, reportFreshness} from '../web/report-model.mjs';
const now = new Date('2026-11-02T00:10:00Z');
const row = (day, id, count) => ({day, vehicle_id: id, sample_count: count, distance_km: count / 10, max_temp_c: 35, high_temp_samples: 0});
const data = {batch: {run_id: 'actual-run'}, days: [row('2026-11-02', 'car-a', 3), row('2026-11-02', 'car-b', 5), row('2026-11-01', 'car-c', 7), row('2026-10-20', 'car-old', 9)]};
test('freshness advances between fetches, crosses the threshold and follows a newer batch', () => {
  const stamp = now.getTime();
  const snapshot = {batch: {last_event_ms: stamp - 899000, ageSeconds: 899, stale: false}};
  assert.deepEqual(reportFreshness(snapshot, stamp), {ageSeconds: 899, stale: false});
  assert.deepEqual(reportFreshness(snapshot, stamp + 1000), {ageSeconds: 900, stale: false});
  assert.deepEqual(reportFreshness(snapshot, stamp + 2000), {ageSeconds: 901, stale: true});
  // Resuming a hidden tab uses elapsed wall time, not a count of timer ticks.
  assert.deepEqual(reportFreshness(snapshot, stamp + 120000), {ageSeconds: 1019, stale: true});
  assert.deepEqual(reportFreshness({batch: {last_event_ms: stamp + 119000}}, stamp + 120000), {ageSeconds: 1, stale: false});
});
test('freshness has no invented zero for absent or invalid batches and clamps future timestamps', () => {
  for (const batch of [null, {}, {last_event_ms: null}, {last_event_ms: 'invalid'}, {last_event_ms: 0}]) {
    assert.deepEqual(reportFreshness({batch}, now.getTime()), {ageSeconds: null, stale: null});
  }
  assert.deepEqual(reportFreshness({batch: {last_event_ms: now.getTime() + 1000}}, now.getTime()), {ageSeconds: 0, stale: false});
});
test('today-only reports ignore retained older rows and keep search independent of totals', () => {
  const today = reportView(data, '', now), filtered = reportView(data, 'CAR-B', now);
  assert.equal(today.seen, 2); assert.equal(filtered.seen, 2);
  assert.equal(today.samples, 8); assert.equal(filtered.samples, 8);
  assert.equal(today.days.length, 2);
  assert.deepEqual(filtered.vehicles, [['car-b', 5]]);
  assert.equal(filtered.days.length, 1); assert.equal(filtered.days[0].vehicle_id, 'car-b');
  assert.equal(reportView(data, 'car-c', now).days.length, 0);
});
test('today windows and totals roll over at Shanghai midnight even against a retained batch', () => {
  const windows = ['2026-11-01T15:55:00Z', '2026-11-01T16:00:00Z', '2026-11-02T16:00:00Z']
    .map(bucket_start => ({bucket_start}));
  assert.deepEqual(reportView({...data, windows}, '', now).windows, [windows[1]]);
  const nextDay = reportView({...data, windows}, '', new Date('2026-11-02T16:00:00Z'));
  assert.equal(nextDay.samples, 0); assert.equal(nextDay.seen, 0); assert.equal(nextDay.hasToday, false);
  assert.deepEqual(nextDay.windows, [windows[2]]);
});
test('unpublished response cannot produce actual metrics', () => {
  const view = reportView({...data, batch: null}, '', now);
  assert.equal(view.seen, 0); assert.deepEqual(view.days, []); assert.equal(view.temperature, null);
});
test('day filtering uses Shanghai midnight', () => {
  assert.equal(shanghaiDate('2026-11-01T16:00:00Z'), '2026-11-02');
  assert.equal(shanghaiDate('2026-11-01T15:59:59Z'), '2026-11-01');
});
test('speed windows use weighted averages and ignore empty samples', () => {
  const buckets = speedBuckets([{bucket_start: '2026-11-02T00:05:00Z', sample_count: 1, avg_speed_kph: 80}, {bucket_start: '2026-11-02T00:05:00Z', sample_count: 3, avg_speed_kph: 40}, {bucket_start: '2026-11-02T00:00:00Z', sample_count: 0, avg_speed_kph: 999}]);
  assert.deepEqual(buckets, [{at: '2026-11-02T00:05:00Z', speed: 50}]);
});

const live = {schemaVersion: 1, generatedAt: now.toISOString(), source: {connected: true},
  totals: {seenToday: 2, reporting: 1, silent: 1, receivedLastMinute: 60},
  modes: {DRIVE: 1, PARK: 0, CHARGE: 0},
  vehicles: [{vehicleId: 'car-a', status: 'reporting', stateFresh: true, mode: 'DRIVE', batterySocPct: 58},
    {vehicleId: 'car-b', status: 'silent', stateFresh: false, mode: 'PARK'}]};
test('live filtering does not alter actual overview totals', () => {
  const view = liveView(live, 'CAR-B', 'silent', now.getTime());
  assert.equal(view.vehicles.length, 1); assert.equal(view.vehicles[0].vehicleId, 'car-b');
  assert.equal(view.totals.reporting, 1); assert.equal(view.totals.receivedLastMinute, 60);
  assert.deepEqual(liveView(live, 'car-b', 'reporting', now.getTime()).vehicles, []);
});
test('stale snapshots, disconnected source and failed requests retain values as unknown', () => {
  for (const view of [liveView(live, '', 'all', now.getTime() + 15001),
    liveView({...live, source: {connected: false}}, '', 'all', now.getTime()),
    liveView(live, '', 'all', now.getTime(), true)]) {
    assert.equal(view.healthy, false); assert.equal(view.totals.reporting, null);
    assert.equal(view.totals.silent, null); assert.equal(view.modes.DRIVE, null);
    assert.equal(view.vehicles[0].status, 'unknown'); assert.equal(view.vehicles[0].batterySocPct, 58);
    assert.equal(view.vehicles[0].stateFresh, false);
  }
});
test('live data works before the first historical batch; absent feed is unavailable', () => {
  assert.equal(reportView({batch: null, days: []}, '', now).seen, 0);
  assert.equal(liveView(live, '', 'all', now.getTime()).totals.seenToday, 2);
  assert.equal(liveView(undefined, '', 'all', now.getTime()).totals.receivedLastMinute, null);
  assert.equal(liveView(live, '', 'all', now.getTime() - 6000).healthy, false);
});
