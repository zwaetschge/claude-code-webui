export interface AmbientTransformKeyframe {
  offset: number;
  xVw: number;
  yVh: number;
  rotateDeg: number;
  scaleX: number;
}

export interface AmbientMotionSpec {
  durationMs: number;
  keyframes: readonly AmbientTransformKeyframe[];
}

interface AmbientMotionTrack extends AmbientMotionSpec {
  element: HTMLElement;
}

export const AMBIENT_MOTION_FPS = 30;
export const GECKO_AMBIENT_MOTION_FPS = 20;

export const AURORA_WAVE_MOTIONS: readonly AmbientMotionSpec[] = [
  {
    durationMs: 38_000,
    keyframes: [
      { offset: 0, xVw: -4, yVh: -1.2, rotateDeg: -1.2, scaleX: 1.03 },
      { offset: 0.45, xVw: 5, yVh: 1.4, rotateDeg: 1, scaleX: 1.07 },
      { offset: 0.72, xVw: 1.5, yVh: -0.4, rotateDeg: 0.3, scaleX: 1.04 },
      { offset: 1, xVw: -4, yVh: -1.2, rotateDeg: -1.2, scaleX: 1.03 },
    ],
  },
  {
    durationMs: 48_000,
    keyframes: [
      { offset: 0, xVw: 5, yVh: 1, rotateDeg: 1.1, scaleX: 1.04 },
      { offset: 0.42, xVw: -4, yVh: -1.2, rotateDeg: -0.8, scaleX: 1.08 },
      { offset: 0.76, xVw: 1, yVh: 0.5, rotateDeg: 0.4, scaleX: 1.03 },
      { offset: 1, xVw: 5, yVh: 1, rotateDeg: 1.1, scaleX: 1.04 },
    ],
  },
  {
    durationMs: 62_000,
    keyframes: [
      { offset: 0, xVw: -3, yVh: 0.7, rotateDeg: -0.8, scaleX: 1.02 },
      { offset: 0.48, xVw: 4, yVh: -1, rotateDeg: 0.9, scaleX: 1.06 },
      { offset: 0.78, xVw: -0.5, yVh: 0.4, rotateDeg: -0.2, scaleX: 1.03 },
      { offset: 1, xVw: -3, yVh: 0.7, rotateDeg: -0.8, scaleX: 1.02 },
    ],
  },
];

export const LOGIN_WAVE_MOTIONS: readonly AmbientMotionSpec[] = [
  {
    durationMs: 40_000,
    keyframes: [
      { offset: 0, xVw: -4, yVh: -1, rotateDeg: -1, scaleX: 1.03 },
      { offset: 0.48, xVw: 5, yVh: 1.3, rotateDeg: 1, scaleX: 1.07 },
      { offset: 0.74, xVw: 1, yVh: -0.4, rotateDeg: 0.2, scaleX: 1.04 },
      { offset: 1, xVw: -4, yVh: -1, rotateDeg: -1, scaleX: 1.03 },
    ],
  },
  {
    durationMs: 58_000,
    keyframes: [
      { offset: 0, xVw: 5, yVh: 1, rotateDeg: 1.1, scaleX: 1.04 },
      { offset: 0.46, xVw: -4, yVh: -1.2, rotateDeg: -0.8, scaleX: 1.08 },
      { offset: 0.78, xVw: 1, yVh: 0.5, rotateDeg: 0.4, scaleX: 1.03 },
      { offset: 1, xVw: 5, yVh: 1, rotateDeg: 1.1, scaleX: 1.04 },
    ],
  },
];

function cubicBezierCoordinate(t: number, firstControl: number, secondControl: number) {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * firstControl + 3 * inverse * t * t * secondControl + t * t * t;
}

// Matches CSS ease-in-out: cubic-bezier(0.42, 0, 0.58, 1).
function easeInOut(progress: number) {
  let parameter = progress;
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const x = cubicBezierCoordinate(parameter, 0.42, 0.58);
    const inverse = 1 - parameter;
    const derivative =
      3 * inverse * inverse * 0.42 +
      6 * inverse * parameter * (0.58 - 0.42) +
      3 * parameter * parameter * (1 - 0.58);
    if (Math.abs(derivative) < 0.0001) break;
    parameter -= (x - progress) / derivative;
  }
  return cubicBezierCoordinate(Math.min(1, Math.max(0, parameter)), 0, 1);
}

function interpolate(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

export function getAmbientTransformAtTime(spec: AmbientMotionSpec, elapsedMs: number) {
  if (spec.keyframes.length < 2) {
    throw new Error('Ambient motion requires at least two keyframes');
  }
  const normalizedTime = ((elapsedMs % spec.durationMs) + spec.durationMs) % spec.durationMs;
  const progress = normalizedTime / spec.durationMs;
  const keyframes = spec.keyframes;
  let nextIndex = keyframes.findIndex((keyframe) => keyframe.offset >= progress);
  if (nextIndex <= 0) nextIndex = 1;

  const from = keyframes[nextIndex - 1]!;
  const to = keyframes[nextIndex] ?? keyframes[keyframes.length - 1]!;
  const segmentProgress = (progress - from.offset) / Math.max(0.0001, to.offset - from.offset);
  const easedProgress = easeInOut(Math.min(1, Math.max(0, segmentProgress)));

  return `translate3d(${interpolate(from.xVw, to.xVw, easedProgress).toFixed(4)}vw, ${interpolate(from.yVh, to.yVh, easedProgress).toFixed(4)}vh, 0) rotate(${interpolate(from.rotateDeg, to.rotateDeg, easedProgress).toFixed(4)}deg) scaleX(${interpolate(from.scaleX, to.scaleX, easedProgress).toFixed(5)})`;
}

export function startAmbientMotion(
  elements: readonly (HTMLElement | null)[],
  specs: readonly AmbientMotionSpec[],
  fps?: number
) {
  const tracks: AmbientMotionTrack[] = specs.flatMap((spec, index) => {
    const element = elements[index];
    return element ? [{ ...spec, element }] : [];
  });
  if (tracks.length === 0) return () => undefined;

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const targetFps =
    fps ??
    (document.documentElement.classList.contains('plum-engine-gecko')
      ? GECKO_AMBIENT_MOTION_FPS
      : AMBIENT_MOTION_FPS);
  const frameIntervalMs = 1000 / Math.max(1, targetFps);
  let intervalId: number | undefined;
  let origin = performance.now();
  let pausedAt: number | undefined;

  const renderFrame = () => {
    const elapsedMs = performance.now() - origin;
    for (const track of tracks) {
      track.element.style.transform = getAmbientTransformAtTime(track, elapsedMs);
    }
  };

  const stopTimer = () => {
    if (intervalId !== undefined) {
      window.clearInterval(intervalId);
      intervalId = undefined;
    }
  };

  const startTimer = () => {
    stopTimer();
    if (document.hidden || reducedMotionQuery.matches) return;
    renderFrame();
    intervalId = window.setInterval(renderFrame, frameIntervalMs);
  };

  const syncPlayback = () => {
    const shouldPause = document.hidden || reducedMotionQuery.matches;
    if (shouldPause) {
      if (pausedAt === undefined) pausedAt = performance.now();
      stopTimer();
      if (reducedMotionQuery.matches) {
        for (const track of tracks) track.element.style.transform = '';
      }
      return;
    }

    if (pausedAt !== undefined) {
      origin += performance.now() - pausedAt;
      pausedAt = undefined;
    }
    startTimer();
  };

  document.addEventListener('visibilitychange', syncPlayback);
  reducedMotionQuery.addEventListener('change', syncPlayback);
  syncPlayback();

  return () => {
    stopTimer();
    document.removeEventListener('visibilitychange', syncPlayback);
    reducedMotionQuery.removeEventListener('change', syncPlayback);
    for (const track of tracks) track.element.style.transform = '';
  };
}
