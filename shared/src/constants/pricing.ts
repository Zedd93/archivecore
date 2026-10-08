export const PRICE_UNITS = [
  'box_month',
  'box',
  'folder',
  'page',
  'kilometer',
  'kilogram',
  'hour',
  'order',
] as const;

export const PRICING_SERVICES = [
  { code: 'storage_box_month', unit: 'box_month', defaultName: 'Przechowywanie kartonu / miesiąc' },
  { code: 'intake_box', unit: 'box', defaultName: 'Przyjęcie kartonu' },
  { code: 'retrieval_box', unit: 'box', defaultName: 'Pobranie kartonu' },
  { code: 'return_box', unit: 'box', defaultName: 'Zwrot kartonu do magazynu' },
  { code: 'retrieval_folder', unit: 'folder', defaultName: 'Pobranie teczki' },
  { code: 'return_folder', unit: 'folder', defaultName: 'Zwrot teczki do magazynu' },
  { code: 'scan_page', unit: 'page', defaultName: 'Skanowanie strony' },
  { code: 'transport_km', unit: 'kilometer', defaultName: 'Transport' },
  { code: 'destruction_box', unit: 'box', defaultName: 'Zniszczenie kartonu' },
  { code: 'destruction_kg', unit: 'kilogram', defaultName: 'Zniszczenie dokumentacji' },
  { code: 'archive_work_hour', unit: 'hour', defaultName: 'Praca archiwisty' },
  { code: 'minimum_order', unit: 'order', defaultName: 'Minimalna opłata za zlecenie' },
] as const;

export type PriceUnit = (typeof PRICE_UNITS)[number];
export type PricingServiceCode = (typeof PRICING_SERVICES)[number]['code'];
