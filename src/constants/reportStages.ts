import { ReportStage } from '../types';

export interface ReportStageMeta {
  value: ReportStage;
  label: string;
  badgeClass: string;
}

export const REPORT_STAGE_OPTIONS: ReportStageMeta[] = [
  {
    value: 'bao_gia',
    label: 'Báo giá',
    badgeClass: 'text-[#3674DC]',
  },
  {
    value: 'cham_soc',
    label: 'Chăm sóc',
    badgeClass: 'text-amber-700',
  },
  {
    value: 'coc',
    label: 'Cọc',
    badgeClass: 'text-emerald-700',
  },
  {
    value: 'chot_in',
    label: 'Chốt in',
    badgeClass: 'text-indigo-700',
  },
  {
    value: 'chot_thiet_ke',
    label: 'Chốt thiết kế',
    badgeClass: 'text-violet-700',
  },
  {
    value: 'hoan_thanh',
    label: 'Hoàn thành',
    badgeClass: 'text-emerald-700',
  },
];

const VALID_STAGE_SET = new Set<string>(
  REPORT_STAGE_OPTIONS.map((opt) => opt.value)
);

export function sanitizeReportStage(raw: unknown): ReportStage | '' {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (VALID_STAGE_SET.has(trimmed)) {
    return trimmed as ReportStage;
  }
  return '';
}

export function getReportStageLabel(stage?: ReportStage | '' | null): string {
  if (!stage) return 'Chưa phân loại';
  const found = REPORT_STAGE_OPTIONS.find((opt) => opt.value === stage);
  return found ? found.label : 'Chưa phân loại';
}
