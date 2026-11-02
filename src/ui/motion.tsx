import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleProp, View, ViewStyle } from 'react-native';

/** DESIGN_SYSTEM.md section 9: sheet-like transitions 220-300 ms, gentle easing. */
export const MOTION = { reveal: 280, progress: 320, pulse: 900 } as const;

/** Zero when the person asked the system for reduced motion: state changes show instantly. */
export const motionDuration = (reduced: boolean, ms: number): number => (reduced ? 0 : ms);

export type MotionPreference = 'unknown' | 'reduced' | 'full';

/** The last answer from the platform, so screens opened later know it on their first frame. */
let known: boolean | null = null;

/**
 * Follows the system "reduce motion" setting. Until the platform has answered the preference is
 * `unknown` and nothing may animate: motion starts only once "full motion" is confirmed.
 */
export function useMotionPreference(): MotionPreference {
  const [reduced, setReduced] = useState<boolean | null>(known);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(v => {
        known = !!v;
        if (live) {
          setReduced(!!v);
        }
      })
      .catch(() => {
        // Cannot tell: the safe answer is less motion.
        known = true;
        if (live) {
          setReduced(true);
        }
      });
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', v => {
      known = !!v;
      setReduced(!!v);
    });
    return () => {
      live = false;
      sub?.remove?.();
    };
  }, []);
  return reduced === null ? 'unknown' : reduced ? 'reduced' : 'full';
}

/** True when the person asked for reduced motion (or it is not known yet). */
export function useReducedMotion(): boolean {
  return useMotionPreference() !== 'full';
}

/** Test hook: forget the cached answer. */
export const resetMotionPreference = (): void => {
  known = null;
};

/** Fades and rises into place once. With reduced motion it is simply there. */
export function Reveal({
  children,
  delay = 0,
  style,
  testID,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const pref = useMotionPreference();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (pref === 'unknown') {
      return;
    }
    if (pref === 'reduced') {
      v.setValue(1);
      return;
    }
    const a = Animated.timing(v, {
      toValue: 1,
      duration: MOTION.reveal,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [pref, v, delay]);
  return (
    <Animated.View
      testID={testID}
      style={[
        style,
        {
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** A soft ring that swells twice and stops. Static (a plain ring) with reduced motion. */
export function PulseRing({
  color,
  size = 56,
  testID,
}: {
  color: string;
  size?: number;
  testID?: string;
}) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      v.setValue(0);
      return;
    }
    const a = Animated.loop(
      Animated.timing(v, {
        toValue: 1,
        duration: MOTION.pulse,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      { iterations: 2 },
    );
    a.start();
    return () => a.stop();
  }, [reduced, v]);
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          position: 'absolute',
          width: size * 0.7,
          height: size * 0.7,
          borderRadius: size,
          borderWidth: 2,
          borderColor: color,
        }}
      />
      {reduced ? null : (
        <Animated.View
          style={{
            position: 'absolute',
            width: size * 0.7,
            height: size * 0.7,
            borderRadius: size,
            borderWidth: 2,
            borderColor: color,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }],
          }}
        />
      )}
    </View>
  );
}

/** A progress bar whose fill eases to its new value (or jumps, with reduced motion). */
export function AnimatedProgress({
  value,
  color,
  track,
  testID,
}: {
  value: number;
  color: string;
  track: string;
  testID?: string;
}) {
  const reduced = useReducedMotion();
  const pct = Math.max(0, Math.min(1, value));
  const v = useRef(new Animated.Value(pct)).current;
  useEffect(() => {
    if (reduced) {
      v.setValue(pct);
      return;
    }
    const a = Animated.timing(v, {
      toValue: pct,
      duration: MOTION.progress,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    a.start();
    return () => a.stop();
  }, [pct, reduced, v]);
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{ height: 10, borderRadius: 999, overflow: 'hidden', backgroundColor: track }}
    >
      <Animated.View
        style={{
          height: '100%',
          borderRadius: 999,
          backgroundColor: color,
          width: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }}
      />
    </View>
  );
}
