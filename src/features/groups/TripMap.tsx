import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { canChangeTripArea, Group, GroupMember } from '../../domain/groups/model';
import { AreaDownload, useAreaDownload } from '../../runtime/hooks';
import { Badge, Banner, Button, Card, Icon, ProgressBar, Row, Text } from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';

/**
 * The group's trip map: the area the organizer asks everyone to download. It reaches each person
 * in their welcome when they join, so the organizer can set it only until someone joins.
 */
export function TripMapCard({
  group,
  members,
  me,
  onChoose,
  onRemove,
}: {
  group: Group;
  members: GroupMember[];
  me: string | null;
  onChoose: () => void;
  onRemove: () => void;
}) {
  const { c } = useTheme();
  const area = group.tripArea ?? null;
  const dl = useAreaDownload(area);
  const organizer = group.role === 'organizer';
  const editable = canChangeTripArea(group, members, me);
  if (!area && (!organizer || group.status !== 'active')) {
    return null;
  }
  return (
    <Card style={{ gap: space.md }} testID="trip-map">
      <Row style={{ gap: space.md }}>
        <MiniMap />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="cardTitle">Trip map</Text>
          {area && !dl.covered ? (
            <Text variant="caption" color={c.warningText}>
              Not saved on this phone
            </Text>
          ) : null}
          <Text variant="caption" muted testID="trip-map-summary">
            {area
              ? `${area.name} · ${dl.sizeText}`
              : editable
              ? 'Choose the area people should download. They get it when they join, so set it before inviting anyone.'
              : 'No trip map. It can only be set before anyone joins.'}
          </Text>
        </View>
      </Row>

      {area ? <TripMapDownload dl={dl} /> : null}

      {organizer && editable ? (
        <Row style={{ gap: space.sm }}>
          <Button
            small
            variant={area ? 'secondary' : 'primary'}
            icon="map"
            label={area ? 'Change area' : 'Choose on map'}
            onPress={onChoose}
            style={{ flex: 1 }}
            testID="trip-map-choose"
          />
          {area ? (
            <Button
              small
              variant="ghost"
              label="Remove"
              onPress={onRemove}
              testID="trip-map-remove"
            />
          ) : null}
        </Row>
      ) : null}
      {organizer && area && !editable ? (
        <Row style={{ gap: space.xs, alignItems: 'flex-start' }}>
          <Icon name="lock" size={16} color={c.textMuted} />
          <Text variant="caption" muted style={{ flex: 1 }} testID="trip-map-locked">
            The map area can't change now that people have joined, so everyone has the same map.
          </Text>
        </Row>
      ) : null}
    </Card>
  );
}

/** A small stand-in preview of the trip map area (no tiles are rendered here). */
function MiniMap() {
  const { c } = useTheme();
  return (
    <View
      style={[styles.mini, { backgroundColor: c.primarySoft, borderColor: c.border }]}
      accessibilityElementsHidden
    >
      <View style={[styles.miniRidge, { borderColor: c.surface }]} />
      <View style={[styles.miniBox, { borderColor: c.primary }]} />
    </View>
  );
}

function TripMapDownload({ dl }: { dl: AreaDownload }) {
  const { c } = useTheme();
  const { covered, progress, sizeText, busy, error, download } = dl;
  if (covered) {
    return (
      <Row style={{ gap: space.xs }}>
        <Icon name="done" size={18} color={c.primary} />
        <Text variant="caption" color={c.primary} testID="trip-map-ready">
          Saved on this phone · works offline
        </Text>
      </Row>
    );
  }
  if (progress !== null) {
    return (
      <View style={{ gap: space.xs }} testID="trip-map-progress">
        <Text variant="caption" muted>
          Downloading · {Math.round(progress * 100)}%
        </Text>
        <ProgressBar value={progress} />
      </View>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      <Button
        icon="download"
        label={`Save for offline · ${sizeText}`}
        onPress={() => void download()}
        loading={busy}
        disabled={busy}
        testID="trip-map-download"
      />
      {error ? <Banner tone="error" title={error} /> : null}
    </View>
  );
}

/** On the group page: a nudge until this phone has the trip map. */
export function TripMapBanner({ group }: { group: Group }) {
  const area = group.status === 'active' ? group.tripArea ?? null : null;
  const { covered, progress, sizeText, busy, error, download } = useAreaDownload(area);
  if (!area || covered) {
    return null;
  }
  if (progress !== null) {
    return (
      <View style={styles.banner} testID="trip-map-banner">
        <Banner
          title="Downloading the trip map"
          body={`${area.name} · ${Math.round(progress * 100)}%`}
        />
      </View>
    );
  }
  return (
    <View style={styles.banner} testID="trip-map-banner">
      <Banner
        tone={error ? 'error' : 'warn'}
        title={`Save the trip map (${sizeText.replace(/^About /, '')}) before you lose signal`}
        body={error ?? `${area.name} · ${sizeText}. Get it while you have internet.`}
        actionLabel={busy ? 'Starting…' : 'Save'}
        onAction={busy ? undefined : () => void download()}
      />
    </View>
  );
}

/** Groups list card: grey "Map saved offline" chip once this phone has the trip map. */
export function TripMapChip({ group }: { group: Group }) {
  const area = group.status === 'active' ? group.tripArea ?? null : null;
  const { covered } = useAreaDownload(area);
  return area && covered ? <Badge icon="offline" label="Map saved offline" /> : null;
}

/** Groups list card: an amber footer strip while the trip map is missing on this phone. */
export function TripMapFooter({ group }: { group: Group }) {
  const { c } = useTheme();
  const area = group.status === 'active' ? group.tripArea ?? null : null;
  const { covered, progress, sizeText, busy, download } = useAreaDownload(area);
  if (!area || covered) {
    return null;
  }
  return (
    <View
      style={[styles.footer, { backgroundColor: c.warningBg, borderTopColor: c.warningBorder }]}
      testID={`trip-map-footer-${group.id}`}
    >
      <Icon name="warning" size={16} color={c.warningText} />
      <Text variant="caption" color={c.warningText} style={{ flex: 1 }} numberOfLines={1}>
        {progress !== null
          ? `Saving trip map · ${Math.round(progress * 100)}%`
          : `Trip map not saved offline · ${sizeText.replace(/^About /, '')}`}
      </Text>
      {progress === null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Download the trip map"
          onPress={busy ? undefined : () => void download()}
          hitSlop={10}
          style={styles.footerAction}
        >
          <Text variant="caption" color={c.warning} style={{ fontWeight: '800' }}>
            {busy ? 'Starting…' : 'Download'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** For the groups list: a badge while this phone is missing the group's trip map. */
export function TripMapBadge({ group }: { group: Group }) {
  const area = group.status === 'active' ? group.tripArea ?? null : null;
  const { covered } = useAreaDownload(area);
  return area && !covered ? <Badge icon="warning" label="Map not downloaded" tone="warn" /> : null;
}

const styles = StyleSheet.create({
  banner: { gap: space.sm },
  mini: {
    width: 64,
    height: 64,
    borderRadius: radius.tile,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniRidge: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 6,
    top: 24,
    left: -20,
  },
  miniBox: { width: 34, height: 30, borderWidth: 2, borderStyle: 'dashed', borderRadius: 4 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    minHeight: 44,
    borderTopWidth: 1,
  },
  footerAction: { minHeight: 44, justifyContent: 'center' },
});
