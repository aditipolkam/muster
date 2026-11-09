import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { ActivityStanding } from '../../domain/adventures/lifecycle';
import { bearingDeg, distanceM } from '../../domain/geo';
import { cardinal16Of, etaMinutes, formatDistanceIn, formatEta } from '../../domain/geo/pace';
import { useLocationStore } from '../../platform/locationStore';
import { useNavSession } from '../../runtime/navSession';
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
  useNavPrefs,
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
import { radius, size, space, tabular, useTheme } from '../../ui/theme';
import { FlagPin } from '../../ui/trail';
import { QrScanner } from './QrScanner';
import { SharePlace, ShareLocationSheet } from './ShareLocationSheet';
import { TripMapBanner, TripMapCard, TripMapChip, TripMapFooter } from './TripMap';

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

function Avatar({
  name,
  dim,
  size: s = 36,
  online,
}: {
  name: string;
  dim?: boolean;
  size?: number;
  /** Green presence dot: in range now. */
  online?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View accessibilityElementsHidden>
      <View
        style={[
          styles.avatar,
          { width: s, height: s, borderRadius: s / 2 },
          { backgroundColor: c.primarySoft, opacity: dim ? 0.5 : 1 },
        ]}
      >
        <Text variant={s > 40 ? 'heading' : 'cardTitle'} color={c.deep}>
          {(name.trim()[0] ?? '?').toUpperCase()}
        </Text>
      </View>
      {online ? (
        <View
          style={[styles.presenceDot, { backgroundColor: c.connected, borderColor: c.surface }]}
        />
      ) : null}
    </View>
  );
}

/** The group's rounded-square tile: its initial on soft green. */
function GroupTile({ name, dim, size: s = 48 }: { name: string; dim?: boolean; size?: number }) {
  const { c } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      style={[
        styles.groupTile,
        {
          width: s,
          height: s,
          borderRadius: s >= 48 ? 16 : radius.tile,
          backgroundColor: c.primarySoft,
          opacity: dim ? 0.5 : 1,
        },
      ]}
    >
      <Text variant="heading" color={c.deep}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

/** The newest meeting point still on the map: the group's "active" one. */
function activePoint<T extends { deleted?: boolean; updatedAt: number }>(points: T[]): T | null {
  return (
    points
      .filter(x => !x.deleted)
      .reduce<T | null>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), null) ?? null
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
 * One group in the list: tile, name, "N members · You organize" on one line, then chips (who is
 * nearby, the active meeting point, the trip map), and an amber footer if the trip map is missing.
 */
function GroupRow({ group: g, onPress }: { group: Group; onPress: () => void }) {
  const { c } = useTheme();
  const all = useGroupMembers(g.id);
  const members = all.filter(m => m.state === 'active');
  const presence = useGroupPresence(g, all, useNow());
  const point = activePoint(useGroupPoints(g.id));
  const fix = useLocationStore(st => st.fix);
  const { units } = useNavPrefs();
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
      style={({ pressed }) => [styles.groupPress, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Card style={styles.groupCard}>
        <View style={styles.groupMain}>
          <GroupTile name={g.name} dim={!active} />
          <View style={styles.groupBody}>
            <Text variant="cardTitle" numberOfLines={1}>
              {g.name}
            </Text>
            <Text variant="caption" muted numberOfLines={1}>
              {meta}
            </Text>
          </View>
          <Icon name="chevron" size={22} color={c.textMuted} />
        </View>
        <View style={styles.groupStatus}>
          {active ? (
            <View testID={`group-presence-${g.id}`}>
              {presence.reachable > 0 ? (
                <Badge dot tone="good" label={`${presence.reachable} nearby`} />
              ) : (
                <Badge label={members.length > 1 ? 'Nobody nearby' : presence.status.label} />
              )}
            </View>
          ) : (
            <Badge
              label={g.status === 'joining' ? 'Waiting' : 'Ended'}
              tone={g.status === 'joining' ? 'warn' : 'neutral'}
            />
          )}
          {active && point ? (
            <Badge
              tone="meeting"
              icon="flag"
              label={
                fix
                  ? `${point.name} · ${formatDistanceIn(distanceM(fix, point), units)}`
                  : point.name
              }
            />
          ) : null}
          {active ? activityBadge : null}
          {active ? <TripMapChip group={g} /> : null}
        </View>
        <TripMapFooter group={g} />
      </Card>
    </Pressable>
  );
}

/** At the end of the list: how to join someone else's group. */
function JoinHint({ onScan }: { onScan: () => void }) {
  const { c } = useTheme();
  return (
    <View style={[styles.joinHint, { borderColor: c.border }]} testID="groups-join-hint">
      <IconTile name="qr" size={44} />
      <Text variant="cardTitle">Joining someone's trek?</Text>
      <Text variant="caption" muted style={{ textAlign: 'center' }}>
        Scan the leader's QR code or open their invite link. Works without internet.
      </Text>
      <Button small variant="secondary" icon="qr" label="Scan QR code" onPress={onScan} />
    </View>
  );
}

export function GroupsScreen({ navigation }: Nav<'GroupsList'>) {
  const { groups: service } = useServices();
  const groups = [...useGroups()].sort(
    (x, y) => statusRank(x.status) - statusRank(y.status) || y.createdAt - x.createdAt,
  );
  const rt = useGroupRuntime();
  return (
    <Screen
      title="Groups"
      right={
        <Row style={{ gap: space.sm }}>
          <Button
            small
            variant="secondary"
            icon="qr"
            label="Join"
            onPress={() => navigation.navigate('JoinGroup')}
            testID="groups-add-join"
          />
          <Button
            small
            icon="plus"
            label="New"
            onPress={() => navigation.navigate('CreateGroup')}
            testID="groups-add-create"
          />
        </Row>
      }
    >
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
        ListFooterComponent={
          groups.length > 0 ? <JoinHint onScan={() => navigation.navigate('JoinGroup')} /> : null
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
  // A `muster://join?...` deep link arrives as separate route params.
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
          ? 'This invitation is from a newer version of Muster. Update the app.'
          : 'That is not a Muster invitation.',
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
                  placeholder="muster://join?…"
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
  const fix = useLocationStore(st => st.fix);
  const { units, paceKmh } = useNavPrefs();
  const startNav = useNavSession(st => st.start);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareHere, setShareHere] = useState(false);
  const [sharePlace, setSharePlace] = useState<SharePlace | null>(null);
  // Back from choosing a meeting point on the map: open the sheet on that place to name it.
  useEffect(() => {
    if (picked) {
      setSharePlace({ lat: picked.lat, lon: picked.lon });
      setShareHere(false);
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
  const feed = buildFeed(members, points, me, now);
  const pinned = activePoint(points);
  const parent = navigation.getParent() as
    | { navigate: (n: string, p?: object) => void }
    | undefined;
  const showOnMap = (pointId: string) =>
    parent?.navigate('Map', { focusMeetingPoint: `${groupId}:${pointId}`, nonce: Date.now() });
  const nearbyNames = presence.members.filter(x => x.presence.reachable).map(x => x.member.name);
  const presenceLine =
    group.status !== 'active'
      ? presence.status.label
      : nearbyNames.length === 1
      ? `${nearbyNames[0]} is nearby`
      : nearbyNames.length > 1
      ? `${nearbyNames.length} people nearby`
      : presence.status.label;
  const pinnedDist = pinned && fix ? distanceM(fix, pinned) : null;
  const pinnedBrg = pinned && fix ? bearingDeg(fix, pinned) : null;

  return (
    <Screen onBack={() => navigation.navigate('GroupsList')} edges={['top', 'bottom']}>
      <View style={styles.pageHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.navigate('GroupsList')}
          hitSlop={8}
          style={styles.headerBtn}
        >
          <Icon name="back" size={28} />
        </Pressable>
        <Pressable
          testID="group-title"
          accessibilityRole="button"
          accessibilityLabel={`${group.name}. Group info`}
          onPress={() => navigation.navigate('GroupInfo', { groupId })}
          style={styles.pageTitle}
        >
          <GroupTile name={group.name} size={40} dim={group.status !== 'active'} />
          <View style={{ flex: 1 }}>
            <Text variant="cardTitle" numberOfLines={1}>
              {group.name}
            </Text>
            <Text
              variant="caption"
              numberOfLines={1}
              color={nearbyNames.length > 0 ? c.primary : c.textMuted}
              testID="group-status"
            >
              {presenceLine}
            </Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Group info"
          onPress={() => navigation.navigate('GroupInfo', { groupId })}
          style={styles.headerBtn}
          testID="group-info-button"
        >
          <Icon name="info" size={24} color={c.text} />
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
        {pinned && group.status === 'active' ? (
          <View style={[styles.pinned, { backgroundColor: c.ink }]} testID="group-pinned-point">
            <IconTile name="flag" color={c.onInk} bg={c.meeting} size={44} />
            <View style={{ flex: 1 }}>
              <Text variant="cardTitle" color={c.onInk} numberOfLines={1}>
                {pinned.name}
              </Text>
              <Text variant="caption" color={c.onInkMuted} numberOfLines={1} style={tabular}>
                {pinnedDist === null || pinnedBrg === null
                  ? 'Meeting point · waiting for GPS'
                  : `${formatDistanceIn(pinnedDist, units)} ${cardinal16Of(
                      pinnedBrg,
                    )} · ~${formatEta(etaMinutes(pinnedDist, paceKmh))}`}
              </Text>
            </View>
            <Button
              small
              variant="light"
              label="Go"
              testID="group-pinned-go"
              onPress={() => {
                startNav({
                  name: pinned.name,
                  lat: pinned.lat,
                  lon: pinned.lon,
                  kind: 'meeting',
                  key: `${groupId}:${pinned.id}`,
                });
                parent?.navigate('Map');
              }}
            />
          </View>
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
              ? 'No updates yet. Set a meeting point or share your location with the group.'
              : 'No updates yet. Meeting points and people joining show up here.'}
          </Text>
        }
        renderItem={({ item: e }) =>
          e.kind === 'day' ? (
            <View style={styles.dayRow}>
              <View style={[styles.dayLine, { backgroundColor: c.border }]} />
              <Text variant="label" muted>
                {e.text}
              </Text>
              <View style={[styles.dayLine, { backgroundColor: c.border }]} />
            </View>
          ) : e.kind === 'member' ? (
            <Text variant="label" muted style={styles.system}>
              {e.text}
            </Text>
          ) : (
            <FeedPoint
              e={e}
              note={points.find(x => x.id === e.pointId)?.note ?? null}
              onPress={() => showOnMap(e.pointId)}
            />
          )
        }
      />
      {organizer && group.status === 'active' ? (
        <View style={[styles.composer, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text variant="caption" muted style={{ textAlign: 'center' }}>
            Only you can post here. Followers get your updates when they're in range.
          </Text>
          <Row style={{ gap: space.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Set a meeting point on the map"
              onPress={() =>
                parent?.navigate('Map', { pickMeeting: { groupId }, nonce: Date.now() })
              }
              style={[styles.flagBtn, { backgroundColor: c.meetingSoft }]}
              testID="group-open-map"
            >
              <Icon name="flag" size={24} color={c.meetingStroke} />
            </Pressable>
            <Button
              style={{ flex: 1 }}
              icon="locate"
              label="Share my location"
              onPress={() => {
                setSharePlace(null);
                setShareHere(true);
                setShareOpen(true);
              }}
              testID="group-share-location"
            />
          </Row>
        </View>
      ) : null}
      <ShareLocationSheet
        visible={shareOpen}
        groupId={groupId}
        groupName={group.name}
        place={sharePlace}
        startHere={shareHere}
        inRange={presence.reachable}
        onChooseOnMap={() => {
          setShareOpen(false);
          parent?.navigate('Map', { pickMeeting: { groupId }, nonce: Date.now() });
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

/** A meeting point in the feed: mini map, name, note, Show on map, time. */
function FeedPoint({
  e,
  note,
  onPress,
}: {
  e: Extract<FeedEvent, { kind: 'meeting' }>;
  note: string | null;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      testID={`update-${e.pointId}`}
      accessibilityRole="button"
      accessibilityLabel={`${e.title}: ${e.name}. Show on map`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bubble,
        e.mine && styles.bubbleMine,
        { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <View style={[styles.miniMap, { backgroundColor: c.primarySoft }]}>
        <View style={[styles.miniRoad, { backgroundColor: c.surface }]} />
        <View style={styles.miniPin}>
          <FlagPin size={26} />
        </View>
      </View>
      <View style={styles.bubbleBody}>
        <Text variant="label" color={c.meetingText}>
          {e.title}
        </Text>
        <Text variant="cardTitle">{e.name}</Text>
        {note ? (
          <Text variant="caption" muted numberOfLines={2} style={{ fontWeight: '500' }}>
            {note}
          </Text>
        ) : null}
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="caption" color={c.primary} style={{ fontWeight: '800' }}>
            Show on map
          </Text>
          <Text variant="label" muted>
            {clock(e.at)}
          </Text>
        </Row>
      </View>
    </Pressable>
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
    ...(group.status === 'active' ? [{ value: 'activities' as const, label: 'Trips' }] : []),
  ];
  // The invitation is opened from the last row of Members (organizer only). The group can end,
  // or stop taking invitations, while this screen is open.
  const shown =
    tab === 'invite'
      ? canInvite
        ? 'invite'
        : 'members'
      : tabs.some(t => t.value === tab)
      ? tab
      : 'members';

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
              A code adds one person and is valid for 24 hours. They scan it with Muster; no
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More options"
          onPress={() => setMenuOpen(true)}
          testID="info-menu"
          style={styles.headerBtn}
        >
          <Icon name="more" size={24} color={c.text} />
        </Pressable>
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
          <GroupTile name={group.name} size={56} dim={group.status !== 'active'} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title" numberOfLines={1} testID="info-name">
              {group.name}
            </Text>
            <Text variant="caption" muted numberOfLines={1} testID="info-meta">
              {active.length} {active.length === 1 ? 'member' : 'members'} ·{' '}
              {organizer ? 'You organize' : 'You follow'}
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
                  ? 'None yet. Set one from the group page with the flag button.'
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
                    leading={<IconTile name="flag" tone="meeting" />}
                    subtitle={`Shared ${ago(now - p.updatedAt)}${p.note ? ` · ${p.note}` : ''}`}
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
              {sortedMembers.map((m, i) => {
                const pres = presenceOfMember.get(m.address);
                const leader = m.role === 'organizer';
                const near = m.state === 'active' && m.address !== me && !!pres?.reachable;
                return (
                  <ListRow
                    key={m.address}
                    testID={`member-${m.address}`}
                    divider={i < sortedMembers.length - 1 || canInvite}
                    leading={
                      <Avatar
                        name={m.name}
                        online={near}
                        dim={m.state !== 'active' || pres?.freshness === 'last_seen'}
                      />
                    }
                    title={`${m.name}${m.address === me ? ' (you)' : ''}`}
                    subtitle={
                      m.state !== 'active'
                        ? m.state === 'left'
                          ? 'Left the group'
                          : 'Removed'
                        : m.address === me
                        ? leader
                          ? 'Leader · shares updates with the group'
                          : 'Follower · this phone'
                        : `${leader ? 'Leader' : 'Follower'} · ${
                            near ? 'nearby now' : presenceText(pres!)
                          }`
                    }
                    trailing={
                      leader && m.state === 'active' ? (
                        <Badge label="Leader" tone="good" />
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
                );
              })}
              {canInvite ? (
                <ListRow
                  testID="info-tab-invite"
                  title="Invite people with a QR code"
                  leading={<IconTile name="qr" />}
                  chevron
                  divider={false}
                  onPress={() => setTab('invite')}
                />
              ) : null}
            </Card>
          </>
        ) : null}

        {shown === 'activities' && !activitiesOn ? (
          <Card style={{ paddingVertical: space.xs }} testID="group-adventures">
            <ListRow
              title="Trips"
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
  const me = useMesh().localAddress;

  useEffect(() => {
    const load = () => void meetingPoints.get(groupId, pointId).then(setPoint);
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
  // Pub/sub: only the organizer acts on a point; followers read it.
  const organizer = group.role === 'organizer';

  return (
    <Screen title={point.name} onBack={() => navigation.goBack()}>
      <ScrollView contentContainerStyle={styles.list}>
        <Card style={{ gap: space.sm }}>
          <Row style={{ gap: space.md }}>
            <IconTile name="flag" tone="meeting" size={44} />
            <View style={{ flex: 1 }}>
              <Text variant="cardTitle">{point.name}</Text>
              <Text variant="caption" muted>
                {group.name}
              </Text>
            </View>
          </Row>
          {point.note ? <Text testID="point-note">{point.note}</Text> : null}
          <Text variant="mono" muted selectable testID="point-coords">{`${point.lat.toFixed(
            6,
          )}, ${point.lon.toFixed(6)}`}</Text>
        </Card>
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
        <Button
          label="Show on map"
          icon="map"
          onPress={() =>
            navigation
              .getParent()
              ?.navigate('Map', { focusMeetingPoint: `${groupId}:${pointId}`, nonce: Date.now() })
          }
          testID="point-show"
        />
        {organizer ? (
          <Button
            variant="danger"
            icon="trash"
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
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerBtn: {
    width: size.touch,
    height: size.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presenceDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  groupTile: { alignItems: 'center', justifyContent: 'center' },
  groupPress: { marginBottom: space.md },
  groupMain: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  joinHint: {
    alignItems: 'center',
    gap: space.sm,
    padding: space.xl,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    marginTop: space.xs,
  },
  pinned: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
  },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginVertical: space.xs },
  dayLine: { flex: 1, height: 1 },
  system: { textAlign: 'center' },
  composer: {
    gap: space.sm,
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
    paddingBottom: space.sm,
    borderTopWidth: 1,
  },
  flagBtn: {
    width: 54,
    height: 54,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniMap: { height: 96, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  miniRoad: {
    position: 'absolute',
    width: 400,
    height: 10,
    transform: [{ rotate: '-18deg' }],
    opacity: 0.9,
  },
  miniPin: { marginTop: -8 },
  bubbleBody: { padding: space.md, gap: 2 },
  list: { padding: space.gutter, paddingTop: 0, gap: space.md, paddingBottom: space.xxl },
  startWrap: { gap: space.md, paddingTop: space.xl },
  sheetScrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    padding: space.gutter,
    gap: space.md,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  groupCard: { padding: 0, overflow: 'hidden' },
  groupBody: { flex: 1, gap: 2 },
  groupStatus: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
  },
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
  bubble: {
    alignSelf: 'flex-start',
    width: '85%',
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  bubbleMine: { alignSelf: 'flex-end' },
  infoHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  sectionLabel: { textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: -space.xs },
  inviteCard: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
  qrPlate: {
    padding: space.md,
    // A QR code needs a white plate in both themes to scan.
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    borderWidth: 1,
  },
  inviteActions: { flexDirection: 'row', gap: space.sm, alignSelf: 'stretch' },
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
    minHeight: size.input,
    fontSize: 16,
  },
});

export type { Group };
