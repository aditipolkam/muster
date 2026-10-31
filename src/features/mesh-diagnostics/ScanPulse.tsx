import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import { useTheme } from '../../ui/theme';

/** Expanding rings while the mesh is scanning. Static when the user prefers reduced motion. */
export function ScanPulse({ active, size = 56 }: { active: boolean; size?: number }) {
  const { c } = useTheme();
  const t = useRef(new Animated.Value(0)).current;
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce, () => undefined);
  }, []);

  useEffect(() => {
    if (!active || reduce) {
      t.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduce, t]);

  const ring = (delay: number) => {
    const phase = Animated.modulo(Animated.add(t, delay), 1);
    return {
      opacity: phase.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
      transform: [{ scale: phase.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.4] }) }],
    };
  };
  const base = {
    position: 'absolute' as const,
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: 2,
    borderColor: c.primary,
  };

  return (
    <View
      accessible
      accessibilityLabel={active ? 'Scanning for nearby devices' : 'Not scanning'}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      {active && !reduce ? (
        <>
          <Animated.View style={[base, ring(0)]} />
          <Animated.View style={[base, ring(0.5)]} />
        </>
      ) : null}
      <View
        style={{
          width: size * 0.3,
          height: size * 0.3,
          borderRadius: size * 0.15,
          backgroundColor: active ? c.primary : c.border,
        }}
      />
    </View>
  );
}
