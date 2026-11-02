import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from './theme';

export type BadgeIcon =
  | 'summit'
  | 'trail'
  | 'compass'
  | 'forest'
  | 'camp'
  | 'flag'
  | 'mesh'
  | 'map';

/** A triangle drawn with borders: the one shape most of the set is built from. */
function Tri({ w, h, color, style }: { w: number; h: number; color: string; style?: object }) {
  return (
    <View
      style={[
        {
          width: 0,
          height: 0,
          borderLeftWidth: w / 2,
          borderRightWidth: w / 2,
          borderBottomWidth: h,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
        },
        style,
      ]}
    />
  );
}

function Mark({ icon, color, bg }: { icon: BadgeIcon; color: string; bg: string }) {
  switch (icon) {
    case 'summit':
      return (
        <View style={styles.box}>
          <Tri w={22} h={20} color={color} style={{ position: 'absolute', left: 14, bottom: 8 }} />
          <Tri w={26} h={26} color={color} style={{ position: 'absolute', left: 2, bottom: 8 }} />
          <Tri w={8} h={8} color={bg} style={{ position: 'absolute', left: 11, bottom: 26 }} />
        </View>
      );
    case 'forest':
      return (
        <View style={styles.box}>
          {[2, 14, 26].map((x, i) => (
            <View
              key={x}
              style={{ position: 'absolute', left: x, bottom: 8, alignItems: 'center' }}
            >
              <Tri w={12} h={i === 1 ? 20 : 15} color={color} />
              <View style={{ width: 2, height: 4, backgroundColor: color }} />
            </View>
          ))}
        </View>
      );
    case 'camp':
      return (
        <View style={styles.box}>
          <Tri w={30} h={22} color={color} style={{ position: 'absolute', left: 4, bottom: 8 }} />
          <Tri w={8} h={11} color={bg} style={{ position: 'absolute', left: 15, bottom: 8 }} />
        </View>
      );
    case 'trail':
      return (
        <View style={styles.box}>
          {[
            [4, 10],
            [12, 16],
            [20, 22],
            [27, 17],
            [31, 26],
          ].map(([x, y]) => (
            <View
              key={`${x}-${y}`}
              style={{
                position: 'absolute',
                left: x,
                bottom: y,
                width: 5,
                height: 5,
                borderRadius: 3,
                backgroundColor: color,
              }}
            />
          ))}
        </View>
      );
    case 'compass':
      return (
        <View style={styles.box}>
          <View style={[styles.ring, { borderColor: color }]} />
          <View style={{ transform: [{ rotate: '35deg' }] }}>
            <Tri w={8} h={13} color={color} />
            <Tri w={8} h={13} color={bg} style={{ transform: [{ rotate: '180deg' }] }} />
          </View>
        </View>
      );
    case 'flag':
      return (
        <View style={styles.box}>
          <View
            style={{
              position: 'absolute',
              left: 9,
              bottom: 7,
              width: 3,
              height: 26,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: 12,
              bottom: 17,
              width: 17,
              height: 11,
              backgroundColor: color,
            }}
          />
        </View>
      );
    case 'mesh':
      return (
        <View style={styles.box}>
          {[
            [8, 10],
            [28, 10],
            [18, 27],
          ].map(([x, y]) => (
            <View
              key={`${x}-${y}`}
              style={{
                position: 'absolute',
                left: x,
                bottom: y,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: color,
              }}
            />
          ))}
          <View
            style={{
              position: 'absolute',
              left: 12,
              bottom: 13,
              width: 20,
              height: 2,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: 10,
              bottom: 20,
              width: 14,
              height: 2,
              backgroundColor: color,
              transform: [{ rotate: '60deg' }],
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: 24,
              bottom: 20,
              width: 14,
              height: 2,
              backgroundColor: color,
              transform: [{ rotate: '-60deg' }],
            }}
          />
        </View>
      );
    case 'map':
      return (
        <View style={styles.box}>
          {[5, 15, 25].map(x => (
            <View
              key={x}
              style={{
                position: 'absolute',
                left: x,
                bottom: 8,
                width: 9,
                height: 24,
                backgroundColor: color,
                opacity: x === 15 ? 0.65 : 1,
              }}
            />
          ))}
        </View>
      );
  }
}

/**
 * A badge icon drawn from simple shapes (mountains, a tent, pines, a compass) in the app's own
 * colours, so the set matches the rest of the UI. Locked badges are drawn muted.
 */
export function BadgeMark({
  icon,
  unlocked,
  size = 56,
  testID,
}: {
  icon: BadgeIcon;
  unlocked: boolean;
  size?: number;
  testID?: string;
}) {
  const { c } = useTheme();
  const fg = unlocked ? c.primary : c.textMuted;
  const bg = unlocked ? c.primarySoft : c.surfaceAlt;
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size * 0.28,
          backgroundColor: bg,
          borderColor: unlocked ? c.primary : c.border,
          opacity: unlocked ? 1 : 0.8,
        },
      ]}
    >
      <View style={{ transform: [{ scale: size / 56 }] }}>
        <Mark icon={icon} color={fg} bg={bg} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  box: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 32, height: 32, borderRadius: 16, borderWidth: 2.5 },
});
