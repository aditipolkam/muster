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
import {
  CreateGroupScreen,
  GroupDetailsScreen,
  GroupsScreen,
  JoinGroupScreen,
  MeetingPointScreen,
} from '../features/groups/GroupsScreens';
import { DownloadScreen } from '../features/maps-manager/DownloadScreen';
import { RegionsScreen } from '../features/maps-manager/RegionsScreen';
import { MeshDiagnosticsScreen } from '../features/mesh-diagnostics/MeshDiagnosticsScreen';
import { MapScreen } from '../features/map/MapScreen';
import { OnboardingScreen } from '../features/onboarding/OnboardingScreen';
import { MoreScreen } from '../features/more/MoreScreen';
import { NavigateScreen } from '../features/navigate/NavigateScreen';
import { SavedScreen } from '../features/markers/SavedScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { GroupsStackParamList, MoreStackParamList, RootTabParamList } from '../runtime/navigation';
import { bindMeshToAppState } from '../runtime/meshLifecycle';
import { Services, ServicesProvider, useServices } from '../runtime/services';
import { createLogger } from '../shared/logger';
import { perf } from '../shared/perf';
import { Banner, Icon, IconName, Text } from '../ui/components';
import { ThemeProvider, useTheme } from '../ui/theme';
import { bootstrap } from './bootstrap';

const log = createLogger('app');
const Tab = createBottomTabNavigator<RootTabParamList>();
const MoreStack = createNativeStackNavigator<MoreStackParamList>();
const GroupsStack = createNativeStackNavigator<GroupsStackParamList>();

function GroupsNavigator() {
  return (
    <GroupsStack.Navigator screenOptions={{ headerShown: false }}>
      <GroupsStack.Screen name="GroupsList" component={GroupsScreen} />
      <GroupsStack.Screen name="CreateGroup" component={CreateGroupScreen} />
      <GroupsStack.Screen name="JoinGroup" component={JoinGroupScreen} />
      <GroupsStack.Screen name="GroupDetails" component={GroupDetailsScreen} />
      <GroupsStack.Screen name="MeetingPoint" component={MeetingPointScreen} />
    </GroupsStack.Navigator>
  );
}

function MoreNavigator() {
  return (
    <MoreStack.Navigator screenOptions={{ headerShown: false }}>
      <MoreStack.Screen name="MoreList" component={MoreScreen} />
      <MoreStack.Screen name="Downloaded" component={RegionsScreen} />
      <MoreStack.Screen name="Download" component={DownloadScreen} />
      <MoreStack.Screen name="Saved" component={SavedScreen} />
      <MoreStack.Screen name="Mesh" component={MeshDiagnosticsScreen} />
      <MoreStack.Screen name="Settings" component={SettingsScreen} />
    </MoreStack.Navigator>
  );
}

const tabIcon =
  (name: IconName) =>
  ({ color }: { color: string }) =>
    <Icon name={name} size={24} color={color} />;

const linking: LinkingOptions<RootTabParamList> = {
  prefixes: ['trailmesh://'],
  config: {
    screens: {
      Map: 'map',
      Groups: {
        screens: {
          GroupsList: 'groups',
          CreateGroup: 'groups/new',
          JoinGroup: 'join',
        },
      },
      Navigate: 'navigate',
      More: {
        screens: {
          MoreList: 'more',
          Downloaded: 'maps',
          Download: 'maps/download',
          Saved: 'saved',
          Mesh: 'mesh',
          Settings: 'settings',
        },
      },
    },
  },
};

function Shell() {
  const { c, dark } = useTheme();
  const { mesh, kv } = useServices();
  useEffect(() => bindMeshToAppState(mesh), [mesh]);
  // null = still reading the flag; the first launch shows onboarding once.
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  useEffect(() => {
    void kv.get('onboarding.done').then(v => setOnboarded(v === '1'));
  }, [kv]);
  if (onboarded === null) {
    return null;
  }
  if (!onboarded) {
    return (
      <OnboardingScreen
        onDone={() => {
          setOnboarded(true);
          void kv.set('onboarding.done', '1');
        }}
      />
    );
  }
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
          tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
          tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
          lazy: false,
        }}
      >
        <Tab.Screen
          name="Map"
          component={MapScreen}
          options={{ tabBarIcon: tabIcon('map'), tabBarButtonTestID: 'tab-map' }}
        />
        <Tab.Screen
          name="Groups"
          component={GroupsNavigator}
          options={{
            title: 'Group',
            tabBarIcon: tabIcon('group'),
            tabBarButtonTestID: 'tab-groups',
          }}
        />
        <Tab.Screen
          name="Navigate"
          component={NavigateScreen}
          options={{ tabBarIcon: tabIcon('navigate'), tabBarButtonTestID: 'tab-navigate' }}
        />
        <Tab.Screen
          name="More"
          component={MoreNavigator}
          options={{ tabBarIcon: tabIcon('more'), tabBarButtonTestID: 'tab-more' }}
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
