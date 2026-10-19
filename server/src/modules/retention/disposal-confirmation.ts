import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { validateDisposalSignature } from './disposal-signature';

export type DisposalConfirmation = {
  id: string;
  tenantName: string;
  tenantNip: string | null;
  tenantAddress: string | null;
  completedBy: string;
  completedAt: Date;
  protocolReference: string;
  methodDescription: string | null;
  weightKg: number | null;
  standardReference: string | null;
  signatureData: string | null;
  executionNote: string | null;
  boxes: Array<{
    id: string; boxNumber: string; title: string; location: string | null;
    apDecision?: 'consent_received' | 'not_required' | null;
    apDecisionReference?: string | null;
    apDecisionDate?: string | null;
    apDecisionReason?: string | null;
  }>;
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
    tenantNip: typeof values.tenantNip === 'string' ? values.tenantNip : null,
    tenantAddress: typeof values.tenantAddress === 'string' ? values.tenantAddress : null,
    completedBy: typeof values.completedByName === 'string' ? values.completedByName : `${record.user.firstName} ${record.user.lastName}`,
    completedAt: record.createdAt,
    protocolReference: values.protocolReference,
    methodDescription: typeof values.methodDescription === 'string' ? values.methodDescription : null,
    weightKg: typeof values.weightKg === 'number' && Number.isFinite(values.weightKg) && values.weightKg > 0 ? values.weightKg : null,
    standardReference: typeof values.standardReference === 'string' ? values.standardReference : null,
    signatureData: typeof values.signatureData === 'string' ? values.signatureData : null,
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

export type DisposalPdfKind = 'confirmation' | 'protocol' | 'certificate';

export function buildDisposalConfirmationPdf(record: DisposalConfirmation, evidence: DisposalEvidenceImage[] = [], kind: DisposalPdfKind = 'confirmation'): Promise<Buffer> {
  if (kind === 'certificate' && (!record.methodDescription || record.weightKg === null || !record.standardReference || !record.signatureData || evidence.length === 0)) {
    throw Object.assign(new Error('Certyfikat wymaga zapisanej metody, masy, normy, podpisu operatora i co najmniej jednego zdjęcia dowodowego.'), { statusCode: 409 });
  }
  const signature = record.signatureData ? validateDisposalSignature(record.signatureData) : null;
  return new Promise((resolve, reject) => {
    const title = kind === 'certificate' ? 'Certyfikat zniszczenia dokumentów' : kind === 'protocol' ? 'Protokół wykonania brakowania' : 'Potwierdzenie wykonania brakowania';
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `${title} ${record.protocolReference}`, Author: 'ArchiveCore' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('body', fontPath()).font('body');

    if (kind === 'certificate') {
      doc.fontSize(18).fillColor('#123047').text('DoXart', { align: 'center' });
      doc.moveDown(1).fontSize(22).text('CERTYFIKAT', { align: 'center' });
      doc.fontSize(15).text('ZNISZCZENIA DOKUMENTÓW', { align: 'center' });
      doc.moveDown(0.2).fontSize(11).text(`Nr ${record.protocolReference}`, { align: 'center' });
    } else {
      doc.fontSize(20).fillColor('#123047').text(title);
      doc.moveDown(0.3).fontSize(9).fillColor('#6b7280').text('Dokument wygenerowany z zapisów systemu ArchiveCore. Podpis graficzny nie jest kwalifikowanym podpisem elektronicznym.');
    }
    doc.moveDown(0.8).fontSize(11).fillColor('#1f2937');
    doc.text(`Klient: ${record.tenantName}`);
    if (record.tenantNip) doc.text(`NIP: ${record.tenantNip}`);
    if (record.tenantAddress) doc.text(`Adres: ${record.tenantAddress}`);
    doc.text(`Numer protokołu: ${record.protocolReference}`);
    doc.text(`Wykonano: ${record.completedAt.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
    doc.text(`Potwierdził w systemie: ${record.completedBy}`);
    doc.text(`Identyfikator operacji: ${record.id}`);
    doc.text(`PDF wygenerowano: ${new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
    doc.text(`Liczba kartonów: ${record.boxes.length}`);
    if (record.methodDescription || record.weightKg !== null || record.standardReference || record.executionNote) {
      doc.moveDown(0.5).fontSize(9).fillColor('#6b7280').text('Dane zadeklarowane przez operatora przy potwierdzeniu:');
      doc.fontSize(11).fillColor('#1f2937');
      if (record.methodDescription) doc.text(`Metoda: ${record.methodDescription}`);
      if (record.weightKg !== null) doc.text(`Masa: ${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(record.weightKg)} kg`);
      if (record.standardReference) doc.text(`Norma / klasa niszczenia (deklaracja operatora): ${record.standardReference}`);
      if (record.executionNote) doc.text(`Uwagi: ${record.executionNote}`);
    }
    if (kind === 'certificate') {
      doc.moveDown(0.8).fontSize(10).fillColor('#1f2937').text('Osoba wskazana poniżej potwierdziła w systemie wykonanie zniszczenia dokumentacji objętej tym numerem protokołu, według zadeklarowanej metody i normy. Zdjęcia dowodowe oraz zakres kartonów stanowią dalsze strony dokumentu.');
    }
    if (signature) {
      if (doc.y > doc.page.height - 180) doc.addPage();
      doc.moveDown(0.7).fontSize(9).fillColor('#6b7280').text(`Podpis graficzny osoby potwierdzającej: ${record.completedBy}`);
      const imageY = doc.y + 4;
      doc.image(signature, 48, imageY, { fit: [230, 80] });
      doc.y = imageY + 85;
      doc.fontSize(8).text('Podpis złożony w aplikacji; nie jest kwalifikowanym podpisem elektronicznym.');
    } else if (kind === 'protocol') {
      doc.moveDown(0.7).fontSize(9).fillColor('#6b7280').text('Podpis graficzny: brak w zapisie tej operacji.');
    }
    doc.moveDown(0.9).fontSize(15).fillColor('#155e75').text('Kartony objęte operacją');
    doc.moveDown(0.3);
    for (const [index, box] of record.boxes.entries()) {
      const heading = `${index + 1}. ${box.boxNumber} - ${box.title}`;
      const detail = `ID: ${box.id}  |  Lokalizacja przed brakowaniem: ${box.location || 'brak'}`;
      const apDetail = box.apDecision === 'consent_received'
        ? `Zgoda AP: ${box.apDecisionReference || 'brak numeru'}, ${box.apDecisionDate || 'brak daty'}`
        : box.apDecision === 'not_required'
          ? `Zgoda AP niewymagana: ${box.apDecisionReason || 'brak uzasadnienia'}`
          : null;
      doc.fontSize(10);
      const headingHeight = doc.heightOfString(heading);
      doc.fontSize(8);
      const detailHeight = doc.heightOfString(detail);
      const apDetailHeight = apDetail ? doc.heightOfString(apDetail) : 0;
      if (doc.y + headingHeight + detailHeight + apDetailHeight + 8 > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        doc.fontSize(15).fillColor('#155e75').text('Kartony objęte operacją (ciąg dalszy)', { paragraphGap: 8 });
      }
      doc.fontSize(10).fillColor('#1f2937').text(heading);
      doc.fontSize(8).fillColor('#6b7280').text(detail, { paragraphGap: 6 });
      if (apDetail) doc.text(apDetail, { paragraphGap: 6 });
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
