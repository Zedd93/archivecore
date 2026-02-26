import QRCode from 'qrcode';

export interface QrOptions {
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  width?: number;
  margin?: number;
}

export class QrService {
  async generateDataUrl(data: string, options: QrOptions = {}): Promise<string> {
    return QRCode.toDataURL(data, {
      errorCorrectionLevel: options.errorCorrectionLevel || 'M',
      width: options.width || 200,
      margin: options.margin || 2,
    });
  }

  async generateBuffer(data: string, options: QrOptions = {}): Promise<Buffer> {
    return QRCode.toBuffer(data, {
      errorCorrectionLevel: options.errorCorrectionLevel || 'M',
      width: options.width || 200,
      margin: options.margin || 2,
      type: 'png',
    });
  }

  async generateSvg(data: string, options: QrOptions = {}): Promise<string> {
    return QRCode.toString(data, {
      errorCorrectionLevel: options.errorCorrectionLevel || 'M',
      width: options.width || 200,
      margin: options.margin || 2,
      type: 'svg',
    });
  }
}

export const qrService = new QrService();
