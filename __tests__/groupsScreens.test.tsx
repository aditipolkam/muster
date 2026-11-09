import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { parseInviteLink } from '../src/domain/groups/invite';
import { areaFromBox } from '../src/domain/maps/mapArea';
import { buildFeed } from '../src/features/groups/GroupsScreens';
import { MapScreen } from '../src/features/map/MapScreen';
import {
  CreateGroupScreen,
  GroupDetailsScreen,
  GroupInfoScreen,
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
    Marker: (p: Record<string, any>) => R.createElement(View, { testID: p.id }, p.children),
  };
});

const nav = () => {
  const calls: unknown[][] = [];
  const n: any = {
    navigate: (...a: unknown[]) => calls.push(['navigate', ...a]),
    replace: (...a: unknown[]) => calls.push(['replace', ...a]),
    goBack: () => calls.push(['goBack']),
    setParams: (...a: unknown[]) => calls.push(['setParams', ...a]),
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

  it('the header has Join and New, and the list ends with how to join a trek', async () => {
    const { t } = await twoDevices('organizer');
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <GroupsScreen navigation={n} route={{} as never} />
      </Harness>,
    );
    fireEvent.press(screen.getByTestId('groups-add-join'));
    expect(calls).toEqual([['navigate', 'JoinGroup']]);
    fireEvent.press(screen.getByTestId('groups-add-create'));
    expect(calls[1]).toEqual(['navigate', 'CreateGroup']);
    expect(await screen.findByTestId('groups-join-hint')).toBeTruthy();
    expect(screen.getByText("Joining someone's trek?")).toBeTruthy();
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
    expect(await screen.findByText(/members? · You organize/)).toBeTruthy();
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
    await t.services.kv.set('profile.name', 'Alex');
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <CreateGroupScreen navigation={n} route={{} as never} />
      </Harness>,
    );
    expect(screen.getByTestId('group-create-submit').props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('group-name'), 'Sunday loop');
    await waitFor(() =>
      expect(screen.getByTestId('group-create-submit').props.accessibilityState.disabled).toBe(
        false,
      ),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-create-submit'));
    });
    const groups = await t.services.groupsRepo.list();
    expect(groups).toMatchObject([{ name: 'Sunday loop', role: 'organizer' }]);
    expect(calls[0]).toEqual([
      'replace',
      'GroupInfo',
      { groupId: groups[0]!.id, justCreated: true },
    ]);
  });

  it('keeps Create disabled and points to Profile until a name is set', async () => {
    const t = await makeTestServices();
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <CreateGroupScreen navigation={n} route={{} as never} />
      </Harness>,
    );
    fireEvent.changeText(screen.getByTestId('group-name'), 'Sunday loop');
    expect(await screen.findByText('Set your name first')).toBeTruthy();
    expect(screen.getByTestId('group-create-submit').props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByTestId('your-name')).toBeNull();
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
    await t.services.kv.set('profile.name', 'Sam');
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <JoinGroupScreen navigation={n} route={{ params: undefined } as never} />
      </Harness>,
    );
    fireEvent.press(await screen.findByTestId('paste-toggle'));
    fireEvent.changeText(screen.getByTestId('invite-link'), 'hello');
    await act(async () => {
      fireEvent.press(screen.getByTestId('join-submit'));
    });
    expect(screen.getByText('That is not a Muster invitation.')).toBeTruthy();
  });

  it('joins from a pasted invitation and opens the group once the organizer accepts', async () => {
    const { t, net } = await twoDevicesBase();
    await t.services.kv.set('profile.name', 'Sam');
    const org = await makeGroupNode(net, 'off1org', { name: 'Olive' });
    const g = await org.groups.createGroup({ name: 'Ridge walk' });
    const inv = await org.groups.createInvite(g.ok ? g.value.id : '', { autoApprove: true });
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <JoinGroupScreen navigation={n} route={{ params: undefined } as never} />
      </Harness>,
    );
    await waitFor(() => expect(screen.queryByText('Set your name first')).toBeNull());
    fireEvent.press(await screen.findByTestId('paste-toggle'));
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

  it('a deep link shows who invited you and joins with one tap', async () => {
    const { t, net } = await twoDevicesBase();
    await t.services.kv.set('profile.name', 'Sam');
    const org = await makeGroupNode(net, 'off1org', { name: 'Olive' });
    const g = await org.groups.createGroup({ name: 'Ridge walk' });
    const inv = await org.groups.createInvite(g.ok ? g.value.id : '', { autoApprove: true });
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <JoinGroupScreen
          navigation={n}
          route={{ params: { link: inv.ok ? inv.value.link : '' } } as never}
        />
      </Harness>,
    );
    expect(await screen.findByText('Ridge walk')).toBeTruthy();
    expect(screen.getByText('You are invited to')).toBeTruthy();
    expect(screen.queryByTestId('invite-link')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('join-submit').props.accessibilityState.disabled).toBeFalsy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('join-submit'));
      await settle([org, { groups: t.services.groups }]);
    });
    await waitFor(() =>
      expect(calls.some(c => c[0] === 'replace' && c[1] === 'GroupDetails')).toBe(true),
    );
  });

  it('shows a waiting card with a way to cancel while the organizer decides', async () => {
    const { t, net } = await twoDevicesBase();
    await t.services.kv.set('profile.name', 'Sam');
    const org = await makeGroupNode(net, 'off1org', { name: 'Olive' });
    const g = await org.groups.createGroup({ name: 'Ridge walk' });
    const inv = await org.groups.createInvite(g.ok ? g.value.id : '');
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <JoinGroupScreen navigation={n} route={{ params: undefined } as never} />
      </Harness>,
    );
    fireEvent.press(await screen.findByTestId('paste-toggle'));
    await waitFor(() => expect(screen.queryByText('Set your name first')).toBeNull());
    fireEvent.changeText(screen.getByTestId('invite-link'), inv.ok ? inv.value.link : '');
    await act(async () => {
      fireEvent.press(screen.getByTestId('join-submit'));
    });
    expect(await screen.findByTestId('join-waiting')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('join-cancel'));
    });
    expect(await t.services.groupsRepo.list()).toEqual([]);
    expect(await screen.findByTestId('scan-qr')).toBeTruthy();
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

describe('buildFeed', () => {
  const at = (d: string) => new Date(d).getTime();
  const member = (address: string, name: string, updatedAt: number) =>
    ({ address, name, state: 'active', rev: 1, updatedAt } as never);

  it('orders newest first and inserts a day label before each day', () => {
    const now = at('2026-11-03T12:00:00');
    const feed = buildFeed(
      [member('a', 'Ana', at('2026-11-02T09:00:00')), member('b', 'Bo', at('2026-11-03T08:00:00'))],
      [{ id: 'p', rev: 2, name: 'Hut', updatedAt: at('2026-11-03T10:00:00'), updatedBy: 'b' }],
      'a',
      now,
    );
    expect(feed.map(e => (e.kind === 'day' ? `day:${e.text}` : e.kind))).toEqual([
      'meeting',
      'member',
      'day:Today',
      'member',
      'day:Yesterday',
    ]);
    expect(feed[0]).toMatchObject({ title: 'Meeting point updated', name: 'Hut' });
    expect(feed.find(e => e.kind === 'member' && e.text === 'You joined')).toBeTruthy();
  });

  it('marks a meeting point as mine only when this phone wrote that revision', () => {
    const now = at('2026-11-03T12:00:00');
    const point = (id: string, updatedBy: string) => ({
      id,
      rev: 1,
      name: id,
      updatedAt: at('2026-11-03T10:00:00'),
      updatedBy,
    });
    const feed = buildFeed([], [point('mine', 'a'), point('theirs', 'b')], 'a', now);
    const mine = Object.fromEntries(
      feed.flatMap(e => (e.kind === 'meeting' ? [[e.name, e.mine]] : [])),
    );
    expect(mine).toEqual({ mine: true, theirs: false });
    // Before the mesh reports an address nothing is mine.
    expect(
      buildFeed([], [point('x', 'a')], null, now).some(e => e.kind === 'meeting' && e.mine),
    ).toBe(false);
  });
});

describe('Group page (updates)', () => {
  it('opens on Updates: joins and shared meeting points, newest at the bottom, no member list', async () => {
    const { t, other, all, g } = await twoDevices('organizer');
    const inv = await t.services.groups.createInvite(g.id, { autoApprove: true });
    const parsed = inv.ok ? parseInviteLink(inv.value.link) : null;
    await other.groups.joinFromInvite(parsed && parsed.ok ? parsed.invite : (undefined as never));
    await settle(all);
    const p = await t.services.groups.publishPoint(g.id, {
      name: 'Lake junction',
      lat: 56.8,
      lon: -5.1,
    });
    await settle(all);
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <GroupDetailsScreen navigation={n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    // In the feed, and pinned at the top as the active meeting point.
    expect((await screen.findAllByText('Lake junction')).length).toBe(2);
    expect(screen.getByTestId('group-pinned-point')).toBeTruthy();
    expect(screen.getByText('Meeting point shared')).toBeTruthy();
    expect(screen.getByText('Other joined')).toBeTruthy();
    expect(typeof screen.getByTestId('group-status').props.children).toBe('string');
    expect(
      screen.getByText("Only you can post here. Followers get your updates when they're in range."),
    ).toBeTruthy();
    expect(screen.queryByText('Members (2)')).toBeNull();
    expect(screen.queryByTestId('invite-create')).toBeNull();
    expect(p.ok).toBe(true);
  });

  it('tapping a meeting point update plots it on the map', async () => {
    const { t, other, all, g } = await twoDevices('member');
    const p = await other.groups.publishPoint(g.id, { name: 'Hut', lat: 56.8, lon: -5.1 });
    await settle(all);
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <GroupDetailsScreen navigation={n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    fireEvent.press(await screen.findByTestId(`update-${p.ok ? p.value.point.id : ''}`));
    expect(calls.at(-1)).toEqual([
      'navigate',
      'Map',
      { focusMeetingPoint: `${g.id}:${p.ok ? p.value.point.id : ''}`, nonce: expect.any(Number) },
    ]);
  });

  it('tapping the title opens group info', async () => {
    const { t, g } = await twoDevices('member');
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <GroupDetailsScreen navigation={n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    fireEvent.press(await screen.findByTestId('group-title'));
    expect(calls.at(-1)).toEqual(['navigate', 'GroupInfo', { groupId: g.id }]);
  });

  it('organizers can share a location from the group page', async () => {
    const org = await twoDevices('organizer');
    render(
      <Harness services={org.t.services}>
        <GroupDetailsScreen
          navigation={nav().n}
          route={{ params: { groupId: org.g.id } } as never}
        />
      </Harness>,
    );
    expect(await screen.findByTestId('group-share-location')).toBeTruthy();
    expect(screen.getByTestId('group-open-map')).toBeTruthy();
  });

  it('members cannot share a location (only the organizer publishes points)', async () => {
    const mem = await twoDevices('member');
    render(
      <Harness services={mem.t.services}>
        <GroupDetailsScreen
          navigation={nav().n}
          route={{ params: { groupId: mem.g.id } } as never}
        />
      </Harness>,
    );
    await screen.findByTestId('group-title');
    expect(screen.queryByTestId('group-share-location')).toBeNull();
    expect(screen.queryByTestId('group-open-map')).toBeNull();
  });

  it('says so when there are no updates yet', async () => {
    const { t, g } = await twoDevices('organizer');
    render(
      <Harness services={t.services}>
        <GroupDetailsScreen navigation={nav().n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    await screen.findByTestId('group-title');
    // The organizer's own join is the first update.
    expect(screen.getByText('You joined')).toBeTruthy();
  });
});

describe('Group info screen', () => {
  it('shows the roster and an invitation QR code to the organizer, and ends the group', async () => {
    const { t, other, all, g } = await twoDevices('organizer');
    const inv = await t.services.groups.createInvite(g.id, { autoApprove: true });
    const parsed = inv.ok ? parseInviteLink(inv.value.link) : null;
    await other.groups.joinFromInvite(parsed && parsed.ok ? parsed.invite : (undefined as never));
    await settle(all);
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <GroupInfoScreen navigation={n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    expect(await screen.findByText('Members (2)')).toBeTruthy();
    expect(screen.getByText('Me (you)')).toBeTruthy();
    expect(screen.getByTestId('info-meta').props.children.join('')).toMatch(/You organize/);
    // The invitation lives on its own tab.
    expect(screen.queryByTestId('invite-create')).toBeNull();
    fireEvent.press(screen.getByTestId('info-tab-invite'));
    fireEvent.press(screen.getByTestId('invite-create'));
    expect(await screen.findByTestId('qr-code')).toBeTruthy();
    expect(screen.getByTestId('invite-terms').props.children.join('')).toMatch(
      /One person · you approve · expires in \d+ (h|min)/,
    );
    // Switching approval only takes effect on the next code, and the screen says so.
    fireEvent(screen.getByTestId('invite-auto'), 'valueChange', true);
    expect(screen.getByText(/Create a new code to use it/)).toBeTruthy();

    // Ending the group lives in the menu at the top right, not on the page.
    fireEvent.press(screen.getByTestId('info-menu'));
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

  it('right after creating, shows the invitation QR straight away and Done returns to the group', async () => {
    const { t, g } = await twoDevices('organizer');
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <GroupInfoScreen
          navigation={n}
          route={{ params: { groupId: g.id, justCreated: true } } as never}
        />
      </Harness>,
    );
    expect(await screen.findByTestId('qr-code')).toBeTruthy();
    expect(screen.getByText('Group created')).toBeTruthy();
    fireEvent.press(screen.getByText('Done'));
    expect(calls.at(-1)).toEqual(['navigate', 'GroupDetails', { groupId: g.id }]);
  });

  it('opens on members and shows one tab at a time, keeping the header and menu on each', async () => {
    const { t, g } = await twoDevices('organizer');
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <GroupInfoScreen navigation={n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    expect(await screen.findByText(/Members \(/)).toBeTruthy();
    expect(screen.queryByText(/Meeting points \(/)).toBeNull();
    expect(screen.queryByTestId('qr-code')).toBeNull();

    fireEvent.press(screen.getByTestId('info-tab-points'));
    expect(await screen.findByText('Meeting points (0)')).toBeTruthy();
    expect(screen.queryByText(/Members \(/)).toBeNull();
    expect(screen.getByTestId('info-name')).toBeTruthy();
    expect(screen.getByTestId('info-menu')).toBeTruthy();

    // The invitation opens from the last row of Members.
    fireEvent.press(screen.getByTestId('info-tab-members'));
    fireEvent.press(screen.getByTestId('info-tab-invite'));
    expect(screen.getByTestId('invite-create')).toBeTruthy();
    expect(screen.queryByText(/Meeting points \(/)).toBeNull();
  });

  it('lists meeting points and opens one directly on the map', async () => {
    const { t, other, all, g } = await twoDevices('member');
    const p = await other.groups.publishPoint(g.id, { name: 'Hut', lat: 56.8, lon: -5.1 });
    await settle(all);
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <GroupInfoScreen navigation={n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    fireEvent.press(await screen.findByTestId('info-tab-points'));
    expect(await screen.findByText('Meeting points (1)')).toBeTruthy();
    fireEvent.press(screen.getByTestId(`point-${p.ok ? p.value.point.id : ''}`));
    expect(calls.at(-1)).toEqual([
      'navigate',
      'Map',
      { focusMeetingPoint: `${g.id}:${p.ok ? p.value.point.id : ''}`, nonce: expect.any(Number) },
    ]);
  });

  it('a member sees the organizer and can leave', async () => {
    const { t, g, all, other } = await twoDevices('member');
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <GroupInfoScreen navigation={n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    expect(await screen.findByText('Members (2)')).toBeTruthy();
    // Only the organizer invites.
    expect(screen.queryByTestId('info-tab-invite')).toBeNull();
    expect(screen.queryByTestId('invite-create')).toBeNull();
    fireEvent.press(screen.getByTestId('info-menu'));
    expect(screen.getByTestId('group-sync')).toBeTruthy();
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
  it('shows who created and updated it; a member only reads it (no acknowledge)', async () => {
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
    expect(screen.queryByTestId('point-ack')).toBeNull();
    expect(screen.queryByTestId('point-remove')).toBeNull();
    expect(await other.points.acks(g.id, id)).toEqual([]);
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

describe('Share location (group page)', () => {
  /** Organizer with one member who has joined, so a shared point reaches someone. */
  const withMember = async () => {
    const { t, other, g, all } = await twoDevices('organizer');
    const inv = await t.services.groups.createInvite(g.id, { autoApprove: true });
    const parsed = inv.ok ? parseInviteLink(inv.value.link) : null;
    await other.groups.joinFromInvite(parsed && parsed.ok ? parsed.invite : (undefined as never));
    await settle(all);
    return { t, other, g, all };
  };
  const open = (t: Awaited<ReturnType<typeof makeTestServices>>, params: object) => {
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <GroupDetailsScreen navigation={n} route={{ params } as never} />
      </Harness>,
    );
    return calls;
  };
  const fixAt = (lat: number, lon: number, accM = 6) =>
    useLocationStore.setState({
      permission: 'granted',
      fix: { lat, lon, accM, fixAt: Date.now() },
      watchingSince: Date.now(),
    });

  it('sends the current location as a named meeting point to the group', async () => {
    const { t, other, g, all } = await withMember();
    fixAt(56.7968, -5.0035);
    open(t, { groupId: g.id });
    // With a GPS fix, "Share my location" goes straight to step 2 on where you stand.
    fireEvent.press(await screen.findByTestId('group-share-location'));
    expect(screen.getByTestId('share-location-sheet')).toBeTruthy();
    expect(screen.getByText('Name and share')).toBeTruthy();
    expect(screen.getByText('STEP 2 OF 2')).toBeTruthy();
    expect(screen.getByText('Share with Ridge walk')).toBeTruthy();
    // Change goes back to the choices, which offer where you are.
    fireEvent.press(screen.getByTestId('share-back'));
    expect(screen.getByText(/Accurate to ±6 m/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('share-here'));
    expect(screen.getByTestId('share-submit').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('share-chip-Campsite'));
    expect(screen.getByTestId('share-name').props.value).toBe('Campsite');
    fireEvent.changeText(screen.getByTestId('share-name'), 'Lake junction');
    fireEvent.changeText(screen.getByTestId('share-note'), 'Lunch at noon');
    await act(async () => {
      fireEvent.press(screen.getByTestId('share-submit'));
      await settle(all);
    });
    expect(await other.points.list(g.id)).toMatchObject([
      { name: 'Lake junction', note: 'Lunch at noon', lat: 56.7968, lon: -5.0035 },
    ]);
    // It shows in the feed as this phone's own message (and pinned at the top).
    expect((await screen.findAllByText('Lake junction')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('share-location-sheet')).toBeNull();
  });

  it('without a GPS fix the current location cannot be sent yet', async () => {
    const { t, g } = await twoDevices('organizer');
    useLocationStore.setState({ permission: 'granted', fix: null });
    open(t, { groupId: g.id });
    fireEvent.press(await screen.findByTestId('group-share-location'));
    expect(screen.getByText('Finding your location…')).toBeTruthy();
    fireEvent.press(screen.getByTestId('share-here'));
    expect(screen.queryByText('Name and share')).toBeNull();
  });

  it('offers saved places, with the name filled in', async () => {
    const { t, other, g, all } = await withMember();
    await t.services.points.create({ name: 'Car park', lat: 56.81, lon: -5.11 });
    open(t, { groupId: g.id });
    fireEvent.press(await screen.findByTestId('group-share-location'));
    const [m] = await t.services.points.list();
    fireEvent.press(await screen.findByTestId(`share-saved-${m!.id}`));
    expect(screen.getByTestId('share-name').props.value).toBe('Car park');
    await act(async () => {
      fireEvent.press(screen.getByTestId('share-submit'));
      await settle(all);
    });
    expect(await other.points.list(g.id)).toMatchObject([
      { name: 'Car park', lat: 56.81, lon: -5.11 },
    ]);
  });

  it('Choose on the map opens the pin picker for this group', async () => {
    const { t, g } = await twoDevices('organizer');
    const calls = open(t, { groupId: g.id });
    fireEvent.press(await screen.findByTestId('group-share-location'));
    fireEvent.press(screen.getByTestId('share-on-map'));
    const go = calls.find(c => c[0] === 'navigate' && c[1] === 'Map');
    expect(go?.[2]).toMatchObject({ pickMeeting: { groupId: g.id } });
    expect(screen.queryByTestId('share-location-sheet')).toBeNull();
  });

  it('back from the map, it opens on the chosen place ready to name and share', async () => {
    const { t, other, g, all } = await withMember();
    open(t, { groupId: g.id, picked: { lat: 56.8, lon: -5.1, nonce: 1 } });
    expect(await screen.findByText('Name and share')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('share-name'), 'Hut');
    await act(async () => {
      fireEvent.press(screen.getByTestId('share-submit'));
      await settle(all);
    });
    expect(await other.points.list(g.id)).toMatchObject([{ name: 'Hut', lat: 56.8, lon: -5.1 }]);
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

  it('keeps group and mesh status off the map', async () => {
    const { t, all } = await twoDevices('organizer');
    await settle(all);
    await renderMap(t);
    expect(screen.queryByTestId('mesh-pill')).toBeNull();
    expect(screen.queryByTestId('map-group-card')).toBeNull();
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

  it("an organizer's long-press no longer offers a meeting point: it drops a marker", async () => {
    const { t, all } = await twoDevices('organizer');
    await settle(all);
    await renderMap(t);
    await act(async () => {
      mockMap.map!.onLongPress({ nativeEvent: { lngLat: [-5.0035, 56.7968] } });
    });
    await waitFor(async () => expect(await t.services.points.list()).toHaveLength(1));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('meeting-editor')).toBeNull();
  });

  it('a member sees a received point at its coordinates; followers only read it', async () => {
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
    // "Start navigation" plots the line on the map instead of leaving it.
    const before = calls.length;
    fireEvent.press(screen.getByTestId('meeting-navigate'));
    expect(calls).toHaveLength(before);
    const bar = await screen.findByTestId('navigation-bar');
    expect(within(bar).getByText('Hut')).toBeTruthy();
    fireEvent.press(screen.getByTestId('navigation-end'));
    await pressMarker(key);
    expect(await screen.findByTestId('meeting-sheet')).toBeTruthy();
    // Pub/sub: a follower cannot send anything back to the group, so there is no Acknowledge.
    expect(screen.queryByTestId('meeting-ack')).toBeNull();
    expect(screen.getByTestId('meeting-compass')).toBeTruthy();
    expect(
      screen.getByText('Straight-line estimate. Trails and climbs not included.'),
    ).toBeTruthy();
    void settle(all);
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

describe('Trip map', () => {
  const AREA = areaFromBox([-5.05, 56.77, -4.95, 56.83], 'Ridge walk');
  const installedOver = (bbox: number[]) => ({
    id: 'r1',
    name: 'Ridge',
    bbox: [bbox[0]! - 0.01, bbox[1]! - 0.01, bbox[2]! + 0.01, bbox[3]! + 0.01],
    minZoom: 8,
    maxZoom: 15,
    bytes: 1000,
    sha256: null,
    osmDataDate: null,
    schemaV: 1,
    progressBytes: 1000,
    filePath: '/r.pmtiles',
    installedAt: 1,
    source: 'custom' as const,
    errorCode: null,
    sourceUrl: null,
    state: 'installed' as const,
  });

  /** This phone joins a group whose organizer set a trip map first. */
  async function memberOfGroupWithMap() {
    const net = new FakeNetwork();
    const t = await makeTestServices({ net, address: 'off1me' });
    const other = await makeGroupNode(net, 'off1other', { name: 'Other' });
    await t.mesh.start();
    await t.services.groups.start({ poll: false });
    const og = await other.groups.createGroup({ name: 'Ridge walk' });
    const g = og.ok ? og.value : (undefined as never);
    expect((await other.groups.setTripArea(g.id, AREA)).ok).toBe(true);
    const inv = await other.groups.createInvite(g.id, { autoApprove: true });
    const parsed = inv.ok ? parseInviteLink(inv.value.link) : null;
    await t.services.groups.joinFromInvite(
      parsed && parsed.ok ? parsed.invite : (undefined as never),
    );
    await settle([{ groups: t.services.groups }, other]);
    return { t, other, g };
  }

  it('the organizer chooses it on the map before inviting anyone', async () => {
    const { t, g } = await twoDevices('organizer');
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <GroupInfoScreen navigation={n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    expect(await screen.findByTestId('trip-map-summary')).toHaveTextContent(
      /set it before inviting anyone/,
    );
    fireEvent.press(screen.getByTestId('trip-map-choose'));
    expect(calls.at(-1)).toEqual([
      'navigate',
      'Map',
      { pickTripMap: { groupId: g.id, region: null }, nonce: expect.any(Number) },
    ]);
  });

  it('the area chosen on the map is saved, named after the group, and invites come next', async () => {
    const { t, g } = await twoDevices('organizer');
    const bbox = [-5.05, 56.77, -4.95, 56.83];
    render(
      <Harness services={t.services}>
        <GroupInfoScreen
          navigation={nav().n}
          route={{ params: { groupId: g.id, pickedArea: { bbox, nonce: 1 } } } as never}
        />
      </Harness>,
    );
    await waitFor(async () =>
      expect((await t.services.groupsRepo.get(g.id))?.tripArea?.bbox).toEqual(bbox),
    );
    expect((await t.services.groupsRepo.get(g.id))?.tripArea?.name).toBe('Ridge walk');
    expect(await screen.findByText(/Ridge walk · About/)).toBeTruthy();
    expect(screen.getByTestId('invite-create')).toBeTruthy();
    expect(screen.getByTestId('trip-map-remove')).toBeTruthy();
  });

  it('is locked for the organizer once someone has joined', async () => {
    const { t, other, all, g } = await twoDevices('organizer');
    await t.services.groups.setTripArea(g.id, AREA);
    const inv = await t.services.groups.createInvite(g.id, { autoApprove: true });
    const parsed = inv.ok ? parseInviteLink(inv.value.link) : null;
    await other.groups.joinFromInvite(parsed && parsed.ok ? parsed.invite : (undefined as never));
    await settle(all);
    render(
      <Harness services={t.services}>
        <GroupInfoScreen navigation={nav().n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    expect(await screen.findByTestId('trip-map-locked')).toBeTruthy();
    expect(screen.queryByTestId('trip-map-choose')).toBeNull();
    expect(screen.queryByTestId('trip-map-remove')).toBeNull();
  });

  it('a member who joined is asked to download it on the group page and in the list', async () => {
    const { t, g } = await memberOfGroupWithMap();
    render(
      <Harness services={t.services}>
        <GroupDetailsScreen navigation={nav().n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    expect(
      await screen.findByText(/^Save the trip map \(\d+ (KB|MB)\) before you lose signal$/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Ridge walk · About \d+ (KB|MB)\. Get it while you have internet/),
    ).toBeTruthy();
    screen.unmount();
    render(
      <Harness services={t.services}>
        <GroupsScreen navigation={nav().n} route={{} as never} />
      </Harness>,
    );
    expect(await screen.findByText(/^Trip map not saved offline · \d+ (KB|MB)$/)).toBeTruthy();
  });

  it('one tap on the group page starts the download of that area', async () => {
    const { t, g } = await memberOfGroupWithMap();
    const plan = jest.spyOn(t.services.packs, 'planArea').mockResolvedValue({
      ok: true,
      value: { fileBytes: 1000 } as any,
    });
    const start = jest.spyOn(t.services.packs, 'startArea').mockResolvedValue({
      ok: true,
      value: {} as any,
    });
    render(
      <Harness services={t.services}>
        <GroupDetailsScreen navigation={nav().n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    const button = await screen.findByText('Save');
    await act(async () => {
      fireEvent.press(button);
    });
    expect(plan).toHaveBeenCalledWith(AREA.bbox, AREA.maxZoom);
    expect(start).toHaveBeenCalledWith({ fileBytes: 1000 }, 'Ridge walk');
  });

  it('the nudge goes away once a downloaded map covers the area', async () => {
    const { t, g } = await memberOfGroupWithMap();
    jest.spyOn(t.services.regions, 'list').mockResolvedValue([installedOver(AREA.bbox)] as any);
    render(
      <Harness services={t.services}>
        <GroupInfoScreen navigation={nav().n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    expect(await screen.findByTestId('trip-map-ready')).toBeTruthy();
    expect(screen.queryByTestId('trip-map-choose')).toBeNull();
    screen.unmount();
    render(
      <Harness services={t.services}>
        <GroupDetailsScreen navigation={nav().n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    await screen.findByTestId('group-title');
    expect(screen.queryByTestId('trip-map-banner')).toBeNull();
  });

  it('a member of a group without a trip map sees nothing about it', async () => {
    const { t, g } = await twoDevices('member');
    render(
      <Harness services={t.services}>
        <GroupInfoScreen navigation={nav().n} route={{ params: { groupId: g.id } } as never} />
      </Harness>,
    );
    await screen.findByTestId('info-name');
    expect(screen.queryByTestId('trip-map')).toBeNull();
  });
});
