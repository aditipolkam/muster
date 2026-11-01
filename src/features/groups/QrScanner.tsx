import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from '../../ui/components';
import { radius, space } from '../../ui/theme';

/** Camera preview that reports the first QR code it reads. Needs the camera permission. */
export function QrScanner({
  onScan,
  onCancel,
}: {
  onScan: (text: string) => void;
  onCancel: () => void;
}) {
  const [permission, request] = useCameraPermissions();
  const done = useRef(false);

  if (!permission) {
    return <Text muted>Checking camera access…</Text>;
  }
  if (!permission.granted) {
    return (
      <View style={{ gap: space.sm }}>
        <Text>
          TrailMesh needs the camera only to read an invitation QR code. Nothing is recorded or
          sent.
        </Text>
        <Button label="Allow camera" onPress={() => void request()} testID="camera-allow" />
        <Button variant="ghost" label="Cancel" onPress={onCancel} />
      </View>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.frame}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={e => {
            if (!done.current) {
              done.current = true;
              onScan(e.data);
            }
          }}
        />
      </View>
      <Button variant="ghost" label="Cancel" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 300, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' },
});
