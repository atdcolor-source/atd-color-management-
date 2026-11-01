import { memo, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  CalendarRange,
  Check,
  Cloud,
  CloudOff,
  Copy,
  FolderOpen,
  Inbox,
  LogOut,
  Package,
  RefreshCw,
  User,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AccountSession, AppTab, InventoryAlert } from '../types';
import { ReorderProductsTable } from './ReorderProductsTable';

interface HeaderProps {
  companyName: string;
  logoDataUrl?: string | null;
  accountSession: AccountSession;
  onLogout: () => void;
  onManualSync: () => void;
  serverConnected: boolean;
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  onOpenReorderTable: () => void;
  onFallbackImage: (
    dataUrl: string,
    downloadName: string,
    altText: string
  ) => void;
  itemCount: number;
  savedCount: number;
  reportCount: number;
  inventoryAlerts: InventoryAlert[];
  onQuickRestockAlert: (itemId: string, addQty: number) => void;
  unsyncedCount: number;
  isLoadingCloud: boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onQuickCopyInvoice: () => void;
  copySuccess: boolean;
  isCopying: boolean;
}

export const Header = memo(function Header({
  companyName,
  logoDataUrl,
  accountSession,
  onLogout,
  onManualSync,
  serverConnected,
  activeTab,
  onSelectTab,
  onOpenReorderTable,
  onFallbackImage,
  itemCount,
  savedCount,
  reportCount,
  inventoryAlerts,
  onQuickRestockAlert,
  unsyncedCount,
  isLoadingCloud,
  soundEnabled,
  onToggleSound,
  onQuickCopyInvoice,
  copySuccess,
  isCopying,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [brokenLogoSrc, setBrokenLogoSrc] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inboxRef = useRef<HTMLDivElement | null>(null);
  const canShowLogo = Boolean(logoDataUrl && logoDataUrl !== brokenLogoSrc);
  const alertCount = inventoryAlerts.length;

  useEffect(() => {
    if (!menuOpen && !inboxOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
      if (inboxRef.current && !inboxRef.current.contains(target)) {
        setInboxOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setInboxOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [menuOpen, inboxOpen]);

  const navItems: { tab: AppTab; label: string }[] = [
    { tab: AppTab.WORKSPACE, label: 'Chọn & Báo giá' },
    {
      tab: AppTab.SAVED,
      label:
        savedCount > 0 ? `Báo giá đã lưu (${savedCount})` : 'Báo giá đã lưu',
    },
    {
      tab: AppTab.REPORTS,
      label: reportCount > 0 ? `Báo cáo (${reportCount})` : 'Báo cáo',
    },
    { tab: AppTab.PLAN, label: 'Kế Hoạch' },
    {
      tab: AppTab.INVENTORY,
      label: alertCount > 0 ? `Kho hàng (${alertCount})` : 'Kho hàng',
    },
    { tab: AppTab.INVOICE, label: 'Xem bản in' },
    { tab: AppTab.CATALOG, label: 'Sửa bảng giá' },
    { tab: AppTab.SETTINGS, label: 'Cài đặt chung' },
  ];

  const isSyncingNow = isLoadingCloud || unsyncedCount > 0;
  const brandLabel = companyName || 'ATD Color';

  return (
    <div className="no-print sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
      <header className="max-w-[1380px] mx-auto flex items-center justify-between gap-3 sm:gap-5 px-4 sm:px-6 h-14 sm:h-16">
        <button
          type="button"
          onClick={() => onSelectTab(AppTab.WORKSPACE)}
          aria-label={brandLabel}
          title={brandLabel}
          className="inline-flex items-center text-lg sm:text-xl font-extrabold tracking-tight text-[#4887EE] hover:text-[#3674DC] transition-opacity hover:opacity-90 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4887EE]"
        >
          {canShowLogo ? (
            <img
              src={logoDataUrl!}
              alt={brandLabel}
              referrerPolicy="no-referrer"
              decoding="async"
              onError={() => setBrokenLogoSrc(logoDataUrl || null)}
              className="h-9 sm:h-11 w-auto max-w-[136px] sm:max-w-[168px] object-contain object-left select-none"
            />
          ) : (
            brandLabel
          )}
        </button>

        <nav
          aria-label="Điều hướng chính"
          className="hidden xl:flex items-center gap-3 2xl:gap-4 text-[13px] font-medium text-slate-600"
        >
          {navItems.map((nav) => {
            const isActive = activeTab === nav.tab;
            return (
              <button
                key={nav.tab}
                type="button"
                onClick={() => onSelectTab(nav.tab)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 num-clean ${
                  isActive
                    ? 'text-[#3674DC] font-semibold border-[#4887EE]'
                    : 'border-transparent hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                {nav.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          {/* Hộp tin báo đặt thêm vật tư Kho hàng */}
          <div ref={inboxRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setInboxOpen((prev) => !prev);
                setMenuOpen(false);
              }}
              aria-expanded={inboxOpen}
              title={
                alertCount > 0
                  ? `Hộp tin: ${alertCount} vật tư cần đặt thêm`
                  : 'Hộp tin thông báo Kho hàng'
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                alertCount > 0
                  ? 'text-amber-900 bg-amber-50 hover:bg-amber-100 border-amber-300'
                  : 'text-slate-700 bg-slate-50 hover:bg-slate-100 border-slate-200'
              }`}
            >
              <Inbox
                className={`w-3.5 h-3.5 shrink-0 ${
                  alertCount > 0 ? 'text-amber-600' : 'text-slate-500'
                }`}
              />
              <span>
                Hộp tin{alertCount > 0 ? ` (${alertCount})` : ''}
              </span>
            </button>

            {inboxOpen && (
              <div className="absolute right-0 mt-2 w-[92vw] sm:w-[540px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                <ReorderProductsTable
                  compact
                  alerts={inventoryAlerts}
                  onRestockItem={onQuickRestockAlert}
                  onOpenFullOrderTable={() => {
                    setInboxOpen(false);
                    onOpenReorderTable();
                  }}
                  onFallbackImage={onFallbackImage}
                />
              </div>
            )}
          </div>

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
            className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border cursor-pointer shrink-0 ${
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

          {/* Shared Account & Live Cloud Sync Menu */}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setMenuOpen((prev) => !prev);
                setInboxOpen(false);
              }}
              aria-expanded={menuOpen}
              title={`Tài khoản đang dùng chung: @${accountSession.usernameKey}`}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                !serverConnected && !isLoadingCloud
                  ? 'text-amber-800 bg-amber-50 hover:bg-amber-100 border-amber-200'
                  : isSyncingNow
                    ? 'text-blue-700 bg-blue-50 hover:bg-blue-100 border-blue-200'
                    : 'text-slate-800 bg-emerald-50/60 hover:bg-emerald-100/70 border-emerald-200'
              }`}
            >
              {!serverConnected && !isLoadingCloud ? (
                <CloudOff className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              ) : isSyncingNow ? (
                <Cloud className="w-3.5 h-3.5 text-blue-600 shrink-0 animate-pulse" />
              ) : (
                <User className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              )}
              <span className="max-w-[84px] sm:max-w-[128px] truncate">
                @{accountSession.usernameKey}
              </span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-lg p-3.5 z-50 space-y-3">
                <div className="space-y-0.5">
                  <div className="text-xs text-slate-500">
                    Đang đăng nhập tài khoản dùng chung
                  </div>
                  <div className="text-sm font-bold text-slate-900 truncate">
                    {accountSession.displayName}
                  </div>
                  <div className="text-xs font-medium text-slate-600 num-clean truncate">
                    Tên đăng nhập: @{accountSession.usernameKey}
                  </div>
                </div>

                <div className="pt-2.5 border-t border-slate-100 text-xs leading-relaxed num-clean">
                  {!serverConnected && !isLoadingCloud ? (
                    <span className="text-amber-800 font-medium">
                      Đang chờ kết nối lại máy chủ ({unsyncedCount} mục chờ đồng
                      bộ). Dữ liệu vẫn được lưu 100% trên thiết bị.
                    </span>
                  ) : isSyncingNow ? (
                    <span className="text-blue-700 font-medium">
                      Đang tự động đồng bộ dữ liệu lên máy chủ đám mây...
                    </span>
                  ) : (
                    <span className="text-emerald-800 font-medium">
                      Đã kết nối máy chủ · Đồng bộ 100% ({savedCount} báo giá đã
                      lưu). Mọi máy tính và điện thoại cùng tài khoản đều xem
                      chung tức thì.
                    </span>
                  )}
                </div>

                <div className="pt-1 flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onManualSync();
                      setMenuOpen(false);
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                    <span>Đồng bộ ngay với máy chủ</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onSelectTab(AppTab.SAVED);
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap num-clean"
                  >
                    <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Mở Báo giá đã lưu{savedCount > 0 ? ` (${savedCount})` : ''}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onSelectTab(AppTab.REPORTS);
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap num-clean"
                  >
                    <BarChart3 className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Mở mục Báo cáo{reportCount > 0 ? ` (${reportCount})` : ''}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onSelectTab(AppTab.PLAN);
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap num-clean"
                  >
                    <CalendarRange className="w-3.5 h-3.5 shrink-0" />
                    <span>Mở mục Kế Hoạch (Voucher & Date KH)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      if (alertCount > 0) {
                        onOpenReorderTable();
                      } else {
                        onSelectTab(AppTab.INVENTORY);
                      }
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap num-clean"
                  >
                    <Package className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {alertCount > 0
                        ? `Bảng sản phẩm cần đặt (${alertCount})`
                        : 'Mở mục Kho hàng'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <LogOut className="w-3.5 h-3.5 shrink-0" />
                    <span>Đổi tài khoản / Đăng xuất</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={itemCount === 0 || isCopying}
            onClick={onQuickCopyInvoice}
            className={`inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              copySuccess
                ? 'bg-emerald-600 text-white'
                : 'bg-[#4887EE] text-white hover:bg-[#3674DC]'
            }`}
          >
            {copySuccess ? (
              <>
                <Check className="w-4 h-4 shrink-0" />
                <span>Đã sao chép</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 shrink-0" />
                <span>
                  <span className="hidden sm:inline">Sao chép ảnh</span>
                  <span className="sm:hidden">Chép ảnh</span>
                  {itemCount > 0 ? ` (${itemCount})` : ''}
                </span>
              </>
            )}
          </button>
        </div>
      </header>

      <nav
        aria-label="Điều hướng di động"
        className="xl:hidden flex items-center gap-5 overflow-x-auto px-4 h-10 border-t border-slate-100 text-xs font-medium text-slate-600"
      >
        {navItems.map((nav) => {
          const isActive = activeTab === nav.tab;
          return (
            <button
              key={nav.tab}
              type="button"
              onClick={() => onSelectTab(nav.tab)}
              className={`h-full inline-flex items-center border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer num-clean ${
                isActive
                  ? 'text-[#3674DC] font-semibold border-[#4887EE]'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              {nav.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
});
