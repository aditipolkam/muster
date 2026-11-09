import type { NavigatorScreenParams } from '@react-navigation/native';
import type { PhaseType } from '../domain/adventures/model';

/** A place (and optionally its offline map region) chosen on the map for a phase. */
export type PickedLocation = {
  lat: number;
  lon: number;
  /** [west, south, east, north], or null when the phase has no map region. */
  region: [number, number, number, number] | null;
  nonce: number;
};

/** Asks the map to choose a place for a phase and send it back to the editor. */
export type PickLocationRequest = {
  adventureId: string;
  checkpointId?: string;
  type: PhaseType;
  /** Where to start: the phase's current place, if it has one. */
  lat?: number;
  lon?: number;
  /** Also ask for the offline map region round the place. */
  includeRegion: boolean;
  region?: [number, number, number, number] | null;
};

/** Profile tab: identity, plus the offline-maps, saved-places, mesh and settings screens. */
export type ProfileStackParamList = {
  ProfileHome: undefined;
  Downloaded: undefined;
  Download: undefined;
  Saved: undefined;
  Mesh: undefined;
  Settings: undefined;
};

export type ActivityStackParamList = {
  Adventures: undefined;
  /** Edit an existing adventure, or plan a new one (optionally for a group you organize). */
  AdventureEditor: { adventureId?: string; groupId?: string } | undefined;
  AdventureDetails: { adventureId: string };
  CheckpointEditor: {
    adventureId: string;
    checkpointId?: string;
    lat?: number;
    lon?: number;
    /** The kind of phase being added (the picker's choice). */
    type?: PhaseType;
    /** Coming back from "Select Location" on the map. */
    picked?: PickedLocation;
  };
  /** "What kind of phase is this?" */
  AddPhase: { adventureId: string };
  PhaseAdded: { adventureId: string; checkpointId: string };
  /** Shown once, after a person finishes their last phase. */
  ActivityCompleted: { adventureId: string };
  CheckpointDetails: { adventureId: string; checkpointId: string };
  AdventureSummary: { adventureId: string; celebrate?: boolean };
  Achievements: undefined;
};

/** The offline-maps screens live inside the Profile stack. */
export type MapsStackParamList = ProfileStackParamList;

export type GroupsStackParamList = {
  GroupsList: undefined;
  CreateGroup: undefined;
  JoinGroup:
    | { link?: string; v?: string; g?: string; o?: string; t?: string; n?: string }
    | undefined;
  GroupDetails: {
    groupId: string;
    /** Coming back from choosing a meeting point on the map. */
    picked?: { lat: number; lon: number; nonce: number };
  };
  /**
   * `justCreated`: show the invitation QR straight away so the organizer can add people.
   * `pickedArea`: coming back from choosing the trip map on the map.
   */
  GroupInfo: {
    groupId: string;
    justCreated?: boolean;
    pickedArea?: { bbox: [number, number, number, number]; nonce: number };
  };
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
        /** Choose a place for a phase: shows the pin-placing flow instead of the usual map. */
        pick?: PickLocationRequest;
        /** Choose a meeting point for a group; the place goes back to the group page. */
        pickMeeting?: { groupId: string; lat?: number; lon?: number };
        /** Choose a group's trip map; the area goes back to group info. */
        pickTripMap?: { groupId: string; region?: [number, number, number, number] | null };
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
  Activity: NavigatorScreenParams<ActivityStackParamList> | undefined;
  Profile: NavigatorScreenParams<ProfileStackParamList> | undefined;
};
