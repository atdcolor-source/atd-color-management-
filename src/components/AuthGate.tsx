import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  RefreshCw,
  UserCheck,
  UserPlus,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  AccountAuthError,
  AccountAuthErrorCode,
  loginAccount,
  normalizeUsernameKey,
  registerAccount,
} from '../services/accountAuth';
import { checkServerCloudHealth } from '../services/cloudApiClient';
import { AccountSession } from '../types';

interface AuthGateProps {
  onAuthenticated: (session: AccountSession) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
}

type AuthMode = 'login' | 'register';
type ServerStatus = 'checking' | 'connected' | 'offline' | 'quota';

export function AuthGate({
  onAuthenticated,
  soundEnabled,
  onToggleSound,
}: AuthGateProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<AccountAuthErrorCode | null>(null);
  const [upgradeUrl, setUpgradeUrl] = useState<string | undefined>(undefined);
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');

  const normalizedUsername = normalizeUsernameKey(username);
  const showNormalizedHint =
    username.trim().length > 0 && username.trim() !== normalizedUsername;

  const verifyServerConnection = useCallback(async () => {
    setServerStatus('checking');
    const health = await checkServerCloudHealth();
    if (health.connected) {
      setServerStatus('connected');
    } else if (health.quotaExceeded) {
      setServerStatus('quota');
      if (health.upgradeUrl) {
        setUpgradeUrl(health.upgradeUrl);
      }
    } else {
      setServerStatus('offline');
    }
  }, []);

  useEffect(() => {
    void verifyServerConnection();
    const handleOnline = () => {
      void verifyServerConnection();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [verifyServerConnection]);

  const clearErrors = () => {
    setErrorMessage(null);
    setErrorCode(null);
    setUpgradeUrl(undefined);
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    clearErrors();
  };

  const handleQuickRegisterFromLogin = async () => {
    if (isSubmitting) return;
    clearErrors();
    setIsSubmitting(true);
    try {
      const session = await registerAccount({
        rawUsername: username,
        displayName: displayName || username,
        password,
        rememberMe,
      });
      setServerStatus('connected');
      onAuthenticated(session);
    } catch (err) {
      if (err instanceof AccountAuthError) {
        setErrorMessage(err.message);
        setErrorCode(err.code);
        setUpgradeUrl(err.upgradeUrl);
      } else {
        setErrorMessage(
          'Không thể kết nối máy chủ xác thực lúc này. Vui lòng bấm kiểm tra lại kết nối và thử lại.'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    clearErrors();

    if (mode === 'register' && password !== confirmPassword) {
      setErrorMessage('Mật khẩu nhập lại không khớp. Vui lòng kiểm tra lại.');
      setErrorCode('VALIDATION');
      return;
    }

    setIsSubmitting(true);
    try {
      const session =
        mode === 'login'
          ? await loginAccount({
              rawUsername: username,
              password,
              rememberMe,
            })
          : await registerAccount({
              rawUsername: username,
              displayName,
              password,
              rememberMe,
            });
      setServerStatus('connected');
      onAuthenticated(session);
    } catch (err) {
      if (err instanceof AccountAuthError) {
        setErrorMessage(err.message);
        setErrorCode(err.code);
        setUpgradeUrl(err.upgradeUrl);
        if (err.code === 'OFFLINE') {
          setServerStatus('offline');
        }
      } else {
        setErrorMessage(
          'Không thể kết nối máy chủ lúc này. Vui lòng kiểm tra kết nối mạng và thử lại.'
        );
        setServerStatus('offline');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="w-full border-b border-slate-200 bg-white">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <span className="text-lg sm:text-xl font-extrabold tracking-tight text-[#4887EE] whitespace-nowrap shrink-0">
            ATD Color
          </span>

          <button
            type="button"
            data-mute-toggle="true"
            onClick={onToggleSound}
            title={
              soundEnabled
                ? 'Đang bật tiếng chạm (Bấm để tắt âm)'
                : 'Đang tắt tiếng chạm (Bấm để bật lại)'
            }
            aria-label={
              soundEnabled ? 'Tắt âm thanh khi bấm' : 'Bật âm thanh khi bấm'
            }
            className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border cursor-pointer shrink-0 transition-colors ${
              soundEnabled
                ? 'text-slate-700 bg-slate-50 hover:bg-slate-100 border-slate-200'
                : 'text-slate-400 bg-white hover:bg-slate-50 border-slate-200'
            }`}
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4 shrink-0" />
            ) : (
              <VolumeX className="w-4 h-4 shrink-0" />
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-[440px] bg-white border border-slate-200 rounded-xl p-5 sm:p-7 shadow-xs">
          {/* Live Cloud Server Connection Bar */}
          <div className="mb-4">
            {serverStatus === 'connected' ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-900 bg-emerald-50/80 border border-emerald-200 rounded-lg">
                <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span>
                  Đã kết nối máy chủ đám mây · Sẵn sàng đồng bộ tự động
                </span>
              </div>
            ) : serverStatus === 'checking' ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg">
                <Cloud className="w-3.5 h-3.5 text-blue-600 shrink-0 animate-pulse" />
                <span>Đang kết nối máy chủ đồng bộ...</span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-lg">
                <span>
                  {serverStatus === 'quota'
                    ? 'Hạn mức đọc/ghi miễn phí hôm nay đã đầy'
                    : 'Đang thử kết nối lại với máy chủ...'}
                </span>
                <button
                  type="button"
                  onClick={() => void verifyServerConnection()}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-amber-900 bg-white border border-amber-300 hover:bg-amber-100 rounded cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-3 h-3 shrink-0" />
                  <span>Kết nối lại</span>
                </button>
              </div>
            )}
          </div>

          <div className="space-y-1.5 mb-5">
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">
              {mode === 'login'
                ? 'Đăng nhập tài khoản'
                : 'Tạo tài khoản dùng chung'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {mode === 'login'
                ? 'Ai đăng nhập cùng tên tài khoản và mật khẩu sẽ xem và dùng chung toàn bộ báo giá đã lưu, bảng giá và cài đặt chung.'
                : 'Đặt tên tài khoản và mật khẩu riêng. Mọi máy tính hoặc điện thoại đăng nhập cùng tài khoản này sẽ tự động đồng bộ chung dữ liệu.'}
            </p>
          </div>

          {/* Segmented Mode Control */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg mb-5">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs sm:text-sm font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserCheck className="w-4 h-4 shrink-0" />
              <span>Đăng nhập</span>
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs sm:text-sm font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'register'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserPlus className="w-4 h-4 shrink-0" />
              <span>Tạo tài khoản mới</span>
            </button>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <label
                htmlFor="auth-username"
                className="block text-xs font-bold text-slate-700 mb-1.5"
              >
                Tên tài khoản
              </label>
              <input
                id="auth-username"
                type="text"
                required
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (errorMessage) clearErrors();
                }}
                placeholder="Ví dụ: atdcolor"
                className="w-full h-11 px-3.5 text-sm font-medium text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
              />
              {showNormalizedHint && normalizedUsername && (
                <p className="mt-1 text-xs text-slate-500 num-clean">
                  Tên đăng nhập chuẩn:{' '}
                  <strong className="text-slate-800">
                    {normalizedUsername}
                  </strong>
                </p>
              )}
            </div>

            {mode === 'register' && (
              <div>
                <label
                  htmlFor="auth-display-name"
                  className="block text-xs font-bold text-slate-700 mb-1.5"
                >
                  Tên hiển thị / Tên tiệm (không bắt buộc)
                </label>
                <input
                  id="auth-display-name"
                  type="text"
                  maxLength={80}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ví dụ: ATD Color"
                  className="w-full h-11 px-3.5 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-bold text-slate-700 mb-1.5"
              >
                Mật khẩu
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={4}
                  maxLength={128}
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errorMessage) clearErrors();
                  }}
                  placeholder="Nhập mật khẩu (tối thiểu 4 ký tự)"
                  className="w-full h-11 pl-3.5 pr-11 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div>
                <label
                  htmlFor="auth-confirm-password"
                  className="block text-xs font-bold text-slate-700 mb-1.5"
                >
                  Nhập lại mật khẩu
                </label>
                <input
                  id="auth-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={4}
                  maxLength={128}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (errorMessage) clearErrors();
                  }}
                  placeholder="Nhập lại mật khẩu để xác nhận"
                  className="w-full h-11 px-3.5 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
                />
              </div>
            )}

            <label className="flex items-center gap-2.5 text-xs sm:text-sm text-slate-700 cursor-pointer select-none pt-0.5">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
              />
              <span>Ghi nhớ đăng nhập trên thiết bị này</span>
            </label>

            {errorMessage && (
              <div
                role="alert"
                className={`space-y-2.5 px-3.5 py-3 text-xs sm:text-sm border rounded-lg ${
                  errorCode === 'ACCOUNT_NOT_FOUND'
                    ? 'text-slate-800 bg-blue-50/80 border-blue-200'
                    : 'text-rose-800 bg-rose-50 border-rose-200'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <AlertCircle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      errorCode === 'ACCOUNT_NOT_FOUND'
                        ? 'text-blue-600'
                        : 'text-rose-600'
                    }`}
                  />
                  <span>{errorMessage}</span>
                </div>

                {errorCode === 'ACCOUNT_NOT_FOUND' &&
                  normalizedUsername.length >= 3 &&
                  password.length >= 4 && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void handleQuickRegisterFromLogin()}
                      className="w-full h-9 inline-flex items-center justify-center gap-1.5 px-3 text-xs sm:text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                    >
                      <UserPlus className="w-4 h-4 shrink-0" />
                      <span>
                        Tạo ngay tài khoản @{normalizedUsername} với mật khẩu
                        này
                      </span>
                    </button>
                  )}

                {upgradeUrl && (
                  <a
                    href={upgradeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-xs font-bold text-blue-700 underline"
                  >
                    Mở bảng quản lý hạn mức Firebase Console
                  </a>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-11 inline-flex items-center justify-center gap-2 px-4 text-sm font-bold text-white bg-[#4887EE] hover:bg-[#3674DC] rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {isSubmitting ? (
                <>
                  <KeyRound className="w-4 h-4 shrink-0 animate-spin" />
                  <span>
                    {mode === 'login'
                      ? 'Đang kết nối & đăng nhập...'
                      : 'Đang tạo tài khoản...'}
                  </span>
                </>
              ) : mode === 'login' ? (
                <>
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>Đăng nhập vào hệ thống</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4 shrink-0" />
                  <span>Tạo tài khoản & Bắt đầu</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-slate-100 text-xs text-slate-500 leading-relaxed">
            Mẹo chia sẻ nội bộ: Chỉ cần gửi <strong>Tên tài khoản</strong> và{' '}
            <strong>Mật khẩu</strong> cho nhân viên hoặc mở trên điện thoại — mọi
            tệp báo giá đã lưu sẽ tự động xem chung và đồng bộ 100%.
          </div>
        </div>
      </main>

      <footer className="w-full border-t border-slate-200/80 bg-slate-50 py-3.5 px-4 text-center">
        <p className="text-[11px] font-medium text-slate-400">
          Một Sản Phẩm Của ATD Color
        </p>
      </footer>
    </div>
  );
}
