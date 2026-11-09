import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { ActivityStanding } from '../../domain/adventures/lifecycle';
import { buildInviteLink, parseInviteLink } from '../../domain/groups/invite';
import { presenceText, sortByPresence } from '../../domain/groups/presence';
import { Group, GroupMember, GROUP_NAME_MAX, shortAddress } from '../../domain/groups/model';
import { areaFromBox } from '../../domain/maps/mapArea';
import {
  useGroup,
  useGroupMembers,
  useAdventures,
  useGroupActivities,
  useGroupPoints,
  useGroupRuntime,
  useGroups,
  useMesh,
  useGroupPresence,
} from '../../runtime/hooks';
import { GroupsStackParamList } from '../../runtime/navigation';
import { useServices } from '../../runtime/services';
import {
  Badge,
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  Menu,
  Icon,
  IconButton,
  IconName,
  IconTile,
  ListRow,
  Row,
  Screen,
  SegmentedTabs,
  StatusPill,
  Text,
} from '../../ui/components';
import { useNow } from '../../ui/useNow';
import { QrCode } from '../../ui/QrCode';
import { isEnabled } from '../../shared/features';
import { ToggleRow } from '../../ui/activity';
import { radius, space, useTheme } from '../../ui/theme';
import { QrScanner } from './QrScanner';
import { SharePlace, ShareLocationSheet } from './ShareLocationSheet';
import { TripMapBadge, TripMapBanner, TripMapCard } from './TripMap';

type Nav<T extends keyof GroupsStackParamList> = NativeStackScreenProps<GroupsStackParamList, T>;

function useInput() {
  const { c } = useTheme();
  return useMemo(
    () => [styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }],
    [c],
  );
}

/** Your name lives in the Profile tab; group screens only read it. */
function useProfileName(): string {
  const { kv } = useServices();
  const [name, setName] = useState('');
  useFocusEffect(
    useCallback(() => {
      void kv.get('profile.name').then(v => setName(v ?? ''));
    }, [kv]),
  );
  return name;
}

function NameNeededBanner({ navigation }: { navigation: { getParent: () => unknown } }) {
  return (
    <Banner
      title="Set your name first"
      body="Group members see the name from your profile."
      actionLabel="Open profile"
      onAction={() =>
        (navigation.getParent() as { navigate: (n: string) => void } | undefined)?.navigate(
          'Profile',
        )
      }
    />
  );
}

/** The mesh must be running before a group can be created, joined or followed. */
function MeshBanner() {
  const { mesh } = useServices();
  const snap = useMesh();
  const [busy, setBusy] = useState(false);
  if (snap.lifecycle === 'running') {
    return null;
  }
  return (
    <Banner
      tone="warn"
      title="Mesh is off"
      body="Groups share over Bluetooth. Start the mesh to create, join or sync a group."
      actionLabel={busy ? 'Starting…' : 'Start mesh'}
      onAction={() => {
        setBusy(true);
        void mesh.start().finally(() => setBusy(false));
      }}
    />
  );
}

/** "23 h", "8 min": how long something still lasts, rounded up so it never reads 0 early. */
function timeLeft(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  return min >= 60 ? `${Math.ceil(min / 60)} h` : `${min} min`;
}

function ago(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min < 1) {
    return 'just now';
  }
  if (min < 60) {
    return `${min} min ago`;
  }
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

type FeedEvent =
  | {
      kind: 'meeting';
      key: string;
      at: number;
      title: string;
      name: string;
      pointId: string;
      /** This phone wrote the revision, so it sits on the right like a sent message. */
      mine: boolean;
    }
  | { kind: 'member'; key: string; at: number; text: string }
  | { kind: 'day'; key: string; at: number; text: string };

function dayLabel(at: number, now: number): string {
  const d = new Date(at);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) {
    return 'Today';
  }
  return diff === 1
    ? 'Yesterday'
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Newest first (for an inverted list, so the newest sits at the bottom like a chat). */
export function buildFeed(
  members: GroupMember[],
  points: { id: string; rev: number; name: string; updatedAt: number; updatedBy: string }[],
  me: string | null,
  now: number,
): FeedEvent[] {
  const events: FeedEvent[] = [
    ...points.map<FeedEvent>(p => ({
      kind: 'meeting',
      key: `p-${p.id}-${p.rev}`,
      at: p.updatedAt,
      title: p.rev > 1 ? 'Meeting point updated' : 'Meeting point shared',
      name: p.name,
      pointId: p.id,
      mine: me !== null && p.updatedBy === me,
    })),
    ...members.map<FeedEvent>(m => ({
      kind: 'member',
      key: `m-${m.address}-${m.rev}`,
      at: m.updatedAt,
      text:
        m.state === 'active'
          ? `${m.address === me ? 'You' : m.name} joined`
          : `${m.name} ${m.state === 'left' ? 'left' : 'was removed'}`,
    })),
  ].sort((x, y) => x.at - y.at);
  const withDays: FeedEvent[] = [];
  let lastDay = '';
  for (const e of events) {
    const label = dayLabel(e.at, now);
    const day = new Date(e.at).toDateString();
    if (day !== lastDay) {
      withDays.push({ kind: 'day', key: `d-${day}`, at: e.at, text: label });
      lastDay = day;
    }
    withDays.push(e);
  }
  return withDays.reverse();
}

function Avatar({ name, dim, size = 36 }: { name: string; dim?: boolean; size?: number }) {
  const { c } = useTheme();
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        { backgroundColor: c.primarySoft, opacity: dim ? 0.5 : 1 },
      ]}
      accessibilityElementsHidden
    >
      <Text variant={size > 40 ? 'heading' : 'cardTitle'} color={c.primary}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

export function nameOf(members: GroupMember[], address: string, me: string | null): string {
  if (address === me) {
    return 'you';
  }
  return members.find(m => m.address === address)?.name ?? shortAddress(address);
}

// ---- Groups list --------------------------------------------------------------------------

const STANDING_TEXT: Record<ActivityStanding, string> = {
  draft: 'Draft · only you can see it',
  waiting: 'Live · tap to start',
  running: 'In progress',
  finished: 'Finished',
  closed: 'Ended by the organizer',
};

const statusRank = (s: Group['status']) => (s === 'active' ? 0 : s === 'joining' ? 1 : 2);

function StartCard({
  icon,
  title,
  body,
  onPress,
  testID,
}: {
  icon: IconName;
  title: string;
  body: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Card style={{ paddingVertical: space.xs }}>
      <ListRow
        title={title}
        subtitle={body}
        leading={<IconTile name={icon} />}
        chevron
        divider={false}
        onPress={onPress}
        testID={testID}
      />
    </Card>
  );
}

/**
 * One group in the list: name, member count and role, then whether anyone is in range, then any
 * badges on a line of their own. Badges never share a line with the text, so a long badge can no
 * longer squeeze the member count until it wraps mid-word.
 */
function GroupRow({ group: g, onPress }: { group: Group; onPress: () => void }) {
  const { c } = useTheme();
  const all = useGroupMembers(g.id);
  const members = all.filter(m => m.state === 'active');
  const presence = useGroupPresence(g, all, useNow());
  const activities = useGroupActivities(g.id).filter(() => isEnabled('groupActivities'));
  const waiting = activities.filter(a => a.standing === 'waiting').length;
  const running = activities.filter(a => a.standing === 'running').length;
  const drafts = g.role === 'organizer' ? activities.filter(a => a.standing === 'draft').length : 0;
  const active = g.status === 'active';
  const meta = active
    ? `${members.length} ${members.length === 1 ? 'member' : 'members'}${
        g.role === 'organizer' ? ' · You organize' : ''
      }`
    : g.status === 'joining'
    ? 'Asked to join · waiting for the organizer'
    : 'Ended by the organizer';
  const dot =
    presence.status.tone === 'good'
      ? c.connected
      : presence.status.tone === 'bad'
      ? c.danger
      : c.warning;
  const activityBadge =
    waiting > 0 ? (
      <Badge
        label={waiting === 1 ? '1 activity waiting' : `${waiting} activities waiting`}
        tone="good"
      />
    ) : running > 0 ? (
      <Badge label="Activity in progress" tone="good" />
    ) : drafts > 0 ? (
      <Badge label={drafts === 1 ? '1 draft' : `${drafts} drafts`} tone="neutral" />
    ) : null;
  return (
    <Pressable
      testID={`group-${g.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${g.name}, ${meta}${active ? `, ${presence.status.label}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Card style={styles.groupCard}>
        <Avatar name={g.name} dim={!active} size={44} />
        <View style={styles.groupBody}>
          <Text variant="cardTitle" numberOfLines={1}>
            {g.name}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {meta}
          </Text>
          <View style={styles.groupStatus}>
            {active ? (
              <Row style={styles.groupPresence}>
                <View style={[styles.statusDot, { backgroundColor: dot }]} />
                <Text variant="caption" muted numberOfLines={1} testID={`group-presence-${g.id}`}>
                  {presence.status.label}
                </Text>
              </Row>
            ) : (
              <Badge
                label={g.status === 'joining' ? 'Waiting' : 'Ended'}
                tone={g.status === 'joining' ? 'warn' : 'neutral'}
              />
            )}
            {active ? activityBadge : null}
            {active ? <TripMapBadge group={g} /> : null}
          </View>
        </View>
        <Icon name="chevron" size={22} color={c.textMuted} />
      </Card>
    </Pressable>
  );
}

export function GroupsScreen({ navigation }: Nav<'GroupsList'>) {
  const { groups: service } = useServices();
  const groups = [...useGroups()].sort(
    (x, y) => statusRank(x.status) - statusRank(y.status) || y.createdAt - x.createdAt,
  );
  const rt = useGroupRuntime();
  const [addOpen, setAddOpen] = useState(false);
  const go = (screen: 'CreateGroup' | 'JoinGroup') => {
    setAddOpen(false);
    navigation.navigate(screen);
  };
  return (
    <Screen
      title="Groups"
      right={
        <IconButton
          testID="groups-add"
          icon="plus"
          label="Create or join a group"
          onPress={() => setAddOpen(true)}
          active
        />
      }
    >
      <AddGroupSheet visible={addOpen} onClose={() => setAddOpen(false)} onPick={go} />
      <FlatList
        data={groups}
        keyExtractor={g => g.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <MeshBanner />
            {rt.notices.map(n => (
              <Banner
                key={n.at + n.text}
                title={n.text}
                onDismiss={() => service.dismissNotices()}
                style={{ marginTop: space.sm }}
              />
            ))}
            {rt.joinRequests.map(r => (
              <Card
                key={r.subId}
                style={{ marginTop: space.sm, gap: space.xs }}
                testID="join-request"
              >
                <Text style={{ fontWeight: '700' }}>
                  {r.name ?? shortAddress(r.sender)} wants to join "{r.groupName}"
                </Text>
                <Text variant="caption" muted>
                  {r.nearby
                    ? 'Found your group nearby. Approve only if you know them.'
                    : 'They scanned your invitation.'}
                </Text>
                <Row>
                  <Button
                    small
                    label="Approve"
                    onPress={() => void service.approveJoin(r.subId)}
                    testID="join-approve"
                  />
                  <Button
                    small
                    variant="secondary"
                    label="Decline"
                    onPress={() => void service.rejectJoin(r.subId)}
                  />
                </Row>
              </Card>
            ))}
          </>
        }
        ListEmptyComponent={
          <View style={styles.startWrap} testID="groups-empty">
            <Text variant="heading" style={{ textAlign: 'center' }}>
              No groups yet
            </Text>
            <Text muted style={{ textAlign: 'center' }}>
              A group shares meeting points and who is nearby, over Bluetooth, with no internet.
            </Text>
            <StartCard
              icon="plus"
              title="Start a group"
              body="Name it, then invite people with a QR code."
              onPress={() => navigation.navigate('CreateGroup')}
              testID="groups-create"
            />
            <StartCard
              icon="group"
              title="Join a group"
              body="Scan an invitation, or find a group open nearby."
              onPress={() => navigation.navigate('JoinGroup')}
              testID="groups-join"
            />
          </View>
        }
        renderItem={({ item: g }) => (
          <GroupRow
            group={g}
            onPress={() => navigation.navigate('GroupDetails', { groupId: g.id })}
          />
        )}
      />
    </Screen>
  );
}

/** The "+" on the Groups tab: one place to start a group or join one. */
function AddGroupSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (screen: 'CreateGroup' | 'JoinGroup') => void;
}) {
  const { c } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[styles.sheetScrim, { backgroundColor: c.overlay }]}
        onPress={onClose}
        accessibilityLabel="Close"
      >
        <Pressable
          style={[styles.sheet, { backgroundColor: c.bg }]}
          onPress={() => undefined}
          testID="groups-add-sheet"
        >
          <Text variant="heading">Add a group</Text>
          <StartCard
            icon="plus"
            title="Start a group"
            body="Name it, then invite people with a QR code."
            onPress={() => onPick('CreateGroup')}
            testID="groups-add-create"
          />
          <StartCard
            icon="group"
            title="Join a group"
            body="Scan an invitation, or find a group open nearby."
            onPress={() => onPick('JoinGroup')}
            testID="groups-add-join"
          />
          <Button variant="ghost" label="Cancel" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---- Create group -------------------------------------------------------------------------

export function CreateGroupScreen({ navigation }: Nav<'CreateGroup'>) {
  const { groups } = useServices();
  const input = useInput();
  const [name, setName] = useState('');
  const yourName = useProfileName();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    const r = await groups.createGroup({ name, yourName });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.userMessage);
      return;
    }
    navigation.replace('GroupInfo', { groupId: r.value.id, justCreated: true });
  };

  return (
    <Screen title="Create group" onBack={() => navigation.goBack()}>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <MeshBanner />
        <Text variant="label" muted>
          Group name
        </Text>
        <TextInput
          testID="group-name"
          style={input}
          value={name}
          onChangeText={setName}
          maxLength={GROUP_NAME_MAX}
          placeholder="Saturday ridge walk"
          autoFocus
          returnKeyType="done"
          accessibilityLabel="Group name"
        />
        {yourName.trim() ? (
          <Text variant="caption" muted testID="create-as">
            You will join as {yourName.trim()}. You become the organizer: you decide who joins and
            you are the only one who can share meeting points.
          </Text>
        ) : (
          <NameNeededBanner navigation={navigation} />
        )}
        {error ? <Banner tone="error" title={error} /> : null}
        <Button
          label="Create"
          onPress={() => void create()}
          loading={busy}
          disabled={!name.trim() || !yourName.trim()}
          testID="group-create-submit"
        />
      </ScrollView>
    </Screen>
  );
}

// ---- Join group ---------------------------------------------------------------------------

export function JoinGroupScreen({ navigation, route }: Nav<'JoinGroup'>) {
  const { groups } = useServices();
  const input = useInput();
  const rt = useGroupRuntime();
  const all = useGroups();
  const yourName = useProfileName();
  // A `trailmesh://join?...` deep link arrives as separate route params.
  const p = route.params;
  const deepLink =
    p?.link ??
    (p?.g && p.o && p.t && p.n
      ? buildInviteLink({ groupId: p.g, organizer: p.o, token: p.t, groupName: p.n })
      : '');
  const invite = deepLink ? parseInviteLink(deepLink) : null;
  const [link, setLink] = useState(deepLink);
  const [scanning, setScanning] = useState(false);
  const [pasting, setPasting] = useState(!!deepLink && !(invite && invite.ok));
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const joining = all.find(g => g.id === joiningId) ?? null;

  useFocusEffect(
    useCallback(() => {
      void groups.startDiscovery();
      return () => void groups.stopDiscovery();
    }, [groups]),
  );

  useEffect(() => {
    if (joiningId && joining?.status === 'active') {
      navigation.replace('GroupDetails', { groupId: joining.id });
    } else if (joiningId && !joining) {
      // The request was declined or timed out; the notice on the Groups screen says why.
      setJoiningId(null);
      setError('The organizer did not accept the request.');
    }
  }, [joining, joiningId, navigation]);

  const requireName = async () => {
    if (!yourName.trim()) {
      setError('Set your name in Profile first.');
      return false;
    }
    return true;
  };

  const joinWith = async (text: string) => {
    setError(null);
    const parsed = parseInviteLink(text);
    if (!parsed.ok) {
      setError(
        parsed.error === 'unsupported_version'
          ? 'This invitation is from a newer version of TrailMesh. Update the app.'
          : 'That is not a TrailMesh invitation.',
      );
      return;
    }
    if (!(await requireName())) {
      return;
    }
    const r = await groups.joinFromInvite(parsed.invite);
    if (!r.ok) {
      setError(r.error.userMessage);
      return;
    }
    setJoiningId(r.value.id);
  };

  const cancelRequest = () => {
    if (joiningId) {
      void groups.leaveGroup(joiningId);
    }
    setJoiningId(null);
  };

  return (
    <Screen title="Join group" onBack={() => navigation.goBack()}>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <MeshBanner />
        {yourName.trim() ? null : <NameNeededBanner navigation={navigation} />}
        {error ? <Banner tone="error" title={error} /> : null}

        {joining ? (
          <Card style={{ alignItems: 'center', gap: space.sm }} testID="join-waiting">
            <ActivityIndicator />
            <Text variant="cardTitle" style={{ textAlign: 'center' }}>
              Waiting for the organizer to approve "{joining.name}"
            </Text>
            <Text variant="caption" muted style={{ textAlign: 'center' }}>
              Stay close to the organizer. The first connection can take a few minutes.
            </Text>
            <Button
              small
              variant="ghost"
              label="Cancel request"
              onPress={cancelRequest}
              testID="join-cancel"
            />
          </Card>
        ) : invite && invite.ok && !pasting ? (
          <Card style={{ gap: space.sm }} testID="join-invitation">
            <Text variant="label" muted>
              You are invited to
            </Text>
            <Text variant="heading">{invite.invite.groupName}</Text>
            <Button
              label="Join"
              onPress={() => void joinWith(link)}
              disabled={!yourName.trim()}
              testID="join-submit"
            />
            <Button
              small
              variant="ghost"
              label="Use a different invitation"
              onPress={() => {
                setLink('');
                setPasting(false);
                navigation.setParams({ link: undefined, g: undefined, v: undefined });
              }}
            />
          </Card>
        ) : (
          <>
            {scanning ? (
              <QrScanner
                onCancel={() => setScanning(false)}
                onScan={t => {
                  setScanning(false);
                  setLink(t);
                  void joinWith(t);
                }}
              />
            ) : (
              <Button label="Scan QR code" onPress={() => setScanning(true)} testID="scan-qr" />
            )}

            <Text variant="heading">Open nearby</Text>
            <Text variant="caption" muted>
              Organizers can open their group for a few minutes so people in range can ask to join.
              They still approve each person.
            </Text>
            {rt.discovered.length === 0 ? (
              <Row>
                <ActivityIndicator />
                <Text muted testID="nearby-empty">
                  Looking for groups nearby… none found yet.
                </Text>
              </Row>
            ) : (
              rt.discovered.map(f => (
                <Card key={f.g} style={{ paddingVertical: space.xs }}>
                  <ListRow
                    title={f.n}
                    subtitle={`Organizer ${shortAddress(f.o)}`}
                    leading={<Avatar name={f.n} />}
                    divider={false}
                    trailing={
                      <Button
                        small
                        label="Ask to join"
                        disabled={!!joining || !yourName.trim()}
                        testID="nearby-join"
                        onPress={() =>
                          void (async () => {
                            if (!(await requireName())) {
                              return;
                            }
                            const res = await groups.joinNearby(f);
                            if (res.ok) {
                              setJoiningId(res.value.id);
                            } else {
                              setError(res.error.userMessage);
                            }
                          })()
                        }
                      />
                    }
                  />
                </Card>
              ))
            )}

            <Divider />
            {pasting ? (
              <>
                <TextInput
                  testID="invite-link"
                  style={input}
                  value={link}
                  onChangeText={setLink}
                  placeholder="trailmesh://join?…"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  accessibilityLabel="Invitation link"
                />
                <Button
                  label="Join"
                  onPress={() => void joinWith(link)}
                  disabled={!link.trim() || !!joining}
                  testID="join-submit"
                />
              </>
            ) : (
              <Button
                small
                variant="ghost"
                label="Paste an invitation link instead"
                onPress={() => setPasting(true)}
                testID="paste-toggle"
              />
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// ---- Group page: updates ------------------------------------------------------------------

/** WhatsApp-style group page. Opens on Updates; tap the title for members and settings. */
export function GroupDetailsScreen({ navigation, route }: Nav<'GroupDetails'>) {
  const { groupId, picked } = route.params;
  const group = useGroup(groupId);
  const members = useGroupMembers(groupId);
  const points = useGroupPoints(groupId);
  const me = useMesh().localAddress;
  const { c } = useTheme();
  const now = useNow();
  const presence = useGroupPresence(group, members, now);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePlace, setSharePlace] = useState<SharePlace | null>(null);
  // Back from choosing a meeting point on the map: open the sheet on that place to name it.
  useEffect(() => {
    if (picked) {
      setSharePlace({ lat: picked.lat, lon: picked.lon });
      setShareOpen(true);
    }
  }, [picked?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!group) {
    return (
      <Screen title="Group" onBack={() => navigation.navigate('GroupsList')}>
        <EmptyState
          title="Group not found"
          body="It may have ended or you left it."
          actionLabel="Back"
          onAction={() => navigation.navigate('GroupsList')}
        />
      </Screen>
    );
  }
  const organizer = group.role === 'organizer';
  const active = members.filter(m => m.state === 'active');
  const feed = buildFeed(members, points, me, now);
  const showOnMap = (pointId: string) =>
    (navigation.getParent() as { navigate: (n: string, p: object) => void } | undefined)?.navigate(
      'Map',
      { focusMeetingPoint: `${groupId}:${pointId}`, nonce: Date.now() },
    );

  return (
    <Screen onBack={() => navigation.navigate('GroupsList')} edges={['top', 'bottom']}>
      <View style={styles.pageHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.navigate('GroupsList')}
          hitSlop={8}
        >
          <Icon name="back" size={30} />
        </Pressable>
        <Pressable
          testID="group-title"
          accessibilityRole="button"
          accessibilityLabel={`${group.name}. Group info`}
          onPress={() => navigation.navigate('GroupInfo', { groupId })}
          style={styles.pageTitle}
        >
          <Avatar name={group.name} />
          <View style={{ flex: 1 }}>
            <Text variant="cardTitle" numberOfLines={1}>
              {group.name}
            </Text>
            <Text variant="caption" muted numberOfLines={1} testID="group-status">
              {`${active.length} ${active.length === 1 ? 'member' : 'members'} · ${
                presence.status.label
              }`}
            </Text>
          </View>
        </Pressable>
      </View>
      <View style={styles.pageBanners}>
        <MeshBanner />
        {group.status === 'closed' ? (
          <Banner tone="warn" title="This group was ended by the organizer" />
        ) : null}
        {group.status === 'joining' ? (
          <Banner tone="warn" title="Waiting for the organizer to approve you" />
        ) : null}
        <TripMapBanner group={group} />
      </View>
      <FlatList
        testID="group-updates"
        inverted
        data={feed}
        keyExtractor={e => e.key}
        contentContainerStyle={styles.feed}
        ListEmptyComponent={
          <Text muted style={styles.feedEmpty} testID="updates-empty">
            {organizer
              ? 'No updates yet. Tap "Share location" to send the group a meeting point.'
              : 'No updates yet. Meeting points and people joining show up here.'}
          </Text>
        }
        renderItem={({ item: e }) =>
          e.kind === 'day' ? (
            <View style={[styles.pill, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text variant="caption" muted>
                {e.text}
              </Text>
            </View>
          ) : e.kind === 'member' ? (
            <View style={[styles.pill, { backgroundColor: c.primarySoft }]}>
              <Text variant="caption" color={c.deep}>
                {e.text}
              </Text>
            </View>
          ) : (
            <Pressable
              testID={`update-${e.pointId}`}
              accessibilityRole="button"
              accessibilityLabel={`${e.title}: ${e.name}. Show on map`}
              onPress={() => showOnMap(e.pointId)}
              style={[
                styles.bubble,
                e.mine
                  ? [styles.bubbleMine, { backgroundColor: c.primarySoft, borderColor: c.border }]
                  : { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <Row>
                <IconTile name="flag" color={c.mapMeeting} bg={c.mapMeeting + '22'} />
                <View style={{ flex: 1 }}>
                  <Text variant="caption" muted>
                    {e.title}
                  </Text>
                  <Text variant="cardTitle">{e.name}</Text>
                  <Text variant="caption" color={c.primary}>
                    Show on map ›
                  </Text>
                </View>
              </Row>
              <Text variant="label" muted style={styles.stamp}>
                {clock(e.at)}
              </Text>
            </Pressable>
          )
        }
      />
      {organizer && group.status === 'active' ? (
        <View style={[styles.actionBar, { backgroundColor: c.surface, borderColor: c.border }]}>
          <IconButton
            icon="map"
            label="Open map"
            onPress={() => navigation.getParent()?.navigate('Map' as never)}
            testID="group-open-map"
          />
          <Button
            style={{ flex: 1 }}
            icon="pin"
            label="Share location"
            onPress={() => {
              setSharePlace(null);
              setShareOpen(true);
            }}
            testID="group-share-location"
          />
        </View>
      ) : null}
      <ShareLocationSheet
        visible={shareOpen}
        groupId={groupId}
        groupName={group.name}
        place={sharePlace}
        onChooseOnMap={() => {
          setShareOpen(false);
          (
            navigation.getParent() as { navigate: (n: string, p: object) => void } | undefined
          )?.navigate('Map', { pickMeeting: { groupId }, nonce: Date.now() });
        }}
        onClose={() => {
          setShareOpen(false);
          setSharePlace(null);
          navigation.setParams({ picked: undefined });
        }}
      />
    </Screen>
  );
}

// ---- Group info: members, meeting points, invitations ------------------------------------

type InfoTab = 'members' | 'points' | 'invite' | 'activities';

export function GroupInfoScreen({ navigation, route }: Nav<'GroupInfo'>) {
  const { groupId, justCreated, pickedArea } = route.params;
  const { groups: service, mesh } = useServices();
  const group = useGroup(groupId);
  const members = useGroupMembers(groupId);
  const points = useGroupPoints(groupId);
  const rt = useGroupRuntime();
  const me = useMesh().localAddress;
  const [invite, setInvite] = useState<{
    link: string;
    expiresAt: number;
    autoApprove: boolean;
  } | null>(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A new group opens on its invitation, so the first thing to do is add people (also right
  // after choosing the trip map, the step before inviting).
  const [tab, setTab] = useState<InfoTab>(justCreated || pickedArea ? 'invite' : 'members');
  const { c } = useTheme();
  const now = useNow();
  const presence = useGroupPresence(group, members, now);
  const activitiesOn = isEnabled('groupActivities');
  const groupAdventures = useAdventures().filter(a => a.groupId === groupId);
  const activities = useGroupActivities(groupId);
  // A draft is the organizer's alone; nobody else has it.
  const visibleActivities = activities.filter(
    a => a.standing !== 'draft' || group?.role === 'organizer',
  );
  const openMore = (screen: string, params?: object) =>
    (navigation.getParent() as { navigate: (n: string, p: object) => void } | undefined)?.navigate(
      'Activity',
      { screen, params },
    );
  // Right after creating a group, show the invitation so the first thing to do is add people.
  const autoInvited = useRef(false);
  const organizerNow = group?.role === 'organizer';
  useEffect(() => {
    if (justCreated && organizerNow && !autoInvited.current) {
      autoInvited.current = true;
      void service.createInvite(groupId, { autoApprove: false }).then(r => {
        if (r.ok) {
          setInvite({ ...r.value, autoApprove: false });
        }
      });
    }
  }, [justCreated, organizerNow, service, groupId]);
  const back = () => navigation.navigate('GroupDetails', { groupId });
  // Back from choosing the trip map on the map: save it (refused if someone joined meanwhile).
  const groupName = group?.name;
  useEffect(() => {
    if (!pickedArea || !groupName) {
      return;
    }
    navigation.setParams({ pickedArea: undefined });
    void service
      .setTripArea(groupId, areaFromBox(pickedArea.bbox, groupName))
      .then(r => setError(r.ok ? null : r.error.userMessage));
  }, [pickedArea?.nonce, groupName]); // eslint-disable-line react-hooks/exhaustive-deps
  const chooseTripMap = () =>
    (navigation.getParent() as { navigate: (n: string, p: object) => void } | undefined)?.navigate(
      'Map',
      { pickTripMap: { groupId, region: group?.tripArea?.bbox ?? null }, nonce: Date.now() },
    );
  const removeTripMap = () =>
    void service.setTripArea(groupId, null).then(r => setError(r.ok ? null : r.error.userMessage));

  if (!group) {
    return (
      <Screen title="Group info" onBack={() => navigation.navigate('GroupsList')}>
        <EmptyState
          title="Group not found"
          body="It may have ended or you left it."
          actionLabel="Back"
          onAction={() => navigation.navigate('GroupsList')}
        />
      </Screen>
    );
  }
  const organizer = group.role === 'organizer';
  const active = members.filter(m => m.state === 'active');
  const nearbyUntil = rt.nearbyUntil[group.id] ?? 0;
  const presenceOfMember = new Map(presence.members.map(x => [x.member.address, x.presence]));
  const sortedMembers = [
    ...members.filter(m => m.address === me),
    ...sortByPresence(
      members
        .filter(m => m.state === 'active' && m.address !== me)
        .map(m => ({ m, presence: presenceOfMember.get(m.address)! })),
    ).map(x => x.m),
    ...members.filter(m => m.state !== 'active'),
  ];

  const createInvite = async () => {
    const r = await service.createInvite(group.id, { autoApprove });
    if (r.ok) {
      setInvite({ ...r.value, autoApprove });
      setError(null);
    } else {
      setError(r.error.userMessage);
    }
  };

  const leave = () =>
    Alert.alert(
      organizer ? 'End group?' : 'Leave group?',
      organizer
        ? 'Members are told the group has ended. Its meeting points are removed from this device.'
        : 'Its meeting points are removed from this device. You can rejoin with a new invitation.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: organizer ? 'End group' : 'Leave',
          style: 'destructive',
          onPress: () =>
            void service.leaveGroup(group.id).then(() => navigation.navigate('GroupsList')),
        },
      ],
    );

  const canInvite = organizer && group.status === 'active';
  const tabs: { value: InfoTab; label: string }[] = [
    { value: 'members', label: 'Members' },
    { value: 'points', label: 'Points' },
    ...(canInvite ? [{ value: 'invite' as const, label: 'Invite' }] : []),
    ...(group.status === 'active'
      ? [{ value: 'activities' as const, label: activitiesOn ? 'Activities' : 'Adventures' }]
      : []),
  ];
  // The group can end, or the invite tab go away, while this screen is open.
  const shown = tabs.some(t => t.value === tab) ? tab : 'members';

  const nearbyOpen = nearbyUntil > now;
  const inviteSection = (
    <>
      <Text variant="label" muted style={styles.sectionLabel}>
        Invitation code
      </Text>
      {invite ? (
        <Card style={styles.inviteCard} testID="invite-card">
          <View style={[styles.qrPlate, { borderColor: c.border }]}>
            <QrCode value={invite.link} size={196} />
          </View>
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text variant="cardTitle">Scan to join {group.name}</Text>
            <Text variant="caption" muted testID="invite-terms">
              One person · {invite.autoApprove ? 'joins straight away' : 'you approve'} · expires in{' '}
              {timeLeft(invite.expiresAt - now)}
            </Text>
          </View>
          <View style={styles.inviteActions}>
            <Button
              small
              variant="secondary"
              icon="share"
              label="Share link"
              style={{ flex: 1 }}
              onPress={() => void Share.share({ message: invite.link })}
            />
            <Button
              small
              variant="ghost"
              icon="sync"
              label="New code"
              style={{ flex: 1 }}
              onPress={() => void createInvite()}
              testID="invite-renew"
            />
          </View>
        </Card>
      ) : (
        <Card style={styles.inviteCard}>
          <IconTile name="qr" />
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text variant="cardTitle">No active code</Text>
            <Text variant="caption" muted style={{ textAlign: 'center' }}>
              A code adds one person and is valid for 24 hours. They scan it with TrailMesh; no
              internet needed.
            </Text>
          </View>
          <Button
            icon="qr"
            label="Create code"
            onPress={() => void createInvite()}
            style={{ alignSelf: 'stretch' }}
            testID="invite-create"
          />
        </Card>
      )}

      <Text variant="label" muted style={styles.sectionLabel}>
        Joining
      </Text>
      <Card style={{ paddingVertical: space.xs }}>
        <ToggleRow
          title="Approve automatically"
          body={
            invite && invite.autoApprove !== autoApprove
              ? 'Applies to the next code. Create a new code to use it.'
              : 'Whoever scans the code joins without waiting for you.'
          }
          value={autoApprove}
          onChange={setAutoApprove}
          testID="invite-auto"
        />
        <Divider />
        <ToggleRow
          title="Open to people nearby"
          body={
            nearbyOpen
              ? `Phones in Bluetooth range can ask to join · ${timeLeft(nearbyUntil - now)} left`
              : 'For 10 minutes, phones in Bluetooth range can find this group and ask to join.'
          }
          value={nearbyOpen}
          onChange={on => void (on ? service.openNearby(group.id) : service.closeNearby(group.id))}
          testID="invite-nearby"
        />
      </Card>
    </>
  );

  const menuItems = [
    ...(!organizer && group.status === 'active'
      ? [
          {
            label: 'Sync now',
            icon: 'sync' as const,
            onPress: () => void service.requestSync(group.id),
            disabled: mesh.getSnapshot().lifecycle !== 'running',
            testID: 'group-sync',
          },
        ]
      : []),
    {
      label: organizer ? 'End group' : 'Leave group',
      icon: organizer ? ('stop' as const) : ('exit' as const),
      onPress: leave,
      destructive: true,
      testID: 'group-leave',
    },
  ];

  return (
    <Screen
      title="Group info"
      onBack={back}
      right={
        <IconButton
          icon="menu"
          label="More options"
          onPress={() => setMenuOpen(true)}
          testID="info-menu"
        />
      }
    >
      <Menu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        testID="info-menu-list"
      />
      <ScrollView contentContainerStyle={styles.list}>
        <MeshBanner />
        <View style={styles.infoHead}>
          <Avatar name={group.name} size={52} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" numberOfLines={1} testID="info-name">
              {group.name}
            </Text>
            <Text variant="caption" muted numberOfLines={1} testID="info-meta">
              {active.length} {active.length === 1 ? 'member' : 'members'} ·{' '}
              {organizer ? 'You organize' : 'Member'}
            </Text>
            <Row style={{ gap: space.xs }}>
              {group.status === 'closed' ? (
                <Badge label="Ended by organizer" tone="warn" />
              ) : group.status === 'joining' ? (
                <Badge label="Waiting for approval" tone="warn" />
              ) : (
                <StatusPill tone={presence.status.tone} label={presence.status.label} />
              )}
            </Row>
          </View>
        </View>
        {justCreated ? (
          <Banner
            title="Group created"
            body={
              group.tripArea
                ? 'Show this code to the people you want to add. They scan it and appear here.'
                : 'Set the trip map below first, then show this code to the people you want to add.'
            }
            actionLabel="Done"
            onAction={back}
          />
        ) : null}
        {error ? <Banner tone="error" title={error} /> : null}
        <TripMapCard
          group={group}
          members={members}
          me={me}
          onChoose={chooseTripMap}
          onRemove={removeTripMap}
        />
        {/* Above the tabs: a request is answered from any of them, never missed behind one. */}
        {canInvite
          ? rt.joinRequests
              .filter(r => r.groupId === group.id)
              .map(r => (
                <Banner
                  key={r.subId}
                  title={`${r.name ?? shortAddress(r.sender)} wants to join`}
                  actionLabel="Approve"
                  onAction={() => void service.approveJoin(r.subId)}
                  onDismiss={() => void service.rejectJoin(r.subId)}
                />
              ))
          : null}
        <SegmentedTabs<InfoTab>
          fill
          options={tabs}
          value={shown}
          onChange={setTab}
          testID="info-tab"
        />

        {shown === 'invite' ? inviteSection : null}

        {shown === 'points' ? (
          <>
            <Text variant="heading">Meeting points ({points.length})</Text>
            {points.length === 0 ? (
              <Text muted>
                {organizer
                  ? 'None yet. Share one from the group page with "Share location".'
                  : 'None yet. Meeting points the organizer shares appear here and on your map.'}
              </Text>
            ) : (
              <Card style={{ paddingVertical: space.xs }}>
                {points.map((p, i) => (
                  <ListRow
                    key={p.id}
                    testID={`point-${p.id}`}
                    title={p.name}
                    divider={i < points.length - 1}
                    leading={<IconTile name="flag" color={c.mapMeeting} bg={c.mapMeeting + '22'} />}
                    subtitle={
                      p.ackedRev >= p.rev
                        ? 'Acknowledged'
                        : organizer
                        ? `Shared ${ago(now - p.updatedAt)}`
                        : 'Not acknowledged'
                    }
                    chevron
                    onPress={() =>
                      (
                        navigation.getParent() as
                          | { navigate: (n: string, p: object) => void }
                          | undefined
                      )?.navigate('Map', {
                        focusMeetingPoint: `${groupId}:${p.id}`,
                        nonce: Date.now(),
                      })
                    }
                  />
                ))}
              </Card>
            )}
          </>
        ) : null}

        {shown === 'members' ? (
          <>
            <Text variant="heading">Members ({active.length})</Text>
            <Card style={{ paddingVertical: space.xs }}>
              {sortedMembers.map((m, i) => (
                <ListRow
                  key={m.address}
                  testID={`member-${m.address}`}
                  divider={i < sortedMembers.length - 1}
                  leading={
                    <Avatar
                      name={m.name}
                      dim={
                        m.state !== 'active' ||
                        presenceOfMember.get(m.address)?.freshness === 'last_seen'
                      }
                    />
                  }
                  title={`${m.name}${m.address === me ? ' (you)' : ''}`}
                  subtitle={
                    m.state !== 'active'
                      ? m.state === 'left'
                        ? 'Left the group'
                        : 'Removed'
                      : m.address === me
                      ? m.role === 'organizer'
                        ? 'Organizer'
                        : 'This phone'
                      : `${m.role === 'organizer' ? 'Organizer · ' : ''}${presenceText(
                          presenceOfMember.get(m.address)!,
                        )}`
                  }
                  trailing={
                    m.state === 'active' &&
                    m.address !== me &&
                    presenceOfMember.get(m.address)?.reachable ? (
                      <StatusPill tone="good" label="In range" style={styles.flat} />
                    ) : organizer && m.state === 'active' && m.address !== me ? (
                      <Button
                        small
                        variant="ghost"
                        label="Remove"
                        onPress={() =>
                          Alert.alert(
                            'Remove member?',
                            `${m.name} will be removed from the group.`,
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Remove',
                                style: 'destructive',
                                onPress: () => void service.removeMember(group.id, m.address),
                              },
                            ],
                          )
                        }
                      />
                    ) : null
                  }
                />
              ))}
            </Card>
          </>
        ) : null}

        {shown === 'activities' && !activitiesOn ? (
          <Card style={{ paddingVertical: space.xs }} testID="group-adventures">
            <ListRow
              title="Adventures"
              subtitle={
                groupAdventures.length === 0
                  ? organizer
                    ? 'Plan a day out with checkpoints for the group'
                    : 'None planned by the organizer yet'
                  : `${groupAdventures.length} for this group`
              }
              leading={<IconTile name="trail" />}
              chevron
              divider={false}
              onPress={() => openMore('Adventures')}
            />
            {organizer ? (
              <Button
                small
                variant="ghost"
                label="Plan a group adventure"
                testID="plan-group-adventure"
                onPress={() => openMore('AdventureEditor', { groupId: group.id })}
              />
            ) : null}
          </Card>
        ) : null}

        {shown === 'activities' && activitiesOn ? (
          <Card style={{ paddingVertical: space.xs }} testID="group-adventures">
            <ListRow
              title="Activities"
              subtitle={
                visibleActivities.length === 0
                  ? organizer
                    ? 'Plan a day out with phases for the group'
                    : 'None published by the organizer yet'
                  : `${visibleActivities.length} for this group`
              }
              leading={<IconTile name="trail" />}
              divider={visibleActivities.length > 0}
            />
            {visibleActivities.map((a, i) => (
              <ListRow
                key={a.adventure.id}
                testID={`activity-${a.adventure.id}`}
                title={a.adventure.name}
                subtitle={`${STANDING_TEXT[a.standing]}${
                  a.total > 0 && a.standing !== 'draft' ? ` · ${a.done} of ${a.total} phases` : ''
                }`}
                chevron
                divider={i < visibleActivities.length - 1}
                onPress={() => openMore('AdventureDetails', { adventureId: a.adventure.id })}
              />
            ))}
            {organizer ? (
              <Button
                small
                variant="ghost"
                label="Plan an activity"
                testID="plan-group-adventure"
                onPress={() => openMore('AdventureEditor', { groupId: group.id })}
              />
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// ---- Meeting point details ----------------------------------------------------------------

export function MeetingPointScreen({ navigation, route }: Nav<'MeetingPoint'>) {
  const { groupId, pointId } = route.params;
  const { groups: service, meetingPoints } = useServices();
  const group = useGroup(groupId);
  const members = useGroupMembers(groupId);
  const [point, setPoint] = useState<Awaited<ReturnType<typeof meetingPoints.get>>>(null);
  const [acks, setAcks] = useState<Awaited<ReturnType<typeof meetingPoints.acks>>>([]);
  const me = useMesh().localAddress;
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      void meetingPoints.get(groupId, pointId).then(setPoint);
      void meetingPoints.acks(groupId, pointId).then(setAcks);
    };
    load();
    return meetingPoints.changes.subscribe(load);
  }, [meetingPoints, groupId, pointId]);

  if (!point || point.deleted || !group) {
    return (
      <Screen title="Meeting point" onBack={() => navigation.goBack()}>
        <EmptyState
          title="Meeting point removed"
          body="The organizer removed it, or it is not on this device."
          actionLabel="Back"
          onAction={() => navigation.goBack()}
        />
      </Screen>
    );
  }
  const organizer = group.role === 'organizer';
  const acked = point.ackedRev >= point.rev;
  const ackers = new Set(acks.filter(a => a.rev >= point.rev).map(a => a.address));
  const others = members.filter(m => m.state === 'active' && m.address !== me);

  return (
    <Screen title={point.name} onBack={() => navigation.goBack()}>
      <ScrollView contentContainerStyle={styles.list}>
        <Text variant="caption" muted>
          {group.name}
        </Text>
        {point.note ? <Text testID="point-note">{point.note}</Text> : null}
        <Text variant="mono" selectable testID="point-coords">{`${point.lat.toFixed(
          6,
        )}, ${point.lon.toFixed(6)}`}</Text>
        <Card style={{ gap: space.xs }}>
          <Text testID="point-created">Created by {nameOf(members, point.createdBy, me)}</Text>
          <Text testID="point-updated">
            {point.rev > 1 || point.updatedBy !== point.createdBy
              ? `Updated by ${nameOf(members, point.updatedBy, me)} (version ${point.rev})`
              : `Version ${point.rev}`}
          </Text>
          <Text variant="caption" muted>
            {new Date(point.updatedAt).toLocaleString()}
          </Text>
        </Card>
        {message ? <Banner title={message} /> : null}
        <Button
          label="Show on map"
          onPress={() =>
            navigation
              .getParent()
              ?.navigate('Map', { focusMeetingPoint: `${groupId}:${pointId}`, nonce: Date.now() })
          }
          testID="point-show"
        />
        {!organizer ? (
          <Button
            variant={acked ? 'secondary' : 'primary'}
            label={
              acked
                ? point.ackPublished
                  ? 'Acknowledged'
                  : 'Acknowledged (not delivered yet)'
                : 'Acknowledge'
            }
            disabled={acked && point.ackPublished}
            testID="point-ack"
            onPress={() =>
              void service.acknowledge(groupId, pointId).then(r => {
                if (!r.ok) {
                  setMessage(r.error.userMessage);
                } else {
                  setMessage(
                    r.value
                      ? 'The organizer has been told.'
                      : 'Saved. It will be sent when you are in range of the organizer.',
                  );
                }
              })
            }
          />
        ) : (
          <>
            <Text variant="heading">Acknowledged by</Text>
            {others.length === 0 ? <Text muted>No other members yet.</Text> : null}
            {others.map(m => (
              <Row key={m.address}>
                <Text style={{ flex: 1 }}>{m.name}</Text>
                <Badge
                  label={ackers.has(m.address) ? 'Acknowledged' : 'Waiting'}
                  tone={ackers.has(m.address) ? 'good' : 'neutral'}
                />
              </Row>
            ))}
            <Button
              variant="danger"
              label="Remove meeting point"
              testID="point-remove"
              onPress={() =>
                Alert.alert('Remove meeting point?', 'It disappears from every member’s map.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () =>
                      void service.removePoint(groupId, pointId).then(() => navigation.goBack()),
                  },
                ])
              }
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.gutter, paddingTop: 0, gap: space.md, paddingBottom: space.xxl },
  startWrap: { gap: space.md, paddingTop: space.xl },
  sheetScrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    padding: space.gutter,
    gap: space.md,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  groupCard: { marginBottom: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md },
  groupBody: { flex: 1, gap: 2 },
  groupStatus: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xs,
  },
  groupPresence: { gap: space.xs, flexShrink: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  pageTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  pageBanners: { paddingHorizontal: space.gutter, gap: space.sm },
  feed: { padding: space.gutter, gap: space.sm },
  feedEmpty: { textAlign: 'center', padding: space.xl, transform: [{ scaleY: -1 }] },
  pill: {
    alignSelf: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  bubble: {
    alignSelf: 'flex-start',
    width: '85%',
    padding: space.md,
    borderRadius: radius.sheet,
    borderBottomLeftRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    gap: space.xs,
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    borderBottomLeftRadius: radius.sheet,
    borderBottomRightRadius: radius.sm,
  },
  stamp: { alignSelf: 'flex-end' },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  infoHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  sectionLabel: { textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: -space.xs },
  inviteCard: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
  qrPlate: {
    padding: space.md,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  inviteActions: { flexDirection: 'row', gap: space.sm, alignSelf: 'stretch' },
  flat: { shadowOpacity: 0, elevation: 0, borderWidth: 0, paddingHorizontal: 0 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: space.lg,
    minHeight: 52,
    fontSize: 15,
  },
});

export type { Group };
