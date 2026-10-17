// Full-screen barcode scanner using the phone's own scanner (works in Expo Go).
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { useStore } from '@/lib/store';

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const { reportScan } = useStore();
  const last = useRef<string | null>(null);
  const done = useRef(false);

  if (!permission) return <View style={{ flex: 1, backgroundColor: '#000' }} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.hint}>FoodLog needs the camera to read barcodes.</Text>
        <Button kind="primary" title="Allow camera" onPress={requestPermission} />
        <Button kind="ghost" title="Cancel" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }} accessibilityLabel="Barcode scanner">
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={({ data }) => {
          if (done.current) return;
          // Same number twice in a row, to avoid misreads.
          if (last.current === data) {
            done.current = true;
            router.back();
            reportScan(data);
          }
          last.current = data;
        }}
      />
      <View pointerEvents="none" style={styles.window} />
      <SafeAreaView edges={['bottom']} style={styles.bottom}>
        <Text style={styles.hint} accessibilityLiveRegion="polite">Line the barcode up inside the box</Text>
        <Button title="Close scanner" onPress={() => router.back()} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#000', justifyContent: 'center', padding: 24, gap: 12 },
  window: { position: 'absolute', left: '6%', right: '6%', top: '37%', height: '26%', borderWidth: 3, borderColor: '#fff', borderRadius: 14 },
  bottom: { position: 'absolute', left: 16, right: 16, bottom: 16, gap: 12 },
  hint: { color: '#fff', fontSize: 17, textAlign: 'center', textShadowColor: '#000', textShadowRadius: 3 },
});
