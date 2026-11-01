import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  db,
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  handleFirestoreError,
  inspectFirestoreError,
  OperationType,
} from '../firebase';
import { AccountSession } from '../types';
import {
  apiGetAccount,
  apiRegisterAccount,
  CloudRelayError,
} from './cloudApiClient';

export const ACCOUNT_SESSION_STORAGE_KEY = 'atdcolor_account_session_v1';
const VERIFIED_ACCOUNTS_CACHE_KEY = 'atdcolor_verified_accounts_v1';

// Exact schema boundaries synchronized with firebase-blueprint.json & firestore.rules
const USERNAME_KEY_PATTERN = /^[a-z0-9_-]+$/;
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 40;
const MAX_DISPLAY_NAME_LEN = 80;
const MIN_PASSWORD_LEN = 4;
const MAX_PASSWORD_LEN = 128;
const WORKSPACE_ID_PATTERN = /^ws_[a-f0-9]{64}$/;
const PBKDF2_ITERATIONS = 100_000;

export type AccountAuthErrorCode =
  | 'VALIDATION'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_EXISTS'
  | 'WRONG_PASSWORD'
  | 'QUOTA_EXCEEDED'
  | 'OFFLINE';

export class AccountAuthError extends Error {
  readonly code: AccountAuthErrorCode;
  readonly upgradeUrl?: string;

  constructor(
    message: string,
    code: AccountAuthErrorCode = 'VALIDATION',
    upgradeUrl?: string
  ) {
    super(message);
    this.name = 'AccountAuthError';
    this.code = code;
    this.upgradeUrl = upgradeUrl;
  }
}

interface CachedVerifiedAccount {
  usernameKey: string;
  displayName: string;
  verifierHash: string;
  verifiedAt: string;
}

function loadCachedVerifiedAccount(
  usernameKey: string
): CachedVerifiedAccount | null {
  try {
    const raw = localStorage.getItem(VERIFIED_ACCOUNTS_CACHE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, CachedVerifiedAccount>;
    const entry = map?.[usernameKey];
    if (
      entry &&
      entry.usernameKey === usernameKey &&
      typeof entry.verifierHash === 'string' &&
      entry.verifierHash.length === 64
    ) {
      return entry;
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

function saveCachedVerifiedAccount(entry: CachedVerifiedAccount): void {
  try {
    const raw = localStorage.getItem(VERIFIED_ACCOUNTS_CACHE_KEY);
    const map: Record<string, CachedVerifiedAccount> = raw
      ? (JSON.parse(raw) as Record<string, CachedVerifiedAccount>)
      : {};
    map[entry.usernameKey] = entry;
    localStorage.setItem(VERIFIED_ACCOUNTS_CACHE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

function withPromiseTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('Request timeout: the client is offline'));
    }, ms);
    promise
      .then((val) => {
        window.clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        window.clearTimeout(timer);
        reject(err);
      });
  });
}

export function normalizeUsernameKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9_-]/g, '');
}

export function validateUsernameInput(raw: string): string | null {
  const normalized = normalizeUsernameKey(raw);
  if (!normalized || normalized.length < MIN_USERNAME_LEN) {
    return `Tên tài khoản cần có ít nhất ${MIN_USERNAME_LEN} ký tự (chữ cái không dấu, số, _ hoặc -).`;
  }
  if (normalized.length > MAX_USERNAME_LEN) {
    return `Tên tài khoản tối đa ${MAX_USERNAME_LEN} ký tự.`;
  }
  if (!USERNAME_KEY_PATTERN.test(normalized)) {
    return 'Tên tài khoản chỉ gồm chữ cái thường không dấu, chữ số, dấu gạch dưới (_) hoặc gạch ngang (-).';
  }
  return null;
}

export function validatePasswordInput(password: string): string | null {
  if (!password || password.length < MIN_PASSWORD_LEN) {
    return `Mật khẩu cần có ít nhất ${MIN_PASSWORD_LEN} ký tự.`;
  }
  if (password.length > MAX_PASSWORD_LEN) {
    return `Mật khẩu tối đa ${MAX_PASSWORD_LEN} ký tự.`;
  }
  return null;
}

// --- Pure-TS FIPS 180-4 SHA-256 + RFC 2104 HMAC + RFC 2898 PBKDF2 Fallback ---
// Guarantees byte-for-byte identical output even in restricted non-HTTPS mobile webviews.

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Bytes(data: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const bitLen = data.length * 8;
  const padLen = (data.length + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(data);
  padded[data.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padLen - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const v15 = w[i - 15];
      const s0 =
        ((v15 >>> 7) | (v15 << 25)) ^
        ((v15 >>> 18) | (v15 << 14)) ^
        (v15 >>> 3);
      const v2 = w[i - 2];
      const s1 =
        ((v2 >>> 17) | (v2 << 15)) ^
        ((v2 >>> 19) | (v2 << 13)) ^
        (v2 >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 =
        ((e >>> 6) | (e << 26)) ^
        ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 =
        ((a >>> 2) | (a << 30)) ^
        ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

function pbkdf2Sha256SingleBlockFallback(
  passwordBytes: Uint8Array,
  saltBytes: Uint8Array,
  iterations: number
): Uint8Array {
  const keyBlock = new Uint8Array(64);
  if (passwordBytes.length > 64) {
    keyBlock.set(sha256Bytes(passwordBytes));
  } else {
    keyBlock.set(passwordBytes);
  }

  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    ipad[i] = keyBlock[i] ^ 0x36;
    opad[i] = keyBlock[i] ^ 0x5c;
  }

  const hmac = (msg: Uint8Array): Uint8Array => {
    const inner = new Uint8Array(64 + msg.length);
    inner.set(ipad, 0);
    inner.set(msg, 64);
    const innerDigest = sha256Bytes(inner);

    const outer = new Uint8Array(64 + 32);
    outer.set(opad, 0);
    outer.set(innerDigest, 64);
    return sha256Bytes(outer);
  };

  const saltAndBlock = new Uint8Array(saltBytes.length + 4);
  saltAndBlock.set(saltBytes, 0);
  saltAndBlock[saltBytes.length + 3] = 1;

  let u = hmac(saltAndBlock);
  const dk = new Uint8Array(u);

  for (let iter = 1; iter < iterations; iter++) {
    u = hmac(u);
    for (let j = 0; j < 32; j++) {
      dk[j] ^= u[j];
    }
  }
  return dk;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function pbkdf2Hex256(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const pwBytes = encoder.encode(password);
  const saltBytes = encoder.encode(salt);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const baseKey = await crypto.subtle.importKey(
        'raw',
        pwBytes,
        'PBKDF2',
        false,
        ['deriveBits']
      );
      const bits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: saltBytes,
          iterations: PBKDF2_ITERATIONS,
          hash: 'SHA-256',
        },
        baseKey,
        256
      );
      return bytesToHex(new Uint8Array(bits));
    } catch {
      // Fallback to pure-TS implementation
    }
  }

  return bytesToHex(
    pbkdf2Sha256SingleBlockFallback(pwBytes, saltBytes, PBKDF2_ITERATIONS)
  );
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function deriveAccountSecrets(
  usernameKey: string,
  password: string
): Promise<{ verifierHash: string; workspaceId: string }> {
  const [verifierHash, workspaceCapHex] = await Promise.all([
    pbkdf2Hex256(password, `atdcolor-auth-verifier-v1:${usernameKey}`),
    pbkdf2Hex256(password, `atdcolor-workspace-cap-v1:${usernameKey}`),
  ]);
  return {
    verifierHash,
    workspaceId: `ws_${workspaceCapHex}`,
  };
}

function parseSessionRaw(raw: string | null): AccountSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AccountSession>;
    if (
      typeof parsed.usernameKey === 'string' &&
      USERNAME_KEY_PATTERN.test(parsed.usernameKey) &&
      parsed.usernameKey.length >= MIN_USERNAME_LEN &&
      parsed.usernameKey.length <= MAX_USERNAME_LEN &&
      typeof parsed.workspaceId === 'string' &&
      WORKSPACE_ID_PATTERN.test(parsed.workspaceId)
    ) {
      return {
        usernameKey: parsed.usernameKey,
        displayName:
          typeof parsed.displayName === 'string' && parsed.displayName.trim()
            ? parsed.displayName.trim().slice(0, MAX_DISPLAY_NAME_LEN)
            : parsed.usernameKey,
        workspaceId: parsed.workspaceId,
        loggedInAt:
          typeof parsed.loggedInAt === 'string'
            ? parsed.loggedInAt
            : new Date().toISOString(),
      };
    }
  } catch {
    // Ignore malformed stored session
  }
  return null;
}

export function loadSavedAccountSession(): AccountSession | null {
  try {
    const fromLocal = parseSessionRaw(
      localStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY)
    );
    if (fromLocal) return fromLocal;
  } catch {
    // Ignore restricted storage
  }
  try {
    const fromSession = parseSessionRaw(
      sessionStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY)
    );
    if (fromSession) return fromSession;
  } catch {
    // Ignore restricted storage
  }
  return null;
}

export function persistAccountSession(
  session: AccountSession,
  rememberMe: boolean
): void {
  const serialized = JSON.stringify(session);
  try {
    if (rememberMe) {
      localStorage.setItem(ACCOUNT_SESSION_STORAGE_KEY, serialized);
      sessionStorage.removeItem(ACCOUNT_SESSION_STORAGE_KEY);
    } else {
      sessionStorage.setItem(ACCOUNT_SESSION_STORAGE_KEY, serialized);
      localStorage.removeItem(ACCOUNT_SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota / privacy restrictions
  }
}

export function clearAccountSession(): void {
  try {
    localStorage.removeItem(ACCOUNT_SESSION_STORAGE_KEY);
  } catch {
    // Ignore
  }
  try {
    sessionStorage.removeItem(ACCOUNT_SESSION_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

function buildQuotaAuthError(isDailyRead: boolean, projectId?: string, dbId?: string): AccountAuthError {
  const pId = projectId || FIREBASE_PROJECT_ID;
  const dId = dbId || FIRESTORE_DATABASE_ID;
  const upgradeUrl = isDailyRead
    ? `https://console.firebase.google.com/project/${pId}/firestore/databases/${dId}/data?openUpgradeDialog=true`
    : undefined;
  return new AccountAuthError(
    'Đã chạm hạn mức đọc/ghi miễn phí trong ngày của đám mây (sẽ tự làm mới vào ngày mai).',
    'QUOTA_EXCEEDED',
    upgradeUrl
  );
}

export async function registerAccount(params: {
  rawUsername: string;
  displayName?: string;
  password: string;
  rememberMe: boolean;
}): Promise<AccountSession> {
  const usernameErr = validateUsernameInput(params.rawUsername);
  if (usernameErr) {
    throw new AccountAuthError(usernameErr, 'VALIDATION');
  }
  const passwordErr = validatePasswordInput(params.password);
  if (passwordErr) {
    throw new AccountAuthError(passwordErr, 'VALIDATION');
  }

  const usernameKey = normalizeUsernameKey(params.rawUsername);
  const resolvedDisplayName = (
    params.displayName?.trim() ||
    params.rawUsername.trim() ||
    usernameKey
  ).slice(0, MAX_DISPLAY_NAME_LEN);

  const { verifierHash, workspaceId } = await deriveAccountSecrets(
    usernameKey,
    params.password
  );

  // 1. Primary Path: Same-Origin Express Server Relay (/api/cloud/accounts) -> Firestore gRPC
  let relayUnreachable = false;
  try {
    await apiRegisterAccount({
      usernameKey,
      displayName: resolvedDisplayName,
      verifierHash,
    });
  } catch (err) {
    if (err instanceof CloudRelayError) {
      if (err.code === 'ACCOUNT_EXISTS') {
        throw new AccountAuthError(
          `Tài khoản "${usernameKey}" đã được tạo trước đó. Nếu là tài khoản của bạn, vui lòng chọn Đăng nhập; hoặc đặt tên tài khoản khác.`,
          'ACCOUNT_EXISTS'
        );
      }
      if (err.code === 'QUOTA_DAILY_READS' || err.code === 'QUOTA_EXCEEDED') {
        throw buildQuotaAuthError(
          err.code === 'QUOTA_DAILY_READS',
          err.projectId,
          err.databaseId
        );
      }
      if (
        err.code === 'NETWORK_UNREACHABLE' ||
        err.code === 'RELAY_NOT_JSON' ||
        err.code === 'FIRESTORE_UNAVAILABLE'
      ) {
        relayUnreachable = true;
      } else {
        throw new AccountAuthError(err.message, 'VALIDATION');
      }
    } else {
      relayUnreachable = true;
    }
  }

  // 2. Fallback Path: Direct Client Firestore (with auto long-polling + strict timeout)
  if (relayUnreachable) {
    const accountPath = `accounts/${usernameKey}`;
    const accountRef = doc(db, 'accounts', usernameKey);

    let alreadyExists = false;
    try {
      const existingSnap = await withPromiseTimeout(getDoc(accountRef), 7000);
      alreadyExists = existingSnap.exists();
    } catch (error) {
      const info = inspectFirestoreError(error);
      if (info.isQuotaExceeded) {
        throw buildQuotaAuthError(info.isDailyReadQuota);
      }
      if (info.isOfflineOrNetwork) {
        throw new AccountAuthError(
          'Thiết bị đang mất kết nối mạng hoặc trình duyệt chặn kết nối đám mây. Vui lòng kiểm tra Wi-Fi/4G và bấm thử lại.',
          'OFFLINE'
        );
      }
      handleFirestoreError(error, OperationType.GET, accountPath);
    }

    if (alreadyExists) {
      throw new AccountAuthError(
        `Tài khoản "${usernameKey}" đã được tạo trước đó. Nếu là tài khoản của bạn, vui lòng chọn Đăng nhập; hoặc đặt tên tài khoản khác.`,
        'ACCOUNT_EXISTS'
      );
    }

    try {
      await withPromiseTimeout(
        setDoc(accountRef, {
          usernameKey,
          displayName: resolvedDisplayName,
          verifierHash,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
        7500
      );
    } catch (error) {
      const info = inspectFirestoreError(error);
      if (info.isQuotaExceeded) {
        throw buildQuotaAuthError(info.isDailyReadQuota);
      }
      if (info.isOfflineOrNetwork) {
        throw new AccountAuthError(
          'Thiết bị đang mất kết nối mạng khi lưu tài khoản. Vui lòng kiểm tra Wi-Fi/4G và thử lại.',
          'OFFLINE'
        );
      }
      handleFirestoreError(error, OperationType.CREATE, accountPath);
    }
  }

  saveCachedVerifiedAccount({
    usernameKey,
    displayName: resolvedDisplayName,
    verifierHash,
    verifiedAt: new Date().toISOString(),
  });

  const session: AccountSession = {
    usernameKey,
    displayName: resolvedDisplayName,
    workspaceId,
    loggedInAt: new Date().toISOString(),
  };
  persistAccountSession(session, params.rememberMe);
  return session;
}

export async function loginAccount(params: {
  rawUsername: string;
  password: string;
  rememberMe: boolean;
}): Promise<AccountSession> {
  const usernameErr = validateUsernameInput(params.rawUsername);
  if (usernameErr) {
    throw new AccountAuthError(usernameErr, 'VALIDATION');
  }
  const passwordErr = validatePasswordInput(params.password);
  if (passwordErr) {
    throw new AccountAuthError(passwordErr, 'VALIDATION');
  }

  const usernameKey = normalizeUsernameKey(params.rawUsername);
  const { verifierHash, workspaceId } = await deriveAccountSecrets(
    usernameKey,
    params.password
  );

  let serverVerifierHash = '';
  let serverDisplayName = usernameKey;
  let accountFound = false;
  let relayUnreachable = false;

  // 1. Primary Path: Same-Origin Express Server Relay (/api/cloud/accounts/:usernameKey)
  try {
    const res = await apiGetAccount(usernameKey);
    if (res.exists && res.account) {
      accountFound = true;
      serverVerifierHash = res.account.verifierHash;
      if (res.account.displayName.trim()) {
        serverDisplayName = res.account.displayName
          .trim()
          .slice(0, MAX_DISPLAY_NAME_LEN);
      }
    }
  } catch (err) {
    if (err instanceof CloudRelayError) {
      if (err.code === 'QUOTA_DAILY_READS' || err.code === 'QUOTA_EXCEEDED') {
        // Check local verified cache before failing on quota!
        const cached = loadCachedVerifiedAccount(usernameKey);
        if (cached && constantTimeEqual(cached.verifierHash, verifierHash)) {
          const offlineSession: AccountSession = {
            usernameKey,
            displayName: cached.displayName,
            workspaceId,
            loggedInAt: new Date().toISOString(),
          };
          persistAccountSession(offlineSession, params.rememberMe);
          return offlineSession;
        }
        throw buildQuotaAuthError(
          err.code === 'QUOTA_DAILY_READS',
          err.projectId,
          err.databaseId
        );
      }
      relayUnreachable = true;
    } else {
      relayUnreachable = true;
    }
  }

  // 2. Fallback Path: Direct Client Firestore (with auto long-polling + strict timeout)
  if (relayUnreachable) {
    const accountPath = `accounts/${usernameKey}`;
    const accountRef = doc(db, 'accounts', usernameKey);

    try {
      const snap = await withPromiseTimeout(getDoc(accountRef), 7000);
      if (snap.exists()) {
        accountFound = true;
        const data = snap.data();
        serverVerifierHash = String(data.verifierHash || '');
        if (typeof data.displayName === 'string' && data.displayName.trim()) {
          serverDisplayName = data.displayName
            .trim()
            .slice(0, MAX_DISPLAY_NAME_LEN);
        }
      }
    } catch (error) {
      // 3. Offline Resilience: Allow returning verified account on this device when temporarily offline
      const cached = loadCachedVerifiedAccount(usernameKey);
      if (cached && constantTimeEqual(cached.verifierHash, verifierHash)) {
        const offlineSession: AccountSession = {
          usernameKey,
          displayName: cached.displayName,
          workspaceId,
          loggedInAt: new Date().toISOString(),
        };
        persistAccountSession(offlineSession, params.rememberMe);
        return offlineSession;
      }

      const info = inspectFirestoreError(error);
      if (info.isQuotaExceeded) {
        throw buildQuotaAuthError(info.isDailyReadQuota);
      }
      if (info.isOfflineOrNetwork) {
        throw new AccountAuthError(
          'Thiết bị đang mất kết nối mạng. Vui lòng kiểm tra Wi-Fi/4G và thử lại.',
          'OFFLINE'
        );
      }
      handleFirestoreError(error, OperationType.GET, accountPath);
    }
  }

  if (!accountFound) {
    throw new AccountAuthError(
      `Tài khoản "${usernameKey}" chưa được tạo trên hệ thống. Bạn có thể bấm nút bên dưới để tạo mới ngay với mật khẩu vừa nhập.`,
      'ACCOUNT_NOT_FOUND'
    );
  }

  if (!constantTimeEqual(serverVerifierHash, verifierHash)) {
    throw new AccountAuthError(
      'Mật khẩu không chính xác. Vui lòng kiểm tra lại mật khẩu.',
      'WRONG_PASSWORD'
    );
  }

  saveCachedVerifiedAccount({
    usernameKey,
    displayName: serverDisplayName,
    verifierHash: serverVerifierHash,
    verifiedAt: new Date().toISOString(),
  });

  const session: AccountSession = {
    usernameKey,
    displayName: serverDisplayName,
    workspaceId,
    loggedInAt: new Date().toISOString(),
  };
  persistAccountSession(session, params.rememberMe);
  return session;
}
