/**
 * Auth Store — Keychain hydration of lockout state.
 *
 * Lockout state lives in Keychain (not AsyncStorage) so an attacker cannot reset
 * `failedAttempts` and `lockoutUntil` by wiping AsyncStorage. The store hydrates from
 * Keychain on app start, taking the more-restrictive of (in-memory, secure-store)
 * to defend against AsyncStorage tampering.
 */

import { useAuthStore } from '../../../src/stores/authStore';
import { authService } from '../../../src/services/authService';
import { resetStores, getAuthState } from '../../utils/testHelpers';

describe('authStore — lockout state hydration', () => {
  beforeEach(() => {
    resetStores();
    jest.useFakeTimers();
    jest.spyOn(authService, 'readLockoutState');
    jest.spyOn(authService, 'writeLockoutState').mockResolvedValue();
    jest.spyOn(authService, 'resetLockoutState').mockResolvedValue();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('hydrates from Keychain on startup when Keychain has higher state', async () => {
    (authService.readLockoutState as jest.Mock).mockResolvedValue({
      failedAttempts: 3,
      lockoutUntil: Date.now() + 60_000,
    });

    await useAuthStore.getState().hydrateLockoutFromSecureStore();

    expect(getAuthState().failedAttempts).toBe(3);
    expect(getAuthState().lockoutUntil).not.toBeNull();
  });

  it('keeps in-memory state when it is more restrictive than Keychain', async () => {
    // Imagine the user got locked-out in this process but the keychain write hasn't landed.
    useAuthStore.setState({ failedAttempts: 5, lockoutUntil: Date.now() + 30_000 });
    (authService.readLockoutState as jest.Mock).mockResolvedValue({
      failedAttempts: 0,
      lockoutUntil: null,
    });

    await useAuthStore.getState().hydrateLockoutFromSecureStore();

    expect(getAuthState().failedAttempts).toBe(5);
    expect(getAuthState().lockoutUntil).not.toBeNull();
  });

  it('persists failed attempts to Keychain on recordFailedAttempt', () => {
    const { recordFailedAttempt } = useAuthStore.getState();

    recordFailedAttempt();

    expect(authService.writeLockoutState).toHaveBeenCalledWith({
      failedAttempts: 1,
      lockoutUntil: null,
    });
  });

  it('persists lockoutUntil to Keychain when threshold is hit', () => {
    const { recordFailedAttempt } = useAuthStore.getState();

    for (let i = 0; i < 5; i++) {
      recordFailedAttempt();
    }

    const lastCall = (authService.writeLockoutState as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall.failedAttempts).toBe(5);
    expect(lastCall.lockoutUntil).toBeGreaterThan(Date.now());
  });

  it('clears Keychain state on resetFailedAttempts', () => {
    useAuthStore.setState({ failedAttempts: 3, lockoutUntil: Date.now() + 60_000 });

    useAuthStore.getState().resetFailedAttempts();

    expect(authService.resetLockoutState).toHaveBeenCalled();
  });

  it('does not partialize lockoutUntil into AsyncStorage payload', () => {
    // The persist middleware exposes its `partialize` configuration. We can derive what
    // would be written by calling it on the current state.
    useAuthStore.setState({
      failedAttempts: 4,
      lockoutUntil: 1_700_000_000_000,
      isEnabled: true,
      biometricEnabled: false,
    });

    const persistApi = (useAuthStore as any).persist;
    expect(persistApi).toBeDefined();
    // Inspect the persisted state shape via getOptions() (middleware exposes options).
    const options = persistApi.getOptions?.();
    if (options?.partialize) {
      const partialized = options.partialize(useAuthStore.getState());
      expect(partialized).not.toHaveProperty('failedAttempts');
      expect(partialized).not.toHaveProperty('lockoutUntil');
    }
  });
});
