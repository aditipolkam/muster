import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { parseInviteLink } from '../src/domain/groups/invite';
import { MapScreen } from '../src/features/map/MapScreen';
import {
  CreateGroupScreen,
  GroupDetailsScreen,
  GroupsScreen,
  JoinGroupScreen,
  MeetingPointScreen,
} from '../src/features/groups/GroupsScreens';
import { FakeNetwork } from '../src/testing/FakeMesh';
import { Harness } from '../src/testing/componentHarness';
import { makeGroupNode, settle } from '../src/testing/groupNode';
import { makeTestServices } from '../src/testing/services';
import { useLocationStore } from '../src/platform/locationStore';

jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb: () => void | (() => void)) => R.useEffect(cb, [cb]) };
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
  const { View } = require('react-native');
  return {
    Map: (p: Record<string, any>) => {
      mockMap.map = p;
      R.useImperativeHandle(p.ref, () => ({ getCenter: async () => [-5.0, 56.8] }));
      return R.createElement(View, { testID: 'maplibre-map' }, p.children);
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
      return R.createElement(View, { testID: `src-${p.id}` }, p.children);
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

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockMap.sources = {};
  mockMap.map = null;
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

/** The device under test plus a second node on the same fake radio. */
async function twoDevices(role: 'organizer' | 'member') {
  const net = new FakeNetwork();
  const t = await makeTestServices({ net, address: 'off1me' });
  const other = await makeGroupNode(net, 'off1other', { name: 'Other' });
  await t.mesh.start();
  await t.services.groups.start({ poll: false });
  const all = [{ groups: t.services.groups }, other];
  if (role === 'organizer') {
    const g = await t.services.groups.createGroup({ name: 'Ridge walk', yourName: 'Me' });
    return { t, other, net, g: g.ok ? g.value : (undefined as never), all };
  }
  const og = await other.groups.createGroup({ name: 'Ridge walk' });
  const g = og.ok ? og.value : (undefined as never);
  const inv = await other.groups.createInvite(g.id, { autoApprove: true });
  const parsed = inv.ok ? parseInviteLink(inv.value.link) : null;
  const joined = await t.services.groups.joinFromInvite(
    parsed && parsed.ok ? parsed.invite : (undefined as never),
  );
  expect(joined.ok).toBe(true);
  await settle(all);
  return { t, other, net, g, all };
}

describe('Groups screen', () => {
  it('shows the empty state, a mesh warning and the create/join actions', async () => {
    const t = await makeTestServices();
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <GroupsScreen navigation={n} route={{} as never} />
      </Harness>,
    );
    expect(screen.getByText('No groups yet')).toBeTruthy();
    expect(screen.getByText('Mesh is off')).toBeTruthy();
    fireEvent.press(screen.getByTestId('groups-create'));
    fireEvent.press(screen.getByTestId('groups-join'));
    expect(calls).toEqual([
      ['navigate', 'CreateGroup'],
      ['navigate', 'JoinGroup'],
    ]);
  });

  it('lists groups with the role and lets the organizer approve a request', async () => {
    const { t, other, all } = await twoDevices('organizer');
    const inv = await t.services.groups.createInvite((await t.services.groupsRepo.list())[0]!.id);
    const parsed = inv.ok ? parseInviteLink(inv.value.link) : null;
    await other.groups.joinFromInvite(parsed && parsed.ok ? parsed.invite : (undefined as never));
    await settle(all);
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <GroupsScreen navigation={n} route={{} as never} />
      </Harness>,
    );
    expect(await screen.findByText('Ridge walk')).toBeTruthy();
    expect(screen.getByText('Organizer')).toBeTruthy();
    expect(await screen.findByTestId('join-request')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('join-approve'));
    });
    await settle(all);
    expect((await other.groupsRepo.list())[0]?.status).toBe('active');
  });
});

describe('Create Group screen', () => {
  it('creates the group, makes the user the organizer and opens its details', async () => {
    const { t } = await twoDevicesBase();
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <CreateGroupScreen navigation={n} route={{} as never} />
      </Harness>,
    );
    expect(screen.getByTestId('group-create-submit').props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('group-name'), 'Sunday loop');
    fireEvent.changeText(screen.getByTestId('your-name'), 'Alex');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-create-submit'));
    });
    const groups = await t.services.groupsRepo.list();
    expect(groups).toMatchObject([{ name: 'Sunday loop', role: 'organizer' }]);
    expect(calls[0]).toEqual(['replace', 'GroupDetails', { groupId: groups[0]!.id }]);
    expect(await t.services.kv.get('profile.name')).toBe('Alex');
  });

  it('keeps Create disabled until both names are filled in', async () => {
    const t = await makeTestServices();
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <CreateGroupScreen navigation={n} route={{} as never} />
      </Harness>,
    );
    // FakeMesh reports an address from the start; stop it to simulate a device that is not running.
    fireEvent.changeText(screen.getByTestId('group-name'), '   ');
    fireEvent.changeText(screen.getByTestId('your-name'), 'Alex');
    expect(screen.getByTestId('group-create-submit').props.accessibilityState.disabled).toBe(true);
  });
});

async function twoDevicesBase() {
  const net = new FakeNetwork();
  const t = await makeTestServices({ net, address: 'off1me' });
  await t.mesh.start();
  await t.services.groups.start({ poll: false });
  return { t, net };
}

describe('Join Group screen', () => {
  it('rejects text that is not an invitation', async () => {
    const { t } = await twoDevicesBase();
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <JoinGroupScreen navigation={n} route={{ params: undefined } as never} />
      </Harness>,
    );
    fireEvent.changeText(screen.getByTestId('your-name'), 'Sam');
    fireEvent.changeText(screen.getByTestId('invite-link'), 'hello');
    await act(async () => {
      fireEvent.press(screen.getByTestId('join-submit'));
    });
    expect(screen.getByText('That is not a TrailMesh invitation.')).toBeTruthy();
  });

  it('joins from a pasted invitation and opens the group once the organizer accepts', async () => {
    const { t, net } = await twoDevicesBase();
    const org = await makeGroupNode(net, 'off1org', { name: 'Olive' });
    const g = await org.groups.createGroup({ name: 'Ridge walk' });
    const inv = await org.groups.createInvite(g.ok ? g.value.id : '', { autoApprove: true });
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <JoinGroupScreen navigation={n} route={{ params: undefined } as never} />
      </Harness>,
    );
    fireEvent.changeText(screen.getByTestId('your-name'), 'Sam');
    fireEvent.changeText(screen.getByTestId('invite-link'), inv.ok ? inv.value.link : '');
    await act(async () => {
      fireEvent.press(screen.getByTestId('join-submit'));
      await settle([org, { groups: t.services.groups }]);
    });
    await waitFor(() =>
      expect(calls.some(c => c[0] === 'replace' && c[1] === 'GroupDetails')).toBe(true),
    );
    expect((await t.services.groupsRepo.list())[0]).toMatchObject({
      role: 'member',
      status: 'active',
    });
  });

  it('lists open groups found nearby', async () => {
    const { t, net } = await twoDevicesBase();
    const org = await makeGroupNode(net, 'off1org');
    const g = await org.groups.createGroup({ name: 'Open group' });
    await org.groups.openNearby(g.ok ? g.value.id : '');
    t.mesh.simulatePeer('off1org');
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <JoinGroupScreen navigation={n} route={{ params: undefined } as never} />
      </Harness>,
    );
    expect(screen.getByTestId('nearby-empty')).toBeTruthy();
    await act(async () => {
      await settle([org, { groups: t.services.groups }]);
    });
    expect(await screen.findByText('Open group')).toBeTruthy();
  });
});

describe('Group Details screen', () => {
  it('shows the roster and an invitation QR code to the organizer, and ends the group', async () => {
    const { t, other, all, g } = await twoDevices('organizer');
    const inv = await t.services.groups.createInvite(g.id, { autoApprove: true });
    const parsed = inv.ok ? parseInviteLink(inv.value.link) : null;
    await other.groups.joinFromInvite(parsed && parsed.ok ? parsed.invite : (undefined as never));
    await settle(all);
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <GroupDetailsScreen navigation={n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    expect(await screen.findByText('Members (2)')).toBeTruthy();
    expect(screen.getByText('Me (you)')).toBeTruthy();
    expect(screen.getByText('You organize this group')).toBeTruthy();
    fireEvent.press(screen.getByTestId('invite-create'));
    expect(await screen.findByTestId('qr-code')).toBeTruthy();

    fireEvent.press(screen.getByTestId('group-leave'));
    const buttons = alertSpy.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find(b => b.text === 'End group')!.onPress!();
      await settle(all);
    });
    expect(await t.services.groupsRepo.get(g.id)).toBeNull();
    expect((await other.groupsRepo.get(g.id))?.status).toBe('closed');
    expect(calls.at(-1)).toEqual(['navigate', 'GroupsList']);
  });

  it('a member sees the organizer and can leave', async () => {
    const { t, g, all, other } = await twoDevices('member');
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <GroupDetailsScreen navigation={n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    expect(await screen.findByText('Members (2)')).toBeTruthy();
    expect(screen.queryByTestId('invite-create')).toBeNull();
    fireEvent.press(screen.getByTestId('group-leave'));
    const buttons = alertSpy.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find(b => b.text === 'Leave')!.onPress!();
      await settle(all);
    });
    expect(await t.services.groupsRepo.get(g.id)).toBeNull();
    expect((await other.groupsRepo.member(g.id, 'off1me'))?.state).toBe('left');
  });
});

describe('Meeting Point details', () => {
  it('shows who created and updated it, and lets a member acknowledge', async () => {
    const { t, other, g, all } = await twoDevices('member');
    const first = await other.groups.publishPoint(g.id, {
      name: 'Lake junction',
      note: 'Lunch here',
      lat: 56.8,
      lon: -5.1,
    });
    const id = first.ok ? first.value.point.id : '';
    await settle(all);
    await other.groups.publishPoint(
      g.id,
      { name: 'Lake junction', note: 'Lunch here', lat: 56.81, lon: -5.1 },
      id,
    );
    await settle(all);
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <MeetingPointScreen
          navigation={n}
          route={{ params: { groupId: g.id, pointId: id } } as never}
        />
      </Harness>,
    );
    expect(await screen.findByText('Lunch here')).toBeTruthy();
    expect(screen.getByTestId('point-coords').props.children).toBe('56.810000, -5.100000');
    expect(screen.getByTestId('point-created').props.children.join('')).toContain('Created by');
    expect(screen.getByTestId('point-updated').props.children).toContain('Updated by');
    await act(async () => {
      fireEvent.press(screen.getByTestId('point-ack'));
      await settle(all);
    });
    expect(await screen.findByText('Acknowledged')).toBeTruthy();
    expect(await other.points.acks(g.id, id)).toMatchObject([{ address: 'off1me', rev: 2 }]);
  });

  it('shows a removed point as gone', async () => {
    const { t, other, g, all } = await twoDevices('member');
    const first = await other.groups.publishPoint(g.id, { name: 'P', lat: 1, lon: 2 });
    const id = first.ok ? first.value.point.id : '';
    await settle(all);
    await other.groups.removePoint(g.id, id);
    await settle(all);
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <MeetingPointScreen
          navigation={n}
          route={{ params: { groupId: g.id, pointId: id } } as never}
        />
      </Harness>,
    );
    expect(await screen.findByText('Meeting point removed')).toBeTruthy();
  });
});

describe('Map: meeting point controls', () => {
  const renderMap = async (t: Awaited<ReturnType<typeof makeTestServices>>) => {
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <MapScreen navigation={n} route={{ key: 'Map', name: 'Map', params: undefined } as never} />
      </Harness>,
    );
    await waitFor(() => expect(mockMap.map).not.toBeNull());
    return { calls };
  };
  const pressMarker = (key: string) =>
    act(() => {
      mockMap.sources['meeting-points']!.onPress({
        nativeEvent: { features: [{ properties: { id: key } }] },
      });
    });

  it('shows an honest mesh pill and explains it when tapped', async () => {
    const { t, g, all } = await twoDevices('organizer');
    await settle(all);
    await renderMap(t);
    const pill = await screen.findByTestId('mesh-pill');
    expect(pill.props.accessibilityLabel).not.toMatch(/connected/i);
    fireEvent.press(pill);
    expect(await screen.findByTestId('mesh-status-sheet')).toBeTruthy();
    expect(screen.getByTestId('mesh-status-diagnostics')).toBeTruthy();
    expect(g.id).toBeTruthy();
  });

  it('long-press without a group still drops a personal marker', async () => {
    const t = await makeTestServices();
    await renderMap(t);
    await act(async () => {
      mockMap.map!.onLongPress({ nativeEvent: { lngLat: [-3, 54] } });
    });
    await waitFor(async () => expect(await t.services.points.list()).toHaveLength(1));
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('an organizer long-presses, names the point and publishes it to the group', async () => {
    const { t, other, g, all } = await twoDevices('organizer');
    const inv = await t.services.groups.createInvite(g.id, { autoApprove: true });
    const parsed = inv.ok ? parseInviteLink(inv.value.link) : null;
    await other.groups.joinFromInvite(parsed && parsed.ok ? parsed.invite : (undefined as never));
    await settle(all);
    await renderMap(t);
    await waitFor(() => expect(mockMap.map).not.toBeNull());
    await act(async () => {
      mockMap.map!.onLongPress({ nativeEvent: { lngLat: [-5.0035, 56.7968] } });
    });
    const buttons = await waitFor(() => {
      const b = alertSpy.mock.calls.at(-1)?.[2] as
        | { text: string; onPress?: () => void }[]
        | undefined;
      expect(b).toBeDefined();
      return b!;
    });
    expect(buttons.map(b => b.text)).toEqual([
      'Meeting point: Ridge walk',
      'Personal marker',
      'Cancel',
    ]);
    await act(async () => {
      buttons[0]!.onPress!();
    });
    fireEvent.changeText(await screen.findByTestId('meeting-name-input'), 'Lake junction');
    fireEvent.changeText(screen.getByTestId('meeting-note-input'), 'Lunch at noon');
    await act(async () => {
      fireEvent.press(screen.getByTestId('meeting-submit'));
      await settle(all);
    });
    const received = await other.points.list(g.id);
    expect(received).toMatchObject([
      { name: 'Lake junction', note: 'Lunch at noon', lat: 56.7968, lon: -5.0035 },
    ]);
    expect(await t.services.points.list()).toEqual([]);
    expect(await screen.findByTestId('meeting-sheet')).toBeTruthy();
  });

  it('a member sees a received point at its coordinates and can acknowledge it', async () => {
    const { t, other, g, all } = await twoDevices('member');
    const p = await other.groups.publishPoint(g.id, { name: 'Hut', lat: 56.8, lon: -5.1 });
    await settle(all);
    const { calls } = await renderMap(t);
    await waitFor(() => expect(mockMap.sources['meeting-points']?.data.features).toHaveLength(1));
    expect(mockMap.sources['meeting-points']!.data.features[0].geometry.coordinates).toEqual([
      -5.1, 56.8,
    ]);
    const key = `${g.id}:${p.ok ? p.value.point.id : ''}`;
    await pressMarker(key);
    expect(await screen.findByTestId('meeting-sheet')).toBeTruthy();
    expect(screen.getByTestId('meeting-name').props.children).toBe('Hut');
    expect(screen.queryByTestId('meeting-edit')).toBeNull();
    fireEvent.press(screen.getByTestId('meeting-navigate'));
    expect(calls.at(-1)).toEqual([
      'navigate',
      'Navigate',
      { groupId: g.id, pointId: p.ok ? p.value.point.id : '' },
    ]);
    await act(async () => {
      fireEvent.press(screen.getByTestId('meeting-ack'));
      await settle(all);
    });
    expect(await screen.findByText('Acknowledged')).toBeTruthy();
  });

  it('a removal disappears from the map', async () => {
    const { t, other, g, all } = await twoDevices('member');
    const p = await other.groups.publishPoint(g.id, { name: 'Hut', lat: 56.8, lon: -5.1 });
    await settle(all);
    await renderMap(t);
    await waitFor(() => expect(mockMap.sources['meeting-points']?.data.features).toHaveLength(1));
    await act(async () => {
      await other.groups.removePoint(g.id, p.ok ? p.value.point.id : '');
      await settle(all);
    });
    await waitFor(() => expect(mockMap.sources['meeting-points']!.data.features).toHaveLength(0));
  });
});
