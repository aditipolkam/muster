import React, { useMemo } from 'react';
import { View } from 'react-native';
import { projectToBox } from '../../domain/adventures/route';
import { useTheme } from '../../ui/theme';

/**
 * A quiet sketch of the recorded route and its checkpoints, drawn from plain views so it works with
 * no map data at all. "View on map" shows the same route over downloaded maps.
 */
export function RouteSketch({
  route,
  checkpoints,
  width,
  height = 180,
}: {
  route: { lat: number; lon: number }[];
  checkpoints: { lat: number; lon: number; reached: boolean }[];
  width: number;
  height?: number;
}) {
  const { c } = useTheme();
  const { line, dots } = useMemo(() => {
    const all = [...route, ...checkpoints];
    const p = projectToBox(all, width, height);
    return { line: p.slice(0, route.length), dots: p.slice(route.length) };
  }, [route, checkpoints, width, height]);
  return (
    <View
      testID="route-sketch"
      accessible
      accessibilityLabel={`Route sketch with ${route.length} recorded points and ${checkpoints.length} checkpoints`}
      style={{
        width,
        height,
        borderRadius: 12,
        backgroundColor: c.surfaceAlt,
        overflow: 'hidden',
      }}
    >
      {line.slice(1).map((b, i) => {
        const a = line[i] as { x: number; y: number };
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.5) {
          return null;
        }
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: (a.x + b.x) / 2 - len / 2,
              top: (a.y + b.y) / 2 - 1.5,
              width: len,
              height: 3,
              borderRadius: 2,
              backgroundColor: c.mapTrail,
              transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
            }}
          />
        );
      })}
      {dots.map((d, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: d.x - 6,
            top: d.y - 6,
            width: 12,
            height: 12,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: c.surface,
            backgroundColor: checkpoints[i]?.reached ? c.primary : c.textMuted,
          }}
        />
      ))}
    </View>
  );
}
