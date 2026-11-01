import qrcode from 'qrcode-generator';
import React, { useMemo } from 'react';
import { View } from 'react-native';

/** Renders `value` as a QR code from plain Views (no native module, works offline). */
export function QrCode({ value, size = 240 }: { value: string; size?: number }) {
  const rows = useMemo(() => {
    // Type 0 = smallest version that fits; error correction M survives a scuffed screen.
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    return Array.from({ length: n }, (_r, r) =>
      Array.from({ length: n }, (_c, c) => qr.isDark(r, c)),
    );
  }, [value]);
  const cell = size / rows.length;
  return (
    <View
      accessible
      accessibilityLabel="Invitation QR code"
      testID="qr-code"
      style={{ width: size, height: size, backgroundColor: '#FFFFFF', padding: 0 }}
    >
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', height: cell }}>
          {row.map((dark, c) => (
            <View
              key={c}
              style={{ width: cell, height: cell, backgroundColor: dark ? '#000' : '#FFF' }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
