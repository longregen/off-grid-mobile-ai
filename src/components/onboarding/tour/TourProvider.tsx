/**
 * Minimal in-tree replacement for `react-native-spotlight-tour`.
 *
 * Scope is deliberately narrow: just the surface the app actually uses —
 *   - `<SpotlightTourProvider steps overlayColor overlayOpacity onBackdropPress shape>`
 *   - `<AttachStep index={number | number[]} fill? style?>children</AttachStep>`
 *   - `useSpotlightTour() -> { goTo, current, stop, ... }`
 *
 * No SVG, no gesture library, no animation engine. The spotlight "hole" is
 * four absolutely-positioned dark rectangles around a transparent cut-out,
 * measured from the attached view via `measureInWindow`. Replacing the
 * package shrinks the transitive dep tree (react-native-svg + its peers)
 * and removes one more upstream surface we would otherwise have to audit.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode, RefObject } from 'react';
import {
  Dimensions,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import type { ViewStyle } from 'react-native';

// ─── Public types ────────────────────────────────────────────────────────────

export interface TourStepShape {
  type?: 'rectangle';
  padding?: number;
}

export interface TourStepRenderProps {
  stop: () => void;
}

export interface TourStep {
  render: (props: TourStepRenderProps) => ReactNode;
  shape?: TourStepShape;
  onBackdropPress?: 'stop' | (() => void);
}

export type BackdropBehaviour = 'stop' | (() => void);

export interface SpotlightTourProviderProps {
  steps: TourStep[];
  /** Any CSS-ish color string accepted by React Native. Default: "black". */
  overlayColor?: string;
  /** 0..1. Default: 0.62. */
  overlayOpacity?: number;
  onBackdropPress?: BackdropBehaviour;
  shape?: TourStepShape;
  /** Accepted for API compatibility; not used (we don't animate). */
  motion?: string;
  children: ReactNode;
}

// ─── Internal types ──────────────────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TourContextValue {
  current: number | null;
  goTo: (index: number) => void;
  stop: () => void;
  register: (indices: number[], ref: RefObject<View | null>) => () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

// ─── Color parsing ───────────────────────────────────────────────────────────

function applyOpacity(color: string, opacity: number): string {
  // Accept the three color syntaxes the old package accepted ("black", "#rrggbb",
  // "rgba(…)") and bake in the opacity. Anything else is passed through, which
  // means opacity is ignored — acceptable for our narrow usage.
  const clamped = Math.max(0, Math.min(1, opacity));
  if (color === 'black') return `rgba(0,0,0,${clamped})`;
  if (color === 'white') return `rgba(255,255,255,${clamped})`;
  const hexMatch = /^#([\da-f]{6})$/i.exec(color);
  if (hexMatch) {
    const r = parseInt(hexMatch[1].slice(0, 2), 16);
    const g = parseInt(hexMatch[1].slice(2, 4), 16);
    const b = parseInt(hexMatch[1].slice(4, 6), 16);
    return `rgba(${r},${g},${b},${clamped})`;
  }
  return color;
}

// ─── Provider ────────────────────────────────────────────────────────────────

const TOOLTIP_MARGIN = 12;
const DEFAULT_OPACITY = 0.62;
const DEFAULT_PADDING = 8;

export const SpotlightTourProvider: React.FC<SpotlightTourProviderProps> = ({
  steps,
  overlayColor = 'black',
  overlayOpacity = DEFAULT_OPACITY,
  onBackdropPress,
  shape: defaultShape,
  children,
}) => {
  const [current, setCurrent] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [tooltipSize, setTooltipSize] = useState<{ width: number; height: number } | null>(null);
  const targets = useRef<Map<number, RefObject<View | null>>>(new Map());

  const register = useCallback(
    (indices: number[], ref: RefObject<View | null>) => {
      indices.forEach((idx) => targets.current.set(idx, ref));
      return () => {
        indices.forEach((idx) => {
          if (targets.current.get(idx) === ref) {
            targets.current.delete(idx);
          }
        });
      };
    },
    [],
  );

  const goTo = useCallback((idx: number) => {
    const ref = targets.current.get(idx);
    const node = ref?.current;
    if (!node) {
      // Target not mounted yet — bail out silently, matching the upstream behavior.
      return;
    }
    node.measureInWindow((...args) => {
      const [x, y, width, height] = args as [number, number, number, number];
      if (width === 0 && height === 0) return;
      setRect({ x, y, width, height });
      setTooltipSize(null);
      setCurrent(idx);
    });
  }, []);

  const stop = useCallback(() => {
    setCurrent(null);
    setRect(null);
    setTooltipSize(null);
  }, []);

  const activeStep = current !== null ? steps[current] : null;
  const stepShape = activeStep?.shape ?? defaultShape;
  const padding = stepShape?.padding ?? DEFAULT_PADDING;
  const backdropBehavior = activeStep?.onBackdropPress ?? onBackdropPress ?? 'stop';

  const handleBackdropPress = useCallback(() => {
    if (backdropBehavior === 'stop') {
      stop();
    } else if (typeof backdropBehavior === 'function') {
      backdropBehavior();
    }
  }, [backdropBehavior, stop]);

  const contextValue = useMemo<TourContextValue>(
    () => ({ current, goTo, stop, register }),
    [current, goTo, stop, register],
  );

  return (
    <TourContext.Provider value={contextValue}>
      {children}
      {activeStep && rect && (
        <Overlay
          rect={rect}
          padding={padding}
          overlayColor={overlayColor}
          overlayOpacity={overlayOpacity}
          onBackdropPress={handleBackdropPress}
          tooltipSize={tooltipSize}
          setTooltipSize={setTooltipSize}
          renderTooltip={() => activeStep.render({ stop })}
        />
      )}
    </TourContext.Provider>
  );
};

// ─── Overlay ─────────────────────────────────────────────────────────────────

interface OverlayProps {
  rect: Rect;
  padding: number;
  overlayColor: string;
  overlayOpacity: number;
  onBackdropPress: () => void;
  tooltipSize: { width: number; height: number } | null;
  setTooltipSize: (s: { width: number; height: number }) => void;
  renderTooltip: () => ReactNode;
}

const Overlay: React.FC<OverlayProps> = ({
  rect,
  padding,
  overlayColor,
  overlayOpacity,
  onBackdropPress,
  tooltipSize,
  setTooltipSize,
  renderTooltip,
}) => {
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const color = useMemo(
    () => applyOpacity(overlayColor, overlayOpacity),
    [overlayColor, overlayOpacity],
  );

  // Hole rectangle in window coordinates, expanded by `padding` on every side and
  // clipped to the screen so we never produce negative dimensions on edge cases.
  const holeX = Math.max(0, rect.x - padding);
  const holeY = Math.max(0, rect.y - padding);
  const holeW = Math.min(screenW - holeX, rect.width + padding * 2);
  const holeH = Math.min(screenH - holeY, rect.height + padding * 2);

  const topH = holeY;
  const bottomH = Math.max(0, screenH - (holeY + holeH));
  const leftW = holeX;
  const rightX = holeX + holeW;
  const rightW = Math.max(0, screenW - rightX);

  // Tooltip placement: prefer below the hole, otherwise above; horizontally
  // center on the hole and clamp to the screen edges.
  const tooltipWidth = tooltipSize?.width ?? 0;
  const tooltipHeight = tooltipSize?.height ?? 0;
  const spaceBelow = screenH - (holeY + holeH) - TOOLTIP_MARGIN;
  const placeBelow = !tooltipHeight || spaceBelow >= tooltipHeight;
  const tooltipTop = placeBelow
    ? holeY + holeH + TOOLTIP_MARGIN
    : Math.max(TOOLTIP_MARGIN, holeY - TOOLTIP_MARGIN - tooltipHeight);
  const tooltipCenterX = holeX + holeW / 2;
  const tooltipLeft = tooltipWidth
    ? Math.max(
        TOOLTIP_MARGIN,
        Math.min(screenW - tooltipWidth - TOOLTIP_MARGIN, tooltipCenterX - tooltipWidth / 2),
      )
    : TOOLTIP_MARGIN;

  const tooltipVisibilityStyle = tooltipSize ? styles.tooltipVisible : styles.tooltipHidden;

  return (
    <View style={styles.overlayRoot} pointerEvents="box-none" testID="tour-overlay">
      {/* Four bars form the dark area around the transparent spotlight hole. */}
      <Pressable
        style={[styles.bar, styles.barTopLeftAligned, { width: screenW, height: topH, backgroundColor: color }]}
        onPress={onBackdropPress}
        testID="tour-backdrop-top"
      />
      <Pressable
        style={[styles.bar, styles.barLeftAligned, { top: holeY + holeH, width: screenW, height: bottomH, backgroundColor: color }]}
        onPress={onBackdropPress}
        testID="tour-backdrop-bottom"
      />
      <Pressable
        style={[styles.bar, styles.barLeftAligned, { top: holeY, width: leftW, height: holeH, backgroundColor: color }]}
        onPress={onBackdropPress}
        testID="tour-backdrop-left"
      />
      <Pressable
        style={[styles.bar, { top: holeY, left: rightX, width: rightW, height: holeH, backgroundColor: color }]}
        onPress={onBackdropPress}
        testID="tour-backdrop-right"
      />
      {/* Tooltip positioned with absolute coordinates once we know its size. */}
      <View
        style={[
          styles.tooltip,
          tooltipVisibilityStyle,
          {
            top: tooltipTop,
            left: tooltipLeft,
          },
        ]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (width > 0 && height > 0) {
            if (
              !tooltipSize ||
              Math.abs(tooltipSize.width - width) > 0.5 ||
              Math.abs(tooltipSize.height - height) > 0.5
            ) {
              setTooltipSize({ width, height });
            }
          }
        }}
        testID="tour-tooltip"
      >
        {renderTooltip()}
      </View>
    </View>
  );
};

// ─── AttachStep ──────────────────────────────────────────────────────────────

export interface AttachStepProps {
  index: number | number[];
  /** Make the wrapping View fill its parent (analogous to the upstream prop). */
  fill?: boolean;
  style?: ViewStyle;
  children: ReactNode;
}

export const AttachStep: React.FC<AttachStepProps> = ({ index, fill, style, children }) => {
  const ctx = useContext(TourContext);
  const ref = useRef<View>(null);
  const indices = useMemo(() => (Array.isArray(index) ? index : [index]), [index]);

  useEffect(() => {
    if (!ctx) return;
    return ctx.register(indices, ref);
  }, [ctx, indices]);

  return (
    <View
      ref={ref}
      // `collapsable={false}` is required on Android to keep an unstyled wrapper
      // View in the native tree so `measureInWindow` returns real coordinates.
      collapsable={false}
      style={[fill && styles.fill, style]}
    >
      {children}
    </View>
  );
};

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface SpotlightTourHandle {
  current: number | null;
  goTo: (index: number) => void;
  stop: () => void;
  /** Kept for API compatibility with the upstream package. */
  start: () => void;
  next: () => void;
  previous: () => void;
  pause: () => void;
  resume: () => void;
  status: 'idle' | 'running';
}

export function useSpotlightTour(): SpotlightTourHandle {
  const ctx = useContext(TourContext);
  return useMemo<SpotlightTourHandle>(() => {
    if (!ctx) {
      // Matches the upstream behavior of silently no-oping when used outside a provider.
      const noop = () => {};
      return {
        current: null,
        goTo: noop,
        stop: noop,
        start: noop,
        next: noop,
        previous: noop,
        pause: noop,
        resume: noop,
        status: 'idle',
      };
    }
    return {
      current: ctx.current,
      goTo: ctx.goTo,
      stop: ctx.stop,
      // Upstream's `start()` re-runs from step 0; we route it through goTo(0) so
      // callers that only use `start()` still work.
      start: () => ctx.goTo(0),
      next: () => {
        if (ctx.current != null) ctx.goTo(ctx.current + 1);
      },
      previous: () => {
        if (ctx.current != null && ctx.current > 0) ctx.goTo(ctx.current - 1);
      },
      pause: ctx.stop,
      resume: () => {
        if (ctx.current != null) ctx.goTo(ctx.current);
      },
      status: ctx.current == null ? 'idle' : 'running',
    };
  }, [ctx]);
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
  },
  bar: {
    position: 'absolute',
  },
  barLeftAligned: {
    left: 0,
  },
  barTopLeftAligned: {
    top: 0,
    left: 0,
  },
  tooltip: {
    position: 'absolute',
  },
  tooltipHidden: {
    opacity: 0,
  },
  tooltipVisible: {
    opacity: 1,
  },
  fill: {
    flex: 1,
  },
});
