import PDFDocument from 'pdfkit';

const PNG_PREFIX = 'data:image/png;base64,';

export function validateDisposalSignature(data: string): Buffer {
  if (typeof data !== 'string' || data.length > 170_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw Object.assign(new Error('Podpis musi być obrazem PNG do 120 KB'), { statusCode: 400 });
  }
  const image = Buffer.from(data.slice(PNG_PREFIX.length), 'base64');
  if (image.length === 0 || image.length > 120_000 ||
    !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw Object.assign(new Error('Podpis musi być obrazem PNG do 120 KB'), { statusCode: 400 });
  }
  try {
    const document = new PDFDocument({ autoFirstPage: false }) as unknown as {
      openImage(data: Buffer): { width: number; height: number };
    };
    const decoded = document.openImage(image);
    if (decoded.width < 1 || decoded.height < 1 || decoded.width > 1200 || decoded.height > 400) {
      throw new Error('Invalid image dimensions');
    }
  } catch {
    throw Object.assign(new Error('Podpis jest uszkodzony lub ma nieprawidłowe wymiary'), { statusCode: 400 });
  }
  return image;
}
