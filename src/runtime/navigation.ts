import type { NavigatorScreenParams } from '@react-navigation/native';

export type MapsStackParamList = {
  Downloaded: undefined;
  Download: undefined;
};

export type RootTabParamList = {
  Map: { focusMarkerId?: string; focusRegionId?: string; nonce?: number } | undefined;
  Maps: NavigatorScreenParams<MapsStackParamList> | undefined;
  Saved: undefined;
  Mesh: undefined;
  Settings: undefined;
};
