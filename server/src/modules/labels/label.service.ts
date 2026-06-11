import { prisma, Prisma } from '../../config/database';
import { pdfService, LabelLayout, LabelData, LabelField } from './pdf.service';
import { qrService } from './qr.service';
import { DOC_TYPE_LABELS } from '@archivecore/shared';

// Default label template: 70mm x 36mm (standard archive label)
const DEFAULT_LAYOUT: LabelLayout = {
  widthMm: 70,
  heightMm: 36,
  qrSizeMm: 20,
  qrPositionX: 2,
  qrPositionY: 2,
  fontSize: 7,
  fields: [
    { key: 'boxNumber', label: 'Nr kartonu', x: 25, y: 2, maxWidth: 43, fontSize: 9, bold: true },
    { key: 'title', label: 'Tytuł', x: 25, y: 12, maxWidth: 43, fontSize: 7 },
    { key: 'tenantName', label: 'Klient', x: 2, y: 24, maxWidth: 35, fontSize: 6 },
    { key: 'location', label: 'Lokalizacja', x: 40, y: 24, maxWidth: 28, fontSize: 6 },
    { key: 'dateRange', label: 'Okres', x: 2, y: 30, maxWidth: 30, fontSize: 6 },
    { key: 'docType', label: 'Typ dok.', x: 35, y: 30, maxWidth: 33, fontSize: 6 },
  ],
};

export class LabelService {
  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private async findBoxByIdentifier(identifier: string, tenantId: string) {
    const trimmed = identifier.trim();
    if (!trimmed) return null;

    return prisma.box.findFirst({
      where: {
        tenantId,
        OR: [
          ...(this.isUuid(trimmed) ? [{ id: trimmed }] : []),
          { boxNumber: { equals: trimmed, mode: 'insensitive' } },
        ],
      },
      include: {
        tenant: { select: { name: true, shortCode: true } },
        location: { select: { fullPath: true, code: true } },
      },
    });
  }

  async getTemplates(tenantId: string) {
    return prisma.labelTemplate.findMany({
      where: { OR: [{ tenantId }, { tenantId: null }] },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getTemplate(id: string, tenantId: string) {
    const template = await prisma.labelTemplate.findFirst({
      where: {
        id,
        OR: [{ tenantId }, { tenantId: null }],
      },
    });
    if (!template) throw Object.assign(new Error('Szablon etykiety nie znaleziony'), { statusCode: 404 });
    return template;
  }

  async createTemplate(tenantId: string, data: any) {
    const name = String(data.name || '').trim();
    const widthMm = Number(data.widthMm);
    const heightMm = Number(data.heightMm);
    const qrSizeMm = Number(data.qrSizeMm || 20);

    if (!name) throw Object.assign(new Error('Nazwa szablonu jest wymagana'), { statusCode: 400 });
    if (!Number.isFinite(widthMm) || widthMm <= 0) throw Object.assign(new Error('Szerokość etykiety musi być większa od 0'), { statusCode: 400 });
    if (!Number.isFinite(heightMm) || heightMm <= 0) throw Object.assign(new Error('Wysokość etykiety musi być większa od 0'), { statusCode: 400 });
    if (!Number.isFinite(qrSizeMm) || qrSizeMm <= 0) throw Object.assign(new Error('Rozmiar QR musi być większy od 0'), { statusCode: 400 });
    if (qrSizeMm > widthMm || qrSizeMm > heightMm) throw Object.assign(new Error('Rozmiar QR nie może być większy niż etykieta'), { statusCode: 400 });

    const isDefault = Boolean(data.isDefault);
    const createData = {
      tenantId,
      name,
      widthMm,
      heightMm,
      qrSizeMm,
      qrErrorLevel: data.qrErrorLevel || 'M',
      layoutJson: data.layoutJson || DEFAULT_LAYOUT.fields,
      fields: data.fields || DEFAULT_LAYOUT.fields.map(f => f.key),
      isDefault,
    };

    if (!isDefault) {
      return prisma.labelTemplate.create({ data: createData });
    }

    return prisma.$transaction(async (tx) => {
      await tx.labelTemplate.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
      return tx.labelTemplate.create({ data: createData });
    });
  }

  async generateForBox(boxIdentifier: string, tenantId: string, templateId?: string, userId?: string): Promise<Buffer> {
    const box = await this.findBoxByIdentifier(boxIdentifier, tenantId);
    if (!box) throw Object.assign(new Error('Karton nie znaleziony'), { statusCode: 404 });

    const template = templateId
      ? await this.getTemplate(templateId, tenantId)
      : await this.getDefaultTemplate(tenantId);
    const layout = this.templateToLayout(template);

    const labelData: LabelData = {
      qrData: box.qrCode,
      boxNumber: box.boxNumber,
      title: box.title,
      tenantName: box.tenant.name,
      location: box.location?.fullPath || '-',
      dateRange: formatDateRange(box.dateFrom, box.dateTo),
      docType: box.docType ? DOC_TYPE_LABELS[box.docType] || box.docType : '-',
    };

    const pdf = await pdfService.generateLabel(layout, labelData);

    // Save label record
    if (userId) {
      await prisma.label.create({
        data: {
          boxId: box.id,
          templateId: template.id,
          qrData: box.qrCode,
          generatedBy: userId,
          printCount: 1,
          lastPrintedAt: new Date(),
        },
      });
    }

    return pdf;
  }

  async generateForBoxes(boxIdentifiers: string[], tenantId: string, templateId?: string, userId?: string): Promise<Buffer> {
    const identifiers = boxIdentifiers.map((id) => id.trim()).filter(Boolean);
    if (identifiers.length === 0) {
      throw Object.assign(new Error('Wymagana lista numerów kartonów'), { statusCode: 400 });
    }

    const uuidIdentifiers = identifiers.filter((id) => this.isUuid(id));
    const boxes = await prisma.box.findMany({
      where: {
        tenantId,
        OR: [
          ...identifiers.map((identifier) => ({ boxNumber: { equals: identifier, mode: 'insensitive' as const } })),
          ...(uuidIdentifiers.length > 0 ? [{ id: { in: uuidIdentifiers } }] : []),
        ],
      },
      include: {
        tenant: { select: { name: true, shortCode: true } },
        location: { select: { fullPath: true, code: true } },
      },
    });

    if (boxes.length === 0) throw Object.assign(new Error('Nie znaleziono kartonów'), { statusCode: 404 });

    const foundIdentifiers = new Set<string>();
    for (const box of boxes) {
      foundIdentifiers.add(box.id.toLowerCase());
      foundIdentifiers.add(box.boxNumber.toLowerCase());
    }
    const missing = identifiers.filter((identifier) => !foundIdentifiers.has(identifier.toLowerCase()));
    if (missing.length > 0) {
      throw Object.assign(new Error(`Nie znaleziono kartonów: ${missing.join(', ')}`), { statusCode: 404 });
    }

    const template = templateId
      ? await this.getTemplate(templateId, tenantId)
      : await this.getDefaultTemplate(tenantId);
    const layout = this.templateToLayout(template);

    const labelsData: LabelData[] = boxes.map(box => ({
      qrData: box.qrCode,
      boxNumber: box.boxNumber,
      title: box.title,
      tenantName: box.tenant.name,
      location: box.location?.fullPath || '-',
      dateRange: formatDateRange(box.dateFrom, box.dateTo),
      docType: box.docType ? DOC_TYPE_LABELS[box.docType] || box.docType : '-',
    }));

    return pdfService.generateMultipleLabels(layout, labelsData);
  }

  async getQrCodeImage(boxIdentifier: string, tenantId: string, format: 'png' | 'svg' | 'dataurl' = 'png') {
    const box = await this.findBoxByIdentifier(boxIdentifier, tenantId);
    if (!box) throw Object.assign(new Error('Karton nie znaleziony'), { statusCode: 404 });

    switch (format) {
      case 'svg':
        return { data: await qrService.generateSvg(box.qrCode), contentType: 'image/svg+xml' };
      case 'dataurl':
        return { data: await qrService.generateDataUrl(box.qrCode), contentType: 'text/plain' };
      default:
        return { data: await qrService.generateBuffer(box.qrCode), contentType: 'image/png' };
    }
  }

  private templateToLayout(template: Awaited<ReturnType<typeof this.getDefaultTemplate>>): LabelLayout {
    return {
      widthMm: Number(template.widthMm),
      heightMm: Number(template.heightMm),
      qrSizeMm: Number(template.qrSizeMm),
      fields: template.layoutJson as unknown as LabelField[],
      fontSize: 7,
    };
  }

  private async getDefaultTemplate(tenantId: string) {
    let template = await prisma.labelTemplate.findFirst({
      where: { tenantId, isDefault: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!template) {
      template = await prisma.labelTemplate.findFirst({
        where: { tenantId: null, isDefault: true },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!template) {
      template = await prisma.labelTemplate.create({
        data: {
          tenantId,
          name: 'Domyślny (70x36mm)',
          widthMm: 70,
          heightMm: 36,
          qrSizeMm: 20,
          qrErrorLevel: 'M',
          layoutJson: DEFAULT_LAYOUT.fields as unknown as Prisma.InputJsonValue,
          fields: DEFAULT_LAYOUT.fields.map(f => f.key),
          isDefault: true,
        },
      });
    }
    return template;
  }
}

function formatDateRange(from: Date | null, to: Date | null): string {
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  if (from && to) return `${fmt(from)} — ${fmt(to)}`;
  if (from) return `od ${fmt(from)}`;
  if (to) return `do ${fmt(to)}`;
  return '-';
}

export const labelService = new LabelService();
