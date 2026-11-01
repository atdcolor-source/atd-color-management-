import {
  CustomerInfo,
  InventoryItem,
  Product,
  QuoteItem,
  StoreSettings,
} from '../types';

export const CAT_PLASTIC = 'ÉP NHỰA - PLASTIC (Giấy In Chuẩn 300)';
export const CAT_FORMEX = 'IN DECAL + FORMEX (Chuẩn 5mm)';
export const CAT_MENU_DESIGN = 'THIẾT KẾ (Menu / Poster)';
export const LEGACY_CAT_MENU_DESIGN = 'THIẾT KẾ MENU (Theo kích thước)';
export const CAT_OTHER_PRODUCTS = 'SẢN PHẨM KHÁC';
export const CAT_DESIGN_SURCHARGE = 'PHỤ PHÍ THIẾT KẾ';

export const INITIAL_PRODUCTS: Product[] = [
  // 1. ÉP NHỰA - PLASTIC (Giấy In Chuẩn 300) - 1 MẶT
  {
    id: 'ep-1m-a3',
    code: 'EP-1M-A3',
    name: 'Ép Nhựa - Plastic (A3 - 1 Mặt)',
    category: CAT_PLASTIC,
    sides: '1 MẶT',
    size: 'A3',
    unit: 'Tờ',
    price: 37000,
  },
  {
    id: 'ep-1m-a4',
    code: 'EP-1M-A4',
    name: 'Ép Nhựa - Plastic (A4 - 1 Mặt)',
    category: CAT_PLASTIC,
    sides: '1 MẶT',
    size: 'A4',
    unit: 'Tờ',
    price: 29000,
  },
  {
    id: 'ep-1m-a5',
    code: 'EP-1M-A5',
    name: 'Ép Nhựa - Plastic (A5 - 1 Mặt)',
    category: CAT_PLASTIC,
    sides: '1 MẶT',
    size: 'A5',
    unit: 'Tờ',
    price: 17000,
  },

  // 2. ÉP NHỰA - PLASTIC (Giấy In Chuẩn 300) - 2 MẶT
  {
    id: 'ep-2m-a3',
    code: 'EP-2M-A3',
    name: 'Ép Nhựa - Plastic (A3 - 2 Mặt)',
    category: CAT_PLASTIC,
    sides: '2 MẶT',
    size: 'A3',
    unit: 'Tờ',
    price: 40000,
  },
  {
    id: 'ep-2m-a4',
    code: 'EP-2M-A4',
    name: 'Ép Nhựa - Plastic (A4 - 2 Mặt)',
    category: CAT_PLASTIC,
    sides: '2 MẶT',
    size: 'A4',
    unit: 'Tờ',
    price: 32000,
  },
  {
    id: 'ep-2m-a5',
    code: 'EP-2M-A5',
    name: 'Ép Nhựa - Plastic (A5 - 2 Mặt)',
    category: CAT_PLASTIC,
    sides: '2 MẶT',
    size: 'A5',
    unit: 'Tờ',
    price: 30000,
  },

  // 3. IN DECAL + FORMEX (Chuẩn 5mm) - 1 MẶT
  {
    id: 'fm-1m-a3',
    code: 'FM-1M-A3',
    name: 'In Decal + Formex 5mm (A3 - 1 Mặt)',
    category: CAT_FORMEX,
    sides: '1 MẶT',
    size: 'A3',
    unit: 'Bảng',
    price: 124000,
  },
  {
    id: 'fm-1m-a4',
    code: 'FM-1M-A4',
    name: 'In Decal + Formex 5mm (A4 - 1 Mặt)',
    category: CAT_FORMEX,
    sides: '1 MẶT',
    size: 'A4',
    unit: 'Bảng',
    price: 88000,
  },
  {
    id: 'fm-1m-a5',
    code: 'FM-1M-A5',
    name: 'In Decal + Formex 5mm (A5 - 1 Mặt)',
    category: CAT_FORMEX,
    sides: '1 MẶT',
    size: 'A5',
    unit: 'Bảng',
    price: 84000,
  },

  // 4. IN DECAL + FORMEX (Chuẩn 5mm) - 2 MẶT
  {
    id: 'fm-2m-a3',
    code: 'FM-2M-A3',
    name: 'In Decal + Formex 5mm (A3 - 2 Mặt)',
    category: CAT_FORMEX,
    sides: '2 MẶT',
    size: 'A3',
    unit: 'Bảng',
    price: 164000,
  },
  {
    id: 'fm-2m-a4',
    code: 'FM-2M-A4',
    name: 'In Decal + Formex 5mm (A4 - 2 Mặt)',
    category: CAT_FORMEX,
    sides: '2 MẶT',
    size: 'A4',
    unit: 'Bảng',
    price: 118000,
  },
  {
    id: 'fm-2m-a5',
    code: 'FM-2M-A5',
    name: 'In Decal + Formex 5mm (A5 - 2 Mặt)',
    category: CAT_FORMEX,
    sides: '2 MẶT',
    size: 'A5',
    unit: 'Bảng',
    price: 84000,
  },
];

export const LEGACY_FOOTER_NOTE =
  'Quý khách vui lòng kiểm tra kỹ kích thước và số lượng trước khi xác nhận in.';

export const DEFAULT_FOOTER_NOTE = [
  '- Sản phẩm bàn giao: file in ấn (CMYK) + file ảnh (PNG).',
  '- Thời gian làm việc: 11:00 AM – 23:00 PM.',
  '- Không hoàn tiền cọc với mọi lý do khách quan và chủ quan.',
  '- Những thông tin phát sinh ngoài thông tin đơn hàng sẽ tính theo phần phụ phí thỏa thuận.',
  '- Thông tin số lượng món xin niêm yết lại, trong trường hợp thêm hay bổ sung sau khi lên lịch sẽ có phụ phí.',
].join('\n');

export const PREVIOUS_FOOTER_NOTE = [
  LEGACY_FOOTER_NOTE,
  DEFAULT_FOOTER_NOTE,
].join('\n');

export const INITIAL_STORE_SETTINGS: StoreSettings = {
  companyName: 'ATD Color',
  address: 'Tân Hồng, Đồng Tháp',
  phone: '0967434893',
  email: 'atdcolor.com',
  tiktok: '@atdcolor2',
  preparerName: 'Nguyễn Tuấn Đạt',
  invoiceTitle: 'PHIẾU ĐẶT HÀNG',
  footerNote: DEFAULT_FOOTER_NOTE,
  showCalculator: true,
  showAiChat: true,
  logoVersion: '',
  signatureVersion: '',
};

export const INITIAL_CUSTOMER: CustomerInfo = {
  name: '',
  code: '',
  phone: '',
};

export const INITIAL_QUOTE_ITEMS: QuoteItem[] = [];

const INITIAL_INVENTORY_SEED_TIME = '2026-01-01T00:00:00.000Z';

export const OTHER_MATERIAL_PACK_PREFIX = 'Vật Liệu Khác · ';

export const LEGACY_V1_INVENTORY_IDS: readonly string[] = [
  'inv-plastic-a3',
  'inv-plastic-a4',
  'inv-decal-a3',
  'inv-decal-a4',
  'inv-formex-5mm',
  'inv-bang-keo',
  'inv-mang-no',
];

export const INITIAL_INVENTORY_ITEMS: InventoryItem[] = [
  {
    id: 'inv-v2-mang-bobb-bong',
    name: 'Màng BOBB bóng',
    unit: 'Cuộn',
    quantity: 1,
    minThreshold: 0,
    packSize: 1,
    packLabel: '1 cuộn',
    sortIndex: 0,
    createdAt: INITIAL_INVENTORY_SEED_TIME,
    updatedAt: INITIAL_INVENTORY_SEED_TIME,
  },
  {
    id: 'inv-v2-giay-anh-2m-230g-a3',
    name: 'Giấy In ảnh 2M 230g A3',
    unit: 'Tờ',
    quantity: 50,
    minThreshold: 10,
    packSize: 50,
    packLabel: '50 tờ cho 1 xấp',
    sortIndex: 1,
    createdAt: INITIAL_INVENTORY_SEED_TIME,
    updatedAt: INITIAL_INVENTORY_SEED_TIME,
  },
  {
    id: 'inv-v2-giay-anh-2m-230g-a4',
    name: 'Giấy In ảnh 2M 230g A4',
    unit: 'Tờ',
    quantity: 50,
    minThreshold: 10,
    packSize: 50,
    packLabel: '50 tờ cho 1 xấp',
    sortIndex: 2,
    createdAt: INITIAL_INVENTORY_SEED_TIME,
    updatedAt: INITIAL_INVENTORY_SEED_TIME,
  },
  {
    id: 'inv-v2-plastic-a3-80mic',
    name: 'Miếng Nhựa Plastic A3 80Mic',
    unit: 'Tờ',
    quantity: 100,
    minThreshold: 20,
    packSize: 100,
    packLabel: '100 tờ cho 1 xấp',
    sortIndex: 3,
    createdAt: INITIAL_INVENTORY_SEED_TIME,
    updatedAt: INITIAL_INVENTORY_SEED_TIME,
  },
  {
    id: 'inv-v2-plastic-a4-80mic',
    name: 'Miếng Nhựa Plastic A4 80Mic',
    unit: 'Tờ',
    quantity: 100,
    minThreshold: 20,
    packSize: 100,
    packLabel: '100 tờ cho 1 xấp',
    sortIndex: 4,
    createdAt: INITIAL_INVENTORY_SEED_TIME,
    updatedAt: INITIAL_INVENTORY_SEED_TIME,
  },
  {
    id: 'inv-v2-decal-135g-a4',
    name: 'Giấy Decal 135g A4',
    unit: 'Tờ',
    quantity: 50,
    minThreshold: 10,
    packSize: 50,
    packLabel: '50 tờ cho 1 xấp',
    sortIndex: 5,
    createdAt: INITIAL_INVENTORY_SEED_TIME,
    updatedAt: INITIAL_INVENTORY_SEED_TIME,
  },
  {
    id: 'inv-v2-decal-135g-a3',
    name: 'Giấy Decal 135g A3',
    unit: 'Tờ',
    quantity: 50,
    minThreshold: 10,
    packSize: 50,
    packLabel: '50 tờ cho 1 xấp',
    sortIndex: 6,
    createdAt: INITIAL_INVENTORY_SEED_TIME,
    updatedAt: INITIAL_INVENTORY_SEED_TIME,
  },
  {
    id: 'inv-v2-formex-a3',
    name: 'Formex A3',
    unit: 'Tấm',
    quantity: 20,
    minThreshold: 5,
    packSize: 20,
    packLabel: '20 tấm',
    sortIndex: 7,
    createdAt: INITIAL_INVENTORY_SEED_TIME,
    updatedAt: INITIAL_INVENTORY_SEED_TIME,
  },
  {
    id: 'inv-v2-formex-a4',
    name: 'Formex A4',
    unit: 'Tấm',
    quantity: 20,
    minThreshold: 5,
    packSize: 20,
    packLabel: '20 tấm',
    sortIndex: 8,
    createdAt: INITIAL_INVENTORY_SEED_TIME,
    updatedAt: INITIAL_INVENTORY_SEED_TIME,
  },
  // Vật Liệu Khác
  {
    id: 'inv-v2-other-bang-keo-trong',
    name: 'Băng Keo Trong',
    unit: 'Cây',
    quantity: 1,
    minThreshold: 0,
    packSize: 1,
    packLabel: `${OTHER_MATERIAL_PACK_PREFIX}1 cây`,
    sortIndex: 9,
    createdAt: INITIAL_INVENTORY_SEED_TIME,
    updatedAt: INITIAL_INVENTORY_SEED_TIME,
  },
  {
    id: 'inv-v2-other-bang-keo-nguy-hiem',
    name: 'Băng Keo Nguy Hiểm',
    unit: 'Cây',
    quantity: 1,
    minThreshold: 0,
    packSize: 1,
    packLabel: `${OTHER_MATERIAL_PACK_PREFIX}1 cây`,
    sortIndex: 10,
    createdAt: INITIAL_INVENTORY_SEED_TIME,
    updatedAt: INITIAL_INVENTORY_SEED_TIME,
  },
  {
    id: 'inv-v2-other-chong-soc',
    name: 'Chống Sốc',
    unit: 'Cuộn',
    quantity: 1,
    minThreshold: 0,
    packSize: 1,
    packLabel: `${OTHER_MATERIAL_PACK_PREFIX}1 cuộn`,
    sortIndex: 11,
    createdAt: INITIAL_INVENTORY_SEED_TIME,
    updatedAt: INITIAL_INVENTORY_SEED_TIME,
  },
];

