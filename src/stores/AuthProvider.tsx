import { useState, useCallback, type ReactNode } from 'react';
import { AuthContext, type AuthState } from './authStore';

const STORAGE_KEY = 'jf_auth';

function loadAuth(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { token: null, npub: null, displayName: null, lightningAddress: null, sats: 0, joints: 0, totalJointsEarned: 0, isNewAccount: false };
}

function saveAuth(state: AuthState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(loadAuth);

  const login = useCallback((token: string, npub: string, displayName: string | null, lightningAddress: string | null, sats: number, joints: number, totalJointsEarned: number = 0, isNewAccount: boolean = false) => {
    const next = { token, npub, displayName, lightningAddress, sats, joints, totalJointsEarned, isNewAccount };
    saveAuth(next);  // sync save BEFORE state update so child effects can read it
    setState(next);
  }, []);

  const logout = useCallback(() => {
    // Clear all app data from localStorage
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('jf_gamestate');
    localStorage.removeItem('jf_pending_payment');
    localStorage.removeItem('jf_speed_migrated');
    // Clear session storage
    sessionStorage.clear();
    setState({ token: null, npub: null, displayName: null, lightningAddress: null, sats: 0, joints: 0, totalJointsEarned: 0, isNewAccount: false });
    // Force page reload to reset all in-memory state
    window.location.reload();
  }, []);

  const setSats = useCallback((sats: number) => {
    setState(s => { const next = { ...s, sats }; saveAuth(next); return next; });
  }, []);

  const setJoints = useCallback((joints: number) => {
    setState(s => { const next = { ...s, joints }; saveAuth(next); return next; });
  }, []);

  const setTotalJointsEarned = useCallback((totalJointsEarned: number) => {
    setState(s => { const next = { ...s, totalJointsEarned }; saveAuth(next); return next; });
  }, []);

  const setProfile = useCallback((displayName: string | null, lightningAddress: string | null) => {
    setState(s => { const next = { ...s, displayName, lightningAddress }; saveAuth(next); return next; });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, setSats, setJoints, setTotalJointsEarned, setProfile, isLoggedIn: !!state.token }}>
      {children}
    </AuthContext.Provider>
  );
}
