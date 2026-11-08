import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ActivityCompletedScreen } from '../src/features/adventures/ActivityRunScreens';
import { AddPhaseScreen, PhaseAddedScreen } from '../src/features/adventures/ActivityScreens';
import { PhaseType } from '../src/domain/adventures/model';
import {
  AdventureDetailsScreen,
  AdventureEditorScreen,
  AdventuresScreen,
} from '../src/features/adventures/AdventuresScreens';
import {
  CheckpointDetailsScreen,
  CheckpointEditorScreen,
} from '../src/features/adventures/CheckpointScreens';
import { GroupInfoScreen, GroupsScreen } from '../src/features/groups/GroupsScreens';
import { useLocationStore } from '../src/platform/locationStore';
import { setFeature } from '../src/shared/features';
import { Harness } from '../src/testing/componentHarness';
import { makeTestServices } from '../src/testing/services';

jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb: () => void | (() => void)) => R.useEffect(cb, [cb]) };
});
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false }, jest.fn()],
}));

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

let alertSpy: jest.SpyInstance;
// Group activities ship behind a flag that is off by default; these tests are about the feature.
beforeAll(() => setFeature('groupActivities', true));
afterAll(() => setFeature('groupActivities', false));
beforeEach(() => {
  useLocationStore.setState({
    permission: 'undetermined',
    fix: null,
    headingDeg: null,
    watchingSince: null,
    lastError: null,
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => alertSpy.mockRestore());

/** The organizer's phone with a group, as in the real app. */
async function organizer() {
  const t = await makeTestServices({ address: 'off1me' });
  await t.mesh.start();
  await t.services.groups.start({ poll: false });
  t.services.adventures.start({ poll: false });
  const g = await t.services.groups.createGroup({ name: 'Crew', yourName: 'Me' });
  if (!g.ok) {
    throw new Error('group');
  }
  return { t, groupId: g.value.id };
}

/** Press the button of the confirmation Alert with the given label. */
async function pressAlert(label: string) {
  const buttons = alertSpy.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  await act(async () => {
    buttons.find(b => b.text === label)?.onPress?.();
  });
}

describe('planning an activity', () => {
  it('creating for a group makes a private draft, ordered when asked', async () => {
    const { t, groupId } = await organizer();
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <AdventureEditorScreen navigation={n} route={{ params: { groupId } } as any} />
      </Harness>,
    );
    expect(screen.getByText('New activity')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('adventure-name'), 'Flower hunt');
    fireEvent(screen.getByTestId('ordered-switch'), 'valueChange', true);
    await act(async () => {
      fireEvent.press(screen.getByTestId('adventure-save'));
    });
    const [adv] = await t.services.adventuresRepo.list();
    expect(adv).toMatchObject({ name: 'Flower hunt', status: 'draft', ordered: true, rev: 0 });
    expect(calls).toContainEqual(['replace', 'AdventureDetails', { adventureId: adv!.id }]);
  });

  it('a solo adventure has no order switch and is not a draft', async () => {
    const { t } = await organizer();
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <AdventureEditorScreen navigation={n} route={{} as any} />
      </Harness>,
    );
    expect(screen.queryByTestId('ordered-switch')).toBeNull();
  });
});

describe('with the groupActivities flag off', () => {
  beforeEach(() => setFeature('groupActivities', false));
  afterEach(() => setFeature('groupActivities', true));

  it('a group adventure is planned as before: no draft, no order switch', async () => {
    const { t, groupId } = await organizer();
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <AdventureEditorScreen navigation={n} route={{ params: { groupId } } as any} />
      </Harness>,
    );
    expect(screen.getByText('New adventure')).toBeTruthy();
    expect(screen.queryByTestId('ordered-switch')).toBeNull();
    fireEvent.changeText(screen.getByTestId('adventure-name'), 'Ridge walk');
    await act(async () => {
      fireEvent.press(screen.getByTestId('adventure-save'));
    });
    const [adv] = await t.services.adventuresRepo.list();
    expect(adv).toMatchObject({ name: 'Ridge walk', status: 'planned', activity: false });
  });

  it('an activity from another phone opens as a plain group adventure', async () => {
    const { t, groupId } = await organizer();
    const a = await t.services.adventures.createAdventure(
      { name: 'Valley Nature Quest' },
      { groupId, draft: true },
    );
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <AdventureDetailsScreen
          navigation={n}
          route={{ params: { adventureId: a.ok ? a.value.id : '' } } as any}
        />
      </Harness>,
    );
    expect(await screen.findByText('Checkpoints')).toBeTruthy();
  });

  it('group info shows the Adventures card, not activities', async () => {
    const { t, groupId } = await organizer();
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <GroupInfoScreen navigation={n} route={{ params: { groupId } } as any} />
      </Harness>,
    );
    fireEvent.press(await screen.findByTestId('info-tab-activities'));
    expect(screen.getAllByText('Adventures')).toHaveLength(2); // the tab and the card
    expect(screen.getByText('Plan a group adventure')).toBeTruthy();
    expect(screen.queryByText('Plan an activity')).toBeNull();
  });
});

async function draft(extra: { ordered?: boolean } = {}) {
  const { t, groupId } = await organizer();
  const a = await t.services.adventures.createAdventure(
    { name: 'Valley Nature Quest' },
    { groupId, draft: true, ...extra },
  );
  return { t, groupId, id: a.ok ? a.value.id : '' };
}

const PLACE = { lat: 37.7812, lon: -122.4046 };

describe('Edit Activity (the draft)', () => {
  it('shows the summary and tabs, and an empty phase list with Add Phase', async () => {
    const { t, id } = await draft();
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <AdventureDetailsScreen navigation={n} route={{ params: { adventureId: id } } as any} />
      </Harness>,
    );
    expect(await screen.findByText('Edit Activity')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('0 phases')).toBeTruthy();
    expect(screen.getByText('Activity Phases')).toBeTruthy();
    fireEvent.press(screen.getByTestId('add-phase'));
    expect(calls).toContainEqual(['navigate', 'AddPhase', { adventureId: id }]);
    // Cannot publish an empty activity.
    expect(screen.getByTestId('action-publish').props.accessibilityState?.disabled).toBe(true);
  });

  it('lists numbered phases with an icon each and opens one to edit', async () => {
    const { t, id } = await draft();
    const one = await t.services.adventures.addCheckpoint(id, {
      name: 'Reach the Viewpoint',
      kind: 'other',
      ...PLACE,
    });
    await t.services.adventures.addCheckpoint(id, {
      name: 'Collect a Wildflower',
      kind: 'other',
      type: 'collect',
    });
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <AdventureDetailsScreen navigation={n} route={{ params: { adventureId: id } } as any} />
      </Harness>,
    );
    expect(await screen.findByText('1. Reach the Viewpoint')).toBeTruthy();
    expect(screen.getByText('2. Collect a Wildflower')).toBeTruthy();
    expect(screen.getByText('2 phases')).toBeTruthy();
    fireEvent.press(screen.getByTestId(`phase-${one.ok ? one.value.id : ''}`));
    expect(calls).toContainEqual([
      'navigate',
      'CheckpointEditor',
      { adventureId: id, checkpointId: one.ok ? one.value.id : '' },
    ]);
  });

  it('reorders phases with the up and down controls', async () => {
    const { t, id } = await draft();
    const a = await t.services.adventures.addCheckpoint(id, { name: 'A', kind: 'other', ...PLACE });
    const b = await t.services.adventures.addCheckpoint(id, {
      name: 'B',
      kind: 'other',
      type: 'task',
    });
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <AdventureDetailsScreen navigation={n} route={{ params: { adventureId: id } } as any} />
      </Harness>,
    );
    await screen.findByText('1. A');
    fireEvent.press(screen.getByTestId('reorder-toggle'));
    await act(async () => {
      fireEvent.press(screen.getByTestId(`move-up-${b.ok ? b.value.id : ''}`));
    });
    expect(await screen.findByText('1. B')).toBeTruthy();
    expect(screen.getByText('2. A')).toBeTruthy();
    expect(a.ok).toBe(true);
  });

  it('edits the details and the order setting, and Save Draft keeps them', async () => {
    const { t, id } = await draft();
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <AdventureDetailsScreen navigation={n} route={{ params: { adventureId: id } } as any} />
      </Harness>,
    );
    await screen.findByText('Edit Activity');
    fireEvent.press(screen.getByText('Details'));
    fireEvent.changeText(screen.getByTestId('activity-name'), 'Wildflower Quest');
    fireEvent.changeText(screen.getByTestId('activity-description'), 'Small challenges');
    fireEvent.press(screen.getByText('Settings'));
    await act(async () => {
      fireEvent(screen.getByTestId('ordered-switch'), 'valueChange', true);
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('save-draft'));
    });
    const a = await t.services.adventuresRepo.get(id);
    expect(a).toMatchObject({
      name: 'Wildflower Quest',
      description: 'Small challenges',
      status: 'draft',
      ordered: true,
    });
    expect(calls).toContainEqual(['goBack']);
  });

  it('publishing asks first, then starts it for the group', async () => {
    const { t, id } = await draft();
    await t.services.adventures.addCheckpoint(id, { name: 'A', kind: 'other', ...PLACE });
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <AdventureDetailsScreen navigation={n} route={{ params: { adventureId: id } } as any} />
      </Harness>,
    );
    await screen.findByText('1. A');
    await act(async () => {
      fireEvent.press(screen.getByTestId('action-publish'));
    });
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe('Publish this activity?');
    await pressAlert('Publish');
    await waitFor(async () =>
      expect((await t.services.adventuresRepo.get(id))?.status).toBe('active'),
    );
    expect((await t.services.adventuresRepo.get(id))?.rev).toBe(1);
  });

  it('a draft can be discarded', async () => {
    const { t, id } = await draft();
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <AdventureDetailsScreen navigation={n} route={{ params: { adventureId: id } } as any} />
      </Harness>,
    );
    await screen.findByText('Edit Activity');
    fireEvent.press(screen.getByText('Settings'));
    fireEvent.press(screen.getByTestId('action-discard'));
    await pressAlert('Discard');
    expect(await t.services.adventuresRepo.get(id)).toBeNull();
    expect(calls).toContainEqual(['goBack']);
  });
});

describe('Add Phase and the phase form', () => {
  it('offers the four kinds, with Location Checkpoint chosen first', async () => {
    const { n, calls } = nav();
    const t = await makeTestServices();
    render(
      <Harness services={t.services}>
        <AddPhaseScreen navigation={n} route={{ params: { adventureId: 'a1' } } as any} />
      </Harness>,
    );
    expect(screen.getByText('What kind of phase is this?')).toBeTruthy();
    for (const label of ['Location Checkpoint', 'Collect Item', 'Take a Photo', 'Custom Task']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByTestId('phase-type-checkpoint').props.accessibilityState.selected).toBe(
      true,
    );
    fireEvent.press(screen.getByTestId('phase-type-collect'));
    fireEvent.press(screen.getByTestId('phase-type-continue'));
    expect(calls).toContainEqual([
      'replace',
      'CheckpointEditor',
      { adventureId: 'a1', type: 'collect' },
    ]);
  });

  async function editor(type: PhaseType) {
    const { t, id } = await draft();
    const { n, calls } = nav();
    const utils = render(
      <Harness services={t.services}>
        <CheckpointEditorScreen
          navigation={n}
          route={{ params: { adventureId: id, type } } as any}
        />
      </Harness>,
    );
    await screen.findByTestId('checkpoint-name');
    return { t, id, calls, n, ...utils };
  }

  it('a location checkpoint needs a place; Select Location goes to the map', async () => {
    const { calls, id } = await editor('checkpoint');
    expect(screen.getByText('Add Checkpoint')).toBeTruthy();
    expect(screen.getByTestId('location-value').props.children).toBe('Not set');
    fireEvent.changeText(screen.getByTestId('checkpoint-name'), 'Summit Viewpoint');
    await act(async () => {
      fireEvent.press(screen.getByTestId('checkpoint-save'));
    });
    expect(await screen.findByText(/Choose where it is/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('select-location'));
    const nav = calls.find(c => c[1] === 'Map');
    expect(nav?.[2]).toMatchObject({
      pick: { adventureId: id, type: 'checkpoint', includeRegion: true },
    });
  });

  it('takes a place and region back from the map, then saves with radius, photo and region', async () => {
    const { t, id, n, rerender } = await editor('checkpoint');
    fireEvent.changeText(screen.getByTestId('checkpoint-name'), 'Summit Viewpoint');
    const picked = { ...PLACE, region: [-122.43, 37.76, -122.38, 37.8], nonce: 1 };
    rerender(
      <Harness services={t.services}>
        <CheckpointEditorScreen
          navigation={n}
          route={{ params: { adventureId: id, type: 'checkpoint', picked } } as any}
        />
      </Harness>,
    );
    expect(await screen.findByText(/37\.78/)).toBeTruthy();
    // The region size is shown once a place and region are set.
    expect(screen.getByTestId('region-size').props.children.join('')).toMatch(/About .* (KB|MB)/);
    await act(async () => {
      fireEvent(screen.getByTestId('radius-slider'), 'accessibilityAction', {
        nativeEvent: { actionName: 'increment' },
      });
    });
    expect(screen.getByTestId('radius-value').props.children.join('')).toBe('55 m');
    fireEvent(screen.getByTestId('require-photo'), 'valueChange', true);
    await act(async () => {
      fireEvent.press(screen.getByTestId('checkpoint-save'));
    });
    const [cp] = await t.services.adventuresRepo.checkpoints(id);
    expect(cp).toMatchObject({
      name: 'Summit Viewpoint',
      type: 'checkpoint',
      lat: PLACE.lat,
      radiusM: 55,
      requirePhoto: true,
      region: [-122.43, 37.76, -122.38, 37.8],
    });
  });

  it('switching the map region off saves the phase with none', async () => {
    const { t, id, n, rerender } = await editor('checkpoint');
    fireEvent.changeText(screen.getByTestId('checkpoint-name'), 'No map');
    rerender(
      <Harness services={t.services}>
        <CheckpointEditorScreen
          navigation={n}
          route={
            {
              params: {
                adventureId: id,
                type: 'checkpoint',
                picked: { ...PLACE, region: null, nonce: 2 },
              },
            } as any
          }
        />
      </Harness>,
    );
    await screen.findByTestId('include-region');
    await act(async () => {
      fireEvent.press(screen.getByTestId('checkpoint-save'));
    });
    expect((await t.services.adventuresRepo.checkpoints(id))[0]?.region).toBeNull();
  });

  it('a photo phase needs no place and always requires a photo', async () => {
    const { t, id, calls } = await editor('photo');
    expect(screen.getByText('Take a Photo')).toBeTruthy();
    expect(screen.queryByTestId('select-location')).toBeNull();
    expect(screen.queryByTestId('radius-slider')).toBeNull();
    expect(screen.getByTestId('require-photo').props.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('checkpoint-name'), 'Lakeside Photo');
    await act(async () => {
      fireEvent.press(screen.getByTestId('checkpoint-save'));
    });
    const [cp] = await t.services.adventuresRepo.checkpoints(id);
    expect(cp).toMatchObject({ type: 'photo', lat: null, requirePhoto: true, region: null });
    expect(calls.find(c => c[0] === 'replace')?.[1]).toBe('PhaseAdded');
  });

  it('a collect item may have a place, but does not need one', async () => {
    const { t, id } = await editor('collect');
    expect(screen.getByTestId('location-value').props.children).toBe('Optional');
    fireEvent.changeText(screen.getByTestId('checkpoint-name'), 'Collect a Wildflower');
    await act(async () => {
      fireEvent.press(screen.getByTestId('checkpoint-save'));
    });
    expect((await t.services.adventuresRepo.checkpoints(id))[0]).toMatchObject({
      type: 'collect',
      lat: null,
    });
  });

  it('a plain adventure keeps the simple checkpoint form, with a way to search on the map', async () => {
    const t = await makeTestServices({ address: 'off1me' });
    t.services.adventures.start({ poll: false });
    const a = await t.services.adventures.createAdventure({ name: 'Solo' });
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <CheckpointEditorScreen
          navigation={n}
          route={{ params: { adventureId: a.ok ? a.value.id : '' } } as any}
        />
      </Harness>,
    );
    expect(await screen.findByText('New checkpoint')).toBeTruthy();
    expect(screen.queryByTestId('require-photo')).toBeNull();
    fireEvent.press(screen.getByTestId('select-location'));
    expect(calls.find(c => c[1] === 'Map')?.[2]).toMatchObject({ pick: { includeRegion: false } });
  });

  it('after saving, Phase Added summarises it and offers another or Done', async () => {
    const { t, id } = await draft();
    const cp = await t.services.adventures.addCheckpoint(id, {
      name: 'Summit Viewpoint',
      kind: 'other',
      requirePhoto: true,
      radiusM: 50,
      ...PLACE,
    });
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <PhaseAddedScreen
          navigation={n}
          route={{ params: { adventureId: id, checkpointId: cp.ok ? cp.value.id : '' } } as any}
        />
      </Harness>,
    );
    expect(await screen.findByText('Summit Viewpoint')).toBeTruthy();
    expect(screen.getByText('has been added!')).toBeTruthy();
    expect(screen.getByText('Location set')).toBeTruthy();
    expect(screen.getByText('Photo required')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.getByTestId('added-region')).toBeTruthy();
    fireEvent.press(screen.getByTestId('add-another-phase'));
    expect(calls).toContainEqual(['replace', 'AddPhase', { adventureId: id }]);
    fireEvent.press(screen.getByTestId('phase-added-done'));
    expect(calls).toContainEqual(['navigate', 'AdventureDetails', { adventureId: id }]);
  });
});

/** A published activity with two phases and the person (the organizer) not yet started. */
async function published(over: { ordered?: boolean; region?: boolean } = {}) {
  const { t, groupId } = await organizer();
  const a = await t.services.adventures.createAdventure(
    { name: 'Valley Nature Quest', description: 'A fun nature walk.' },
    { groupId, draft: true, ordered: over.ordered },
  );
  const id = a.ok ? a.value.id : '';
  const one = await t.services.adventures.addCheckpoint(id, {
    name: 'Reach the Viewpoint',
    kind: 'other',
    ...PLACE,
    ...(over.region === false ? { region: null } : {}),
  });
  const two = await t.services.adventures.addCheckpoint(id, {
    name: 'Collect a Wildflower',
    kind: 'other',
    type: 'collect',
    requirePhoto: true,
  });
  await t.services.adventures.act(id, 'publish');
  return {
    t,
    id,
    groupId,
    one: one.ok ? one.value.id : '',
    two: two.ok ? two.value.id : '',
  };
}

const openHome = (t: Awaited<ReturnType<typeof organizer>>['t'], id: string) => {
  const { n, calls } = nav();
  render(
    <Harness services={t.services}>
      <AdventureDetailsScreen navigation={n} route={{ params: { adventureId: id } } as any} />
    </Harness>,
  );
  return { n, calls };
};

describe('the published activity, before you start', () => {
  it('shows the overview: published, group, phases, distance, time, description', async () => {
    const { t, id } = await published();
    openHome(t, id);
    expect(await screen.findByText('Published')).toBeTruthy();
    expect(screen.getByText(/2 phases/)).toBeTruthy();
    expect(screen.getByText('A fun nature walk.')).toBeTruthy();
    expect(screen.getByTestId('overview-distance')).toBeTruthy();
    expect(screen.getByText('Start Activity')).toBeTruthy();
    // No editing of any kind once published.
    expect(screen.queryByTestId('action-publish')).toBeNull();
    expect(screen.queryByTestId('add-phase')).toBeNull();
  });

  it('lists the phases when Phases is opened, and Activity Rules explains the run', async () => {
    const { t, id, one } = await published({ ordered: true });
    openHome(t, id);
    fireEvent.press(await screen.findByTestId('row-phases'));
    expect(screen.getByTestId(`overview-phase-${one}`)).toBeTruthy();
    expect(screen.getByText('1. Reach the Viewpoint')).toBeTruthy();
    fireEvent.press(screen.getByTestId('row-rules'));
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe('Activity rules');
    expect(alertSpy.mock.calls.at(-1)?.[1]).toMatch(/in order/);
    expect(alertSpy.mock.calls.at(-1)?.[1]).toMatch(/stay on your phone/);
  });

  it('Preview on Map shows the activity on the map', async () => {
    const { t, id } = await published();
    const { calls } = openHome(t, id);
    fireEvent.press(await screen.findByTestId('row-preview'));
    expect(calls.find(c => c[1] === 'Map')?.[2]).toMatchObject({ showAdventure: id });
  });

  it('Start Activity starts this person’s own timer and the page becomes the in-progress view', async () => {
    const { t, id } = await published();
    openHome(t, id);
    {
      const target = await screen.findByTestId('join-adventure');
      await act(async () => {
        fireEvent.press(target);
      });
    }
    expect(await screen.findByText('In Progress')).toBeTruthy();
    expect(screen.getByTestId('run-clock')).toBeTruthy();
    expect(screen.getByTestId('run-phases-heading').props.children.join('')).toBe('Phases (0 / 2)');
    expect((await t.services.adventuresRepo.participant(id, 'off1me'))?.state).toBe('joined');
  });

  it('the organizer can cancel it; an ended activity cannot be started', async () => {
    const { t, id } = await published();
    openHome(t, id);
    fireEvent.press(await screen.findByTestId('action-cancel'));
    await pressAlert('Cancel activity');
    expect(await screen.findByText('The organizer ended this activity')).toBeTruthy();
    expect(screen.queryByTestId('join-adventure')).toBeNull();
  });
});

describe('Download Map Region', () => {
  const sizeText = () => screen.getByTestId('region-caption').props.children;

  it('shows the region with an approximate size and offline use', async () => {
    const { t, id } = await published();
    openHome(t, id);
    expect(await screen.findByText('Download Map Region')).toBeTruthy();
    expect(sizeText()).toMatch(/About .* (KB|MB) {2}·/);
    expect(sizeText()).toMatch(/Offline use/);
  });

  it('one tap plans the area and starts the download', async () => {
    const { t, id } = await published();
    const plan = jest.spyOn(t.services.packs, 'planArea').mockResolvedValue({
      ok: true,
      value: { fileBytes: 1000 } as any,
    });
    const start = jest.spyOn(t.services.packs, 'startArea').mockResolvedValue({
      ok: true,
      value: {} as any,
    });
    openHome(t, id);
    {
      const target = await screen.findByTestId('download-region');
      await act(async () => {
        fireEvent.press(target);
      });
    }
    const area = (await t.services.adventuresRepo.get(id))!.region!;
    expect(plan).toHaveBeenCalledWith(area.bbox, area.maxZoom);
    expect(start).toHaveBeenCalledWith({ fileBytes: 1000 }, 'Valley Nature Quest');
  });

  it('says so when the download cannot start', async () => {
    const { t, id } = await published();
    jest.spyOn(t.services.packs, 'planArea').mockResolvedValue({
      ok: false,
      error: { code: 'x', userMessage: 'Check your internet connection.', retryable: true } as any,
    });
    openHome(t, id);
    {
      const target = await screen.findByTestId('download-region');
      await act(async () => {
        fireEvent.press(target);
      });
    }
    expect(await screen.findByText('Check your internet connection.')).toBeTruthy();
  });

  it('shows progress while it downloads and Downloaded when the area is installed', async () => {
    const { t, id } = await published();
    const area = (await t.services.adventuresRepo.get(id))!.region!;
    const base = {
      id: 'r1',
      name: 'Valley',
      bbox: [area.bbox[0] - 0.01, area.bbox[1] - 0.01, area.bbox[2] + 0.01, area.bbox[3] + 0.01],
      minZoom: 8,
      maxZoom: 15,
      bytes: 1000,
      sha256: null,
      osmDataDate: null,
      schemaV: 1,
      progressBytes: 250,
      filePath: null,
      installedAt: null,
      source: 'custom' as const,
      errorCode: null,
      sourceUrl: null,
    };
    const list = jest.spyOn(t.services.regions, 'list');
    list.mockResolvedValue([{ ...base, state: 'downloading' }] as any);
    openHome(t, id);
    expect(await screen.findByText('Downloading map region')).toBeTruthy();
    expect(sizeText()).toBe('25%');
    list.mockResolvedValue([{ ...base, state: 'installed', filePath: '/r.pmtiles' }] as any);
    await act(async () => {
      t.services.regions.changes.emit();
    });
    expect(await screen.findByText('Map region downloaded')).toBeTruthy();
    expect(sizeText()).toBe('Ready for offline use');
  });

  it('has no region card when no phase has one', async () => {
    const { t, id } = await published({ region: false });
    // The collect phase has no place, so there is no map region at all.
    openHome(t, id);
    await screen.findByText('Published');
    expect(screen.queryByTestId('download-region')).toBeNull();
  });
});

async function started(over: { ordered?: boolean } = {}) {
  const p = await published(over);
  await p.t.services.adventures.join(p.id);
  return p;
}

describe('in progress', () => {
  it('shows the timer, participants and the phase timeline with each phase’s state', async () => {
    const { t, id, one, two } = await started({ ordered: true });
    openHome(t, id);
    expect(await screen.findByTestId('run-stats')).toBeTruthy();
    expect(screen.getByTestId('run-participants').props.children.join('')).toBe('1 / 1');
    expect(screen.getByText('1. Reach the Viewpoint')).toBeTruthy();
    expect(screen.getByText('Waiting for GPS')).toBeTruthy(); // the current place phase, no fix yet
    expect(screen.getByText('Locked')).toBeTruthy(); // ordered: the second waits
    expect(screen.getByTestId(`run-phase-${one}`)).toBeTruthy();
    expect(screen.getByTestId(`run-phase-${two}`)).toBeTruthy();
  });

  it('says At location once the person is inside the phase radius', async () => {
    const { t, id } = await started();
    useLocationStore.setState({
      fix: { lat: PLACE.lat, lon: PLACE.lon, accM: 5, fixAt: Date.now() } as any,
    });
    openHome(t, id);
    expect(await screen.findByText('At location · Tap to complete')).toBeTruthy();
  });

  it('opens a phase from the timeline', async () => {
    const { t, id, one } = await started();
    const { calls } = openHome(t, id);
    fireEvent.press(await screen.findByTestId(`run-phase-${one}`));
    expect(calls).toContainEqual([
      'navigate',
      'CheckpointDetails',
      { adventureId: id, checkpointId: one },
    ]);
  });

  it('the Updates tab lists what happened', async () => {
    const { t, id } = await started();
    openHome(t, id);
    fireEvent.press(await screen.findByText('Updates'));
    expect(await screen.findByTestId('run-updates')).toBeTruthy();
    expect(screen.getByText(/You joined/)).toBeTruthy();
  });

  it('Stop and leave stops the timer', async () => {
    const { t, id } = await started();
    openHome(t, id);
    fireEvent.press(await screen.findByTestId('leave-activity'));
    await pressAlert('Leave');
    await waitFor(async () =>
      expect((await t.services.adventuresRepo.participant(id, 'off1me'))?.state).toBe('left'),
    );
  });
});

describe('a phase', () => {
  const openPhase = (t: Awaited<ReturnType<typeof organizer>>['t'], id: string, cp: string) => {
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <CheckpointDetailsScreen
          navigation={n}
          route={{ params: { adventureId: id, checkpointId: cp } } as any}
        />
      </Harness>,
    );
    return { calls };
  };

  it('a place phase says how far away you are, and Mark as Complete works', async () => {
    const { t, id, one } = await started();
    useLocationStore.setState({
      fix: { lat: PLACE.lat, lon: PLACE.lon + 0.002, accM: 5, fixAt: Date.now() } as any,
    });
    const { calls } = openPhase(t, id, one);
    expect(await screen.findByTestId('phase-location')).toBeTruthy();
    expect(screen.getByText(/m away/)).toBeTruthy();
    expect(screen.getByTestId('navigate-checkpoint')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('confirm-arrival'));
    });
    // Close enough (a couple of hundred metres) that no far-away warning is needed... or confirmed.
    if (alertSpy.mock.calls.at(-1)?.[0] === 'You seem to be far from here') {
      await pressAlert('Mark as Complete');
    }
    await waitFor(async () =>
      expect(await t.services.adventuresRepo.completion(id, one, 'off1me')).not.toBeNull(),
    );
    expect(calls).toContainEqual(['goBack']);
  });

  it('inside the radius it says You are at the location', async () => {
    const { t, id, one } = await started();
    useLocationStore.setState({
      fix: { lat: PLACE.lat, lon: PLACE.lon, accM: 5, fixAt: Date.now() } as any,
    });
    openPhase(t, id, one);
    expect(await screen.findByText('You are at the location')).toBeTruthy();
    expect(screen.getByText(/Within \d+ m of target/)).toBeTruthy();
  });

  it('a phase that requires a photo cannot be completed until one is attached', async () => {
    const { t, id, two } = await started();
    openPhase(t, id, two);
    expect(await screen.findByTestId('add-photo')).toBeTruthy();
    expect(screen.getByTestId('confirm-arrival').props.accessibilityState?.disabled).toBe(true);
    (t.photos as any).next = { ok: true, value: 'file:///photos/orchid.jpg' };
    await act(async () => {
      fireEvent.press(screen.getByTestId('add-photo'));
    });
    expect(await screen.findByTestId('phase-photo')).toBeTruthy();
    expect((await t.services.adventuresRepo.phaseRecord(id, two))?.photoUri).toBe(
      'file:///photos/orchid.jpg',
    );
    await waitFor(() =>
      expect(screen.getByTestId('confirm-arrival').props.accessibilityState?.disabled).toBeFalsy(),
    );
  });

  it('removing a photo deletes the file and clears it', async () => {
    const { t, id, two } = await started();
    await t.services.adventures.setPhasePhoto(id, two, 'file:///photos/a.jpg');
    openPhase(t, id, two);
    fireEvent.press(await screen.findByTestId('remove-photo'));
    await waitFor(async () =>
      expect((await t.services.adventuresRepo.phaseRecord(id, two))?.photoUri).toBeNull(),
    );
    expect((t.photos as any).discarded).toContain('file:///photos/a.jpg');
  });

  it('cancelling the picker changes nothing', async () => {
    const { t, id, two } = await started();
    openPhase(t, id, two);
    {
      const target = await screen.findByTestId('add-photo');
      await act(async () => {
        fireEvent.press(target);
      });
    }
    expect(await t.services.adventuresRepo.phaseRecord(id, two)).toBeNull();
  });

  it('keeps the note, and a finished phase shows Completed with the note read-only', async () => {
    const { t, id, one } = await started();
    useLocationStore.setState({
      fix: { lat: PLACE.lat, lon: PLACE.lon, accM: 5, fixAt: Date.now() } as any,
    });
    openPhase(t, id, one);
    fireEvent.changeText(await screen.findByTestId('phase-note'), 'Found a beautiful orchid!');
    await act(async () => {
      fireEvent.press(screen.getByTestId('confirm-arrival'));
    });
    await waitFor(async () =>
      expect((await t.services.adventuresRepo.phaseRecord(id, one))?.note).toBe(
        'Found a beautiful orchid!',
      ),
    );
    expect(await screen.findByTestId('phase-done')).toBeTruthy();
    expect(screen.getByTestId('phase-note').props.editable).toBe(false);
    expect(screen.queryByTestId('confirm-arrival')).toBeNull();
  });

  it('an ordered activity locks later phases with a reason', async () => {
    const { t, id, two } = await started({ ordered: true });
    openPhase(t, id, two);
    expect(await screen.findByText('Finish the earlier phases first')).toBeTruthy();
    expect(screen.getByTestId('confirm-arrival').props.accessibilityState?.disabled).toBe(true);
  });

  it('before Start it asks you to start first', async () => {
    const { t, id, one } = await published();
    openPhase(t, id, one);
    expect(await screen.findByText('Press Start Activity first')).toBeTruthy();
  });

  it('finishing the last phase opens the completed screen', async () => {
    const { t, id, one, two } = await started();
    await t.services.adventures.setPhasePhoto(id, two, 'file:///photos/a.jpg');
    await t.services.adventures.confirmArrival(id, one, 'manual');
    const { calls } = openPhase(t, id, two);
    {
      const target = await screen.findByTestId('confirm-arrival');
      await act(async () => {
        fireEvent.press(target);
      });
    }
    await waitFor(() =>
      expect(calls).toContainEqual(['replace', 'ActivityCompleted', { adventureId: id }]),
    );
  });
});

describe('Activity Completed', () => {
  it('shows the name, duration, distance and phases, and offers Summary and Share', async () => {
    const { t, id, one, two } = await started();
    await t.services.adventures.setPhasePhoto(id, two, 'file:///photos/a.jpg');
    t.clock.advance(125_000);
    await t.services.adventures.confirmArrival(id, one, 'manual');
    await t.services.adventures.confirmArrival(id, two, 'manual');
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <ActivityCompletedScreen navigation={n} route={{ params: { adventureId: id } } as any} />
      </Harness>,
    );
    expect(await screen.findByText('Activity Completed!')).toBeTruthy();
    expect(screen.getByTestId('completed-name').props.children).toBe('Valley Nature Quest');
    expect(screen.getByText('00:02:05')).toBeTruthy();
    expect(screen.getByText('2 / 2')).toBeTruthy();
    fireEvent.press(screen.getByTestId('view-summary'));
    expect(calls).toContainEqual(['navigate', 'AdventureSummary', { adventureId: id }]);
  });

  it('after finishing, the activity page shows Finished with a summary button', async () => {
    const { t, id, one, two } = await started();
    await t.services.adventures.setPhasePhoto(id, two, 'file:///photos/a.jpg');
    await t.services.adventures.confirmArrival(id, one, 'manual');
    await t.services.adventures.confirmArrival(id, two, 'manual');
    openHome(t, id);
    expect(await screen.findByText('Finished')).toBeTruthy();
    expect(screen.getByTestId('view-recap')).toBeTruthy();
    expect(screen.queryByTestId('leave-activity')).toBeNull();
    expect(screen.getByTestId('run-phases-heading').props.children.join('')).toBe('Phases (2 / 2)');
  });
});

describe('Activity History', () => {
  it('lists a finished activity with its date, distance, time and phases', async () => {
    const { t, id, one, two } = await started();
    await t.services.adventures.setPhasePhoto(id, two, 'file:///photos/a.jpg');
    t.clock.advance(61_000);
    await t.services.adventures.confirmArrival(id, one, 'manual');
    await t.services.adventures.confirmArrival(id, two, 'manual');
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <AdventuresScreen navigation={n} route={{} as any} />
      </Harness>,
    );
    fireEvent.press(await screen.findByText('Journal'));
    const row = await screen.findByTestId(`journal-${id}`);
    expect(screen.getByText('Valley Nature Quest')).toBeTruthy();
    expect(screen.getByText(/Completed ·/)).toBeTruthy();
    expect(screen.getByText('00:01:01')).toBeTruthy();
    expect(screen.getByText('2/2')).toBeTruthy();
    fireEvent.press(row);
    expect(calls).toContainEqual(['navigate', 'AdventureSummary', { adventureId: id }]);
  });
});

describe('the group pages', () => {
  it('group info lists the draft for the organizer and the activity as live after publishing', async () => {
    const { t, groupId } = await organizer();
    const a = await t.services.adventures.createAdventure(
      { name: 'Flower hunt' },
      { groupId, draft: true },
    );
    const id = a.ok ? a.value.id : '';
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <GroupInfoScreen navigation={n} route={{ params: { groupId } } as any} />
      </Harness>,
    );
    fireEvent.press(await screen.findByTestId('info-tab-activities'));
    expect(await screen.findByText(/Draft · only you can see it/)).toBeTruthy();
    await t.services.adventures.addCheckpoint(id, {
      name: 'F',
      kind: 'other',
      type: 'task',
      task: 'x',
    });
    await act(async () => {
      await t.services.adventures.act(id, 'publish');
    });
    expect(await screen.findByText(/Live · tap to start/)).toBeTruthy();
    fireEvent.press(screen.getByTestId(`activity-${id}`));
    expect(calls).toContainEqual([
      'navigate',
      'Activity',
      { screen: 'AdventureDetails', params: { adventureId: id } },
    ]);
  });

  it('the groups list says when an activity is waiting, and when it is in progress', async () => {
    const { t, groupId } = await organizer();
    const a = await t.services.adventures.createAdventure(
      { name: 'Flower hunt' },
      { groupId, draft: true },
    );
    const id = a.ok ? a.value.id : '';
    await t.services.adventures.addCheckpoint(id, {
      name: 'F',
      kind: 'other',
      type: 'task',
      task: 'x',
    });
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <GroupsScreen navigation={n} route={{} as any} />
      </Harness>,
    );
    expect(await screen.findByText('1 draft')).toBeTruthy();
    await act(async () => {
      await t.services.adventures.act(id, 'publish');
    });
    expect(await screen.findByText('1 activity waiting')).toBeTruthy();
    await act(async () => {
      await t.services.adventures.join(id);
    });
    expect(await screen.findByText('In progress')).toBeTruthy();
  });
});
