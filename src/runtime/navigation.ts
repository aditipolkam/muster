import type { NavigatorScreenParams } from '@react-navigation/native';

export type MoreStackParamList = {
  MoreList: undefined;
  Downloaded: undefined;
  Download: undefined;
  Saved: undefined;
  Mesh: undefined;
  Settings: undefined;
  Adventures: undefined;
  /** Edit an existing adventure, or plan a new one (optionally for a group you organize). */
  AdventureEditor: { adventureId?: string; groupId?: string } | undefined;
  AdventureDetails: { adventureId: string };
  CheckpointEditor: { adventureId: string; checkpointId?: string; lat?: number; lon?: number };
  CheckpointDetails: { adventureId: string; checkpointId: string };
  AdventureSummary: { adventureId: string; celebrate?: boolean };
  Achievements: undefined;
};

/** The offline-maps screens live inside the More stack. */
export type MapsStackParamList = MoreStackParamList;

export type GroupsStackParamList = {
  GroupsList: undefined;
  CreateGroup: undefined;
  JoinGroup:
    | { link?: string; v?: string; g?: string; o?: string; t?: string; n?: string }
    | undefined;
  GroupDetails: { groupId: string };
  MeetingPoint: { groupId: string; pointId: string };
};

export type RootTabParamList = {
  Map:
    | {
        focusMarkerId?: string;
        focusRegionId?: string;
        /** `<groupId>:<pointId>` */
        focusMeetingPoint?: string;
        /** Show an adventure's checkpoints and recorded route on the map. */
        showAdventure?: string;
        nonce?: number;
      }
    | undefined;
  Groups: NavigatorScreenParams<GroupsStackParamList> | undefined;
  Navigate:
    | {
        groupId?: string;
        pointId?: string;
        markerId?: string;
        /** Straight-line guidance to a checkpoint of an adventure. */
        adventureId?: string;
        checkpointId?: string;
      }
    | undefined;
  More: NavigatorScreenParams<MoreStackParamList> | undefined;
};
