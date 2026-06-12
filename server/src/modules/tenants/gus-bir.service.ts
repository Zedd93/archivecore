import { config } from '../../config/env';

interface GusSearchResult {
  nip: string;
  regon: string;
  name: string;
  address: string;
  city?: string;
  postalCode?: string;
  street?: string;
  buildingNumber?: string;
  apartmentNumber?: string;
  voivodeship?: string;
  county?: string;
  municipality?: string;
  type?: string;
  raw: Record<string, string>;
}

const BIR_NAMESPACE = 'http://CIS/BIR/PUBL/2014/07';
const BIR_DATA_NAMESPACE = 'http://CIS/BIR/PUBL/2014/07/DataContract';

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function getTagValue(xml: string, tagName: string) {
  const match = xml.match(new RegExp(`<[^:>/]*:?${tagName}[^>]*>([\\s\\S]*?)<\\/[^:>]*:?${tagName}>`, 'i'));
  return match ? decodeXml(match[1]).trim() : '';
}

function parseFirstDaneRow(xml: string) {
  const rowMatch = xml.match(/<dane>([\s\S]*?)<\/dane>/i);
  if (!rowMatch) return null;

  const row: Record<string, string> = {};
  const tagRegex = /<([^/][^>\s]*)[^>]*>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(rowMatch[1])) !== null) {
    row[match[1]] = decodeXml(match[2]).trim();
  }
  return row;
}

function formatAddress(row: Record<string, string>) {
  const street = row.Ulica || '';
  const building = row.NrNieruchomosci || '';
  const apartment = row.NrLokalu ? `/${row.NrLokalu}` : '';
  const postalCode = row.KodPocztowy || '';
  const city = row.Miejscowosc || '';
  const municipality = row.Gmina || '';
  const county = row.Powiat || '';
  const voivodeship = row.Wojewodztwo || '';

  const streetLine = [street, building ? `${building}${apartment}` : ''].filter(Boolean).join(' ');
  const cityLine = [postalCode, city].filter(Boolean).join(' ');
  const regionLine = [
    municipality ? `gm. ${municipality}` : '',
    county ? `pow. ${county}` : '',
    voivodeship ? `woj. ${voivodeship}` : '',
  ].filter(Boolean).join(', ');

  return [streetLine, cityLine, regionLine].filter(Boolean).join('\n');
}

function normalizeNip(nip: string) {
  return nip.replace(/\D/g, '');
}

export class GusBirService {
  private endpoint = config.gusBir.endpoint;

  private soapEnvelope(actionName: string, body: string) {
    const action = `${BIR_NAMESPACE}/IUslugaBIRzewnPubl/${actionName}`;
    return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">
  <s:Header>
    <a:Action s:mustUnderstand="1">${action}</a:Action>
    <a:To s:mustUnderstand="1">${this.endpoint}</a:To>
  </s:Header>
  <s:Body>${body}</s:Body>
</s:Envelope>`;
  }

  private async request(actionName: string, body: string, sid?: string) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${BIR_NAMESPACE}/IUslugaBIRzewnPubl/${actionName}"`,
        ...(sid ? { sid } : {}),
      },
      body: this.soapEnvelope(actionName, body),
      signal: AbortSignal.timeout(config.gusBir.timeoutMs),
    });

    const text = await response.text();
    if (!response.ok) {
      throw Object.assign(new Error(`GUS BIR zwrócił HTTP ${response.status}`), { statusCode: 502 });
    }
    return text;
  }

  private async login() {
    if (!config.gusBir.apiKey) {
      throw Object.assign(new Error('Brak konfiguracji GUS_BIR_API_KEY na serwerze'), { statusCode: 503 });
    }

    const body = `<Zaloguj xmlns="${BIR_NAMESPACE}"><pKluczUzytkownika>${escapeXml(config.gusBir.apiKey)}</pKluczUzytkownika></Zaloguj>`;
    const xml = await this.request('Zaloguj', body);
    const sid = getTagValue(xml, 'ZalogujResult');
    if (!sid) {
      throw Object.assign(new Error('Nie udało się zalogować do GUS BIR'), { statusCode: 502 });
    }
    return sid;
  }

  private async logout(sid: string) {
    try {
      await this.request('Wyloguj', `<Wyloguj xmlns="${BIR_NAMESPACE}"><pIdentyfikatorSesji>${escapeXml(sid)}</pIdentyfikatorSesji></Wyloguj>`, sid);
    } catch {
      // Session cleanup failure should not break a successful lookup.
    }
  }

  async findByNip(nipValue: string): Promise<GusSearchResult> {
    const nip = normalizeNip(nipValue);
    if (!/^\d{10}$/.test(nip)) {
      throw Object.assign(new Error('NIP musi składać się z 10 cyfr'), { statusCode: 400 });
    }

    const sid = await this.login();
    try {
      const body = `<DaneSzukajPodmioty xmlns="${BIR_NAMESPACE}">
  <pParametryWyszukiwania xmlns:d="${BIR_DATA_NAMESPACE}">
    <d:Nip>${escapeXml(nip)}</d:Nip>
  </pParametryWyszukiwania>
</DaneSzukajPodmioty>`;
      const xml = await this.request('DaneSzukajPodmioty', body, sid);
      const resultXml = getTagValue(xml, 'DaneSzukajPodmiotyResult');
      const row = parseFirstDaneRow(resultXml);

      if (!row) {
        throw Object.assign(new Error('Nie znaleziono podmiotu w bazie GUS dla podanego NIP'), { statusCode: 404 });
      }

      return {
        nip: row.Nip || nip,
        regon: row.Regon || '',
        name: row.Nazwa || '',
        address: formatAddress(row),
        city: row.Miejscowosc || undefined,
        postalCode: row.KodPocztowy || undefined,
        street: row.Ulica || undefined,
        buildingNumber: row.NrNieruchomosci || undefined,
        apartmentNumber: row.NrLokalu || undefined,
        voivodeship: row.Wojewodztwo || undefined,
        county: row.Powiat || undefined,
        municipality: row.Gmina || undefined,
        type: row.Typ || undefined,
        raw: row,
      };
    } finally {
      await this.logout(sid);
    }
  }
}

export const gusBirService = new GusBirService();
