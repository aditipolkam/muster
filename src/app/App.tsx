import {
  DarkTheme,
  DefaultTheme,
  LinkingOptions,
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
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
import { AddPhaseScreen, PhaseAddedScreen } from '../features/adventures/ActivityScreens';
import { ActivityCompletedScreen } from '../features/adventures/ActivityRunScreens';
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
import { useNavSession } from '../runtime/navSession';
import { Services, ServicesProvider, useServices } from '../runtime/services';
import { createLogger } from '../shared/logger';
import { perf } from '../shared/perf';
import { Banner, Icon, IconName, Text } from '../ui/components';
import { size, ThemeProvider, useTheme } from '../ui/theme';
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
      <ActivityStack.Screen name="AddPhase" component={AddPhaseScreen} />
      <ActivityStack.Screen name="PhaseAdded" component={PhaseAddedScreen} />
      <ActivityStack.Screen name="ActivityCompleted" component={ActivityCompletedScreen} />
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

/**
 * Tab icon: the active tab sits in a 56x30 soft-green pill with the icon in the primary colour.
 * The label (bold when active) comes from the navigator.
 */
function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  const { c } = useTheme();
  return (
    <View
      style={[styles.tabPill, { backgroundColor: focused ? c.primarySoft : 'transparent' }]}
      accessibilityElementsHidden
    >
      <Icon name={name} size={22} color={focused ? c.primary : c.textMuted} filled={focused} />
    </View>
  );
}

function TabLabel({ focused, children }: { focused: boolean; children: string }) {
  const { c } = useTheme();
  return (
    <Text
      variant="label"
      color={focused ? c.text : c.textMuted}
      style={{ fontWeight: focused ? '800' : '600', marginTop: 2 }}
    >
      {children}
    </Text>
  );
}

const renderTabLabel = (p: { focused: boolean; children: string }) => <TabLabel {...p} />;

const tabIcon =
  (name: IconName) =>
  ({ focused }: { focused: boolean }) =>
    <TabIcon name={name} focused={focused} />;

const linking: LinkingOptions<RootTabParamList> = {
  // `trailmesh://` is the pre-rename scheme, still accepted for old invitations.
  prefixes: ['muster://', 'trailmesh://'],
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
  return <Tabs navRef={navRef} tab={tab} setTab={setTab} />;
}

function Tabs({
  navRef,
  tab,
  setTab,
}: {
  navRef: ReturnType<typeof useNavigationContainerRef<RootTabParamList>>;
  tab: string | undefined;
  setTab: (t: string | undefined) => void;
}) {
  const { c, dark } = useTheme();
  const insets = useSafeAreaInsets();
  // Navigating, or placing a pin on the map, is full screen: no tab bar.
  const hideTabs = useNavSession(s => !!s.target || s.picking);
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
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: c.text,
          tabBarInactiveTintColor: c.textMuted,
          tabBarLabel: renderTabLabel,
          tabBarStyle: hideTabs
            ? { display: 'none' }
            : {
                backgroundColor: c.surface,
                borderTopColor: c.border,
                height: 68 + insets.bottom,
                paddingTop: 8,
                paddingBottom: insets.bottom > 0 ? insets.bottom - 4 : 10,
              },
          // Compass is not a tab: it is reached from a meeting point or while navigating.
          ...(route.name === 'Navigate'
            ? { tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }
            : null),
          lazy: false,
        })}
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
            title: 'Groups',
            tabBarIcon: tabIcon('group'),
            tabBarButtonTestID: 'tab-groups',
          }}
        />
        <Tab.Screen
          name="Activity"
          component={ActivityNavigator}
          options={{ tabBarIcon: tabIcon('trail'), tabBarButtonTestID: 'tab-activity' }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileNavigator}
          options={{ tabBarIcon: tabIcon('profile'), tabBarButtonTestID: 'tab-profile' }}
        />
        <Tab.Screen name="Navigate" component={NavigateScreen} options={{ title: 'Compass' }} />
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
          <Banner tone="error" title="Muster could not start" body={error} />
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
  tabPill: {
    width: size.tabPillW,
    height: size.tabPillH,
    borderRadius: size.tabPillH / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
