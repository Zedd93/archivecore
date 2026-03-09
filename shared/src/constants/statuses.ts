// ======= Box Status Labels =======
export const BOX_STATUS_LABELS: Record<string, string> = {
  active: 'Aktywny',
  checked_out: 'Wydany',
  pending_disposal: 'Do brakowania',
  disposed: 'Zniszczony',
  lost: 'Zagubiony',
  damaged: 'Uszkodzony',
};

export const BOX_STATUS_COLORS: Record<string, string> = {
  active: 'green',
  checked_out: 'blue',
  pending_disposal: 'orange',
  disposed: 'gray',
  lost: 'red',
  damaged: 'red',
};

// ======= Order Status Labels =======
export const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: 'Szkic',
  submitted: 'Złożone',
  approved: 'Zaakceptowane',
  rejected: 'Odrzucone',
  in_progress: 'W realizacji',
  ready: 'Gotowe',
  delivered: 'Przekazane',
  completed: 'Zakończone',
  cancelled: 'Anulowane',
};

export const ORDER_STATUS_COLORS: Record<string, string> = {
  draft: 'gray',
  submitted: 'blue',
  approved: 'green',
  rejected: 'red',
  in_progress: 'yellow',
  ready: 'purple',
  delivered: 'indigo',
  completed: 'green',
  cancelled: 'gray',
};

// ======= Order Type Labels =======
export const ORDER_TYPE_LABELS: Record<string, string> = {
  checkout: 'Wydanie',
  return_order: 'Zwrot',
  transfer: 'Przesunięcie',
  disposal: 'Brakowanie',
};

// ======= Priority Labels =======
export const PRIORITY_LABELS: Record<string, string> = {
  normal: 'Normalny',
  high: 'Wysoki',
  urgent: 'Pilny',
};

// ======= Employment Status Labels =======
export const EMPLOYMENT_STATUS_LABELS: Record<string, string> = {
  active: 'Zatrudniony',
  terminated: 'Rozwiązana umowa',
  retired: 'Emerytura',
  deceased: 'Zmarły',
};

// ======= Disposal Status Labels =======
export const DISPOSAL_STATUS_LABELS: Record<string, string> = {
  active: 'Aktywne',
  pending_review: 'Do przeglądu',
  approved: 'Zatwierdzone',
  disposed: 'Zniszczone',
};

// ======= HR Part Labels =======
export const HR_PART_LABELS: Record<string, string> = {
  A: 'Część A — Ubieganie się o zatrudnienie',
  B: 'Część B — Przebieg zatrudnienia',
  C: 'Część C — Ustanie zatrudnienia',
  D: 'Część D — Odpowiedzialność porządkowa',
  E: 'Część E — Kontrola trzeźwości',
};

// ======= Location Type Labels =======
export const LOCATION_TYPE_LABELS: Record<string, string> = {
  warehouse: 'Magazyn',
  zone: 'Strefa',
  rack: 'Regał',
  shelf: 'Półka',
  level: 'Poziom',
  slot: 'Pozycja',
};

// ======= Confidentiality Labels =======
export const CONFIDENTIALITY_LABELS: Record<string, string> = {
  normal: 'Normalny',
  confidential: 'Poufny',
  strictly_confidential: 'Ściśle tajny',
};

// ======= Document Types =======
export const DOC_TYPES = [
  'personnel_files',
  'financial_documents',
  'contracts',
  'correspondence',
  'project_documents',
  'technical_docs',
  'legal_documents',
  'other',
] as const;
