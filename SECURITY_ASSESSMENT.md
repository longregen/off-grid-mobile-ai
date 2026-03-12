# Security & Privacy Assessment — Off Grid Mobile AI

**Date:** 2026-03-12
**Scope:** Full codebase review including supply chain, authentication, data handling, network security, input validation, and mobile-specific concerns.

---

## Executive Summary

Off Grid Mobile AI is a React Native mobile application for running LLM inference locally on-device (via `llama.rn`) with optional connectivity to remote OpenAI-compatible servers. The app's privacy-first architecture — local-first AI with no mandatory cloud dependency — is a strong foundation. However, several findings across authentication, network security, and dependency management warrant attention.

**Overall Risk Rating: MODERATE**

| Category | Severity | Findings |
|---|---|---|
| Authentication / Passphrase Hashing | **CRITICAL** | Custom hash function is cryptographically weak |
| Supply Chain / Dependencies | **MODERATE** | Large dependency surface; `sonar-scanner` package is abandoned |
| Network Security (Remote Servers) | **MODERATE** | HTTP allowed for local servers; no certificate pinning |
| Data Storage / Privacy | **LOW** | Conversations stored unencrypted in AsyncStorage |
| Input Validation | **LOW** | SSRF protections present but incomplete |
| Mobile Platform Security | **LOW** | Reasonable permissions; backup disabled on Android |

---

## 1. CRITICAL — Cryptographically Weak Passphrase Hashing

**File:** `src/services/authService.ts:8-29`

The `hashPassphrase()` method uses a custom JavaScript hash function (DJB2 variant with 1000 iterations) instead of a proper cryptographic hash. This is **not suitable for protecting passphrases**.

```typescript
// Current implementation - weak custom hash
let hash = 0;
for (let i = 0; i < passphrase.length; i++) {
  const char = passphrase.codePointAt(i) ?? 0;
  hash = ((hash << 5) - hash) + char;
  hash = hash & hash;
}
```

**Issues:**
- 32-bit hash space — trivially brutable (~4 billion values)
- No salt — identical passphrases produce identical hashes
- Deterministic — enables rainbow table attacks
- The "1000 iterations" do not add meaningful security since each iteration still operates on the same weak hash

**Recommendation:** Use `react-native-keychain`'s biometric authentication, or integrate a native bcrypt/Argon2 module. The comment on line 9 acknowledges this: `"in production, consider using bcrypt via native module"`.

---

## 2. MODERATE — Supply Chain & Dependency Risks

### 2.1 Dependency Surface Analysis

The project has **40 production dependencies** and **15 dev dependencies**. Key observations:

| Dependency | Risk | Notes |
|---|---|---|
| `sonar-scanner@^3.1.0` | **HIGH** | Last published 2019, deprecated, potential for dependency confusion or takeover |
| `llama.rn@^0.11.2` | **MODERATE** | Native C++ module with JNI bridge — binary payloads in build |
| `whisper.rn@^0.5.5` | **MODERATE** | Native C++ module — same binary payload concerns |
| `@op-engineering/op-sqlite@^15.2.5` | **MODERATE** | Native SQLite module — binary payload |
| `patch-package@^8.0.1` | **LOW** | Used in `postinstall`, but the single patch file is benign (updates build SDK versions for `@react-native-voice/voice`) |

### 2.2 Postinstall Script

```json
"postinstall": "patch-package"
```

The `postinstall` hook runs `patch-package`, which applies patches from `patches/`. The only patch (`@react-native-voice+voice+3.2.4.patch`) is a legitimate build configuration update (SDK version bump, removing deprecated `jcenter()` repository). **No security concern.**

### 2.3 `sonar-scanner` — Abandoned Package

`sonar-scanner@^3.1.0` (devDependency) was last published in 2019 and has been abandoned. Abandoned npm packages carry risk of:
- Account takeover → malicious code injection
- Unpinned transitive dependency vulnerabilities

**Recommendation:** Replace with `sonarqube-scanner` (actively maintained) or use the SonarCloud GitHub Action directly.

### 2.4 No Lockfile Integrity Auditing

There is no evidence of `npm audit` being run in CI. The `package-lock.json` should be periodically audited for known vulnerabilities.

### 2.5 Native Module Binaries

`llama.rn`, `whisper.rn`, and `op-sqlite` include native C/C++ code compiled during build. These are well-known open-source projects, but the binary compilation step means the app's security depends on the integrity of their build toolchains.

---

## 3. MODERATE — Network Security

### 3.1 Cleartext HTTP for Local Network Servers

**File:** `android/app/src/main/res/xml/network_security_config.xml`

```xml
<domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">10.0.2.2</domain>
</domain-config>
```

This is reasonable for development (Metro bundler) and local LLM servers. However, `isPrivateNetworkEndpoint()` in `httpClient.ts:461-511` allows connections to a much wider range of private IPs (10.x.x.x, 172.16-31.x.x, 192.168.x.x, .local domains), while the Android network security config only allows cleartext for 3 specific hosts. This mismatch means:
- On Android: connections to LAN servers (e.g., `192.168.1.100`) over HTTP will be blocked by the platform (good)
- On iOS: No App Transport Security exceptions are defined, so HTTP will also be blocked by default (good)
- The `isPrivateNetworkEndpoint()` function doesn't restrict connections to private networks — it merely *detects* them; remote public endpoints are also accepted

**Issue:** API keys are sent to remote servers via `Authorization: Bearer` header (`openAICompatibleProvider.ts:173-174`). If a user configures a remote server endpoint without HTTPS, the API key would be transmitted in cleartext.

**Recommendation:** Warn users or enforce HTTPS when configuring remote server endpoints that are not on the local network.

### 3.2 No Certificate Pinning

No certificate pinning is implemented for connections to HuggingFace (model downloads) or remote LLM servers. While not always necessary for mobile apps, model downloads from HuggingFace could be MITM'd on compromised networks to serve malicious model files.

### 3.3 User-Agent Spoofing in Tool Handlers

**File:** `src/services/tools/handlers.ts:62-64, 321-322`

The `web_search` and `read_url` tools use spoofed User-Agent strings (Chrome/Safari) to fetch external content. While functional, this impersonates a browser and may violate terms of service.

---

## 4. LOW — Data Storage & Privacy

### 4.1 Conversations Stored in AsyncStorage (Unencrypted)

**Files:** `src/stores/chatStore.ts`, `src/stores/appStore.ts`, `src/stores/authStore.ts`

All conversation history, app settings, and auth state (lockout timers, failed attempts) are persisted via Zustand's `persist` middleware with `AsyncStorage`:

```typescript
persist(..., {
  name: 'local-llm-chat-storage',
  storage: createJSONStorage(() => AsyncStorage),
})
```

`AsyncStorage` on Android stores data in an unencrypted SQLite database. On iOS, it uses `NSUserDefaults` (also unencrypted). This means:
- Full conversation history is accessible to anyone with physical device access (or device backup)
- The auth lockout state (failed attempts, lockout timestamp) is stored in `AsyncStorage` — an attacker could clear this to bypass lockout

**Positive:** API keys for remote servers *are* stored securely via `react-native-keychain` (`remoteServerManager.ts:321-335`), using `ACCESSIBLE.WHEN_UNLOCKED`. The passphrase hash is also stored in Keychain. This is the correct approach.

**Recommendation:** Consider encrypting conversation data at rest, especially if the passphrase feature is enabled. Use `react-native-encrypted-storage` or encrypt before writing to `AsyncStorage`.

### 4.2 Auth Lockout Bypass

**File:** `src/stores/authStore.ts:87-95`

The lockout state (`failedAttempts`, `lockoutUntil`) is persisted in `AsyncStorage`. An attacker with USB debugging access could clear the `local-llm-auth-storage` key to reset lockout state and continue brute-forcing the passphrase. Combined with the weak hash (Finding #1), this significantly reduces the auth protection.

### 4.3 RAG Database Unencrypted

**File:** `src/services/rag/database.ts`

The RAG knowledge base uses `op-sqlite` with an unencrypted database (`rag.db`). Documents ingested into the knowledge base (potentially containing sensitive content) are stored as plaintext.

### 4.4 Privacy-Positive Design

- **No analytics/telemetry**: No Sentry, Firebase Analytics, Crashlytics, or any third-party analytics SDK detected
- **No external data collection**: The app does not send user data to any central server
- **Local-first AI**: LLM inference runs on-device by default
- **Production logging disabled**: The logger (`src/utils/logger.ts`) suppresses all output in production builds (`__DEV__` guard)
- **Minimal permissions**: Only INTERNET, RECORD_AUDIO, VIBRATE, and storage (for model downloads) are requested

---

## 5. LOW — Input Validation & Injection

### 5.1 SSRF Protection — Good but Incomplete

**File:** `src/services/tools/handlers.ts:299-305`

The `read_url` tool includes SSRF protection via `isPrivateUrl()`:

```typescript
function isPrivateUrl(url: string): boolean {
  const h = m[1].toLowerCase();
  return h === 'localhost' || h === '[::1]' || h === 'metadata.google.internal'
    || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(h);
}
```

**Gaps:**
- Does not block `0.0.0.0` (binds to all interfaces, but some systems resolve it)
- Does not handle DNS rebinding attacks (hostname resolves to private IP after check)
- Does not block IPv6 private ranges (e.g., `fc00::/7`, `fe80::/10`) beyond `[::1]`
- Does not block AWS/GCP/Azure metadata endpoints beyond `metadata.google.internal` (e.g., `169.254.169.254` is covered by regex, but `metadata.aws` is not)

### 5.2 Calculator — Safe Implementation

**File:** `src/services/tools/handlers.ts:160-219`

The calculator tool uses a recursive descent parser instead of `eval()`. This is a secure approach. The input is also validated against an allowlist regex: `^[0-9+\-*/().,%^]+$`.

### 5.3 SQL Injection — Protected

**File:** `src/services/rag/database.ts`

All SQL queries use parameterized statements (`?` placeholders). No string interpolation in SQL queries was found. This is correct.

### 5.4 No eval() or Dynamic Code Execution

No instances of `eval()`, `new Function()`, or `dangerouslySetInnerHTML` were found in the codebase. No WebView usage was detected.

---

## 6. LOW — Mobile Platform Security

### 6.1 Android Configuration — Good

- `android:allowBackup="false"` — prevents ADB backup of app data
- Network security config enforces HTTPS by default
- Appropriate permission scoping (e.g., `WRITE_EXTERNAL_STORAGE` maxSdkVersion=28)
- `exported="true"` on `DownloadCompleteBroadcastReceiver` is required for system broadcast but should be verified that it doesn't expose sensitive data

### 6.2 iOS Configuration — Good

- Appropriate permission descriptions for microphone, photo library, and speech recognition
- No ATS exceptions (all connections require HTTPS by default)
- arm64 required (no 32-bit support)

### 6.3 Debug Keystore in .gitignore

`.gitignore` excludes `*.keystore` but explicitly includes `!debug.keystore`. This is standard React Native practice but worth noting — the debug keystore should never be used for release builds.

### 6.4 Console Logging in DocumentService

**File:** `src/services/documentService.ts`

Unlike the rest of the codebase (which uses the `__DEV__`-guarded `logger`), `documentService.ts` uses raw `console.log` and `console.error` calls (lines 54, 64-65, 78, 89, 96, 100, 119, 125, 131, 155-156, 159, 163, 169, 172). These will execute in production and could leak file paths and document metadata to the system log.

---

## 7. Informational — Additional Observations

### 7.1 Model Download Integrity

Model files downloaded from HuggingFace are not verified against checksums or signatures. A MITM attack on the download could substitute a malicious model file. HuggingFace provides SHA256 hashes for files — these should be verified after download.

### 7.2 Patch File Review

The single patch (`patches/@react-native-voice+voice+3.2.4.patch`) is a benign build configuration update:
- Updates compile SDK from 28 to 34
- Updates min SDK from 15 to 24
- Replaces deprecated `jcenter()` with `mavenCentral()` and `google()`
- Removes deprecated build tooling

No code modifications or backdoors.

### 7.3 Brave Search Scraping

The `web_search` tool (`handlers.ts:53-83`) scrapes Brave Search HTML results rather than using an API. This is fragile and could break with HTML changes. It also potentially violates Brave's ToS.

---

## Prioritized Recommendations

| Priority | Action | Effort |
|---|---|---|
| **P0** | Replace custom passphrase hash with bcrypt/Argon2 native module or use biometric auth via Keychain | Medium |
| **P1** | Replace abandoned `sonar-scanner` devDependency | Low |
| **P1** | Add HTTPS enforcement/warning for remote server endpoints | Low |
| **P1** | Replace `console.log` with `logger` in `documentService.ts` | Low |
| **P2** | Store auth lockout state in Keychain instead of AsyncStorage | Low |
| **P2** | Add `npm audit` to CI pipeline | Low |
| **P2** | Verify model file checksums after download from HuggingFace | Medium |
| **P3** | Encrypt conversation data at rest when passphrase is enabled | Medium |
| **P3** | Add DNS rebinding protection to SSRF checks | Low |
| **P3** | Add certificate pinning for HuggingFace downloads | Medium |
