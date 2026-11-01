import type { NavigatorScreenParams } from '@react-navigation/native';

export type MoreStackParamList = {
  MoreList: undefined;
  Downloaded: undefined;
  Download: undefined;
  Saved: undefined;
  Mesh: undefined;
  Settings: undefined;
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
        nonce?: number;
      }
    | undefined;
  Groups: NavigatorScreenParams<GroupsStackParamList> | undefined;
  Navigate: { groupId?: string; pointId?: string; markerId?: string } | undefined;
  More: NavigatorScreenParams<MoreStackParamList> | undefined;
};
