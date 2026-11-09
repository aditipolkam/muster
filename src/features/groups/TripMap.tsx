import React from 'react';
import { StyleSheet, View } from 'react-native';
import { canChangeTripArea, Group, GroupMember } from '../../domain/groups/model';
import { AreaDownload, useAreaDownload } from '../../runtime/hooks';
import {
  Badge,
  Banner,
  Button,
  Card,
  Icon,
  IconTile,
  ProgressBar,
  Row,
  Text,
} from '../../ui/components';
import { space, useTheme } from '../../ui/theme';

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
      <Row>
        <IconTile name="region" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="cardTitle">Trip map</Text>
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
        <Row style={{ gap: space.xs }}>
          <Icon name="lock" size={16} color={c.textMuted} />
          <Text variant="caption" muted style={{ flex: 1 }} testID="trip-map-locked">
            Locked: people already joined with this map.
          </Text>
        </Row>
      ) : null}
    </Card>
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
          Downloaded · works offline
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
        label={`Download · ${sizeText}`}
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
        title="Download the trip map"
        body={
          error ??
          `${area.name} · ${sizeText}. Get it while you have internet; it works offline after.`
        }
        actionLabel={busy ? 'Starting…' : 'Download'}
        onAction={busy ? undefined : () => void download()}
      />
    </View>
  );
}

/** For the groups list: a badge while this phone is missing the group's trip map. */
export function TripMapBadge({ group }: { group: Group }) {
  const area = group.status === 'active' ? group.tripArea ?? null : null;
  const { covered } = useAreaDownload(area);
  return area && !covered ? <Badge label="Map not downloaded" tone="warn" /> : null;
}

const styles = StyleSheet.create({
  banner: { gap: space.sm },
});
