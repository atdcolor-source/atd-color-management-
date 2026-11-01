import { CAT_FORMEX, CAT_PLASTIC } from '../data/initialData';
import { Product, StoreSettings } from '../types';
import { formatVND } from './formatters';

export interface PriceSheetSizeRow {
  size: string;
  price1Side: number;
  price2Side: number;
}

export interface PriceSheetMaterialGroup {
  id: string;
  title: string;
  subtitle: string;
  unitLabel: string;
  rows: PriceSheetSizeRow[];
}

export interface PriceSheetExportPayload {
  products: Product[];
  store: StoreSettings;
  logoDataUrl?: string | null;
}

const DEFAULT_PLASTIC_ROWS: PriceSheetSizeRow[] = [
  { size: 'A3', price1Side: 37000, price2Side: 40000 },
  { size: 'A4', price1Side: 29000, price2Side: 32000 },
  { size: 'A5', price1Side: 17000, price2Side: 30000 },
];

const DEFAULT_FORMEX_ROWS: PriceSheetSizeRow[] = [
  { size: 'A3', price1Side: 124000, price2Side: 164000 },
  { size: 'A4', price1Side: 88000, price2Side: 118000 },
  { size: 'A5', price1Side: 84000, price2Side: 84000 },
];

const NUM_FONT = '"Plus Jakarta Sans", "Be Vietnam Pro", sans-serif';
const BODY_FONT = '"Be Vietnam Pro", "Plus Jakarta Sans", sans-serif';
const DISPLAY_FONT = '"Plus Jakarta Sans", "Be Vietnam Pro", sans-serif';
const LOGO_BLUE = '#4887EE';
const LOGO_BLUE_DARK = '#3674DC';

function buildCategoryRows(
  products: Product[],
  category: string,
  defaultRows: PriceSheetSizeRow[]
): PriceSheetSizeRow[] {
  const categoryItems = products.filter((p) => p.category === category);
  const bySize = new Map<
    string,
    { sizeLabel: string; price1Side?: number; price2Side?: number }
  >();

  for (const item of categoryItems) {
    const rawSize = (item.size || '').trim();
    if (!rawSize) continue;
    const key = rawSize.toUpperCase();
    const existing = bySize.get(key) || { sizeLabel: rawSize };
    const sideUpper = (item.sides || '').trim().toUpperCase();
    if (sideUpper.includes('1')) {
      existing.price1Side = item.price;
    } else if (sideUpper.includes('2')) {
      existing.price2Side = item.price;
    }
    bySize.set(key, existing);
  }

  const usedKeys = new Set<string>();
  const rows: PriceSheetSizeRow[] = defaultRows.map((def) => {
    const key = def.size.toUpperCase();
    usedKeys.add(key);
    const live = bySize.get(key);
    return {
      size: live?.sizeLabel || def.size,
      price1Side:
        typeof live?.price1Side === 'number' ? live.price1Side : def.price1Side,
      price2Side:
        typeof live?.price2Side === 'number' ? live.price2Side : def.price2Side,
    };
  });

  for (const [key, extra] of bySize.entries()) {
    if (usedKeys.has(key)) continue;
    rows.push({
      size: extra.sizeLabel,
      price1Side: extra.price1Side ?? extra.price2Side ?? 0,
      price2Side: extra.price2Side ?? extra.price1Side ?? 0,
    });
  }

  return rows;
}

export function buildPrintPriceSheetGroups(
  products: Product[]
): PriceSheetMaterialGroup[] {
  return [
    {
      id: 'plastic',
      title: 'ÉP NHỰA - PLASTIC',
      subtitle: '(Giấy In Chuẩn 300)',
      unitLabel: 'Đơn vị: 1 Tờ',
      rows: buildCategoryRows(products, CAT_PLASTIC, DEFAULT_PLASTIC_ROWS),
    },
    {
      id: 'formex',
      title: 'IN DECAL + FORMEX',
      subtitle: '(Chuẩn 5mm)',
      unitLabel: 'Đơn vị: 1 Bảng',
      rows: buildCategoryRows(products, CAT_FORMEX, DEFAULT_FORMEX_ROWS),
    },
  ];
}

export function formatPriceSheetPlainText(
  products: Product[],
  store: StoreSettings
): string {
  const groups = buildPrintPriceSheetGroups(products);
  const lines: string[] = [];
  const brand = (store.companyName || 'ATD Color').trim();
  lines.push(`${brand.toUpperCase()} — THÔNG TIN BẢNG GIÁ IN ẤN`);
  lines.push('(ĐƠN VỊ: GIÁ 1 / BẢNG / TỜ)');
  lines.push('--------------------------------------------');

  for (const group of groups) {
    lines.push(`${group.title} ${group.subtitle}`);
    for (const row of group.rows) {
      lines.push(
        `• Khổ ${row.size}: 1 Mặt ${formatVND(row.price1Side)} | 2 Mặt ${formatVND(
          row.price2Side
        )}`
      );
    }
    lines.push('');
  }

  const contacts = [
    store.phone.trim() ? `ĐT: ${store.phone.trim()}` : '',
    store.address.trim() ? `Đ/c: ${store.address.trim()}` : '',
  ].filter(Boolean);
  if (contacts.length > 0) {
    lines.push(contacts.join(' · '));
  }

  return lines.join('\n').trim();
}

const logoCache = new Map<string, HTMLImageElement>();

function loadLogoForCanvas(
  src?: string | null
): Promise<HTMLImageElement | null> {
  if (!src || !src.startsWith('data:image/')) {
    return Promise.resolve(null);
  }
  const cached = logoCache.get(src);
  if (
    cached &&
    cached.complete &&
    cached.naturalWidth > 0 &&
    cached.naturalHeight > 0
  ) {
    return Promise.resolve(cached);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (img: HTMLImageElement | null) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        if (img) {
          if (logoCache.size >= 6) {
            const firstKey = logoCache.keys().next().value;
            if (firstKey) logoCache.delete(firstKey);
          }
          logoCache.set(src, img);
        }
        resolve(img);
      }
    };
    const img = new Image();
    img.decoding = 'async';
    const timer = window.setTimeout(() => finish(null), 3500);
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        finish(img);
      } else {
        finish(null);
      }
    };
    img.onerror = () => finish(null);
    img.src = src;
  });
}

export async function renderPriceSheetToCanvas(
  payload: PriceSheetExportPayload
): Promise<HTMLCanvasElement> {
  const [, loadedLogo] = await Promise.all([
    document.fonts && document.fonts.ready
      ? document.fonts.ready
      : Promise.resolve(),
    loadLogoForCanvas(payload.logoDataUrl),
  ]);

  const groups = buildPrintPriceSheetGroups(payload.products);
  const totalBodyRows = groups.reduce((sum, g) => sum + g.rows.length, 0);

  const width = 920;
  const padX = 40;
  const contentW = width - padX * 2; // 840px

  const colW = {
    material: 336,
    size: 144,
    side1: 180,
    side2: 180,
  };

  const headerTopH = 74;
  const titleBlockH = 78;
  const thRow1H = 38;
  const thRow2H = 36;
  const thTotalH = thRow1H + thRow2H; // 74px
  const rowH = 50;
  const tableBodyH = totalBodyRows * rowH;
  const footerNoteH = 44;

  const exactHeight =
    6 +
    24 +
    headerTopH +
    titleBlockH +
    12 +
    thTotalH +
    tableBodyH +
    footerNoteH +
    16;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = exactHeight * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  // Crisp white sheet background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, exactHeight);

  // Top brand accent bar
  ctx.fillStyle = LOGO_BLUE;
  ctx.fillRect(0, 0, width, 6);

  let y = 30;

  // 1. Top Header: Company Logo in top-left corner + Contact info on top-right
  if (loadedLogo) {
    const maxLogoW = 176;
    const maxLogoH = 64;
    const logoScale = Math.min(
      maxLogoW / loadedLogo.naturalWidth,
      maxLogoH / loadedLogo.naturalHeight,
      2
    );
    const drawW = Math.max(1, Math.round(loadedLogo.naturalWidth * logoScale));
    const drawH = Math.max(1, Math.round(loadedLogo.naturalHeight * logoScale));
    const logoY = y + Math.max(0, Math.round((62 - drawH) / 2));

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(loadedLogo, padX, logoY, drawW, drawH);
    ctx.restore();
  } else {
    ctx.textAlign = 'left';
    ctx.fillStyle = LOGO_BLUE;
    ctx.font = `800 24px ${DISPLAY_FONT}`;
    ctx.fillText(
      (payload.store.companyName || 'ATD Color').trim(),
      padX,
      y + 38
    );
  }

  const rightX = width - padX;
  ctx.textAlign = 'right';
  const contactLine1 = [
    payload.store.address.trim(),
    payload.store.phone.trim() ? `ĐT: ${payload.store.phone.trim()}` : '',
  ]
    .filter(Boolean)
    .join('  ·  ');
  const contactLine2 = [
    payload.store.email.trim() ? `Email: ${payload.store.email.trim()}` : '',
    payload.store.tiktok.trim() ? `TikTok: ${payload.store.tiktok.trim()}` : '',
  ]
    .filter(Boolean)
    .join('  ·  ');

  if (contactLine1 && contactLine2) {
    ctx.fillStyle = '#1E293B';
    ctx.font = `600 14.5px ${BODY_FONT}`;
    ctx.fillText(contactLine1, rightX, y + 24);

    ctx.fillStyle = '#475569';
    ctx.font = `500 14px ${BODY_FONT}`;
    ctx.fillText(contactLine2, rightX, y + 48);
  } else if (contactLine1) {
    ctx.fillStyle = '#1E293B';
    ctx.font = `600 14.5px ${BODY_FONT}`;
    ctx.fillText(contactLine1, rightX, y + 36);
  } else if (contactLine2) {
    ctx.fillStyle = '#475569';
    ctx.font = `500 14px ${BODY_FONT}`;
    ctx.fillText(contactLine2, rightX, y + 36);
  }

  y += headerTopH;

  // Header divider
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padX, y);
  ctx.lineTo(width - padX, y);
  ctx.stroke();

  // 2. Centered Title & Unit Subtitle
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0F172A';
  ctx.font = `800 26px ${DISPLAY_FONT}`;
  ctx.fillText('THÔNG TIN BẢNG GIÁ IN ẤN', width / 2, y + 38);

  ctx.fillStyle = '#475569';
  ctx.font = `700 14px ${DISPLAY_FONT}`;
  ctx.fillText('(ĐƠN VỊ: GIÁ 1 / BẢNG / TỜ)', width / 2, y + 63);

  y += titleBlockH + 12;

  const tableStartY = y;
  const xMat = padX;
  const xSize = xMat + colW.material;
  const xSide1 = xSize + colW.size;
  const xSide2 = xSide1 + colW.side1;
  const xEnd = xSide2 + colW.side2;

  // 3. Two-Tier Ruled Table Header
  ctx.fillStyle = LOGO_BLUE;
  ctx.fillRect(xMat, y, contentW, thTotalH);

  ctx.fillStyle = LOGO_BLUE_DARK;
  ctx.fillRect(xSide1, y + thRow1H, colW.side1 + colW.side2, thRow2H);

  // Header grid dividers
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xSize, y);
  ctx.lineTo(xSize, y + thTotalH);
  ctx.moveTo(xSide1, y);
  ctx.lineTo(xSide1, y + thTotalH);
  ctx.moveTo(xSide1, y + thRow1H);
  ctx.lineTo(xEnd, y + thRow1H);
  ctx.moveTo(xSide2, y + thRow1H);
  ctx.lineTo(xSide2, y + thTotalH);
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 14px ${DISPLAY_FONT}`;

  ctx.textAlign = 'left';
  ctx.fillText('CHẤT LIỆU', xMat + 22, y + 42);

  ctx.textAlign = 'center';
  ctx.fillText('KÍCH THƯỚC', xSize + colW.size / 2, y + 42);
  ctx.fillText('GIÁ IN', xSide1 + (colW.side1 + colW.side2) / 2, y + 25);

  ctx.font = `700 13.5px ${DISPLAY_FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText('1 MẶT', xSide1 + colW.side1 - 28, y + thRow1H + 23);
  ctx.fillText('2 MẶT', xSide2 + colW.side2 - 28, y + thRow1H + 23);

  y += thTotalH;

  // 4. Table Body Groups with full cell grid borders
  groups.forEach((group, groupIdx) => {
    const groupH = group.rows.length * rowH;
    const groupStartY = y;

    // Merged Material Cell background
    ctx.fillStyle = groupIdx % 2 === 0 ? '#F8FAFC' : '#F1F5F9';
    ctx.fillRect(xMat, groupStartY, colW.material, groupH);

    // Vertically centered Material title + subtitle + unit
    const blockCenterY = groupStartY + groupH / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0F172A';
    ctx.font = `800 16px ${DISPLAY_FONT}`;
    ctx.fillText(group.title, xMat + 22, blockCenterY - 14);

    ctx.fillStyle = '#334155';
    ctx.font = `600 14px ${BODY_FONT}`;
    ctx.fillText(group.subtitle, xMat + 22, blockCenterY + 9);

    ctx.fillStyle = '#64748B';
    ctx.font = `500 12.5px ${BODY_FONT}`;
    ctx.fillText(group.unitLabel, xMat + 22, blockCenterY + 30);

    // Size & Price rows
    group.rows.forEach((row, rIdx) => {
      const rowY = groupStartY + rIdx * rowH;

      if (rIdx % 2 === 1) {
        ctx.fillStyle = '#F8FAFC';
        ctx.fillRect(xSize, rowY, colW.size + colW.side1 + colW.side2, rowH);
      }

      // Horizontal divider between size rows
      if (rIdx > 0) {
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xSize, rowY);
        ctx.lineTo(xEnd, rowY);
        ctx.stroke();
      }

      const baselineY = rowY + 31;

      ctx.textAlign = 'center';
      ctx.fillStyle = '#0F172A';
      ctx.font = `800 16.5px ${NUM_FONT}`;
      ctx.fillText(row.size, xSize + colW.size / 2, baselineY);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#0F172A';
      ctx.font = `700 17px ${NUM_FONT}`;
      ctx.fillText(
        formatVND(row.price1Side),
        xSide1 + colW.side1 - 28,
        baselineY
      );

      ctx.fillStyle = '#1D4ED8';
      ctx.font = `700 17px ${NUM_FONT}`;
      ctx.fillText(
        formatVND(row.price2Side),
        xSide2 + colW.side2 - 28,
        baselineY
      );
    });

    // Vertical column borders through this group
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xSize, groupStartY);
    ctx.lineTo(xSize, groupStartY + groupH);
    ctx.moveTo(xSide1, groupStartY);
    ctx.lineTo(xSide1, groupStartY + groupH);
    ctx.moveTo(xSide2, groupStartY);
    ctx.lineTo(xSide2, groupStartY + groupH);
    ctx.stroke();

    // Stronger horizontal divider separating Material groups
    if (groupIdx > 0) {
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xMat, groupStartY);
      ctx.lineTo(xEnd, groupStartY);
      ctx.stroke();
    }

    y += groupH;
  });

  // Crisp outer table frame
  ctx.strokeStyle = '#94A3B8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(xMat, tableStartY, contentW, thTotalH + tableBodyH);

  // Quiet note below table
  ctx.textAlign = 'left';
  ctx.fillStyle = '#64748B';
  ctx.font = `500 13px ${BODY_FONT}`;
  ctx.fillText(
    '* Đơn giá tính trên 1 bảng / 1 tờ thành phẩm (chưa bao gồm chi phí thiết kế và vận chuyển).',
    padX,
    y + 27
  );

  return canvas;
}

export async function copyPriceSheetImageToClipboard(
  payload: PriceSheetExportPayload
): Promise<{ status: 'copied' } | { status: 'fallback'; dataUrl: string }> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  ) {
    try {
      const pngBlobPromise = renderPriceSheetToCanvas(payload).then(
        (canvas) =>
          new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error('Không thể tạo ảnh bảng giá PNG'));
            }, 'image/png');
          })
      );
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlobPromise }),
      ]);
      return { status: 'copied' };
    } catch {
      try {
        const canvas = await renderPriceSheetToCanvas(payload);
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Blob error'))),
            'image/png'
          );
        });
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
        return { status: 'copied' };
      } catch {
        const canvas = await renderPriceSheetToCanvas(payload);
        return {
          status: 'fallback',
          dataUrl: canvas.toDataURL('image/png', 1.0),
        };
      }
    }
  }

  const canvas = await renderPriceSheetToCanvas(payload);
  return { status: 'fallback', dataUrl: canvas.toDataURL('image/png', 1.0) };
}

export async function exportPriceSheetPNG(
  payload: PriceSheetExportPayload
): Promise<void> {
  const canvas = await renderPriceSheetToCanvas(payload);
  const dataUrl = canvas.toDataURL('image/png', 1.0);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = 'Bang-Gia-In-An-ATD-Color.png';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
