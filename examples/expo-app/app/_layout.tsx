import { Slot } from 'expo-router';
import { View } from 'react-native';
import { GremlinProvider } from '../lib/gremlin';
import { RecorderWidget } from '../components/RecorderWidget';

export default function RootLayout() {
  return (
    <GremlinProvider
      config={{
        appName: 'Gremlin Demo Shop',
        appVersion: '1.0.0',
        appBuild: '1',
        captureGestures: true,
        captureNavigation: true,
        capturePerformance: true,
        debug: true,
      }}
      autoStart
    >
      <View style={{ flex: 1 }}>
        <Slot />
        <RecorderWidget />
      </View>
    </GremlinProvider>
  );
}
