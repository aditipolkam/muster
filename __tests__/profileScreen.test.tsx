import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProfileScreen } from '../src/features/profile/ProfileScreen';
import { Harness } from '../src/testing/componentHarness';
import { makeTestServices } from '../src/testing/services';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const nav = () => {
  const calls: unknown[][] = [];
  const n: any = { navigate: (...a: unknown[]) => calls.push(['navigate', ...a]) };
  return { n, calls };
};

describe('Profile screen', () => {
  it('shows the saved name and saves an edit for the group screens to use', async () => {
    const t = await makeTestServices();
    await t.services.kv.set('profile.name', 'Alex');
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <ProfileScreen navigation={n} route={{} as never} />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId('profile-name').props.value).toBe('Alex'));
    fireEvent.changeText(screen.getByTestId('profile-name'), '  Sam ');
    await act(async () => {
      fireEvent(screen.getByTestId('profile-name'), 'submitEditing');
    });
    expect(await t.services.kv.get('profile.name')).toBe('Sam');
  });

  it('does not save an empty name', async () => {
    const t = await makeTestServices();
    await t.services.kv.set('profile.name', 'Alex');
    const { n } = nav();
    render(
      <Harness services={t.services}>
        <ProfileScreen navigation={n} route={{} as never} />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId('profile-name').props.value).toBe('Alex'));
    fireEvent.changeText(screen.getByTestId('profile-name'), '   ');
    await act(async () => {
      fireEvent(screen.getByTestId('profile-name'), 'submitEditing');
    });
    expect(await t.services.kv.get('profile.name')).toBe('Alex');
    expect(screen.getByTestId('profile-name').props.value).toBe('Alex');
  });

  it('opens Settings from the top-right icon', async () => {
    const t = await makeTestServices();
    const { n, calls } = nav();
    render(
      <Harness services={t.services}>
        <ProfileScreen navigation={n} route={{} as never} />
      </Harness>,
    );
    fireEvent.press(screen.getByTestId('profile-settings'));
    expect(calls).toContainEqual(['navigate', 'Settings']);
  });
});
