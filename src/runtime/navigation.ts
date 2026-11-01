import type { NavigatorScreenParams } from '@react-navigation/native';

export type MapsStackParamList = {
  Downloaded: undefined;
  Download: undefined;
};

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
  Maps: NavigatorScreenParams<MapsStackParamList> | undefined;
  Saved: undefined;
  Mesh: undefined;
  Settings: undefined;
};
