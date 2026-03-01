import { useEffect, useRef, useCallback } from 'react';

interface SwipeConfig {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  threshold?: number; // Minimum distance in pixels
  velocityThreshold?: number; // Minimum velocity in px/ms
  enabled?: boolean;
}

interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
  currentX: number;
  currentY: number;
}

export function useSwipeGesture<T extends HTMLElement = HTMLElement>(
  config: SwipeConfig
) {
  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    threshold = 50,
    velocityThreshold = 0.3,
    enabled = true,
  } = config;

  const touchState = useRef<TouchState | null>(null);
  const elementRef = useRef<T>(null);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!enabled) return;

      const touch = e.touches[0];
      if (!touch) return;

      touchState.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        currentX: touch.clientX,
        currentY: touch.clientY,
      };
    },
    [enabled]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!enabled || !touchState.current) return;

      const touch = e.touches[0];
      if (!touch) return;

      touchState.current.currentX = touch.clientX;
      touchState.current.currentY = touch.clientY;
    },
    [enabled]
  );

  const handleTouchEnd = useCallback(() => {
    if (!enabled || !touchState.current) return;

    const { startX, startY, startTime, currentX, currentY } = touchState.current;
    const deltaX = currentX - startX;
    const deltaY = currentY - startY;
    const deltaTime = Date.now() - startTime;

    // Calculate velocity
    const velocityX = Math.abs(deltaX) / deltaTime;
    const velocityY = Math.abs(deltaY) / deltaTime;

    // Determine swipe direction
    const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);

    if (isHorizontal) {
      // Horizontal swipe
      if (
        Math.abs(deltaX) >= threshold &&
        velocityX >= velocityThreshold
      ) {
        if (deltaX > 0) {
          onSwipeRight?.();
        } else {
          onSwipeLeft?.();
        }
      }
    } else {
      // Vertical swipe
      if (
        Math.abs(deltaY) >= threshold &&
        velocityY >= velocityThreshold
      ) {
        if (deltaY > 0) {
          onSwipeDown?.();
        } else {
          onSwipeUp?.();
        }
      }
    }

    touchState.current = null;
  }, [enabled, threshold, velocityThreshold, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !enabled) return;

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: true });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return elementRef;
}

// Hook variant that attaches to the document for global gestures
export function useDocumentSwipeGesture(config: SwipeConfig) {
  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    threshold = 50,
    velocityThreshold = 0.3,
    enabled = true,
  } = config;

  const touchState = useRef<TouchState | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;

      // Only start tracking at screen edges for sidebar reveal
      const edgeThreshold = 30;
      const isLeftEdge = touch.clientX < edgeThreshold;
      const isRightEdge = touch.clientX > window.innerWidth - edgeThreshold;

      if (!isLeftEdge && !isRightEdge) return;

      touchState.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        currentX: touch.clientX,
        currentY: touch.clientY,
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchState.current) return;

      const touch = e.touches[0];
      if (!touch) return;

      touchState.current.currentX = touch.clientX;
      touchState.current.currentY = touch.clientY;
    };

    const handleTouchEnd = () => {
      if (!touchState.current) return;

      const { startX, startY, startTime, currentX, currentY } = touchState.current;
      const deltaX = currentX - startX;
      const deltaY = currentY - startY;
      const deltaTime = Date.now() - startTime;

      const velocityX = Math.abs(deltaX) / deltaTime;

      // Only handle horizontal swipes
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        if (Math.abs(deltaX) >= threshold && velocityX >= velocityThreshold) {
          if (deltaX > 0) {
            onSwipeRight?.();
          } else {
            onSwipeLeft?.();
          }
        }
      }

      touchState.current = null;
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [enabled, threshold, velocityThreshold, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown]);
}
