import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { buildInviteLink, parseInviteLink } from '../../domain/groups/invite';
import { presenceText, sortByPresence } from '../../domain/groups/presence';
import {
  Group,
  GroupMember,
  GROUP_NAME_MAX,
  MEMBER_NAME_MAX,
  shortAddress,
} from '../../domain/groups/model';
import {
  useGroup,
  useGroupMembers,
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
import { radius, space, useTheme } from '../../ui/theme';
import { QrScanner } from './QrScanner';

type Nav<T extends keyof GroupsStackParamList> = NativeStackScreenProps<GroupsStackParamList, T>;

function useInput() {
  const { c } = useTheme();
  return useMemo(
    () => [styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }],
    [c],
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

type FeedItem = { key: string; at: number; icon: 'flag' | 'group'; title: string; detail: string };

function buildFeed(
  members: GroupMember[],
  points: { id: string; rev: number; name: string; updatedAt: number }[],
  me: string | null,
  _now: number,
): FeedItem[] {
  const items: FeedItem[] = [
    ...points.map(p => ({
      key: `p-${p.id}-${p.rev}`,
      at: p.updatedAt,
      icon: 'flag' as const,
      title: p.rev > 1 ? 'Meeting point updated' : 'Meeting point shared',
      detail: p.name,
    })),
    ...members.map(m => ({
      key: `m-${m.address}-${m.rev}`,
      at: m.updatedAt,
      icon: 'group' as const,
      title:
        m.state === 'active'
          ? `${m.address === me ? 'You' : m.name} joined`
          : `${m.name} ${m.state === 'left' ? 'left' : 'was removed'}`,
      detail: 'Group',
    })),
  ];
  return items.sort((a, b) => b.at - a.at);
}

function Avatar({ name, dim }: { name: string; dim?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      style={[styles.avatar, { backgroundColor: c.primarySoft, opacity: dim ? 0.5 : 1 }]}
      accessibilityElementsHidden
    >
      <Text variant="cardTitle" color={c.primary}>
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

export function GroupsScreen({ navigation }: Nav<'GroupsList'>) {
  const { groups: service } = useServices();
  const groups = useGroups();
  const rt = useGroupRuntime();
  return (
    <Screen title="Group">
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
                  {shortAddress(r.sender)} wants to join "{r.groupName}"
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
            <Row style={{ marginVertical: space.md }}>
              <Button
                style={{ flex: 1 }}
                icon="plus"
                label="Create group"
                onPress={() => navigation.navigate('CreateGroup')}
                testID="groups-create"
              />
              <Button
                style={{ flex: 1 }}
                variant="secondary"
                label="Join group"
                onPress={() => navigation.navigate('JoinGroup')}
                testID="groups-join"
              />
            </Row>
          </>
        }
        ListEmptyComponent={
          <EmptyState
            title="No groups yet"
            body="Create a group to share meeting points with people nearby, or join one with an invitation."
          />
        }
        renderItem={({ item: g }) => (
          <Card style={styles.groupCard}>
            <ListRow
              title={g.name}
              subtitle={
                g.status === 'active'
                  ? g.role === 'organizer'
                    ? 'You organize this group'
                    : 'Member'
                  : g.status === 'joining'
                  ? 'Waiting for approval'
                  : 'Ended by organizer'
              }
              leading={<IconTile name="group" />}
              chevron
              divider={false}
              testID={`group-${g.id}`}
              onPress={() => navigation.navigate('GroupDetails', { groupId: g.id })}
              trailing={
                <Badge
                  label={
                    g.status === 'active'
                      ? g.role === 'organizer'
                        ? 'Organizer'
                        : 'Member'
                      : g.status === 'joining'
                      ? 'Waiting'
                      : 'Ended'
                  }
                  tone={g.status === 'active' ? 'good' : 'warn'}
                />
              }
            />
          </Card>
        )}
      />
    </Screen>
  );
}

// ---- Create group -------------------------------------------------------------------------

export function CreateGroupScreen({ navigation }: Nav<'CreateGroup'>) {
  const { groups, kv } = useServices();
  const input = useInput();
  const [name, setName] = useState('');
  const [yourName, setYourName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void kv.get('profile.name').then(v => v && setYourName(v));
  }, [kv]);

  const create = async () => {
    setBusy(true);
    setError(null);
    const r = await groups.createGroup({ name, yourName });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.userMessage);
      return;
    }
    await kv.set('profile.name', yourName.trim());
    navigation.replace('GroupDetails', { groupId: r.value.id });
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
          accessibilityLabel="Group name"
        />
        <Text variant="label" muted>
          Your name
        </Text>
        <TextInput
          testID="your-name"
          style={input}
          value={yourName}
          onChangeText={setYourName}
          maxLength={MEMBER_NAME_MAX}
          placeholder="Alex"
          accessibilityLabel="Your name"
        />
        <Text variant="caption" muted>
          You become the organizer: you decide who joins and you are the only one who can share
          meeting points.
        </Text>
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
  const { groups, kv } = useServices();
  const input = useInput();
  const rt = useGroupRuntime();
  const all = useGroups();
  const [yourName, setYourName] = useState('');
  // A `trailmesh://join?...` deep link arrives as separate route params.
  const p = route.params;
  const deepLink =
    p?.link ??
    (p?.g && p.o && p.t && p.n
      ? buildInviteLink({ groupId: p.g, organizer: p.o, token: p.t, groupName: p.n })
      : '');
  const [link, setLink] = useState(deepLink);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const joining = all.find(g => g.id === joiningId) ?? null;

  useEffect(() => {
    void kv.get('profile.name').then(v => v && setYourName(v));
  }, [kv]);

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
      setError('Enter your name first.');
      return false;
    }
    await kv.set('profile.name', yourName.trim());
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

  return (
    <Screen title="Join group" onBack={() => navigation.goBack()}>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <MeshBanner />
        <Text variant="label" muted>
          Your name
        </Text>
        <TextInput
          testID="your-name"
          style={input}
          value={yourName}
          onChangeText={setYourName}
          maxLength={MEMBER_NAME_MAX}
          placeholder="Alex"
          accessibilityLabel="Your name"
        />
        {joining ? (
          <Banner
            title={`Waiting for the organizer to approve "${joining.name}"`}
            body="Stay close to the organizer. This can take a minute."
          />
        ) : null}
        {error ? <Banner tone="error" title={error} /> : null}

        <Text variant="heading">With an invitation</Text>
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
          <Button
            variant="secondary"
            label="Scan QR code"
            onPress={() => setScanning(true)}
            testID="scan-qr"
          />
        )}
        <TextInput
          testID="invite-link"
          style={input}
          value={link}
          onChangeText={setLink}
          placeholder="or paste trailmesh://join?…"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Invitation link"
        />
        <Button
          label="Join"
          onPress={() => void joinWith(link)}
          disabled={!link.trim() || !!joining}
          testID="join-submit"
        />

        <Divider />
        <Text variant="heading">Nearby</Text>
        <Text variant="caption" muted>
          Organizers can open their group for a few minutes so people in range can ask to join. They
          still approve each person.
        </Text>
        {rt.discovered.length === 0 ? (
          <Text muted testID="nearby-empty">
            No open groups found nearby.
          </Text>
        ) : (
          rt.discovered.map(f => (
            <Card key={f.g} style={{ gap: space.xs }}>
              <Text style={{ fontWeight: '700' }}>{f.n}</Text>
              <Text variant="caption" muted>
                Organizer {shortAddress(f.o)}
              </Text>
              <Button
                small
                label="Ask to join"
                disabled={!!joining}
                testID="nearby-join"
                onPress={() =>
                  void (async () => {
                    if (!(await requireName())) {
                      return;
                    }
                    const r = await groups.joinNearby(f);
                    if (r.ok) {
                      setJoiningId(r.value.id);
                    } else {
                      setError(r.error.userMessage);
                    }
                  })()
                }
              />
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

// ---- Group details ------------------------------------------------------------------------

export function GroupDetailsScreen({ navigation, route }: Nav<'GroupDetails'>) {
  const { groupId } = route.params;
  const { groups: service, mesh } = useServices();
  const group = useGroup(groupId);
  const members = useGroupMembers(groupId);
  const points = useGroupPoints(groupId);
  const rt = useGroupRuntime();
  const me = useMesh().localAddress;
  const [invite, setInvite] = useState<{ link: string; expiresAt: number } | null>(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { c } = useTheme();
  const [tab, setTab] = useState<'members' | 'updates' | 'meeting'>('members');
  const now = useNow();
  const presence = useGroupPresence(group, members, now);

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
      setInvite(r.value);
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

  return (
    <Screen title={group.name} onBack={() => navigation.navigate('GroupsList')}>
      <ScrollView contentContainerStyle={styles.list}>
        <MeshBanner />
        <StatusPill
          tone={presence.status.tone}
          label={`${active.length} ${active.length === 1 ? 'member' : 'members'} · ${
            presence.status.label
          }`}
          testID="group-status"
        />
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'members', label: 'Members' },
            { value: 'updates', label: 'Updates' },
            { value: 'meeting', label: 'Meeting point' },
          ]}
        />
        <Row>
          <Badge label={organizer ? 'You organize this group' : 'Member'} tone="good" />
          {group.status === 'closed' ? <Badge label="Ended by organizer" tone="warn" /> : null}
          {group.status === 'joining' ? <Badge label="Waiting for approval" tone="warn" /> : null}
        </Row>
        {error ? <Banner tone="error" title={error} /> : null}

        {tab === 'members' ? (
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

            {organizer && group.status === 'active' ? (
              <>
                <Text variant="heading">Invite people</Text>
                <Row>
                  <Switch
                    value={autoApprove}
                    onValueChange={setAutoApprove}
                    accessibilityLabel="Approve people who scan automatically"
                  />
                  <Text style={{ flex: 1 }}>Approve people who scan this code automatically</Text>
                </Row>
                <Button
                  variant="secondary"
                  label={invite ? 'New invitation' : 'Show invitation QR'}
                  onPress={() => void createInvite()}
                  testID="invite-create"
                />
                {invite ? (
                  <Card style={{ alignItems: 'center', gap: space.sm }}>
                    <QrCode value={invite.link} />
                    <Text variant="caption" muted>
                      Valid for 24 hours, for one person.
                    </Text>
                    <Button
                      small
                      variant="ghost"
                      label="Share link"
                      onPress={() => void Share.share({ message: invite.link })}
                    />
                  </Card>
                ) : null}
                <Row>
                  <Switch
                    value={nearbyUntil > Date.now()}
                    onValueChange={on =>
                      void (on ? service.openNearby(group.id) : service.closeNearby(group.id))
                    }
                    accessibilityLabel="Let people nearby ask to join"
                  />
                  <Text style={{ flex: 1 }}>Let people nearby ask to join (10 minutes)</Text>
                </Row>
                {rt.joinRequests
                  .filter(r => r.groupId === group.id)
                  .map(r => (
                    <Banner
                      key={r.subId}
                      title={`${shortAddress(r.sender)} wants to join`}
                      actionLabel="Approve"
                      onAction={() => void service.approveJoin(r.subId)}
                      onDismiss={() => void service.rejectJoin(r.subId)}
                    />
                  ))}
              </>
            ) : null}

            {!organizer && group.status === 'active' ? (
              <Button
                variant="secondary"
                label="Sync now"
                onPress={() => void service.requestSync(group.id)}
                disabled={mesh.getSnapshot().lifecycle !== 'running'}
                testID="group-sync"
              />
            ) : null}
            <Button
              variant="danger"
              label={organizer ? 'End group' : 'Leave group'}
              onPress={leave}
              testID="group-leave"
            />
          </>
        ) : null}
        {tab === 'updates' ? (
          <>
            {feed.length === 0 ? (
              <Text muted>No updates yet.</Text>
            ) : (
              <Card style={{ paddingVertical: space.xs }}>
                {feed.map((e, i) => (
                  <ListRow
                    key={e.key}
                    title={e.title}
                    subtitle={`${e.detail} · ${ago(now - e.at)}`}
                    divider={i < feed.length - 1}
                    leading={
                      <IconTile
                        name={e.icon}
                        color={e.icon === 'flag' ? c.mapMeeting : undefined}
                        bg={e.icon === 'flag' ? c.mapMeeting + '22' : undefined}
                      />
                    }
                  />
                ))}
              </Card>
            )}
          </>
        ) : null}
        {tab === 'meeting' ? (
          <>
            <Text variant="heading">Meeting points ({points.length})</Text>
            {points.length === 0 ? (
              <Text muted>
                {organizer
                  ? 'Press and hold on the map, then choose "Meeting point" to share one.'
                  : 'None yet. Meeting points the organizer shares appear here and on your map.'}
              </Text>
            ) : (
              <Card style={{ paddingVertical: space.xs }}>
                {points.map((p, i) => (
                  <ListRow
                    key={p.id}
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
                    onPress={() => navigation.navigate('MeetingPoint', { groupId, pointId: p.id })}
                  />
                ))}
              </Card>
            )}
          </>
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
  groupCard: { marginBottom: space.md, paddingVertical: space.xs },
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
