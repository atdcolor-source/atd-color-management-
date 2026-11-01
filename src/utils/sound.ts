const SOUND_PREF_KEY = 'atdcolor_sound_enabled_v1';

let sharedAudioCtx: AudioContext | null = null;
let lastPlayedTimestamp = 0;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedAudioCtx && sharedAudioCtx.state !== 'closed') {
    return sharedAudioCtx;
  }
  const AudioCtxClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtxClass) return null;
  try {
    sharedAudioCtx = new AudioCtxClass();
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

export function loadSoundEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SOUND_PREF_KEY);
    if (raw === null) return true;
    return raw !== 'false';
  } catch {
    return true;
  }
}

export function saveSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_PREF_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage errors
  }
}

function triggerChimeNodes(ctx: AudioContext): void {
  const now = ctx.currentTime;

  // Fundamental crystal bell tone (G6 -> slight bright shimmer)
  const oscMain = ctx.createOscillator();
  const gainMain = ctx.createGain();
  oscMain.type = 'sine';
  oscMain.frequency.setValueAtTime(1567.98, now);
  oscMain.frequency.exponentialRampToValueAtTime(1600, now + 0.015);

  gainMain.gain.setValueAtTime(0.0001, now);
  gainMain.gain.linearRampToValueAtTime(0.075, now + 0.0025);
  gainMain.gain.exponentialRampToValueAtTime(0.0001, now + 0.115);

  oscMain.connect(gainMain);
  gainMain.connect(ctx.destination);

  // Subtle 2nd harmonic overtone (G7) for crisp "tin" attack
  const oscHarmonic = ctx.createOscillator();
  const gainHarmonic = ctx.createGain();
  oscHarmonic.type = 'sine';
  oscHarmonic.frequency.setValueAtTime(3135.96, now);

  gainHarmonic.gain.setValueAtTime(0.0001, now);
  gainHarmonic.gain.linearRampToValueAtTime(0.024, now + 0.002);
  gainHarmonic.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

  oscHarmonic.connect(gainHarmonic);
  gainHarmonic.connect(ctx.destination);

  oscMain.onended = () => {
    oscMain.disconnect();
    gainMain.disconnect();
  };
  oscHarmonic.onended = () => {
    oscHarmonic.disconnect();
    gainHarmonic.disconnect();
  };

  oscMain.start(now);
  oscMain.stop(now + 0.12);

  oscHarmonic.start(now);
  oscHarmonic.stop(now + 0.055);
}

/**
 * Plays a crisp, zero-latency "tin" chime via Web Audio API.
 * Throttled to prevent duplicate triggers on nested click/pointer targets.
 */
export function playTinSound(): void {
  const nowMs = performance.now();
  if (nowMs - lastPlayedTimestamp < 45) return;
  lastPlayedTimestamp = nowMs;

  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    void ctx
      .resume()
      .then(() => {
        triggerChimeNodes(ctx);
      })
      .catch(() => {
        // Ignore browser autoplay restrictions if not triggered by gesture
      });
    return;
  }

  triggerChimeNodes(ctx);
}
