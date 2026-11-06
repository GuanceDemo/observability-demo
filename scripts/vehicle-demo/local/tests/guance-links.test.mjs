import test from 'node:test';
import assert from 'node:assert/strict';
import {configureGuanceLinks, guanceJobUrl, operationRuns} from '../web/guance-links.mjs';

test('links select the exact workspace, job, history tab and actual run independently', () => {
  configureGuanceLinks('wksp_demo');
  const failure = '186e07f6-895b-4cdf-aca5-6980871c5fbb';
  const recovery = '368eef4f-afb6-42fd-af11-563612c8ab2b';
  const failed = new URL(guanceJobUrl('vehicle_summary', failure));
  const recovered = new URL(guanceJobUrl('vehicle_summary', recovery));
  assert.equal(failed.origin, 'https://console.guance.com');
  assert.equal(failed.searchParams.get('w'), 'wksp_demo');
  assert.equal(failed.searchParams.get('time'), '1d');
  assert.equal(recovered.searchParams.get('time'), '1d');
  assert.equal(failed.searchParams.get('job'), 'a2dfbd53f359945cae03e3f57fa2faf53affdbc726ea6c2ea4d69df1a040844d');
  assert.equal(failed.searchParams.get('jobTab'), 'runs');
  assert.equal(failed.searchParams.get('run'), failure);
  assert.equal(recovered.searchParams.get('run'), recovery);
  assert.notEqual(new URL(guanceJobUrl('vehicle_clean_and_detect', failure)).searchParams.get('job'), failed.searchParams.get('job'));
  assert.notEqual(new URL(guanceJobUrl('emqx_telemetry_to_kafka', failure)).searchParams.get('job'), failed.searchParams.get('job'));
});

test('operation links stay on the actual Flink execution after selection changes', () => {
  const op = {scenario: 'flink_pause', phase: 'recovered',
    failedRun: {runId: 'failed-flink', job: 'vehicle_clean_and_detect'},
    flinkRecoveryRun: {runId: 'new-flink', job: 'vehicle_clean_and_detect'},
    recoveryRun: {runId: 'new-spark'}};
  assert.deepEqual(operationRuns(op, 'vehicle_summary'), [
    ['失败运行', 'failed-flink', 'vehicle_clean_and_detect'],
    ['恢复运行', 'new-flink', 'vehicle_clean_and_detect'],
  ]);
  assert.deepEqual(operationRuns({scenario: 'spark_fail', phase: 'recovered',
    failedRun: {runId: 'failed-spark'}, recoveryRun: {runId: 'new-spark'}}, 'vehicle_clean_and_detect'), [
    ['失败运行', 'failed-spark', 'vehicle_summary'], ['恢复运行', 'new-spark', 'vehicle_summary'],
  ]);
});

test('unknown jobs and malformed run IDs never point at another run or external origin', () => {
  assert.equal(new URL(guanceJobUrl('unknown', '186e07f6-895b-4cdf-aca5-6980871c5fbb')).searchParams.has('run'), false);
  for (const invalid of [null, '', 'javascript:alert(1)', 'x&run=other']) {
    assert.equal(new URL(guanceJobUrl('vehicle_summary', invalid)).searchParams.has('run'), false);
  }
});

test('unconfigured or invalid workspace is omitted instead of selecting a built-in space', () => {
  for (const value of [undefined, '', 'other', 'wksp_demo&x=1']) {
    configureGuanceLinks(value);
    assert.equal(new URL(guanceJobUrl()).searchParams.has('w'), false);
  }
});
