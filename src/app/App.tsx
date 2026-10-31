import {
  DarkTheme,
  DefaultTheme,
  LinkingOptions,
  NavigationContainer,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DownloadScreen } from '../features/maps-manager/DownloadScreen';
import { RegionsScreen } from '../features/maps-manager/RegionsScreen';
import { MeshDiagnosticsScreen } from '../features/mesh-diagnostics/MeshDiagnosticsScreen';
import { MapScreen } from '../features/map/MapScreen';
import { SavedScreen } from '../features/markers/SavedScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { MapsStackParamList, RootTabParamList } from '../runtime/navigation';
import { bindMeshToAppState } from '../runtime/meshLifecycle';
import { Services, ServicesProvider, useServices } from '../runtime/services';
import { createLogger } from '../shared/logger';
import { perf } from '../shared/perf';
import { Banner, Text } from '../ui/components';
import { ThemeProvider, useTheme } from '../ui/theme';
import { bootstrap } from './bootstrap';

const log = createLogger('app');
const Tab = createBottomTabNavigator<RootTabParamList>();
const MapsStack = createNativeStackNavigator<MapsStackParamList>();

function MapsNavigator() {
  return (
    <MapsStack.Navigator screenOptions={{ headerShown: false }}>
      <MapsStack.Screen name="Downloaded" component={RegionsScreen} />
      <MapsStack.Screen name="Download" component={DownloadScreen} />
    </MapsStack.Navigator>
  );
}

const glyph =
  (g: string) =>
  ({ color }: { color: string }) =>
    (
      <Text variant="heading" color={color} accessibilityElementsHidden>
        {g}
      </Text>
    );

const linking: LinkingOptions<RootTabParamList> = {
  prefixes: ['trailmesh://'],
  config: {
    screens: {
      Map: 'map',
      Maps: { screens: { Downloaded: 'maps', Download: 'maps/download' } },
      Saved: 'saved',
      Mesh: 'mesh',
      Settings: 'settings',
    },
  },
};

function Shell() {
  const { c, dark } = useTheme();
  const { mesh } = useServices();
  useEffect(() => bindMeshToAppState(mesh), [mesh]);
  const base = dark ? DarkTheme : DefaultTheme;
  return (
    <NavigationContainer
      linking={linking}
      theme={{
        ...base,
        colors: {
          ...base.colors,
          background: c.bg,
          card: c.surface,
          border: c.border,
          primary: c.primary,
          text: c.text,
        },
      }}
    >
      <Tab.Navigator
        initialRouteName="Map"
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.primary,
          tabBarInactiveTintColor: c.textMuted,
          lazy: false,
        }}
      >
        <Tab.Screen
          name="Map"
          component={MapScreen}
          options={{ tabBarIcon: glyph('◉'), tabBarButtonTestID: 'tab-map' }}
        />
        <Tab.Screen
          name="Maps"
          component={MapsNavigator}
          options={{ title: 'Maps', tabBarIcon: glyph('▤'), tabBarButtonTestID: 'tab-maps' }}
        />
        <Tab.Screen
          name="Saved"
          component={SavedScreen}
          options={{ tabBarIcon: glyph('★'), tabBarButtonTestID: 'tab-saved' }}
        />
        <Tab.Screen
          name="Mesh"
          component={MeshDiagnosticsScreen}
          options={{ tabBarIcon: glyph('⌁'), tabBarButtonTestID: 'tab-mesh' }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ tabBarIcon: glyph('⚙'), tabBarButtonTestID: 'tab-settings' }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function Root() {
  const { c, dark } = useTheme();
  const [services, setServices] = useState<Services | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bootstrap().then(
      s => {
        perf.mark('boot.done');
        setServices(s);
      },
      e => {
        log.error(`bootstrap failed: ${String(e)}`);
        setError(String(e));
      },
    );
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      {services ? (
        <ServicesProvider services={services}>
          <Shell />
        </ServicesProvider>
      ) : error ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
          <Banner tone="error" title="TrailMesh could not start" body={error} />
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator color={c.primary} />
          <Text muted>Preparing offline maps…</Text>
        </View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
