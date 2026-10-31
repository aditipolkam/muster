import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { MeshDiagnosticsScreen } from '../src/features/mesh-diagnostics/MeshDiagnosticsScreen';
import { FakeMesh } from '../src/testing/FakeMesh';
import { Harness } from '../src/testing/componentHarness';
import { makeTestServices } from '../src/testing/services';
import { DIAG_SERVICE_ID, diagTopics } from '../src/mesh/topics';

async function renderScreen() {
  const t = await makeTestServices();
  const mesh = t.mesh as FakeMesh;
  render(
    <Harness services={t.services}>
      <MeshDiagnosticsScreen />
    </Harness>,
  );
  return { t, mesh };
}

describe('MeshDiagnosticsScreen', () => {
  it('starts idle with Stop and publishing disabled and says it is a dev screen', async () => {
    await renderScreen();
    expect(screen.getByText('Not started')).toBeTruthy();
    expect(screen.getByText(/Start the mesh to scan/)).toBeTruthy();
    expect(screen.getByText(/Development diagnostics/)).toBeTruthy();
    expect(screen.getByTestId('mesh-stop').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('pub-start').props.accessibilityState.disabled).toBe(true);
  });

  it('start shows Running, the address, and enables publishing', async () => {
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('mesh-start'));
    });
    await waitFor(() => expect(screen.getByText('Running')).toBeTruthy());
    expect(screen.getByText('off1testdevice')).toBeTruthy();
    expect(screen.getByText(/Scanning… no devices heard yet/)).toBeTruthy();
    expect(screen.getByTestId('pub-start').props.accessibilityState.disabled).toBe(false);
  });

  it('shows a start failure to the user', async () => {
    const { mesh } = await renderScreen();
    mesh.startFails = true;
    await act(async () => {
      fireEvent.press(screen.getByTestId('mesh-start'));
    });
    await waitFor(() => expect(screen.getByText('Error')).toBeTruthy());
  });

  it('lists nearby and lost peers with their connection status', async () => {
    const { mesh } = await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('mesh-start'));
    });
    act(() => {
      mesh.simulatePeer('off1peeraaaaaaaaaaaaaaaaaaaaa', { linked: true, rssi: -48 });
      mesh.simulatePeer('off1peerbbbbbbbbbbbbbbbbbbbbb', { linked: false });
      mesh.simulatePeer('off1peerccccccccccccccccccccc', { state: 'lost', lostAt: 1 });
    });
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('Nearby')).toBeTruthy();
    expect(screen.getByText('Lost')).toBeTruthy();
    expect(screen.getByText(/-48 dBm/)).toBeTruthy();
    expect(screen.getByText('Nearby devices (2)')).toBeTruthy();
    // only live peers can be subscribed to
    expect(screen.getAllByText('Subscribe to this device')).toHaveLength(2);
  });

  it('publishes an event and shows the SDK delivery report, or "No subscribers" honestly', async () => {
    const { t } = await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('mesh-start'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('pub-start'));
    });
    await waitFor(() => expect(screen.getByText('Publishing')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('pub-text'), 'hello trail');
    await act(async () => {
      fireEvent.press(screen.getByTestId('pub-event'));
    });
    await waitFor(() => expect(screen.getByText('No subscribers')).toBeTruthy());
    expect(t.pubsub.getSnapshot().published[0]).toMatchObject({
      topic: diagTopics.event,
      type: 'ping',
    });
  });

  it('shows received messages and flags a duplicate', async () => {
    const { t } = await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('mesh-start'));
    });
    const body = JSON.stringify({
      tm: 1,
      id: 'dupe-1',
      t: 'ping',
      a: 'off1other',
      ts: 1,
      p: { text: 'from afar' },
    });
    const update = {
      subId: 's',
      topic: diagTopics.event,
      key: null,
      seq: 1,
      snapshot: false,
      provider: 'off1other',
      body,
    };
    await act(async () => {
      await (t.pubsub as any).handleUpdate(update);
      await (t.pubsub as any).handleUpdate({ ...update, seq: 2 });
    });
    expect(screen.getAllByText(/ping: from afar/)).toHaveLength(2);
    expect(screen.getAllByText('Duplicate')).toHaveLength(1);
    expect(screen.getByText(/1 duplicate/)).toBeTruthy();
  });

  it('subscribes to a typed address, lists it, and unsubscribes', async () => {
    const { t } = await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('mesh-start'));
    });
    fireEvent.changeText(screen.getByTestId('sub-address'), 'off1provider');
    await act(async () => {
      fireEvent.press(screen.getByText('Subscribe'));
    });
    await waitFor(() => expect(screen.getByText('Subscriptions (1)')).toBeTruthy());
    expect(t.pubsub.getSnapshot().subscriptions[0]).toMatchObject({
      provider: 'off1provider',
      serviceId: DIAG_SERVICE_ID,
      topic: diagTopics.all,
      mode: 'log',
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Unsubscribe'));
    });
    await waitFor(() => expect(screen.getByText('Subscriptions (0)')).toBeTruthy());
  });

  it('Stop ends subscriptions and publishing before stopping the mesh', async () => {
    const { t } = await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('mesh-start'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('pub-start'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('mesh-stop'));
    });
    await waitFor(() => expect(screen.getByText('Stopped')).toBeTruthy());
    expect(t.pubsub.getSnapshot().providing).toBeNull();
    expect(t.pubsub.getSnapshot().subscriptions).toHaveLength(0);
  });
});
