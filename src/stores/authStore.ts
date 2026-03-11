import { createContext, useContext } from 'react';

export interface AuthState {
  token: string | null;
  npub: string | null;
  displayName: string | null;
  lightningAddress: string | null;
  sats: number;
  joints: number;
  totalJointsEarned: number;
  totalDeposited: number;
  isNewAccount: boolean;
}

export interface AuthContextValue extends AuthState {
  login: (token: string, npub: string, displayName: string | null, lightningAddress: string | null, sats: number, joints: number, totalJointsEarned?: number, isNewAccount?: boolean, totalDeposited?: number) => void;
  logout: () => void;
  setSats: (sats: number) => void;
  setJoints: (joints: number) => void;
  setTotalJointsEarned: (n: number) => void;
  setTotalDeposited: (n: number) => void;
  setProfile: (displayName: string | null, lightningAddress: string | null) => void;
  isLoggedIn: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
