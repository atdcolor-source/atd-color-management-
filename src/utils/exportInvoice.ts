import { jsPDF } from 'jspdf';
import {
  CustomerInfo,
  QuoteItem,
  QuoteTotals,
  StoreSettings,
} from '../types';
import {
  formatDateOnlyVN,
  formatISODateVN,
  formatNumberVN,
  formatSignatureDateVN,
  formatVND,
} from './formatters';

export interface InvoiceExportPayload {
  createdAt: string;
  expectedDemoDate: string;
  store: StoreSettings;
  customer: CustomerInfo;
  items: QuoteItem[];
  designIllustration: string;
  invoiceNote: string;
  totals: QuoteTotals;
  logoDataUrl?: string | null;
  signatureDataUrl?: string | null;
}

const NUM_FONT = '"Plus Jakarta Sans", "Be Vietnam Pro", sans-serif';
const BODY_FONT = '"Be Vietnam Pro", "Plus Jakarta Sans", sans-serif';
const DISPLAY_FONT = '"Plus Jakarta Sans", "Be Vietnam Pro", sans-serif';
const LOGO_BLUE = '#4887EE';

function splitTokenToFit(
  ctx: CanvasRenderingContext2D,
  token: string,
  maxWidth: number
): string[] {
  if (!token || ctx.measureText(token).width <= maxWidth) {
    return [token];
  }
  const chunks: string[] = [];
  let current = '';
  for (const ch of Array.from(token)) {
    const candidate = current + ch;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      chunks.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapCanvasParagraphs(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  if (!text || !text.trim()) return [];
  const rawParagraphs = text.replace(/\r\n/g, '\n').split('\n');
  const allLines: string[] = [];

  for (const para of rawParagraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      allLines.push('');
      continue;
    }
    const rawWords = trimmed.split(/\s+/);
    const tokens: string[] = [];
    for (const word of rawWords) {
      tokens.push(...splitTokenToFit(ctx, word, maxWidth));
    }

    let currentLine = tokens[0] || '';
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      const testLine = `${currentLine} ${token}`;
      if (ctx.measureText(testLine).width <= maxWidth) {
        currentLine = testLine;
      } else {
        allLines.push(currentLine);
        currentLine = token;
      }
    }
    allLines.push(currentLine);
  }
  return allLines;
}

const imageCache = new Map<string, HTMLImageElement>();
const MAX_IMAGE_CACHE = 8;

function loadCanvasImage(
  src?: string | null
): Promise<HTMLImageElement | null> {
  if (!src || !src.startsWith('data:image/')) {
    return Promise.resolve(null);
  }
  const cached = imageCache.get(src);
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
          if (imageCache.size >= MAX_IMAGE_CACHE) {
            const oldestKey = imageCache.keys().next().value;
            if (oldestKey) {
              imageCache.delete(oldestKey);
            }
          }
          imageCache.set(src, img);
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

/**
 * Renders a crisp Widescreen Landscape (Ngang) Reference Invoice (1160px wide, 2x Retina)
 */
export async function renderInvoiceToCanvas(
  payload: InvoiceExportPayload
): Promise<HTMLCanvasElement> {
  const [, loadedLogo, loadedSignature] = await Promise.all([
    document.fonts && document.fonts.ready
      ? document.fonts.ready
      : Promise.resolve(),
    loadCanvasImage(payload.logoDataUrl),
    loadCanvasImage(payload.signatureDataUrl),
  ]);

  const width = 1160;
  const padX = 44;
  const contentW = width - padX * 2; // 1072px

  // 54 + 348 + 88 + 160 + 172 + 250 = 1072px
  const colW = {
    stt: 54,
    name: 348,
    qty: 88,
    price: 160,
    total: 172,
    note: 250,
  };

  const leftFooterW = 590;
  const rightSummaryW = 450;

  const measureCanvas = document.createElement('canvas');
  const mCtx = measureCanvas.getContext('2d')!;

  const hasCustomer = Boolean(
    payload.customer.name.trim() ||
      payload.customer.code.trim() ||
      payload.customer.phone.trim()
  );
  const custH = hasCustomer ? 38 : 0;

  const rowLayouts = payload.items.map((item) => {
    mCtx.font = `600 16.5px ${BODY_FONT}`;
    const nameLines = wrapCanvasParagraphs(mCtx, item.name, colW.name - 24);
    mCtx.font = `400 15px ${BODY_FONT}`;
    const noteLines = wrapCanvasParagraphs(
      mCtx,
      item.note || '',
      colW.note - 24
    );
    const maxLines = Math.max(1, nameLines.length, noteLines.length);
    const rowHeight = Math.max(46, 20 + maxLines * 24);
    return { item, nameLines, noteLines, rowHeight };
  });

  const tableHeaderH = 42;
  const tableBodyH = rowLayouts.reduce((sum, r) => sum + r.rowHeight, 0);

  // Measure "Mẫu Thiết Kế đã đính kèm, ảnh minh họa: ..." right above Ghi chú
  const designVal = (payload.designIllustration || '').trim();
  const designFullText = designVal
    ? `Mẫu Thiết Kế đã đính kèm, ảnh minh họa: ${designVal}`
    : '';
  mCtx.font = `700 14.5px ${BODY_FONT}`;
  const designLines = wrapCanvasParagraphs(
    mCtx,
    designFullText,
    leftFooterW - 28
  );
  const designBoxH = designLines.length > 0 ? 14 + designLines.length * 22 : 0;

  mCtx.font = `400 15px ${BODY_FONT}`;
  const noteLines = wrapCanvasParagraphs(
    mCtx,
    payload.invoiceNote,
    leftFooterW - 28
  );
  const noteBoxH = noteLines.length > 0 ? 38 + noteLines.length * 22 : 0;

  const hasPreparerName = Boolean(payload.store.preparerName.trim());
  const hasPreparerBlock = Boolean(hasPreparerName || loadedSignature);
  let sigDrawW = 0;
  let sigDrawH = 0;
  if (loadedSignature) {
    const maxSigW = 220;
    const maxSigH = 74;
    const sigScale = Math.min(
      maxSigW / loadedSignature.naturalWidth,
      maxSigH / loadedSignature.naturalHeight,
      2
    );
    sigDrawW = Math.max(1, Math.round(loadedSignature.naturalWidth * sigScale));
    sigDrawH = Math.max(1, Math.round(loadedSignature.naturalHeight * sigScale));
  }

  const leftBlocks = [designBoxH, noteBoxH].filter((h) => h > 0);
  const leftFooterTotalH =
    leftBlocks.reduce((s, h) => s + h, 0) +
    Math.max(0, leftBlocks.length - 1) * 12;

  // 5 rows: Tổng giá trị đơn (38) + Tiền giảm (38) + Tiền ship (38) + Đã cọc (38) + Thanh toán còn lại (50) = 202px
  const summaryBoxH = 202;
  const preparerBlockH = hasPreparerBlock
    ? (loadedSignature ? 78 + sigDrawH : 88) + (hasPreparerName ? 24 : 0)
    : 0;
  const rightFooterTotalH =
    summaryBoxH + (preparerBlockH > 0 ? 18 + preparerBlockH : 0);
  const bottomSectionH = Math.max(leftFooterTotalH, rightFooterTotalH);

  const headerTopH = 78;
  const titleBlockH = 56;
  const computedHeight =
    6 +
    26 +
    headerTopH +
    titleBlockH +
    8 +
    (hasCustomer ? custH + 12 : 0) +
    tableHeaderH +
    tableBodyH +
    18 +
    bottomSectionH +
    28;

  const exactHeight = Math.max(520, computedHeight);

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = exactHeight * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  // White paper background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, exactHeight);

  // Top accent bar (ATD Logo Blue)
  ctx.fillStyle = LOGO_BLUE;
  ctx.fillRect(0, 0, width, 6);

  let y = 32;

  // 1A. Top Header Row: Left = [Company Logo in Corner] + Contact Info | Right = Ngày lập + Ngày nhận demo dự kiến (RED)
  let brandTextX = padX;
  if (loadedLogo) {
    const maxLogoW = 184;
    const maxLogoH = 72;
    const logoScale = Math.min(
      maxLogoW / loadedLogo.naturalWidth,
      maxLogoH / loadedLogo.naturalHeight,
      2
    );
    const drawW = Math.max(1, Math.round(loadedLogo.naturalWidth * logoScale));
    const drawH = Math.max(1, Math.round(loadedLogo.naturalHeight * logoScale));
    const logoY = y + Math.max(0, Math.round((66 - drawH) / 2));

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(loadedLogo, padX, logoY, drawW, drawH);
    ctx.restore();

    brandTextX = padX + drawW + 18;
  }

  ctx.textAlign = 'left';
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
    ctx.font = `600 15px ${BODY_FONT}`;
    ctx.fillText(contactLine1, brandTextX, y + 26);

    ctx.fillStyle = '#475569';
    ctx.font = `500 14.5px ${BODY_FONT}`;
    ctx.fillText(contactLine2, brandTextX, y + 51);
  } else if (contactLine1) {
    ctx.fillStyle = '#1E293B';
    ctx.font = `600 15px ${BODY_FONT}`;
    ctx.fillText(contactLine1, brandTextX, y + 38);
  } else if (contactLine2) {
    ctx.fillStyle = '#475569';
    ctx.font = `500 14.5px ${BODY_FONT}`;
    ctx.fillText(contactLine2, brandTextX, y + 38);
  }

  const rightX = width - padX;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#334155';
  ctx.font = `600 15px ${NUM_FONT}`;
  ctx.fillText(`Ngày lập: ${formatDateOnlyVN(payload.createdAt)}`, rightX, y + 24);

  const demoDateText = formatISODateVN(payload.expectedDemoDate);
  if (demoDateText) {
    ctx.fillStyle = '#DC2626';
    ctx.font = `800 15.5px ${NUM_FONT}`;
    ctx.fillText(`Ngày nhận demo dự kiến: ${demoDateText}`, rightX, y + 52);
  }

  y += headerTopH;

  // Divider below ATD Color info
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padX, y);
  ctx.lineTo(width - padX, y);
  ctx.stroke();

  // 1B. Large Centered PHIẾU ĐẶT HÀNG directly below ATD Color info
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0F172A';
  ctx.font = `800 32px ${DISPLAY_FONT}`;
  ctx.fillText(
    payload.store.invoiceTitle || 'PHIẾU ĐẶT HÀNG',
    width / 2,
    y + 40
  );

  y += titleBlockH + 8;

  // 2. Customer Line (Khách hàng · Mã khách hàng · SĐT)
  if (hasCustomer) {
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(padX, y, contentW, custH);
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.strokeRect(padX, y, contentW, custH);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#0F172A';
    ctx.font = `600 15.5px ${BODY_FONT}`;
    const custText = [
      payload.customer.name.trim()
        ? `Khách hàng: ${payload.customer.name.trim()}`
        : '',
      payload.customer.code.trim()
        ? `Mã khách hàng: ${payload.customer.code.trim()}`
        : '',
      payload.customer.phone.trim()
        ? `SĐT: ${payload.customer.phone.trim()}`
        : '',
    ]
      .filter(Boolean)
      .join('    ·    ');
    ctx.fillText(custText, padX + 14, y + 25);

    y += custH + 12;
  }

  // 3. Wide Landscape 6-Column Table (STT | NỘI DUNG & KÍCH THƯỚC | SỐ LƯỢNG | ĐƠN GIÁ | THÀNH TIỀN | GHI CHÚ)
  const sttSeparatorX = padX + colW.stt;
  const noteSeparatorX =
    padX + colW.stt + colW.name + colW.qty + colW.price + colW.total;

  ctx.fillStyle = LOGO_BLUE;
  ctx.fillRect(padX, y, contentW, tableHeaderH);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sttSeparatorX, y);
  ctx.lineTo(sttSeparatorX, y + tableHeaderH);
  ctx.moveTo(noteSeparatorX, y);
  ctx.lineTo(noteSeparatorX, y + tableHeaderH);
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 13px ${DISPLAY_FONT}`;
  let cx = padX;
  const thY = y + 26;

  ctx.textAlign = 'center';
  ctx.fillText('STT', cx + colW.stt / 2, thY);
  cx += colW.stt;

  ctx.textAlign = 'left';
  ctx.fillText('NỘI DUNG & KÍCH THƯỚC', cx + 14, thY);
  cx += colW.name;

  ctx.textAlign = 'center';
  ctx.fillText('SỐ LƯỢNG', cx + colW.qty / 2, thY);
  cx += colW.qty;

  ctx.textAlign = 'right';
  ctx.fillText('ĐƠN GIÁ', cx + colW.price - 12, thY);
  cx += colW.price;

  ctx.fillText('THÀNH TIỀN', cx + colW.total - 14, thY);
  cx += colW.total;

  ctx.textAlign = 'left';
  ctx.fillText('GHI CHÚ', cx + 14, thY);

  y += tableHeaderH;

  rowLayouts.forEach((row, idx) => {
    if (idx % 2 === 1) {
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(padX, y, contentW, row.rowHeight);
    }
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.strokeRect(padX, y, contentW, row.rowHeight);

    ctx.beginPath();
    ctx.moveTo(sttSeparatorX, y);
    ctx.lineTo(sttSeparatorX, y + row.rowHeight);
    ctx.moveTo(noteSeparatorX, y);
    ctx.lineTo(noteSeparatorX, y + row.rowHeight);
    ctx.stroke();

    let rx = padX;
    const rowBaseline = y + 29;

    ctx.textAlign = 'center';
    ctx.fillStyle = '#0F172A';
    ctx.font = `700 16.5px ${NUM_FONT}`;
    ctx.fillText(String(idx + 1), rx + colW.stt / 2, rowBaseline);
    rx += colW.stt;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#0F172A';
    ctx.font = `600 16.5px ${BODY_FONT}`;
    let ny = rowBaseline;
    row.nameLines.forEach((line) => {
      ctx.fillText(line, rx + 14, ny);
      ny += 24;
    });
    rx += colW.name;

    ctx.textAlign = 'center';
    ctx.fillStyle = '#0F172A';
    ctx.font = `700 17px ${NUM_FONT}`;
    ctx.fillText(
      formatNumberVN(row.item.quantity),
      rx + colW.qty / 2,
      rowBaseline
    );
    rx += colW.qty;

    ctx.textAlign = 'right';
    ctx.fillStyle = '#334155';
    ctx.font = `600 16.5px ${NUM_FONT}`;
    ctx.fillText(
      formatVND(row.item.unitPrice),
      rx + colW.price - 12,
      rowBaseline
    );
    rx += colW.price;

    const lineTotal = row.item.quantity * row.item.unitPrice;
    ctx.fillStyle = '#0F172A';
    ctx.font = `700 17px ${NUM_FONT}`;
    ctx.fillText(formatVND(lineTotal), rx + colW.total - 14, rowBaseline);
    rx += colW.total;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#475569';
    ctx.font = `400 15px ${BODY_FONT}`;
    let noteY = rowBaseline;
    row.noteLines.forEach((line) => {
      ctx.fillText(line, rx + 14, noteY);
      noteY += 24;
    });

    y += row.rowHeight;
  });

  y += 18;
  const footerStartY = y;

  // 4A. Bottom Left: Design Illustration (above Ghi chú) + Note + Preparer Signature
  let leftY = footerStartY;

  if (designLines.length > 0) {
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(padX, leftY, leftFooterW, designBoxH);
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.strokeRect(padX, leftY, leftFooterW, designBoxH);

    ctx.textAlign = 'left';
    ctx.font = `700 14.5px ${BODY_FONT}`;
    const prefix = 'Mẫu Thiết Kế đã đính kèm, ảnh minh họa: ';

    if (designLines.length === 1 && designLines[0].startsWith(prefix)) {
      ctx.fillStyle = '#0F172A';
      ctx.fillText(prefix, padX + 14, leftY + 23);
      const prefixW = ctx.measureText(prefix).width;
      ctx.fillStyle = '#1D4ED8';
      ctx.fillText(designVal, padX + 14 + prefixW, leftY + 23);
    } else {
      let dy = leftY + 23;
      ctx.fillStyle = '#0F172A';
      designLines.forEach((line) => {
        ctx.fillText(line, padX + 14, dy);
        dy += 22;
      });
    }

    leftY += designBoxH + 12;
  }

  if (noteLines.length > 0) {
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(padX, leftY, leftFooterW, noteBoxH);
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.strokeRect(padX, leftY, leftFooterW, noteBoxH);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#0F172A';
    ctx.font = `700 14px ${BODY_FONT}`;
    ctx.fillText('Ghi chú:', padX + 14, leftY + 22);

    let ny = leftY + 44;
    ctx.fillStyle = '#334155';
    ctx.font = `400 15px ${BODY_FONT}`;
    noteLines.forEach((line) => {
      ctx.fillText(line, padX + 14, ny);
      ny += 22;
    });

    leftY += noteBoxH + 12;
  }

  // 4B. Bottom Right: 5-Row Payment Summary Box + Right-Side Preparer Signature Block
  const sumX = width - padX - rightSummaryW;
  let sumY = footerStartY;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(sumX, sumY, rightSummaryW, summaryBoxH);
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;
  ctx.strokeRect(sumX, sumY, rightSummaryW, summaryBoxH);

  const drawSummaryRow = (
    label: string,
    valueText: string,
    valueColor: string,
    isBoldValue = false
  ) => {
    ctx.strokeStyle = '#E2E8F0';
    ctx.beginPath();
    ctx.moveTo(sumX, sumY + 38);
    ctx.lineTo(sumX + rightSummaryW, sumY + 38);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#334155';
    ctx.font = `600 15px ${BODY_FONT}`;
    ctx.fillText(label, sumX + 16, sumY + 25);

    ctx.textAlign = 'right';
    ctx.fillStyle = valueColor;
    ctx.font = `${isBoldValue ? 700 : 600} 17px ${NUM_FONT}`;
    ctx.fillText(valueText, sumX + rightSummaryW - 16, sumY + 25);

    sumY += 38;
  };

  drawSummaryRow(
    'Tổng giá trị đơn:',
    formatVND(payload.totals.subtotal),
    '#0F172A',
    true
  );

  drawSummaryRow(
    'Tiền giảm:',
    payload.totals.discountAmount > 0
      ? `-${formatVND(payload.totals.discountAmount)}`
      : '0đ',
    payload.totals.discountAmount > 0 ? '#DC2626' : '#475569'
  );

  drawSummaryRow(
    'Tiền ship:',
    payload.totals.shippingFee > 0
      ? formatVND(payload.totals.shippingFee)
      : '0đ',
    payload.totals.shippingFee > 0 ? '#0F172A' : '#475569'
  );

  drawSummaryRow(
    'Đã cọc:',
    payload.totals.depositAmount > 0
      ? formatVND(payload.totals.depositAmount)
      : '0đ',
    payload.totals.depositAmount > 0 ? '#1D4ED8' : '#475569'
  );

  // Final Row: THANH TOÁN CÒN LẠI (50px tall ATD Logo Blue bar)
  ctx.fillStyle = LOGO_BLUE;
  ctx.fillRect(sumX, sumY, rightSummaryW, 50);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 15.5px ${DISPLAY_FONT}`;
  ctx.fillText('THANH TOÁN CÒN LẠI:', sumX + 16, sumY + 31);

  ctx.textAlign = 'right';
  ctx.font = `800 22px ${NUM_FONT}`;
  ctx.fillText(
    formatVND(payload.totals.remainingAmount),
    sumX + rightSummaryW - 16,
    sumY + 33
  );

  if (hasPreparerBlock) {
    const prepStartY = footerStartY + summaryBoxH + 18;
    const sumCenterX = sumX + rightSummaryW / 2;

    ctx.textAlign = 'center';
    ctx.fillStyle = '#475569';
    ctx.font = `italic 400 13.5px ${BODY_FONT}`;
    ctx.fillText(
      formatSignatureDateVN(payload.createdAt),
      sumCenterX,
      prepStartY + 15
    );

    ctx.fillStyle = '#0F172A';
    ctx.font = `700 15.5px ${DISPLAY_FONT}`;
    ctx.fillText('Người lập báo giá', sumCenterX, prepStartY + 38);

    ctx.fillStyle = '#64748B';
    ctx.font = `italic 400 13px ${BODY_FONT}`;
    ctx.fillText('(Chữ ký, ghi rõ họ tên)', sumCenterX, prepStartY + 57);

    let nameBaselineY = prepStartY + 90;
    if (loadedSignature) {
      const sigTopY = prepStartY + 66;
      const sigLeftX = Math.round(sumCenterX - sigDrawW / 2);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(loadedSignature, sigLeftX, sigTopY, sigDrawW, sigDrawH);
      ctx.restore();
      nameBaselineY = sigTopY + sigDrawH + 22;
    }

    if (hasPreparerName) {
      ctx.fillStyle = '#0F172A';
      ctx.font = `700 17px ${DISPLAY_FONT}`;
      ctx.fillText(
        payload.store.preparerName.trim(),
        sumCenterX,
        nameBaselineY
      );
    }
  }

  return canvas;
}

export async function copyInvoiceImageToClipboard(
  payload: InvoiceExportPayload
): Promise<{ status: 'copied' } | { status: 'fallback'; dataUrl: string }> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  ) {
    try {
      const pngBlobPromise = renderInvoiceToCanvas(payload).then(
        (canvas) =>
          new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error('Không thể tạo ảnh PNG'));
            }, 'image/png');
          })
      );
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlobPromise }),
      ]);
      return { status: 'copied' };
    } catch {
      try {
        const canvas = await renderInvoiceToCanvas(payload);
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
        const canvas = await renderInvoiceToCanvas(payload);
        return { status: 'fallback', dataUrl: canvas.toDataURL('image/png', 1.0) };
      }
    }
  }

  const canvas = await renderInvoiceToCanvas(payload);
  return { status: 'fallback', dataUrl: canvas.toDataURL('image/png', 1.0) };
}

export async function exportInvoicePNG(
  payload: InvoiceExportPayload
): Promise<void> {
  const canvas = await renderInvoiceToCanvas(payload);
  const dataUrl = canvas.toDataURL('image/png', 1.0);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `Bao-Gia-ATD-Color.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function exportInvoicePDF(
  payload: InvoiceExportPayload
): Promise<void> {
  const canvas = await renderInvoiceToCanvas(payload);
  const pdfWidthMm = 297;
  const pdfHeightMm = Math.max(
    120,
    Math.round((canvas.height * pdfWidthMm) / canvas.width)
  );

  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [pdfWidthMm, pdfHeightMm],
    compress: true,
  });

  const imgData = canvas.toDataURL('image/jpeg', 0.96);
  pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidthMm, pdfHeightMm);
  pdf.save(`Bao-Gia-ATD-Color.pdf`);
}
