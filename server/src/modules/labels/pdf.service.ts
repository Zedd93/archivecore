import PDFDocument from 'pdfkit';
import { qrService } from './qr.service';

// 1mm = 2.83465 points (PDF points)
const MM_TO_PT = 2.83465;

export interface LabelLayout {
  widthMm: number;
  heightMm: number;
  qrSizeMm: number;
  qrPositionX?: number; // mm from left
  qrPositionY?: number; // mm from top
  fields: LabelField[];
  fontSize?: number;
  fontFamily?: string;
}

export interface LabelField {
  key: string;
  label: string;
  x: number; // mm
  y: number; // mm
  maxWidth?: number; // mm
  fontSize?: number;
  bold?: boolean;
}

export interface LabelData {
  qrData: string;
  boxNumber: string;
  title: string;
  tenantName: string;
  location?: string;
  dateRange?: string;
  docType?: string;
  [key: string]: any;
}

export class PdfService {
  async generateLabel(layout: LabelLayout, data: LabelData): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        const widthPt = layout.widthMm * MM_TO_PT;
        const heightPt = layout.heightMm * MM_TO_PT;

        const doc = new PDFDocument({
          size: [widthPt, heightPt],
          margin: 0,
          info: {
            Title: `Etykieta - ${data.boxNumber}`,
            Author: 'ArchiveCore',
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Generate QR code image
        const qrSizePt = layout.qrSizeMm * MM_TO_PT;
        const qrX = (layout.qrPositionX || 2) * MM_TO_PT;
        const qrY = (layout.qrPositionY || 2) * MM_TO_PT;
        const qrBuffer = await qrService.generateBuffer(data.qrData, {
          width: Math.round(layout.qrSizeMm * 4), // 4x resolution
          errorCorrectionLevel: 'M',
        });
        doc.image(qrBuffer, qrX, qrY, { width: qrSizePt, height: qrSizePt });

        // Render text fields
        const baseFontSize = layout.fontSize || 8;
        for (const field of layout.fields) {
          const x = field.x * MM_TO_PT;
          const y = field.y * MM_TO_PT;
          const maxWidth = field.maxWidth ? field.maxWidth * MM_TO_PT : widthPt - x - 4;
          const fontSize = field.fontSize || baseFontSize;

          // Field label
          doc.font('Helvetica-Bold').fontSize(fontSize - 1);
          doc.text(field.label + ':', x, y, { width: maxWidth, lineBreak: false });

          // Field value
          const value = data[field.key] || '';
          doc.font(field.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
          doc.text(String(value), x, y + fontSize + 1, { width: maxWidth, lineBreak: true, ellipsis: true, height: fontSize * 2.5 });
        }

        // Border
        doc.rect(0.5, 0.5, widthPt - 1, heightPt - 1).stroke('#000000');

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  async generateMultipleLabels(layout: LabelLayout, labels: LabelData[], pageWidthMm: number = 210, pageHeightMm: number = 297): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        const pageW = pageWidthMm * MM_TO_PT;
        const pageH = pageHeightMm * MM_TO_PT;
        const labelW = layout.widthMm * MM_TO_PT;
        const labelH = layout.heightMm * MM_TO_PT;
        const marginPt = 10 * MM_TO_PT; // 10mm page margin
        const gapPt = 2 * MM_TO_PT; // 2mm gap between labels

        const cols = Math.floor((pageW - 2 * marginPt + gapPt) / (labelW + gapPt));
        const rows = Math.floor((pageH - 2 * marginPt + gapPt) / (labelH + gapPt));
        const perPage = cols * rows;

        const doc = new PDFDocument({
          size: 'A4',
          margin: 0,
          info: {
            Title: 'Etykiety - ArchiveCore',
            Author: 'ArchiveCore',
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        for (let i = 0; i < labels.length; i++) {
          if (i > 0 && i % perPage === 0) doc.addPage();

          const posOnPage = i % perPage;
          const col = posOnPage % cols;
          const row = Math.floor(posOnPage / cols);
          const x = marginPt + col * (labelW + gapPt);
          const y = marginPt + row * (labelH + gapPt);

          // Draw individual label at position
          await this.drawLabelAt(doc, layout, labels[i], x, y);
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private async drawLabelAt(doc: PDFKit.PDFDocument, layout: LabelLayout, data: LabelData, offsetX: number, offsetY: number) {
    const widthPt = layout.widthMm * MM_TO_PT;
    const heightPt = layout.heightMm * MM_TO_PT;
    const qrSizePt = layout.qrSizeMm * MM_TO_PT;
    const qrX = offsetX + (layout.qrPositionX || 2) * MM_TO_PT;
    const qrY = offsetY + (layout.qrPositionY || 2) * MM_TO_PT;

    // QR Code
    const qrBuffer = await qrService.generateBuffer(data.qrData, {
      width: Math.round(layout.qrSizeMm * 4),
      errorCorrectionLevel: 'M',
    });
    doc.image(qrBuffer, qrX, qrY, { width: qrSizePt, height: qrSizePt });

    // Fields
    const baseFontSize = layout.fontSize || 8;
    for (const field of layout.fields) {
      const x = offsetX + field.x * MM_TO_PT;
      const y = offsetY + field.y * MM_TO_PT;
      const maxWidth = field.maxWidth ? field.maxWidth * MM_TO_PT : widthPt - (field.x * MM_TO_PT) - 4;
      const fontSize = field.fontSize || baseFontSize;

      doc.font('Helvetica-Bold').fontSize(fontSize - 1);
      doc.text(field.label + ':', x, y, { width: maxWidth, lineBreak: false });

      const value = data[field.key] || '';
      doc.font(field.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      doc.text(String(value), x, y + fontSize + 1, { width: maxWidth, lineBreak: true, ellipsis: true, height: fontSize * 2.5 });
    }

    // Border
    doc.rect(offsetX + 0.5, offsetY + 0.5, widthPt - 1, heightPt - 1).stroke('#000000');
  }
}

export const pdfService = new PdfService();
