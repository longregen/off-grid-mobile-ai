import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authService } from '../services/authService';

interface AuthState {
  isEnabled: boolean;
  isLocked: boolean;
  failedAttempts: number;
  lockoutUntil: number | null;
  lastBackgroundTime: number | null;
  biometricEnabled: boolean;

  // Actions
  setEnabled: (enabled: boolean) => void;
  setLocked: (locked: boolean) => void;
  recordFailedAttempt: () => boolean; // Returns true if lockout triggered
  resetFailedAttempts: () => void;
  setLastBackgroundTime: (time: number | null) => void;
  checkLockout: () => boolean; // Returns true if currently locked out
  getLockoutRemaining: () => number; // Returns seconds remaining
  setBiometricEnabled: (enabled: boolean) => void;
  /** Hydrate in-memory lockout from Keychain on app start. */
  hydrateLockoutFromSecureStore: () => Promise<void>;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Mirror lockout state to Keychain. Fire-and-forget — failures must not block auth flow,
 * but persisting here means an attacker who clears AsyncStorage can't reset failed attempts.
 */
function persistLockoutToSecureStore(failedAttempts: number, lockoutUntil: number | null): void {
  if (failedAttempts === 0 && lockoutUntil === null) {
    authService.resetLockoutState().catch(() => { /* best-effort */ });
    return;
  }
  authService.writeLockoutState({ failedAttempts, lockoutUntil }).catch(() => { /* best-effort */ });
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isEnabled: false,
      isLocked: true, // Always start locked if enabled
      failedAttempts: 0,
      lockoutUntil: null,
      lastBackgroundTime: null,
      biometricEnabled: false,

      setEnabled: (enabled) => {
        set({ isEnabled: enabled, isLocked: enabled });
      },

      setLocked: (locked) => {
        set({ isLocked: locked });
      },

      recordFailedAttempt: () => {
        const { failedAttempts } = get();
        const newAttempts = failedAttempts + 1;

        if (newAttempts >= MAX_FAILED_ATTEMPTS) {
          const lockoutUntil = Date.now() + LOCKOUT_DURATION;
          set({
            failedAttempts: newAttempts,
            lockoutUntil,
          });
          persistLockoutToSecureStore(newAttempts, lockoutUntil);
          return true;
        }

        set({ failedAttempts: newAttempts });
        persistLockoutToSecureStore(newAttempts, null);
        return false;
      },

      resetFailedAttempts: () => {
        set({ failedAttempts: 0, lockoutUntil: null });
        persistLockoutToSecureStore(0, null);
      },

      setLastBackgroundTime: (time) => {
        set({ lastBackgroundTime: time });
      },

      checkLockout: () => {
        const { lockoutUntil } = get();
        if (!lockoutUntil) return false;

        if (Date.now() >= lockoutUntil) {
          set({ lockoutUntil: null, failedAttempts: 0 });
          persistLockoutToSecureStore(0, null);
          return false;
        }

        return true;
      },

      getLockoutRemaining: () => {
        const { lockoutUntil } = get();
        if (!lockoutUntil) return 0;

        const remaining = Math.max(0, lockoutUntil - Date.now());
        return Math.ceil(remaining / 1000);
      },

      setBiometricEnabled: (enabled) => {
        set({ biometricEnabled: enabled });
      },

      hydrateLockoutFromSecureStore: async () => {
        const persisted = await authService.readLockoutState();
        // Take the more restrictive of (in-memory, secure-store) so an attacker can't
        // clear AsyncStorage to escape an active lockout.
        const current = get();
        const failedAttempts = Math.max(current.failedAttempts, persisted.failedAttempts);
        const lockoutUntil = Math.max(current.lockoutUntil ?? 0, persisted.lockoutUntil ?? 0) || null;
        set({ failedAttempts, lockoutUntil });
      },
    }),
    {
      name: 'local-llm-auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        // Lockout state is intentionally NOT persisted to AsyncStorage anymore — it lives in
        // Keychain so it cannot be cleared via `adb shell pm clear` or AsyncStorage wipes.
        // Hydration from Keychain happens on app start via hydrateLockoutFromSecureStore().
        isEnabled: state.isEnabled,
        biometricEnabled: state.biometricEnabled,
      }),
    }
  )
);
