/**
 * AttentionTracker - measures genuine reading engagement on the current page.
 *
 * Naive elapsed-time is wrong (a backgrounded tab left open overnight would
 * outrank everything read). This only accumulates time while the tab is
 * visible AND the user has interacted within the last IDLE_TIMEOUT_MS.
 */

import type { AttentionSnapshot } from '../types';

const IDLE_TIMEOUT_MS = 60_000;
const TICK_MS = 1000;
export const ATTENTION_GATE_SECONDS = 30;

export class AttentionTracker {
  private engagedMs = 0;
  private maxScrollDepth = 0;
  private interactionCount = 0;
  private userSearched = false;
  private lastActivityAt = Date.now();
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private gateFired = false;
  private onGate: (() => void) | null = null;

  private readonly onActivity = () => {
    this.lastActivityAt = Date.now();
    this.interactionCount++;
  };

  private readonly onScroll = () => {
    this.lastActivityAt = Date.now();
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - doc.clientHeight;
    if (scrollable > 0) {
      const depth = Math.min(1, (doc.scrollTop || window.scrollY) / scrollable);
      this.maxScrollDepth = Math.max(this.maxScrollDepth, depth);
    }
  };

  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      this.flushToLastActivity();
    } else {
      this.lastActivityAt = Date.now();
    }
  };

  start(onGate: () => void): void {
    this.onGate = onGate;
    document.addEventListener('scroll', this.onScroll, { passive: true });
    document.addEventListener('mousemove', this.onActivity, { passive: true });
    document.addEventListener('keydown', this.onActivity, { passive: true });
    document.addEventListener('click', this.onActivity, { passive: true });
    document.addEventListener('selectionchange', this.onActivity);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
    document.removeEventListener('scroll', this.onScroll);
    document.removeEventListener('mousemove', this.onActivity);
    document.removeEventListener('keydown', this.onActivity);
    document.removeEventListener('click', this.onActivity);
    document.removeEventListener('selectionchange', this.onActivity);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  markUserSearched(): void {
    this.userSearched = true;
  }

  private tick(): void {
    if (document.visibilityState !== 'visible') return;
    const idleFor = Date.now() - this.lastActivityAt;
    if (idleFor > IDLE_TIMEOUT_MS) return;

    this.engagedMs += TICK_MS;

    if (!this.gateFired && this.engagedMs / 1000 >= ATTENTION_GATE_SECONDS) {
      this.gateFired = true;
      this.onGate?.();
    }
  }

  private flushToLastActivity(): void {
    // No-op placeholder for symmetry with future flush-on-hide logic;
    // engagedMs already only accumulates during active ticks.
  }

  hasPassedGate(): boolean {
    return this.gateFired;
  }

  snapshot(): AttentionSnapshot {
    return {
      engagedSeconds: Math.round(this.engagedMs / 1000),
      scrollDepth: this.maxScrollDepth,
      interactionCount: this.interactionCount,
      userSearched: this.userSearched
    };
  }
}

/**
 * Composite attention score in [0, 1]. Weights per plan:
 * 40% engaged time, 25% scroll depth, 20% interaction count, 15% on-page search.
 */
export function computeAttentionScore(snapshot: AttentionSnapshot): number {
  const normalizedTime = Math.min(1, snapshot.engagedSeconds / 300); // 5 min = saturate
  const normalizedInteractions = Math.min(1, snapshot.interactionCount / 20);

  return (
    0.4 * normalizedTime +
    0.25 * snapshot.scrollDepth +
    0.2 * normalizedInteractions +
    0.15 * (snapshot.userSearched ? 1 : 0)
  );
}
