/**
 * Motor de Audio Espacial Estéreo y Gamificación Multisensorial (Web Audio API)
 * Diseñado para rehabilitación neuro-oftalmológica:
 * - Utiliza paneo estéreo (`StereoPannerNode`, -0.85 a +0.85) según la coordenada X del estímulo
 *   para activar la integración multisensorial colicular hacia el hemicampo afectado.
 * - No requiere archivos externos (.mp3/.wav) y respeta el modo silencio.
 */

class TherapyAudioEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;
  private lastTickTimeMs: number = 0;
  private lastBeaconTimeMs: number = 0;

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private createPannedGain(
    ctx: AudioContext,
    panNorm: number,
    initialGain: number
  ): { gainNode: GainNode; outputNode: AudioNode } {
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(Math.max(0.0001, initialGain), ctx.currentTime);

    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      // Convert normalized X [0..1] or signed [-1..1] to stereo pan [-0.85..0.85]
      const clampedPan = Math.max(-0.85, Math.min(0.85, panNorm));
      panner.pan.setValueAtTime(clampedPan, ctx.currentTime);
      gainNode.connect(panner);
      panner.connect(ctx.destination);
      return { gainNode, outputNode: gainNode };
    }

    gainNode.connect(ctx.destination);
    return { gainNode, outputNode: gainNode };
  }

  /**
   * Pulso armónico ascendente mientras el paciente sostiene la fijación sobre el objetivo.
   */
  public playFixationTick(progress01: number, xNorm01: number): void {
    const nowMs = performance.now();
    if (nowMs - this.lastTickTimeMs < 130) return;
    this.lastTickTimeMs = nowMs;

    const ctx = this.getContext();
    if (!ctx) return;

    const pan = (xNorm01 - 0.5) * 1.7;
    const { gainNode } = this.createPannedGain(ctx, pan, 0.045);
    const osc = ctx.createOscillator();
    osc.type = 'sine';

    const freq = 380 + Math.max(0, Math.min(1, progress01)) * 340;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.075);
    osc.connect(gainNode);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  }

  /**
   * Acorde de recompensa al adquirir un objetivo o cuadrante. Escala ligeramente con la racha (streak).
   */
  public playTargetAcquired(streak: number, xNorm01: number): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const pan = (xNorm01 - 0.5) * 1.7;
    const baseFreq = 523.25 * Math.min(1.35, 1 + Math.max(0, streak - 1) * 0.05); // C5 -> escala por racha
    const notes = [baseFreq, baseFreq * 1.25, baseFreq * 1.5]; // Tríada mayor

    notes.forEach((freq, idx) => {
      const startOffset = idx * 0.045;
      const { gainNode } = this.createPannedGain(ctx, pan, 0.09);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);

      gainNode.gain.setValueAtTime(0.09, ctx.currentTime + startOffset);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + 0.22);

      osc.connect(gainNode);
      osc.start(ctx.currentTime + startOffset);
      osc.stop(ctx.currentTime + startOffset + 0.23);
    });
  }

  /**
   * Sonido de anclaje central completado y disparo de sacada periférica (COMPENSATORY_SACCADE).
   */
  public playAnchorLocked(targetXNorm01: number): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const pan = (targetXNorm01 - 0.5) * 1.7;
    const { gainNode } = this.createPannedGain(ctx, pan, 0.08);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.11);

    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gainNode);
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
  }

  /**
   * Alerta suave cuando el paciente fija un distractor en TARGET_SEARCH_WITH_DISTRACTORS.
   */
  public playDistractorWarning(xNorm01: number): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const pan = (xNorm01 - 0.5) * 1.6;
    const { gainNode } = this.createPannedGain(ctx, pan, 0.06);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(195, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(155, ctx.currentTime + 0.12);

    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.13);
    osc.connect(gainNode);
    osc.start();
    osc.stop(ctx.currentTime + 0.14);
  }

  /**
   * Baliza auditiva espacial de rescate cuando el paciente tarda >65% del tiempo sin localizar el estímulo en el hemicampo afectado.
   */
  public playPeripheralRescueBeacon(xNorm01: number): void {
    const nowMs = performance.now();
    if (nowMs - this.lastBeaconTimeMs < 950) return;
    this.lastBeaconTimeMs = nowMs;

    const ctx = this.getContext();
    if (!ctx) return;

    const pan = (xNorm01 - 0.5) * 1.8; // Paneo pronunciado hacia el oído del hemicampo donde está el objetivo
    const { gainNode } = this.createPannedGain(ctx, pan, 0.075);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.07); // G5

    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gainNode);
    osc.start();
    osc.stop(ctx.currentTime + 0.19);
  }

  /**
   * Fanfarria suave de finalización de sesión terapéutica.
   */
  public playSessionCompleted(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const chord = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    chord.forEach((freq, idx) => {
      const start = idx * 0.08;
      const { gainNode } = this.createPannedGain(ctx, 0, 0.09);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);

      gainNode.gain.setValueAtTime(0.09, ctx.currentTime + start);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + 0.38);

      osc.connect(gainNode);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.4);
    });
  }
}

export const therapyAudio = new TherapyAudioEngine();
