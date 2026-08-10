import type { AddonStream, PlayerSnapshot, SubtitleTrack } from '@/types';

import type { PlayerAdapter, PlayerListener } from './PlayerAdapter';

const initialSnapshot: PlayerSnapshot = {
  status: 'idle',
  source: null,
  duration: 7200,
  position: 0,
  volume: 1,
  muted: false,
  subtitleTracks: [],
  activeSubtitleId: null,
  error: null,
};

export class MockPlayerAdapter implements PlayerAdapter {
  private snapshot: PlayerSnapshot = initialSnapshot;
  private listeners = new Set<PlayerListener>();
  private timer: ReturnType<typeof setInterval> | null = null;

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: PlayerListener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private emit(snapshot: PlayerSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private startClock() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.snapshot.status !== 'playing') return;
      const position = Math.min(this.snapshot.duration, this.snapshot.position + 1);
      this.emit({
        ...this.snapshot,
        position,
        status: position >= this.snapshot.duration ? 'ended' : 'playing',
      });
    }, 1000);
  }

  async load(source: AddonStream, startAt = 0) {
    this.emit({
      ...this.snapshot,
      status: 'loading',
      source,
      position: startAt,
      error: null,
      subtitleTracks: source.subtitles,
      activeSubtitleId: source.subtitles[0]?.id ?? null,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    this.emit({ ...this.snapshot, status: 'paused' });
  }

  async play() {
    this.emit({ ...this.snapshot, status: 'playing', error: null });
    this.startClock();
  }

  async pause() {
    this.emit({ ...this.snapshot, status: 'paused' });
  }

  async seek(position: number) {
    const nextPosition = Math.max(0, Math.min(this.snapshot.duration, position));
    this.emit({ ...this.snapshot, status: 'loading', position: nextPosition });
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    this.emit({
      ...this.snapshot,
      status: 'paused',
      position: nextPosition,
    });
  }

  async setVolume(volume: number) {
    this.emit({
      ...this.snapshot,
      volume: Math.max(0, Math.min(1, volume)),
      muted: volume <= 0,
    });
  }

  async setSubtitleTrack(track: SubtitleTrack | null) {
    this.emit({
      ...this.snapshot,
      activeSubtitleId: track?.id ?? null,
    });
  }

  async destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
    this.snapshot = initialSnapshot;
  }
}
