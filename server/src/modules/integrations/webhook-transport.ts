import { createHmac } from 'crypto';
import { lookup } from 'dns/promises';
import https from 'https';
import { isIP } from 'net';

export function validateWebhookUrl(input: string) {
  if (input.length > 2048) throw new Error('Adres webhooka jest zbyt długi');
  let url: URL;
  try { url = new URL(input); }
  catch { throw new Error('Nieprawidłowy adres webhooka'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) {
    throw new Error('Webhook wymaga publicznego adresu HTTPS na porcie 443, bez danych logowania i fragmentu');
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname.includes('.') || isIP(hostname) || hostname.endsWith('.local') || hostname.endsWith('.localhost')) {
    throw new Error('Webhook wymaga publicznej nazwy domenowej');
  }
  return url.toString();
}

export function isPublicIpv4(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168 || (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export function signWebhook(secret: string, timestamp: string, payloadText: string) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${payloadText}`).digest('hex')}`;
}

export async function sendWebhook(urlText: string, secret: string, eventId: string, payloadText: string) {
  const url = new URL(validateWebhookUrl(urlText));
  const addresses = await lookup(url.hostname, { family: 4, all: true });
  if (addresses.length === 0 || addresses.some((entry) => !isPublicIpv4(entry.address))) {
    throw new Error('Adres webhooka nie wskazuje publicznego adresu IPv4');
  }
  const address = addresses[0].address;
  const timestamp = String(Math.floor(Date.now() / 1000));

  return new Promise<void>((resolve, reject) => {
    const request = https.request(url, {
      agent: false,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payloadText),
        'X-ArchiveCore-Event-Id': eventId,
        'X-ArchiveCore-Timestamp': timestamp,
        'X-ArchiveCore-Signature': signWebhook(secret, timestamp, payloadText),
      },
      lookup: (_hostname, _options, callback) => callback(null, address, 4),
    }, (response) => {
      let received = 0;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > 64 * 1024) request.destroy(new Error('Odpowiedź webhooka jest zbyt duża'));
      });
      response.on('end', () => {
        const status = response.statusCode ?? 0;
        if (status >= 200 && status < 300) resolve();
        else reject(new Error(`HTTP ${status}`));
      });
      response.on('error', reject);
    });
    request.setTimeout(8000, () => request.destroy(new Error('Przekroczono czas odpowiedzi webhooka')));
    request.on('error', reject);
    request.end(payloadText);
  });
}
