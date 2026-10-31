import React, { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import type { PublishedRecord, ReceivedRecord } from '../../mesh/PubSub';
import { DIAG_SERVICE_ID, DIAG_SERVICE_VERSION, diagTopics } from '../../mesh/topics';
import type { SubscriptionMode } from '../../mesh/types';
import { useMesh, usePubSub } from '../../runtime/hooks';
import { useServices } from '../../runtime/services';
import { Badge, Banner, Button, Card, Divider, Row, Screen, Text } from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';
import { useNow } from '../../ui/useNow';
import { ago, lifecycleLabel, peerStatus, shortAddress } from './format';
import { ScanPulse } from './ScanPulse';

/** Development screen (Phase 2). No SDK imports: everything goes through MeshPort and PubSub. */
export function MeshDiagnosticsScreen() {
  const { c } = useTheme();
  const { mesh, pubsub } = useServices();
  const m = useMesh();
  const ps = usePubSub();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('hello');
  const [provider, setProvider] = useState('');
  const [mode, setMode] = useState<SubscriptionMode>('log');
  const [notice, setNotice] = useState<string | null>(null);

  const running = m.lifecycle === 'running';
  const status = lifecycleLabel(m.lifecycle);
  const run = async (fn: () => Promise<{ ok: boolean; error?: { userMessage: string } }>) => {
    setBusy(true);
    const r = await fn();
    setNotice(r.ok ? null : r.error?.userMessage ?? 'Failed');
    setBusy(false);
  };

  const subscribeTo = (addr: string) =>
    run(() =>
      pubsub.subscribe({ provider: addr, serviceId: DIAG_SERVICE_ID, topic: diagTopics.all, mode }),
    );

  const publish = (key?: string) =>
    run(() =>
      pubsub.publish({
        topic: key ? diagTopics.state : diagTopics.event,
        type: 'ping',
        payload: { text },
        key,
      }),
    );

  return (
    <Screen title="Mesh">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Banner
          tone="info"
          title="Development diagnostics"
          body="Bluetooth works on physical devices only. Nothing here is simulated on a real build."
        />
        {m.lastError ? (
          <Banner tone="error" title="Mesh problem" body={m.lastError.userMessage} />
        ) : null}
        {notice ? <Banner tone="error" title="Not done" body={notice} /> : null}

        <Card>
          <Row>
            <ScanPulse active={running} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading">Mesh</Text>
              <Row>
                <Badge label={status.label} tone={status.tone} />
                <Badge
                  label={`Bluetooth ${m.bluetooth}`}
                  tone={m.bluetooth === 'on' ? 'good' : m.bluetooth === 'off' ? 'bad' : 'neutral'}
                />
              </Row>
            </View>
          </Row>
          <Kv k="SDK state" v={m.sdkState ?? '—'} />
          <Kv k="Permissions" v={m.permissions} />
          <Kv k="Address" v={m.localAddress ?? '—'} selectable />
          <Kv k="BLE peers (SDK)" v={m.blePeerCount === null ? '—' : String(m.blePeerCount)} />
          <Row>
            <Button
              testID="mesh-start"
              label="Start mesh"
              disabled={running}
              loading={m.lifecycle === 'starting' || busy}
              onPress={() => run(() => mesh.start())}
              style={{ flex: 1 }}
            />
            <Button
              testID="mesh-stop"
              label="Stop"
              variant="secondary"
              disabled={!running}
              onPress={() =>
                run(async () => {
                  await pubsub.unsubscribeAll();
                  await pubsub.stopProviding();
                  return mesh.stop();
                })
              }
              style={{ flex: 1 }}
            />
          </Row>
          {m.bluetooth === 'off' ? (
            <Button
              label="Turn on Bluetooth"
              variant="ghost"
              onPress={() => void mesh.requestEnableBluetooth()}
            />
          ) : null}
        </Card>

        <Text variant="label" muted>
          Nearby devices ({m.peers.filter(p => p.state === 'nearby').length})
        </Text>
        <Card>
          {m.peers.length === 0 ? (
            <Text muted>
              {running
                ? 'Scanning… no devices heard yet.'
                : 'Start the mesh to scan for nearby devices.'}
            </Text>
          ) : (
            m.peers.map((p, i) => {
              const s = peerStatus(p);
              return (
                <View key={p.address}>
                  {i > 0 ? <Divider /> : null}
                  <View style={styles.peer}>
                    <Row>
                      <Text variant="mono" style={{ flex: 1 }} selectable>
                        {shortAddress(p.address)}
                      </Text>
                      <Badge label={s.label} tone={s.tone} />
                    </Row>
                    <Text variant="caption" muted>
                      {p.transport}
                      {p.rssi !== null ? ` · ${p.rssi} dBm` : ''} ·{' '}
                      {p.state === 'lost'
                        ? `lost ${ago(now, p.lostAt ?? p.lastSeenAt)}`
                        : `seen ${ago(now, p.lastSeenAt)}`}
                    </Text>
                    {p.state === 'nearby' ? (
                      <Button
                        small
                        variant="secondary"
                        label="Subscribe to this device"
                        disabled={!running}
                        onPress={() => subscribeTo(p.address)}
                      />
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </Card>

        <Text variant="label" muted>
          Publisher (this device)
        </Text>
        <Card>
          <Text variant="caption" muted>
            Service {DIAG_SERVICE_ID}. Others follow this device; there are no mesh-wide topics.
          </Text>
          <Row>
            <Button
              testID="pub-start"
              label={ps.providing ? 'Publishing' : 'Start publishing'}
              disabled={!running || !!ps.providing}
              onPress={() =>
                run(() => pubsub.provide(DIAG_SERVICE_ID, DIAG_SERVICE_VERSION, 'restricted'))
              }
              style={{ flex: 1 }}
            />
            <Button
              label="Stop"
              variant="secondary"
              disabled={!ps.providing}
              onPress={() => run(() => pubsub.stopProviding())}
              style={{ flex: 1 }}
            />
          </Row>
          {ps.providing ? (
            <Row>
              <Text variant="caption" muted style={{ flex: 1 }}>
                Who may subscribe
              </Text>
              <Button
                small
                variant={ps.providing.policy === 'restricted' ? 'primary' : 'secondary'}
                label="Ask me"
                onPress={() => run(() => pubsub.setPolicy('restricted'))}
              />
              <Button
                small
                variant={ps.providing.policy === 'accept_all' ? 'primary' : 'secondary'}
                label="Anyone nearby"
                onPress={() => run(() => pubsub.setPolicy('accept_all'))}
              />
            </Row>
          ) : null}
          {ps.pendingRequests.map(r => (
            <View key={r.subId} style={styles.peer}>
              <Text variant="caption">
                {shortAddress(r.sender)} wants to subscribe to {r.topic} ({r.mode})
              </Text>
              <Row>
                <Button
                  small
                  label="Accept"
                  onPress={() => run(() => pubsub.acceptRequest(r.subId))}
                />
                <Button
                  small
                  variant="danger"
                  label="Reject"
                  onPress={() => run(() => pubsub.rejectRequest(r.subId))}
                />
              </Row>
            </View>
          ))}
          {ps.subscribers.length > 0 ? (
            <Text variant="caption" muted>
              Subscribers:{' '}
              {ps.subscribers.map(s => `${shortAddress(s.subscriber)} (${s.state})`).join(', ')}
            </Text>
          ) : null}
          <TextInput
            testID="pub-text"
            value={text}
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={c.textMuted}
            style={[
              styles.input,
              { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt },
            ]}
          />
          <Row>
            <Button
              testID="pub-event"
              small
              label="Publish event"
              disabled={!ps.providing}
              onPress={() => publish()}
              style={{ flex: 1 }}
            />
            <Button
              testID="pub-state"
              small
              variant="secondary"
              label="Publish state"
              disabled={!ps.providing}
              onPress={() => publish('state')}
              style={{ flex: 1 }}
            />
          </Row>
          <Text variant="caption" muted>
            Event = every update in order (log). State = newest value wins (latest).
          </Text>
        </Card>

        <Text variant="label" muted>
          Subscriptions ({ps.subscriptions.length})
        </Text>
        <Card>
          <TextInput
            testID="sub-address"
            value={provider}
            onChangeText={setProvider}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Provider address (off1…)"
            placeholderTextColor={c.textMuted}
            style={[
              styles.input,
              { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt },
            ]}
          />
          <Row>
            <Button
              small
              variant={mode === 'log' ? 'primary' : 'secondary'}
              label="Events (log)"
              onPress={() => setMode('log')}
            />
            <Button
              small
              variant={mode === 'latest' ? 'primary' : 'secondary'}
              label="State (latest)"
              onPress={() => setMode('latest')}
            />
            <Button
              small
              label="Subscribe"
              disabled={!running || provider.trim().length === 0}
              onPress={() => subscribeTo(provider.trim())}
              style={{ marginLeft: 'auto' }}
            />
          </Row>
          {ps.subscriptions.map(s => (
            <View key={s.subId} style={styles.peer}>
              <Row>
                <Text variant="mono" style={{ flex: 1 }}>
                  {shortAddress(s.provider)}
                </Text>
                <Badge
                  label={s.state}
                  tone={s.state === 'active' ? 'good' : s.state === 'pending' ? 'warn' : 'neutral'}
                />
              </Row>
              <Text variant="caption" muted>
                {s.topic} · {s.mode}
              </Text>
              <Button
                small
                variant="secondary"
                label="Unsubscribe"
                onPress={() => run(() => pubsub.unsubscribe(s.subId))}
              />
            </View>
          ))}
        </Card>

        <Text variant="label" muted>
          Published ({ps.published.length})
        </Text>
        <Card>
          {ps.published.length === 0 ? (
            <Text muted>Nothing published yet.</Text>
          ) : (
            ps.published.slice(0, 20).map(p => <PublishedRow key={p.envelopeId} p={p} now={now} />)
          )}
        </Card>

        <Text variant="label" muted>
          Received ({ps.received.length}, {ps.duplicates} duplicate, {ps.rejected} rejected)
        </Text>
        <Card>
          {ps.received.length === 0 ? (
            <Text muted>Nothing received yet.</Text>
          ) : (
            ps.received
              .slice(0, 20)
              .map(r => <ReceivedRow key={`${r.envelopeId}-${r.at}-${r.seq}`} r={r} now={now} />)
          )}
        </Card>

        {ps.errors.length > 0 || m.diagnostics.length > 0 ? (
          <>
            <Text variant="label" muted>
              Errors and SDK diagnostics
            </Text>
            <Card>
              {ps.errors.slice(0, 10).map((e, i) => (
                <Text key={`e${i}`} variant="caption" color={c.danger}>
                  {e.code}: {e.message}
                </Text>
              ))}
              {m.diagnostics.slice(0, 10).map((d, i) => (
                <Text key={`d${i}`} variant="caption" muted>
                  [{d.level}] {d.message}
                </Text>
              ))}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Kv({ k, v, selectable }: { k: string; v: string; selectable?: boolean }) {
  return (
    <Row>
      <Text variant="caption" muted style={{ width: 120 }}>
        {k}
      </Text>
      <Text variant="mono" style={{ flex: 1 }} selectable={selectable}>
        {v}
      </Text>
    </Row>
  );
}

const DELIVERY: Record<
  PublishedRecord['state'],
  { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' }
> = {
  sending: { label: 'Sending', tone: 'warn' },
  sent: { label: 'Handed to mesh', tone: 'good' },
  no_subscribers: { label: 'No subscribers', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'bad' },
};

function PublishedRow({ p, now }: { p: PublishedRecord; now: number }) {
  const d = DELIVERY[p.state];
  return (
    <View style={styles.peer}>
      <Row>
        <Text variant="mono" style={{ flex: 1 }}>
          {p.type} · {p.key ? 'state' : 'event'}
        </Text>
        <Badge label={d.label} tone={d.tone} />
      </Row>
      <Text variant="caption" muted>
        {p.topic} · {p.bytes} B · {ago(now, p.at)}
        {p.report
          ? ` · to ${p.report.subscribers}: live ${p.report.sentLive}, queued ${p.report.queued}, merged ${p.report.coalesced}, failed ${p.report.failed}`
          : ''}
      </Text>
      {p.error ? <Text variant="caption">{p.error}</Text> : null}
    </View>
  );
}

function ReceivedRow({ r, now }: { r: ReceivedRecord; now: number }) {
  return (
    <View style={styles.peer}>
      <Row>
        <Text variant="mono" style={{ flex: 1 }}>
          {r.type}: {String(r.payload.text ?? JSON.stringify(r.payload))}
        </Text>
        {r.duplicate ? (
          <Badge label="Duplicate" tone="warn" />
        ) : r.snapshot ? (
          <Badge label="Catch-up" />
        ) : null}
      </Row>
      <Text variant="caption" muted>
        {shortAddress(r.from)} · {r.topic} · seq {r.seq} · {ago(now, r.at)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  peer: { paddingVertical: space.sm, gap: space.xs },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 16,
  },
});
