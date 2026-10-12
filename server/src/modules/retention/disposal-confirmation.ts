import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';

export type DisposalConfirmation = {
  id: string;
  tenantName: string;
  completedBy: string;
  completedAt: Date;
  protocolReference: string;
  methodDescription: string | null;
  weightKg: number | null;
  executionNote: string | null;
  boxes: Array<{ id: string; boxNumber: string; title: string; location: string | null }>;
};

export type DisposalEvidenceImage = {
  fileName: string;
  checksumSha256: string;
  uploadedAt: Date;
  buffer: Buffer;
};

export function parseDisposalConfirmation(record: {
  entityId: string | null;
  createdAt: Date;
  newValues: Prisma.JsonValue;
  tenant: { name: string } | null;
  user: { firstName: string; lastName: string };
}): DisposalConfirmation {
  const values = record.newValues;
  if (!record.entityId || !values || typeof values !== 'object' || Array.isArray(values) ||
    (!record.tenant && typeof values.tenantName !== 'string')) {
    throw new Error('Niekompletny zapis brakowania');
  }
  const boxes = values.boxes;
  if (typeof values.protocolReference !== 'string' || !Array.isArray(boxes) || boxes.length === 0 ||
    boxes.some((box) => !box || typeof box !== 'object' || Array.isArray(box) ||
      typeof box.id !== 'string' || typeof box.boxNumber !== 'string' || typeof box.title !== 'string' ||
      (box.location !== null && typeof box.location !== 'string'))) {
    throw new Error('Niekompletny zapis brakowania');
  }
  return {
    id: record.entityId,
    tenantName: typeof values.tenantName === 'string' ? values.tenantName : record.tenant!.name,
    completedBy: typeof values.completedByName === 'string' ? values.completedByName : `${record.user.firstName} ${record.user.lastName}`,
    completedAt: record.createdAt,
    protocolReference: values.protocolReference,
    methodDescription: typeof values.methodDescription === 'string' ? values.methodDescription : null,
    weightKg: typeof values.weightKg === 'number' && Number.isFinite(values.weightKg) && values.weightKg > 0 ? values.weightKg : null,
    executionNote: typeof values.executionNote === 'string' ? values.executionNote : null,
    boxes: boxes as DisposalConfirmation['boxes'],
  };
}

function fontPath() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'assets', 'fonts', 'STIXTwoText.ttf'),
    path.resolve(process.cwd(), 'server', 'src', 'assets', 'fonts', 'STIXTwoText.ttf'),
    path.resolve(process.cwd(), 'src', 'assets', 'fonts', 'STIXTwoText.ttf'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Nie znaleziono czcionki dokumentu');
  return found;
}

export function buildDisposalConfirmationPdf(record: DisposalConfirmation, evidence: DisposalEvidenceImage[] = []): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Potwierdzenie brakowania ${record.protocolReference}`, Author: 'ArchiveCore' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('body', fontPath()).font('body');

    doc.fontSize(20).fillColor('#123047').text('Potwierdzenie wykonania brakowania');
    doc.moveDown(0.3).fontSize(9).fillColor('#6b7280').text('Dokument wygenerowany z zapisów systemu ArchiveCore. Nie jest podpisanym certyfikatem zniszczenia ani protokołem papierowym.');
    doc.moveDown(0.8).fontSize(11).fillColor('#1f2937');
    doc.text(`Klient: ${record.tenantName}`);
    doc.text(`Numer protokołu: ${record.protocolReference}`);
    doc.text(`Wykonano: ${record.completedAt.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
    doc.text(`Potwierdził w systemie: ${record.completedBy}`);
    doc.text(`Identyfikator operacji: ${record.id}`);
    doc.text(`PDF wygenerowano: ${new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
    doc.text(`Liczba kartonów: ${record.boxes.length}`);
    if (record.methodDescription || record.weightKg !== null || record.executionNote) {
      doc.moveDown(0.5).fontSize(9).fillColor('#6b7280').text('Dane zadeklarowane przez operatora przy potwierdzeniu:');
      doc.fontSize(11).fillColor('#1f2937');
      if (record.methodDescription) doc.text(`Metoda: ${record.methodDescription}`);
      if (record.weightKg !== null) doc.text(`Masa: ${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(record.weightKg)} kg`);
      if (record.executionNote) doc.text(`Uwagi: ${record.executionNote}`);
    }
    doc.moveDown(0.9).fontSize(15).fillColor('#155e75').text('Kartony objęte operacją');
    doc.moveDown(0.3);
    for (const [index, box] of record.boxes.entries()) {
      const heading = `${index + 1}. ${box.boxNumber} - ${box.title}`;
      const detail = `ID: ${box.id}  |  Lokalizacja przed brakowaniem: ${box.location || 'brak'}`;
      doc.fontSize(10);
      const headingHeight = doc.heightOfString(heading);
      doc.fontSize(8);
      const detailHeight = doc.heightOfString(detail);
      if (doc.y + headingHeight + detailHeight + 8 > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        doc.fontSize(15).fillColor('#155e75').text('Kartony objęte operacją (ciąg dalszy)', { paragraphGap: 8 });
      }
      doc.fontSize(10).fillColor('#1f2937').text(heading);
      doc.fontSize(8).fillColor('#6b7280').text(detail, { paragraphGap: 6 });
    }
    for (const [index, photo] of evidence.entries()) {
      doc.addPage();
      doc.fontSize(16).fillColor('#155e75').text(`Zdjęcie dowodowe ${index + 1}/${evidence.length}`);
      doc.moveDown(0.4).fontSize(9).fillColor('#1f2937').text(`Plik: ${photo.fileName}`);
      doc.text(`Przesłano: ${photo.uploadedAt.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
      doc.fontSize(8).fillColor('#6b7280').text(`SHA-256: ${photo.checksumSha256}`);
      doc.moveDown(0.7);
      doc.image(photo.buffer, 48, doc.y, { fit: [500, 540], align: 'center' });
    }
    doc.end();
  });
}
