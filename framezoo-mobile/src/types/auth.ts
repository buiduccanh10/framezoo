export interface AccountProfile {
  colorA: string;
  colorB: string;
  icon: string;
}

export interface Account {
  profile: AccountProfile;
  nickname: string;
  email?: string | null;
}

export interface AccountWithToken extends Account {
  sessionId: string;
  userId: string;
  token?: string;
  refreshToken?: string;
  seed?: string;
  deviceName: string;
}
