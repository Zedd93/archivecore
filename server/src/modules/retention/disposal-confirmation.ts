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
  boxes: Array<{ id: string; boxNumber: string; title: string; location: string | null }>;
};

export function parseDisposalConfirmation(record: {
  entityId: string | null;
  createdAt: Date;
  newValues: Prisma.JsonValue;
  tenant: { name: string } | null;
  user: { firstName: string; lastName: string };
}): DisposalConfirmation {
  const values = record.newValues;
  if (!record.entityId || !record.tenant || !values || typeof values !== 'object' || Array.isArray(values)) {
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
    tenantName: record.tenant.name,
    completedBy: `${record.user.firstName} ${record.user.lastName}`,
    completedAt: record.createdAt,
    protocolReference: values.protocolReference,
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

export function buildDisposalConfirmationPdf(record: DisposalConfirmation): Promise<Buffer> {
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
    doc.text(`Liczba kartonów: ${record.boxes.length}`);
    doc.moveDown(0.9).fontSize(15).fillColor('#155e75').text('Kartony objęte operacją');
    doc.moveDown(0.3);
    for (const [index, box] of record.boxes.entries()) {
      doc.fontSize(10).fillColor('#1f2937').text(`${index + 1}. ${box.boxNumber} - ${box.title}`, { continued: false });
      doc.fontSize(8).fillColor('#6b7280').text(`ID: ${box.id}  |  Lokalizacja przed brakowaniem: ${box.location || 'brak'}`, { paragraphGap: 6 });
    }
    doc.end();
  });
}
