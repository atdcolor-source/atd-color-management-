import { formatNumberVN } from './formatters';

export interface ReorderTableRow {
  itemId: string;
  itemName: string;
  packSize: number;
  orderQuantity: number;
  orderUnitLabel: string;
}

export interface ReorderTableExportPayload {
  rows: ReorderTableRow[];
}

const NUM_FONT = '"Plus Jakarta Sans", "Be Vietnam Pro", sans-serif';
const BODY_FONT = '"Be Vietnam Pro", "Plus Jakarta Sans", sans-serif';
const DISPLAY_FONT = '"Plus Jakarta Sans", "Be Vietnam Pro", sans-serif';
const TABLE_BLUE = '#4887EE';

function truncateTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

export async function renderReorderTableToCanvas(
  payload: ReorderTableExportPayload
): Promise<HTMLCanvasElement> {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const rows = payload.rows;
  const width = 720;
  const padX = 36;
  const contentW = width - padX * 2; // 648px

  const colW = {
    name: 448,
    qty: 200,
  };

  const titleBlockH = 62;
  const thH = 44;
  const rowH = 48;
  const tableBodyH = Math.max(1, rows.length) * rowH;
  const bottomPadH = 34;

  const exactHeight = 4 + 26 + titleBlockH + thH + tableBodyH + bottomPadH;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = exactHeight * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  // Crisp white sheet background (no logo, no header metadata)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, exactHeight);

  // Clean top accent rule
  ctx.fillStyle = TABLE_BLUE;
  ctx.fillRect(0, 0, width, 4);

  let y = 30;

  // Centered Sheet Title
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0F172A';
  ctx.font = `800 21px ${DISPLAY_FONT}`;
  ctx.fillText('BẢNG SẢN PHẨM CẦN ĐẶT', width / 2, y + 26);

  y += titleBlockH;

  // 2-Column Ruled Table Header: SẢN PHẨM ĐẶT | SỐ LƯỢNG ĐẶT
  const xName = padX;
  const xQty = xName + colW.name;
  const xEnd = xQty + colW.qty;
  const tableStartY = y;

  ctx.fillStyle = TABLE_BLUE;
  ctx.fillRect(xName, y, contentW, thH);

  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xQty, y);
  ctx.lineTo(xQty, y + thH);
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 13.5px ${DISPLAY_FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('SẢN PHẨM ĐẶT', xName + 18, y + 27);

  ctx.textAlign = 'center';
  ctx.fillText('SỐ LƯỢNG ĐẶT', xQty + colW.qty / 2, y + 27);

  y += thH;

  // 2-Column Ruled Table Body (ONLY product name & order quantity e.g. "1 xấp")
  rows.forEach((row, idx) => {
    ctx.fillStyle = idx % 2 === 1 ? '#F8FAFC' : '#FFFFFF';
    ctx.fillRect(xName, y, contentW, rowH);

    // Row bottom divider
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xName, y + rowH);
    ctx.lineTo(xEnd, y + rowH);
    ctx.stroke();

    // Vertical column divider
    ctx.beginPath();
    ctx.moveTo(xQty, y);
    ctx.lineTo(xQty, y + rowH);
    ctx.stroke();

    // Col 1: Product Name
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0F172A';
    ctx.font = `700 15px ${BODY_FONT}`;
    const safeName = truncateTextToWidth(ctx, row.itemName, colW.name - 32);
    ctx.fillText(safeName, xName + 18, y + 30);

    // Col 2: Order Quantity ONLY (e.g. "1 xấp", "1 cuộn", "1 cây" — never "= 50 tờ")
    const mainQtyText = `${formatNumberVN(row.orderQuantity)} ${row.orderUnitLabel}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#3674DC';
    ctx.font = `800 15.5px ${NUM_FONT}`;
    ctx.fillText(mainQtyText, xQty + colW.qty / 2, y + 30);

    y += rowH;
  });

  // Outer crisp table border
  ctx.strokeStyle = '#94A3B8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(xName, tableStartY, contentW, thH + tableBodyH);

  return canvas;
}

export async function copyReorderTableImageToClipboard(
  payload: ReorderTableExportPayload
): Promise<{ status: 'copied' } | { status: 'fallback'; dataUrl: string }> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  ) {
    try {
      const pngBlobPromise = renderReorderTableToCanvas(payload).then(
        (canvas) =>
          new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error('Không thể tạo ảnh bảng sản phẩm cần đặt'));
            }, 'image/png');
          })
      );
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlobPromise }),
      ]);
      return { status: 'copied' };
    } catch {
      try {
        const canvas = await renderReorderTableToCanvas(payload);
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
        const canvas = await renderReorderTableToCanvas(payload);
        return {
          status: 'fallback',
          dataUrl: canvas.toDataURL('image/png', 1.0),
        };
      }
    }
  }

  const canvas = await renderReorderTableToCanvas(payload);
  return { status: 'fallback', dataUrl: canvas.toDataURL('image/png', 1.0) };
}

export async function exportReorderTablePNG(
  payload: ReorderTableExportPayload
): Promise<void> {
  const canvas = await renderReorderTableToCanvas(payload);
  const dataUrl = canvas.toDataURL('image/png', 1.0);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = 'Bang-San-Pham-Can-Dat.png';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
