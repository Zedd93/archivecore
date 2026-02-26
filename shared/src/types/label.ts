export type QrErrorLevel = 'L' | 'M' | 'Q' | 'H';

export interface ILabel {
  id: string;
  boxId: string;
  templateId: string;
  qrData: string;
  generatedBy: string;
  generatedAt: string;
  printCount: number;
  lastPrintedAt: string | null;
}

export interface ILabelTemplate {
  id: string;
  tenantId: string | null;
  name: string;
  widthMm: number;
  heightMm: number;
  layoutJson: Record<string, unknown>;
  fields: string[];
  qrSizeMm: number;
  qrErrorLevel: QrErrorLevel;
  isDefault: boolean;
  createdAt: string;
}

export interface ICreateLabelTemplate {
  name: string;
  widthMm: number;
  heightMm: number;
  layoutJson: Record<string, unknown>;
  fields: string[];
  qrSizeMm: number;
  qrErrorLevel?: QrErrorLevel;
  isDefault?: boolean;
}

export interface IGenerateLabelRequest {
  boxIds: string[];
  templateId: string;
}
