import {
  DarkTheme,
  DefaultTheme,
  LinkingOptions,
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { BottomTabBarButtonProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CreateGroupScreen,
  GroupDetailsScreen,
  GroupInfoScreen,
  GroupsScreen,
  JoinGroupScreen,
  MeetingPointScreen,
} from '../features/groups/GroupsScreens';
import {
  AdventureDetailsScreen,
  AdventureEditorScreen,
  AdventuresScreen,
} from '../features/adventures/AdventuresScreens';
import {
  CheckpointDetailsScreen,
  CheckpointEditorScreen,
} from '../features/adventures/CheckpointScreens';
import { AchievementsScreen, AdventureSummaryScreen } from '../features/adventures/RecapScreens';
import { DownloadScreen } from '../features/maps-manager/DownloadScreen';
import { RegionsScreen } from '../features/maps-manager/RegionsScreen';
import { MeshDiagnosticsScreen } from '../features/mesh-diagnostics/MeshDiagnosticsScreen';
import { AdventureToastHost } from '../features/adventures/AdventureToastHost';
import { MapScreen } from '../features/map/MapScreen';
import { OnboardingScreen } from '../features/onboarding/OnboardingScreen';
import { ProfileScreen } from '../features/profile/ProfileScreen';
import { NavigateScreen } from '../features/navigate/NavigateScreen';
import { SavedScreen } from '../features/markers/SavedScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import {
  ActivityStackParamList,
  GroupsStackParamList,
  ProfileStackParamList,
  RootTabParamList,
} from '../runtime/navigation';
import { bindMeshToAppState } from '../runtime/meshLifecycle';
import { Services, ServicesProvider, useServices } from '../runtime/services';
import { createLogger } from '../shared/logger';
import { perf } from '../shared/perf';
import { Banner, Icon, IconName, Text } from '../ui/components';
import { ThemeProvider, useTheme } from '../ui/theme';
import { bootstrap } from './bootstrap';

const log = createLogger('app');
const Tab = createBottomTabNavigator<RootTabParamList>();
const ActivityStack = createNativeStackNavigator<ActivityStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const GroupsStack = createNativeStackNavigator<GroupsStackParamList>();

function GroupsNavigator() {
  return (
    <GroupsStack.Navigator screenOptions={{ headerShown: false }}>
      <GroupsStack.Screen name="GroupsList" component={GroupsScreen} />
      <GroupsStack.Screen name="CreateGroup" component={CreateGroupScreen} />
      <GroupsStack.Screen name="JoinGroup" component={JoinGroupScreen} />
      <GroupsStack.Screen name="GroupDetails" component={GroupDetailsScreen} />
      <GroupsStack.Screen name="GroupInfo" component={GroupInfoScreen} />
      <GroupsStack.Screen name="MeetingPoint" component={MeetingPointScreen} />
    </GroupsStack.Navigator>
  );
}

function ActivityNavigator() {
  return (
    <ActivityStack.Navigator screenOptions={{ headerShown: false }}>
      <ActivityStack.Screen name="Adventures" component={AdventuresScreen} />
      <ActivityStack.Screen name="AdventureEditor" component={AdventureEditorScreen} />
      <ActivityStack.Screen name="AdventureDetails" component={AdventureDetailsScreen} />
      <ActivityStack.Screen name="CheckpointEditor" component={CheckpointEditorScreen} />
      <ActivityStack.Screen name="CheckpointDetails" component={CheckpointDetailsScreen} />
      <ActivityStack.Screen name="AdventureSummary" component={AdventureSummaryScreen} />
      <ActivityStack.Screen name="Achievements" component={AchievementsScreen} />
    </ActivityStack.Navigator>
  );
}

function ProfileNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileHome" component={ProfileScreen} />
      <ProfileStack.Screen name="Downloaded" component={RegionsScreen} />
      <ProfileStack.Screen name="Download" component={DownloadScreen} />
      <ProfileStack.Screen name="Saved" component={SavedScreen} />
      <ProfileStack.Screen name="Mesh" component={MeshDiagnosticsScreen} />
      <ProfileStack.Screen name="Settings" component={SettingsScreen} />
    </ProfileStack.Navigator>
  );
}

const tabIcon =
  (name: IconName) =>
  ({ color, focused }: { color: string; focused: boolean }) =>
    <Icon name={name} size={24} color={color} filled={focused} />;

/** The Map tab is the app's home: a raised, filled button in the middle of the bar. */
function MapTabButton(props: BottomTabBarButtonProps) {
  const { onPress, testID } = props;
  const { c } = useTheme();
  // React Navigation 7 reports the selected tab as `aria-selected`.
  const focused = !!props['aria-selected'];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="Map"
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      style={styles.mapSlot}
    >
      <View
        style={[
          styles.mapOrb,
          {
            backgroundColor: focused ? c.primary : c.deep,
            borderColor: c.bg,
            shadowColor: c.primary,
          },
        ]}
      >
        <Icon name="map" size={28} color={c.onPrimary} filled />
      </View>
      <Text variant="label" color={focused ? c.primary : c.textMuted} style={styles.mapLabel}>
        Map
      </Text>
    </Pressable>
  );
}

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
      Activity: {
        screens: {
          Adventures: 'adventures',
          Achievements: 'achievements',
        },
      },
      Profile: {
        screens: {
          ProfileHome: 'profile',
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
  const insets = useSafeAreaInsets();
  const navRef = useNavigationContainerRef<RootTabParamList>();
  const [tab, setTab] = useState<string | undefined>('Map');
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
        onDone={name => {
          void kv.set('profile.name', name);
          void kv.set('onboarding.done', '1');
          setOnboarded(true);
        }}
      />
    );
  }
  const base = dark ? DarkTheme : DefaultTheme;
  return (
    <NavigationContainer
      ref={navRef}
      onStateChange={state => setTab(state?.routes[state.index]?.name)}
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
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          tabBarStyle: {
            backgroundColor: c.surface,
            borderTopColor: c.border,
            height: 62 + insets.bottom,
            paddingTop: 6,
            paddingBottom: insets.bottom > 0 ? insets.bottom - 4 : 8,
          },
          lazy: false,
        }}
      >
        <Tab.Screen
          name="Navigate"
          component={NavigateScreen}
          options={{
            title: 'Compass',
            tabBarIcon: tabIcon('compass'),
            tabBarButtonTestID: 'tab-navigate',
          }}
        />
        <Tab.Screen
          name="Activity"
          component={ActivityNavigator}
          options={{ tabBarIcon: tabIcon('trail'), tabBarButtonTestID: 'tab-activity' }}
        />
        <Tab.Screen
          name="Map"
          component={MapScreen}
          options={{
            tabBarButton: MapTabButton,
            tabBarButtonTestID: 'tab-map',
          }}
        />
        <Tab.Screen
          name="Groups"
          component={GroupsNavigator}
          options={{
            title: 'Groups',
            tabBarIcon: tabIcon('group'),
            tabBarButtonTestID: 'tab-groups',
          }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileNavigator}
          options={{ tabBarIcon: tabIcon('profile'), tabBarButtonTestID: 'tab-profile' }}
        />
      </Tab.Navigator>
      <AdventureToastHost
        tab={tab}
        onNavigate={(screen, params) =>
          (navRef as unknown as { navigate: (n: string, p: object) => void }).navigate(
            screen,
            params,
          )
        }
      />
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

const styles = StyleSheet.create({
  mapSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-start' },
  mapOrb: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginTop: -22,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  mapLabel: { marginTop: 2, fontWeight: '600' },
});

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
