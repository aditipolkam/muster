import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { Group, MeetingPoint } from '../src/domain/groups/model';
import { NavigateScreen } from '../src/features/navigate/NavigateScreen';
import { MY_PLACES, targetSections } from '../src/features/navigate/targets';
import { useLocationStore } from '../src/platform/locationStore';
import { Harness } from '../src/testing/componentHarness';
import { makeTestServices } from '../src/testing/services';

const group = (id: string, name: string, status: Group['status'] = 'active'): Group => ({
  id,
  name,
  organizer: 'off1me',
  role: 'organizer',
  status,
  createdAt: 1,
  joinedAt: 1,
  memberRev: 0,
});
const point = (groupId: string, id: string, name: string, deleted = false): MeetingPoint =>
  ({ groupId, id, name, deleted, lat: 1, lon: 1 } as MeetingPoint);

describe('targetSections', () => {
  it('groups meeting points by group, skips empty/ended groups and deleted points, then lists my places', () => {
    const sections = targetSections(
      [
        group('g2', 'Zebra'),
        group('g1', 'Alpha'),
        group('g3', 'Empty'),
        group('g4', 'Old', 'closed'),
      ],
      [
        point('g1', 'a', 'Hut'),
        point('g2', 'b', 'Camp'),
        point('g1', 'c', 'Gone', true),
        point('g4', 'd', 'X'),
      ],
      [{ id: 'm', name: 'Cairn', note: null, lat: 2, lon: 2, createdAt: 1, updatedAt: 1 }],
    );
    expect(sections.map(s => s.title)).toEqual(['Alpha', 'Zebra', MY_PLACES]);
    expect(sections[0]!.data.map(o => o.name)).toEqual(['Hut']);
    expect(sections[2]!.data[0]).toMatchObject({ name: 'Cairn', subtitle: 'Marked by you' });
  });
});

describe('Compass screen', () => {
  const setup = async () => {
    const t = await makeTestServices({ address: 'off1me' });
    await t.mesh.start();
    await t.services.groups.start({ poll: false });
    useLocationStore.setState({
      permission: 'granted',
      fix: { lat: 54.5, lon: -3.0, accM: 5, fixAt: Date.now() },
      headingDeg: null,
    });
    return t;
  };
  const ui = (t: Awaited<ReturnType<typeof makeTestServices>>, params?: object) => (
    <Harness services={t.services}>
      <NavigateScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{ key: 'n', name: 'Navigate', params } as never}
      />
    </Harness>
  );

  it('works as a plain compass with no location chosen, and shows the heading', async () => {
    const t = await setup();
    render(ui(t));
    expect(await screen.findByText('Compass only')).toBeTruthy();
    expect(screen.getByTestId('compass-heading').props.children).toBe('–');
    act(() => useLocationStore.setState({ headingDeg: 90 }));
    expect(screen.getByTestId('compass-heading').props.children).toBe('90°');
    // north stays north: the dial turns against the heading
    expect(StyleSheet.flatten(screen.getByTestId('compass-dial').props.style).transform).toEqual([
      { rotate: '-90deg' },
    ]);
  });

  it('shows distance and bearing to a saved place from a deep link', async () => {
    const t = await setup();
    const m = await t.points.create({ name: 'Hut', lat: 54.51, lon: -3.0 });
    render(ui(t, { markerId: m.id }));
    expect(await screen.findByTestId('nav-distance')).toBeTruthy();
    expect(screen.getByText('Hut')).toBeTruthy();
    expect(screen.getByText(/Marked by you · 1\.11 km · N 0°/)).toBeTruthy();
    expect(screen.getByText('Straight line · terrain not considered')).toBeTruthy();
  });

  it('the dropdown lists locations by group and by my places, and selecting one points at it', async () => {
    const t = await setup();
    const g = await t.services.groups.createGroup({ name: 'Ridge walk' });
    const gid = g.ok ? g.value.id : '';
    const p = await t.services.groups.publishPoint(gid, {
      name: 'Lake junction',
      lat: 54.52,
      lon: -3.0,
    });
    await t.points.create({ name: 'Cairn', lat: 54.5, lon: -3.01 });
    render(ui(t));

    fireEvent.press(await screen.findByTestId('target-select'));
    const picker = await screen.findByTestId('target-picker');
    await waitFor(() => expect(within(picker).getByText('RIDGE WALK')).toBeTruthy());
    expect(within(picker).getByText('MY PLACES')).toBeTruthy();
    expect(within(picker).getByText('Cairn')).toBeTruthy();

    fireEvent.press(within(picker).getByText('Lake junction'));
    expect(await screen.findByText(/Ridge walk · 2\.22 km · N 0°/)).toBeTruthy();
    expect(screen.getByTestId('nav-distance')).toBeTruthy();
    expect(p.ok).toBe(true);

    // back to a plain compass
    fireEvent.press(screen.getByTestId('target-select'));
    fireEvent.press(await screen.findByTestId('target-none'));
    expect(await screen.findByText('Compass only')).toBeTruthy();
    expect(screen.queryByTestId('nav-distance')).toBeNull();
  });

  it('says what will appear when there is nothing to pick yet', async () => {
    const t = await setup();
    render(ui(t));
    fireEvent.press(await screen.findByTestId('target-select'));
    expect(await screen.findByTestId('target-empty')).toBeTruthy();
  });
});
