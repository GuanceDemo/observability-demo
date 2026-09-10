/** Replace an ended/reconnected track instead of leaving it first in the stream. */
export function replacePlaybackTrack(video: HTMLVideoElement, track: MediaStreamTrack): void {
  const previous = video.srcObject instanceof MediaStream ? video.srcObject : null;
  if (previous?.getTracks().some((existing) => existing.id === track.id)) return;
  const retained = previous?.getTracks().filter(
    (existing) => existing.kind !== track.kind && existing.readyState !== "ended",
  ) ?? [];
  video.srcObject = new MediaStream([...retained, track]);
}
