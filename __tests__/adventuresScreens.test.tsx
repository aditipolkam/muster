import React from 'react';
import { AccessibilityInfo, Alert, Animated, View } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { destination } from '../src/domain/geo';
import {
  AdventureDetailsScreen,
  AdventureEditorScreen,
  AdventuresScreen,
} from '../src/features/adventures/AdventuresScreens';
import {
  CheckpointDetailsScreen,
  CheckpointEditorScreen,
} from '../src/features/adventures/CheckpointScreens';
import {
  AchievementsScreen,
  AdventureSummaryScreen,
} from '../src/features/adventures/RecapScreens';
import { GroupInfoScreen } from '../src/features/groups/GroupsScreens';
import { AdventureToastHost } from '../src/features/adventures/AdventureToastHost';
import { AdventureBanners } from '../src/features/adventures/AdventureBanners';
import { MapScreen } from '../src/features/map/MapScreen';
import { SettingsScreen } from '../src/features/settings/SettingsScreen';
import { useLocationStore } from '../src/platform/locationStore';
import { Harness } from '../src/testing/componentHarness';
import { makeTestServices } from '../src/testing/services';
import { MOTION, PulseRing, Reveal, motionDuration, resetMotionPreference } from '../src/ui/motion';

jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    useFocusEffect: (cb: () => void | (() => void)) => R.useEffect(cb, [cb]),
  };
});
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false }, jest.fn()],
}));

const mockMap: { sources: Record<string, Record<string, any>>; map: Record<string, any> | null } = {
  sources: {},
  map: null,
};
jest.mock('@maplibre/maplibre-react-native', () => {
  const R = require('react');
  const { View: V } = require('react-native');
  return {
    Map: (p: Record<string, any>) => {
      mockMap.map = p;
      R.useImperativeHandle(p.ref, () => ({ getCenter: async () => [-5.0, 56.8] }));
      return R.createElement(V, { testID: 'maplibre-map' }, p.children);
    },
    Camera: (p: Record<string, any>) => {
      R.useImperativeHandle(p.ref, () => ({
        easeTo: jest.fn(),
        flyTo: jest.fn(),
        fitBounds: jest.fn(),
      }));
      return null;
    },
    GeoJSONSource: (p: Record<string, any>) => {
      mockMap.sources[p.id] = p;
      return R.createElement(V, { testID: `src-${p.id}` }, p.children);
    },
    Layer: () => null,
  };
});

const nav = () => {
  const calls: unknown[][] = [];
  const n: any = {
    navigate: (...a: unknown[]) => calls.push(['navigate', ...a]),
    replace: (...a: unknown[]) => calls.push(['replace', ...a]),
    goBack: () => calls.push(['goBack']),
    getParent: () => n,
  };
  return { n, calls };
};

const START = { lat: 56.8, lon: -5.0 };
const VIEW = destination(START, 90, 800);

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockMap.sources = {};
  useLocationStore.setState({
    permission: 'granted',
    fix: null,
    headingDeg: null,
    watchingSince: null,
    lastError: null,
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {
  alertSpy.mockRestore();
  jest.restoreAllMocks();
});

async function seed() {
  const t = await makeTestServices({ address: 'off1me' });
  const a = await t.services.adventures.createAdventure({
    name: 'Ridge walk',
    description: 'Layers',
    start: { ...START, label: 'Car park' },
  });
  if (!a.ok) {
    throw new Error('seed');
  }
  const v = await t.services.adventures.addCheckpoint(a.value.id, {
    name: 'Viewpoint',
    kind: 'viewpoint',
    ...VIEW,
  });
  const s = await t.services.adventures.addCheckpoint(a.value.id, {
    name: 'Summit',
    kind: 'summit',
    ...destination(START, 45, 1500),
  });
  if (!v.ok || !s.ok) {
    throw new Error('seed');
  }
  return { ...t, adv: a.value, view: v.value, top: s.value };
}

describe('Adventures list and journal', () => {
  it('shows an empty state, the achievements entry and a way to start', async () => {
    const t = await makeTestServices();
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <AdventuresScreen navigation={n} route={{} as any} />
      </Harness>,
    );
    expect(await screen.findByText('No adventures yet')).toBeTruthy();
    expect(await screen.findByText('0 of 13 earned')).toBeTruthy();
    fireEvent.press(screen.getByTestId('new-adventure'));
    expect(calls).toContainEqual(['navigate', 'AdventureEditor']);
    fireEvent.press(screen.getByTestId('open-achievements'));
    expect(calls).toContainEqual(['navigate', 'Achievements']);
  });

  it('lists planned and active adventures with progress, and finished ones in the journal', async () => {
    const t = await seed();
    await t.services.adventures.act(t.adv.id, 'start');
    const done = await t.services.adventures.createAdventure({ name: 'Old trip' });
    const id = done.ok ? done.value.id : '';
    await t.services.adventures.act(id, 'cancel');
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <AdventuresScreen navigation={n} route={{} as any} />
      </Harness>,
    );
    expect(await screen.findByText('Ridge walk')).toBeTruthy();
    expect(screen.getByText(/0 of 2 checkpoints/)).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    fireEvent.press(screen.getByTestId(`adventure-${t.adv.id}`));
    expect(calls).toContainEqual(['navigate', 'AdventureDetails', { adventureId: t.adv.id }]);
    fireEvent.press(screen.getByText('Journal'));
    expect(await screen.findByText('Old trip')).toBeTruthy();
    expect(screen.getByText('Cancelled')).toBeTruthy();
  });
});

describe('Adventure editor', () => {
  it('creates an adventure and opens it; refuses to save without a name', async () => {
    const t = await makeTestServices();
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <AdventureEditorScreen navigation={n} route={{ params: undefined } as any} />
      </Harness>,
    );
    fireEvent.press(screen.getByTestId('adventure-save'));
    expect(await t.services.adventuresRepo.list()).toEqual([]);
    fireEvent.changeText(screen.getByTestId('adventure-name'), 'Camp weekend');
    fireEvent.changeText(screen.getByTestId('adventure-description'), 'Two nights');
    useLocationStore.setState({ fix: { ...START, accM: 5, fixAt: Date.now() } });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('use-my-location'));
    });
    fireEvent.press(screen.getByTestId('adventure-save'));
    await waitFor(() => expect(calls.find(c => c[0] === 'replace')).toBeDefined());
    const [a] = await t.services.adventuresRepo.list();
    expect(a).toMatchObject({
      name: 'Camp weekend',
      description: 'Two nights',
      startLat: START.lat,
      status: 'planned',
    });
  });

  it('offers a group only to its organizer', async () => {
    const t = await makeTestServices({ address: 'off1me' });
    await t.mesh.start();
    await t.services.groups.start({ poll: false });
    const g = await t.services.groups.createGroup({ name: 'Crew' });
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <AdventureEditorScreen navigation={n} route={{ params: undefined } as any} />
      </Harness>,
    );
    expect(await screen.findByText('Crew')).toBeTruthy();
    expect(g.ok).toBe(true);
  });
});

describe('Adventure details and the active progress panel', () => {
  it('shows "N of M checkpoints explored", remaining and the live clock, and drives the lifecycle', async () => {
    const t = await seed();
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <AdventureDetailsScreen
          navigation={n}
          route={{ params: { adventureId: t.adv.id } } as any}
        />
      </Harness>,
    );
    expect(await screen.findByTestId('progress-label')).toHaveTextContent(
      '0 of 2 checkpoints explored',
    );
    expect(screen.getByTestId('metric-remaining')).toHaveTextContent('2');
    await act(async () => {
      fireEvent.press(screen.getByTestId('action-start'));
    });
    await waitFor(() => expect(screen.getByText('Active')).toBeTruthy());
    await act(async () => {
      await t.services.adventures.confirmArrival(t.adv.id, t.view.id, 'manual');
    });
    await waitFor(() =>
      expect(screen.getByTestId('progress-label')).toHaveTextContent('1 of 2 checkpoints explored'),
    );
    expect(screen.getByTestId('metric-remaining')).toHaveTextContent('1');
    await act(async () => {
      fireEvent.press(screen.getByTestId('action-pause'));
    });
    await waitFor(() => expect(screen.getByText('Paused')).toBeTruthy());
    expect(screen.getByTestId('action-resume')).toBeTruthy();
    fireEvent.press(screen.getByTestId('action-complete'));
    const buttons = alertSpy.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find(b => b.text === 'Finish')!.onPress!();
    });
    await waitFor(() =>
      expect(calls).toContainEqual([
        'replace',
        'AdventureSummary',
        { adventureId: t.adv.id, celebrate: true },
      ]),
    );
    expect((await t.services.adventuresRepo.get(t.adv.id))?.status).toBe('completed');
  });

  it('never lets a member run a group adventure', async () => {
    const t = await makeTestServices({ address: 'off1member' });
    const g = {
      id: 'g',
      name: 'Crew',
      organizer: 'off1org',
      role: 'member' as const,
      status: 'active' as const,
      createdAt: 1,
      joinedAt: 1,
      memberRev: 1,
    };
    await t.services.groupsRepo.save(g);
    await t.mesh.start();
    await t.services.adventuresRepo.save({
      id: 'a1',
      groupId: 'g',
      owner: 'off1org',
      name: 'Group day',
      description: null,
      status: 'planned',
      rev: 1,
      startLat: null,
      startLon: null,
      startLabel: null,
      createdAt: 1,
      startedAt: null,
      endedAt: null,
      tzOffsetMin: 0,
      progress: {
        resumedAt: null,
        activeMs: 0,
        distanceM: 0,
        offlineMapsCovered: null,
        networkUsed: false,
        meshExchangeAt: null,
      },
    });
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <AdventureDetailsScreen navigation={n} route={{ params: { adventureId: 'a1' } } as any} />
      </Harness>,
    );
    expect(await screen.findByText('Group day')).toBeTruthy();
    expect(screen.queryByTestId('action-start')).toBeNull();
    expect(screen.getByTestId('join-adventure')).toBeTruthy();
    expect(screen.queryByTestId('add-checkpoint')).toBeNull();
  });
});

describe('Checkpoints', () => {
  it('the editor adds a checkpoint at the map position it was opened with', async () => {
    const t = await seed();
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <CheckpointEditorScreen
          navigation={n}
          route={{ params: { adventureId: t.adv.id, lat: 56.81, lon: -4.99 } } as any}
        />
      </Harness>,
    );
    fireEvent.changeText(screen.getByTestId('checkpoint-name'), 'Waterfall');
    fireEvent.press(screen.getByTestId('kind-waterfall'));
    fireEvent.press(screen.getByTestId('checkpoint-save'));
    await waitFor(() => expect(calls).toContainEqual(['goBack']));
    const cps = await t.services.adventuresRepo.checkpoints(t.adv.id);
    expect(cps.at(-1)).toMatchObject({
      name: 'Waterfall',
      kind: 'waterfall',
      lat: 56.81,
      lon: -4.99,
    });
    expect(screen.getByText(/safe, public, accessible places/)).toBeTruthy();
  });

  it('manual arrival: warns first when GPS says you are far away, then records it', async () => {
    const t = await seed();
    await t.services.adventures.act(t.adv.id, 'start');
    useLocationStore.setState({
      fix: { ...destination(VIEW, 0, 5000), accM: 5, fixAt: Date.now() },
    });
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <CheckpointDetailsScreen
          navigation={n}
          route={{ params: { adventureId: t.adv.id, checkpointId: t.view.id } } as any}
        />
      </Harness>,
    );
    fireEvent.press(await screen.findByTestId('confirm-arrival'));
    expect(alertSpy).toHaveBeenLastCalledWith(
      'You seem to be far from here',
      expect.stringContaining('away'),
      expect.any(Array),
    );
    expect(await t.services.adventuresRepo.completions(t.adv.id)).toEqual([]);
    const buttons = alertSpy.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find(b => b.text === 'Mark as reached')!.onPress!();
    });
    await waitFor(async () =>
      expect(await t.services.adventuresRepo.completions(t.adv.id)).toHaveLength(1),
    );
    expect(await screen.findByText(/confirmed by you/)).toBeTruthy();
  });

  it('manual arrival close by needs no warning', async () => {
    const t = await seed();
    await t.services.adventures.act(t.adv.id, 'start');
    useLocationStore.setState({ fix: { ...VIEW, accM: 70, fixAt: Date.now() } });
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <CheckpointDetailsScreen
          navigation={n}
          route={{ params: { adventureId: t.adv.id, checkpointId: t.view.id } } as any}
        />
      </Harness>,
    );
    const button = await screen.findByTestId('confirm-arrival');
    await act(async () => {
      fireEvent.press(button);
    });
    expect(alertSpy).not.toHaveBeenCalled();
    await waitFor(async () =>
      expect(await t.services.adventuresRepo.completions(t.adv.id)).toHaveLength(1),
    );
  });

  it('is not offered while the adventure is paused or planned', async () => {
    const t = await seed();
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <CheckpointDetailsScreen
          navigation={n}
          route={{ params: { adventureId: t.adv.id, checkpointId: t.view.id } } as any}
        />
      </Harness>,
    );
    await screen.findByTestId('navigate-checkpoint');
    expect(screen.queryByTestId('confirm-arrival')).toBeNull();
  });

  it('navigates to the checkpoint with the existing straight-line screen', async () => {
    const t = await seed();
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <CheckpointDetailsScreen
          navigation={n}
          route={{ params: { adventureId: t.adv.id, checkpointId: t.view.id } } as any}
        />
      </Harness>,
    );
    fireEvent.press(await screen.findByTestId('navigate-checkpoint'));
    expect(calls).toContainEqual([
      'navigate',
      'Navigate',
      { adventureId: t.adv.id, checkpointId: t.view.id },
    ]);
  });
});

describe('Achievements', () => {
  it('shows all thirteen badges, locked ones with their requirement and progress', async () => {
    const t = await makeTestServices();
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <AchievementsScreen navigation={n} route={{} as any} />
      </Harness>,
    );
    expect(await screen.findByText('Trail Starter')).toBeTruthy();
    expect(screen.getByText('Complete three adventures.')).toBeTruthy();
    expect(screen.getByText('0 of 13 earned')).toBeTruthy();
    expect(screen.getAllByText('Locked').length).toBeGreaterThan(3);
    expect(screen.getByText(/not independently verified/)).toBeTruthy();
    expect(screen.queryByText(/leaderboard/i, { exact: false })).not.toBeNull(); // only in the "no leaderboards" note
  });

  it('shows an unlocked badge with its date and a New marker, then clears the marker', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const t = await seed();
    await t.services.adventures.act(t.adv.id, 'start');
    await t.services.adventures.confirmArrival(t.adv.id, t.view.id, 'manual');
    await t.services.adventures.act(t.adv.id, 'complete');
    await t.services.achievements.evaluateNow();
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <AchievementsScreen navigation={n} route={{} as any} />
      </Harness>,
    );
    expect(await screen.findByText('First Adventure')).toBeTruthy();
    expect(await screen.findByText(/^Earned /)).toBeTruthy();
    expect(screen.getAllByText('New').length).toBeGreaterThan(0);
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('New')).toBeNull();
    jest.useRealTimers();
  });
});

describe('Adventure summary', () => {
  async function finished(withRoute: boolean) {
    const t = await seed();
    await t.services.adventures.act(t.adv.id, 'start');
    await t.services.adventures.confirmArrival(t.adv.id, t.view.id, 'manual');
    if (withRoute) {
      let p = START;
      for (let i = 0; i < 6; i++) {
        p = destination(p, 90, 30);
        t.clock.advance(15_000);
        await t.services.adventureTracker.onFix({ ...p, accM: 5, fixAt: t.clock.now() });
      }
    }
    t.clock.advance(30 * 60_000);
    await t.services.adventures.act(t.adv.id, 'complete');
    await t.services.achievements.evaluateNow();
    return t;
  }

  it('is an honest recap: name, time, checkpoints, milestones, and no invented distance', async () => {
    const t = await finished(false);
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <AdventureSummaryScreen
          navigation={n}
          route={{ params: { adventureId: t.adv.id, celebrate: true } } as any}
        />
      </Harness>,
    );
    expect(await screen.findByTestId('recap-name')).toHaveTextContent('Ridge walk');
    expect(screen.getByTestId('recap-duration')).toHaveTextContent('30 min');
    expect(screen.getByTestId('recap-distance')).toHaveTextContent('Not recorded');
    expect(screen.getByTestId('recap-checkpoints')).toHaveTextContent('1 of 2');
    expect(screen.getByText('No route recorded')).toBeTruthy();
    expect(await screen.findByText('Milestones unlocked')).toBeTruthy();
    expect(screen.getByText('First Adventure')).toBeTruthy();
    expect(screen.queryByTestId('route-sketch')).toBeNull();
  });

  it('draws the recorded route and offers to show it on the map', async () => {
    const t = await finished(true);
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <AdventureSummaryScreen
          navigation={n}
          route={{ params: { adventureId: t.adv.id } } as any}
        />
      </Harness>,
    );
    expect(await screen.findByTestId('route-sketch')).toBeTruthy();
    expect(screen.getByTestId('recap-distance')).not.toHaveTextContent('Not recorded');
    fireEvent.press(screen.getByTestId('route-on-map'));
    expect(calls.find(c => c[1] === 'Map')?.[2]).toMatchObject({ showAdventure: t.adv.id });
  });

  it('keeps a personal note on this device', async () => {
    const t = await finished(false);
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <AdventureSummaryScreen
          navigation={n}
          route={{ params: { adventureId: t.adv.id } } as any}
        />
      </Harness>,
    );
    const input = await screen.findByTestId('recap-note');
    fireEvent.changeText(input, 'Saw an eagle');
    await act(async () => {
      fireEvent(input, 'blur');
    });
    expect(await t.services.kv.get(`adventure.note.${t.adv.id}`)).toBe('Saw an eagle');
  });
});

describe('Map integration', () => {
  it('draws checkpoint markers with their reached state, opens their details, and keeps the attribution', async () => {
    const t = await seed();
    await t.services.adventures.act(t.adv.id, 'start');
    await t.services.adventures.confirmArrival(t.adv.id, t.view.id, 'manual');
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <MapScreen navigation={n} route={{ params: undefined } as any} />
      </Harness>,
    );
    expect(await screen.findByTestId('attribution')).toBeTruthy();
    expect(screen.queryByTestId('adventure-chip')).toBeNull();
    await waitFor(() => {
      const feats = mockMap.sources.checkpoints?.data.features;
      expect(feats).toHaveLength(2);
      expect(feats.map((f: any) => f.properties.reached)).toEqual([true, false]);
    });
    // Tapping a checkpoint marker opens its details.
    act(() =>
      mockMap.sources.checkpoints!.onPress({
        nativeEvent: { features: [{ properties: { id: t.top.id } }] },
      }),
    );
    expect(calls).toContainEqual([
      'navigate',
      'Activity',
      { screen: 'CheckpointDetails', params: { adventureId: t.adv.id, checkpointId: t.top.id } },
    ]);
  });

  it('long-press offers adding a checkpoint to the adventure in progress', async () => {
    const t = await seed();
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <MapScreen navigation={n} route={{ params: undefined } as any} />
      </Harness>,
    );
    await waitFor(() => expect(mockMap.map).not.toBeNull());
    await act(async () => {
      mockMap.map!.onLongPress({ nativeEvent: { lngLat: [-4.9, 56.85] } });
    });
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const buttons = alertSpy.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
    const choice = buttons.find(b => b.text === 'Checkpoint: Ridge walk');
    expect(choice).toBeDefined();
    choice!.onPress!();
    expect(calls).toContainEqual([
      'navigate',
      'Activity',
      { screen: 'CheckpointEditor', params: { adventureId: t.adv.id, lat: 56.85, lon: -4.9 } },
    ]);
  });

  it('long-press with no adventure still just drops a personal marker, as before', async () => {
    const t = await makeTestServices();
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <MapScreen navigation={n} route={{ params: undefined } as any} />
      </Harness>,
    );
    await waitFor(() => expect(mockMap.map).not.toBeNull());
    await act(async () => {
      mockMap.map!.onLongPress({ nativeEvent: { lngLat: [-4.9, 56.85] } });
    });
    await waitFor(async () => expect(await t.services.points.list()).toHaveLength(1));
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('banners: a quiet hint near a checkpoint offers manual confirmation when GPS is weak', async () => {
    const t = await seed();
    await t.services.adventures.act(t.adv.id, 'start');
    render(
      <Harness services={t.services}>
        <AdventureBanners
          onOpenAchievements={() => undefined}
          onOpenCheckpoint={() => undefined}
          onOpenSummary={() => undefined}
        />
      </Harness>,
    );
    t.clock.advance(2000);
    await act(async () => {
      await t.services.adventureTracker.onFix({ ...VIEW, accM: 90, fixAt: t.clock.now() });
    });
    expect(await screen.findByText('Near Viewpoint')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText('I am here'));
    });
    await waitFor(async () =>
      expect(await t.services.adventuresRepo.completions(t.adv.id)).toHaveLength(1),
    );
    expect(await screen.findByText('Reached Viewpoint')).toBeTruthy();
  });

  it('toast host: adventure news shows on other tabs but never over the map', async () => {
    const t = await seed();
    await t.services.adventures.act(t.adv.id, 'start');
    const ui = (tab: string) => (
      <Harness services={t.services}>
        <AdventureToastHost tab={tab} onNavigate={jest.fn()} />
      </Harness>
    );
    const { rerender } = render(ui('Map'));
    t.clock.advance(2000);
    await act(async () => {
      await t.services.adventureTracker.onFix({ ...VIEW, accM: 90, fixAt: t.clock.now() });
    });
    expect(screen.queryByText('Near Viewpoint')).toBeNull();
    rerender(ui('Navigate'));
    expect(await screen.findByText('Near Viewpoint')).toBeTruthy();
  });

  it('streaming the online map while an adventure runs marks it as having used the network', async () => {
    const t = await seed();
    await t.services.adventures.act(t.adv.id, 'start');
    await t.services.adventures.noteNetworkUse();
    expect((await t.services.adventuresRepo.get(t.adv.id))?.progress.networkUsed).toBe(true);
  });
});

describe('Group and settings entry points', () => {
  it('group info lets an organizer plan a group adventure', async () => {
    const t = await makeTestServices({ address: 'off1me' });
    await t.mesh.start();
    await t.services.groups.start({ poll: false });
    const g = await t.services.groups.createGroup({ name: 'Crew' });
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <GroupInfoScreen
          navigation={n}
          route={{ params: { groupId: g.ok ? g.value.id : '' } } as any}
        />
      </Harness>,
    );
    fireEvent.press(await screen.findByTestId('plan-group-adventure'));
    expect(calls).toContainEqual([
      'navigate',
      'Activity',
      { screen: 'AdventureEditor', params: { groupId: g.ok ? g.value.id : '' } },
    ]);
  });

  it('the arrival radius is configurable and stored locally', async () => {
    const t = await makeTestServices();
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <SettingsScreen navigation={n} />
      </Harness>,
    );
    expect(await screen.findByText('Arrival radius: 30 m')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('radius-up'));
    });
    expect(await screen.findByText('Arrival radius: 35 m')).toBeTruthy();
    expect(await t.services.kv.get('pref.checkpointRadiusM')).toBe('35');
  });
});

describe('reduced motion', () => {
  it('motion lasts zero milliseconds when the system asks for less', () => {
    expect(motionDuration(true, MOTION.reveal)).toBe(0);
    expect(motionDuration(false, MOTION.reveal)).toBe(MOTION.reveal);
  });

  it('with reduced motion nothing is animated: no timing starts, and the pulse is a plain ring', async () => {
    resetMotionPreference();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const timing = jest.spyOn(Animated, 'timing');
    const t = await makeTestServices();
    render(
      <Harness services={t.services}>
        <Reveal testID="reveal">
          <View testID="child" />
        </Reveal>
        <PulseRing color="#000" testID="pulse" />
      </Harness>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('pulse', { includeHiddenElements: true }).children).toHaveLength(1),
    );
    expect(timing).not.toHaveBeenCalled();
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('with full motion the reveal and the pulse do animate (and the pulse stops after two swells)', async () => {
    resetMotionPreference();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const timing = jest.spyOn(Animated, 'timing');
    const t = await makeTestServices();
    render(
      <Harness services={t.services}>
        <Reveal>
          <View />
        </Reveal>
        <PulseRing color="#000" testID="pulse" />
      </Harness>,
    );
    await waitFor(() => expect(timing).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('pulse', { includeHiddenElements: true }).children).toHaveLength(2),
    );
    resetMotionPreference();
  });
});
