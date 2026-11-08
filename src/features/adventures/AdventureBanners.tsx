import React, { useEffect, useState } from 'react';
import { achievementById } from '../../domain/adventures/achievements';
import { useAchievementRuntime, useAdventureRuntime } from '../../runtime/hooks';
import { useServices } from '../../runtime/services';
import { Banner } from '../../ui/components';

const TOAST_MS = 6_000;

/** One quiet banner at a time, in the map's top stack: a badge, an arrival, a hint, or news. */
export function AdventureBanners({
  onOpenAchievements,
  onOpenCheckpoint,
  onOpenSummary,
}: {
  onOpenAchievements: () => void;
  onOpenCheckpoint: (adventureId: string, checkpointId: string) => void;
  onOpenSummary: (adventureId: string) => void;
}) {
  const { adventures, achievements } = useServices();
  const rt = useAdventureRuntime();
  const fresh = useAchievementRuntime().fresh;
  const toast = rt.celebrations.filter(c => c.kind !== 'adventure_complete').slice(-1)[0];
  const done = rt.celebrations.find(c => c.kind === 'adventure_complete');
  const [names, setNames] = useState<Record<string, string>>({});
  const { adventuresRepo } = useServices();

  useEffect(() => {
    if (!toast?.checkpointId) {
      return;
    }
    void adventuresRepo.checkpoint(toast.adventureId, toast.checkpointId).then(cp => {
      if (cp) {
        setNames(n => ({ ...n, [toast.id]: cp.name }));
      }
    });
    const t = setTimeout(() => adventures.dismissCelebration(toast.id), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast, adventures, adventuresRepo]);

  if (done) {
    return (
      <Banner
        title="Adventure finished"
        body="Your recap is ready in Adventures."
        actionLabel="View"
        onAction={() => {
          adventures.dismissCelebration(done.id);
          onOpenSummary(done.adventureId);
        }}
        onDismiss={() => adventures.dismissCelebration(done.id)}
      />
    );
  }
  if (fresh[0]) {
    const def = achievementById(fresh[0]);
    return (
      <Banner
        title={`Badge earned: ${def?.name ?? 'new badge'}`}
        actionLabel="View"
        onAction={onOpenAchievements}
        onDismiss={() => achievements.dismissFresh(fresh[0] as string)}
      />
    );
  }
  if (toast) {
    const name = names[toast.id];
    return (
      <Banner
        title={
          toast.kind === 'all_checkpoints'
            ? 'All checkpoints explored'
            : name
            ? `Reached ${name}`
            : 'Checkpoint reached'
        }
        onDismiss={() => adventures.dismissCelebration(toast.id)}
      />
    );
  }
  if (rt.hint) {
    const h = rt.hint;
    return (
      <Banner
        title={h.state === 'uncertain' ? `Near ${h.name}` : `Approaching ${h.name}`}
        body={
          h.state === 'uncertain'
            ? 'GPS is too weak to confirm. Mark it yourself when you are there.'
            : `About ${Math.round(h.distM)} m away. No rush.`
        }
        actionLabel={h.state === 'uncertain' ? 'I am here' : 'Details'}
        onAction={() =>
          h.state === 'uncertain'
            ? void adventures.confirmArrival(h.adventureId, h.checkpointId, 'manual')
            : onOpenCheckpoint(h.adventureId, h.checkpointId)
        }
      />
    );
  }
  const note = rt.notices[0];
  if (note) {
    return <Banner title={note.text} onDismiss={() => adventures.dismissNotices()} />;
  }
  return null;
}
