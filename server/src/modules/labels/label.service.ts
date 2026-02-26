import { prisma, Prisma } from '../../config/database';
import { pdfService, LabelLayout, LabelData, LabelField } from './pdf.service';
import { qrService } from './qr.service';
import { generateQrData } from '@archivecore/shared';

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
  async getTemplates(tenantId: string) {
    return prisma.labelTemplate.findMany({
      where: { OR: [{ tenantId }, { tenantId: null }] },
      orderBy: { isDefault: 'desc' },
    });
  }

  async getTemplate(id: string) {
    const template = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!template) throw Object.assign(new Error('Szablon etykiety nie znaleziony'), { statusCode: 404 });
    return template;
  }

  async createTemplate(tenantId: string, data: any) {
    return prisma.labelTemplate.create({
      data: {
        tenantId,
        name: data.name,
        widthMm: data.widthMm,
        heightMm: data.heightMm,
        qrSizeMm: data.qrSizeMm || 20,
        qrErrorLevel: data.qrErrorLevel || 'M',
        layoutJson: data.layoutJson || DEFAULT_LAYOUT.fields,
        fields: data.fields || DEFAULT_LAYOUT.fields.map(f => f.key),
        isDefault: data.isDefault || false,
      },
    });
  }

  async generateForBox(boxId: string, tenantId: string, templateId?: string, userId?: string): Promise<Buffer> {
    const box = await prisma.box.findFirst({
      where: { id: boxId, tenantId },
      include: {
        tenant: { select: { name: true, shortCode: true } },
        location: { select: { fullPath: true, code: true } },
      },
    });
    if (!box) throw Object.assign(new Error('Karton nie znaleziony'), { statusCode: 404 });

    let layout = DEFAULT_LAYOUT;
    if (templateId) {
      const template = await this.getTemplate(templateId);
      layout = {
        widthMm: Number(template.widthMm),
        heightMm: Number(template.heightMm),
        qrSizeMm: Number(template.qrSizeMm),
        fields: template.layoutJson as unknown as LabelField[],
        fontSize: 7,
      };
    }

    const labelData: LabelData = {
      qrData: box.qrCode,
      boxNumber: box.boxNumber,
      title: box.title,
      tenantName: box.tenant.name,
      location: box.location?.fullPath || '-',
      dateRange: formatDateRange(box.dateFrom, box.dateTo),
      docType: box.docType || '-',
    };

    const pdf = await pdfService.generateLabel(layout, labelData);

    // Save label record
    if (userId) {
      const defaultTemplate = templateId
        ? { connect: { id: templateId } }
        : await this.getOrCreateDefaultTemplate(tenantId);

      await prisma.label.create({
        data: {
          boxId,
          templateId: templateId || (await this.getDefaultTemplateId(tenantId)),
          qrData: box.qrCode,
          generatedBy: userId,
          printCount: 1,
          lastPrintedAt: new Date(),
        },
      });
    }

    return pdf;
  }

  async generateForBoxes(boxIds: string[], tenantId: string, templateId?: string, userId?: string): Promise<Buffer> {
    const boxes = await prisma.box.findMany({
      where: { id: { in: boxIds }, tenantId },
      include: {
        tenant: { select: { name: true, shortCode: true } },
        location: { select: { fullPath: true, code: true } },
      },
    });

    if (boxes.length === 0) throw Object.assign(new Error('Nie znaleziono kartonów'), { statusCode: 404 });

    let layout = DEFAULT_LAYOUT;
    if (templateId) {
      const template = await this.getTemplate(templateId);
      layout = {
        widthMm: Number(template.widthMm),
        heightMm: Number(template.heightMm),
        qrSizeMm: Number(template.qrSizeMm),
        fields: template.layoutJson as unknown as LabelField[],
        fontSize: 7,
      };
    }

    const labelsData: LabelData[] = boxes.map(box => ({
      qrData: box.qrCode,
      boxNumber: box.boxNumber,
      title: box.title,
      tenantName: box.tenant.name,
      location: box.location?.fullPath || '-',
      dateRange: formatDateRange(box.dateFrom, box.dateTo),
      docType: box.docType || '-',
    }));

    return pdfService.generateMultipleLabels(layout, labelsData);
  }

  async getQrCodeImage(boxId: string, tenantId: string, format: 'png' | 'svg' | 'dataurl' = 'png') {
    const box = await prisma.box.findFirst({
      where: { id: boxId, tenantId },
    });
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

  private async getDefaultTemplateId(tenantId: string): Promise<string> {
    let template = await prisma.labelTemplate.findFirst({
      where: { OR: [{ tenantId }, { tenantId: null }], isDefault: true },
    });
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
    return template.id;
  }

  private async getOrCreateDefaultTemplate(tenantId: string) {
    const id = await this.getDefaultTemplateId(tenantId);
    return { connect: { id } };
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
