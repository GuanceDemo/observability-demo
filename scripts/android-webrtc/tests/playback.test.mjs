import assert from 'node:assert/strict';
import {test} from 'node:test';
import {replacePlaybackTrack} from '../player/playback.ts';

class Stream {
  constructor(tracks) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
}
globalThis.MediaStream = Stream;

test('reconnect replaces old video tracks while retaining live tracks of a different kind', () => {
  const audio = {id: 'audio', kind: 'audio', readyState: 'live'};
  const old = {id: 'old', kind: 'video', readyState: 'ended'};
  const next = {id: 'next', kind: 'video', readyState: 'live'};
  const video = {srcObject: new Stream([old, audio])};
  replacePlaybackTrack(video, next);
  assert.deepEqual(video.srcObject.getTracks(), [audio, next]);
  const assigned = video.srcObject;
  replacePlaybackTrack(video, next);
  assert.equal(video.srcObject, assigned);
});
