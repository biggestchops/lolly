// SPDX-License-Identifier: MPL-2.0
/** Decorative rotation about the cursor tip. Position stays with the presence interpolator. */
export interface CursorSwing { angle: number; velocity: number }
export const CURSOR_SWING_LIMIT = 12;

/** Exact damped spring step, with bounded drive and a reset after suspended frames. */
export function stepCursorSwing(state: CursorSwing, dx: number, dy: number, ms: number): CursorSwing {
  if (![dx, dy, ms, state.angle, state.velocity].every(Number.isFinite) || ms > 150) return { angle: 0, velocity: 0 };
  if (ms <= 0) return state;
  const dt = ms / 1000;
  const target = Math.max(-CURSOR_SWING_LIMIT, Math.min(CURSOR_SWING_LIMIT, (-dx + dy * 0.35) / dt * 0.018));
  const damping = 9, frequency = 14;
  const displacement = state.angle - target;
  const sine = Math.sin(frequency * dt), cosine = Math.cos(frequency * dt), decay = Math.exp(-damping * dt);
  const b = (state.velocity + damping * displacement) / frequency;
  const offset = displacement * cosine + b * sine;
  let angle = target + decay * offset;
  let velocity = decay * (-damping * offset - displacement * frequency * sine + b * frequency * cosine);
  if (Math.abs(angle) > CURSOR_SWING_LIMIT) { angle = Math.sign(angle) * CURSOR_SWING_LIMIT; velocity = 0; }
  if (!dx && !dy && Math.abs(angle) < 0.04 && Math.abs(velocity) < 0.4) return { angle: 0, velocity: 0 };
  return { angle, velocity };
}
