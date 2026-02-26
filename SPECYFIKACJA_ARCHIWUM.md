# SPECYFIKACJA SYSTEMU ZARZĄDZANIA ARCHIWUM
## „ArchiveCore" — Wzór programu / Koncepcja produktu

---

# 1. EXECUTIVE SUMMARY

## Cel systemu
ArchiveCore to wielodostępna (multi-tenant) aplikacja webowa do zarządzania archiwum obsługującym dokumentację wielu firm. System łączy zarządzanie fizycznymi jednostkami archiwalnymi (kartony, teczki) z opcjonalnym repozytorium dokumentów cyfrowych (skany, pliki). Nacisk: **szybkie odnajdywanie fizycznej lokalizacji** i **pełna rozliczalność operacji**.

## Kluczowe wartości
- **3 kliknięcia** do odpowiedzi na pytanie „gdzie jest karton X?"
- **Pełna rozliczalność**: każda operacja logowana (kto, co, kiedy, skąd→dokąd)
- **Separacja danych**: tenant A nigdy nie widzi danych tenanta B
- **Elastyczność retencji**: konfigurowalne polityki per klient/per typ dokumentacji
- **Mobilne skanowanie QR**: smartfon zamiast dedykowanego skanera

## Użytkownicy docelowi
- Pracownicy archiwum (operatorzy magazynowi, koordynatorzy)
- Klienci archiwum (koordynatorzy po stronie firmy, pracownicy HR)
- Audytorzy (wewnętrzni i zewnętrzni)
- Administratorzy systemu

## Skala docelowa (założenia robocze)
- Do 500 firm-klientów (tenantów)
- Do 2 000 000 kartonów / jednostek archiwalnych
- Do 50 magazynów/lokalizacji
- Do 5 000 użytkowników łącznie

## Najlepsze praktyki z rynku — podsumowanie
Na podstawie analizy rozwiązań rynkowych (Iron Mountain Connect/InSight DXP, Zasio Versatile 2025, Gimmal Physical, GRM BridgePoint, SafetyCulture):

| Cecha | Standard rynkowy | Nasza rekomendacja |
|---|---|---|
| Tracking kodów | Barcode 1D dominuje, RFID w premium | **QR Code** (tańszy, mobilny, więcej danych) + opcja barcode |
| Retencja | Auto-kalkulacja dat, hold litigation | Auto-kalkulacja + hold + workflow brakowania |
| Chain-of-custody | Check-in/check-out + audit trail | Pełny łańcuch z podpisem elektronicznym |
| Mobile scanning | Trend rosnący, ale nie wszędzie | **Mobile-first** dla operacji magazynowych |
| Integracja offsite | Iron Mountain/Gimmal integracja | API do vendorów zewnętrznych (faza 2) |
| AI/OCR | Trend 2025: auto-klasyfikacja | OCR + auto-tagging (faza 2) |
| Multi-tenant | Rzadkość w pudełkowych rozwiązaniach | **Natywny multi-tenant** — core feature |

**Wnioski**: Większość rozwiązań rynkowych to systemy monolityczne skierowane do jednej organizacji. Natywny multi-tenant z portalem klienta to nasza **główna przewaga konkurencyjna**. QR mobilny zamiast dedykowanych skanerów barcode to istotne obniżenie kosztów wdrożenia.

---

# 2. PERSONY, ROLE I MACIERZ UPRAWNIEŃ

## 2.1 Persony

| Persona | Opis | Główne cele |
|---|---|---|
| **Magda — Operator magazynu** | Pracownik archiwum, obsługuje kartony fizycznie | Szybko znaleźć lokalizację, przesunąć karton, wydrukować etykietę |
| **Tomek — Koordynator archiwum** | Kierownik operacyjny archiwum | Zarządzanie zleceniami, inwentaryzacja, raporty, brakowanie |
| **Anna — Koordynator klienta** | Osoba po stronie firmy-klienta | Zlecenie wydania, przegląd swoich kartonów, pobranie skanu |
| **Piotr — Pracownik HR (klient)** | Odpowiada za akta osobowe | Wyszukanie teczki personalnej, sprawdzenie retencji |
| **Ewa — Audytor** | Audytor wewnętrzny/zewnętrzny | Przegląd logów, historia operacji, raport zgodności |
| **Admin — Administrator systemu** | IT / superuser | Konfiguracja tenantów, ról, polityk, integracji |

## 2.2 Role systemowe

| Rola | Skrót | Zakres |
|---|---|---|
| Super Admin | SA | Pełny dostęp do wszystkich tenantów i konfiguracji |
| Admin Tenanta | AT | Zarządzanie użytkownikami i konfiguracją w ramach swojego tenanta |
| Koordynator Archiwum | KA | Operacje archiwalne, zlecenia, raporty, brakowanie |
| Operator Magazynu | OM | Operacje fizyczne: przyjęcie, przesunięcie, wydanie, inwentaryzacja |
| Koordynator Klienta | KK | Przegląd swoich danych, zlecenia, pobieranie skanów |
| Użytkownik HR | HR | Dostęp do modułu akt osobowych (ograniczony) |
| Audytor | AU | Tylko odczyt + logi audytu |
| Tylko odczyt | RO | Tylko przeglądanie (bez operacji) |

## 2.3 Macierz uprawnień (RBAC)

| Operacja | SA | AT | KA | OM | KK | HR | AU | RO |
|---|---|---|---|---|---|---|---|---|
| Konfiguracja systemu | ✅ | — | — | — | — | — | — | — |
| Zarządzanie tenantami | ✅ | — | — | — | — | — | — | — |
| Zarządzanie użytkownikami (swój tenant) | ✅ | ✅ | — | — | — | — | — | — |
| Przyjęcie kartonu | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| Przypisanie lokalizacji | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| Przesunięcie kartonu | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| Wydanie kartonu | ✅ | ✅ | ✅ | ✅* | — | — | — | — |
| Zlecenie wydania | ✅ | ✅ | ✅ | — | ✅ | — | — | — |
| Wyszukiwanie (swoje dane) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Wyszukiwanie (wszystkie dane) | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | — |
| Pobranie skanu | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| Edycja metadanych | ✅ | ✅ | ✅ | — | — | — | — | — |
| Brakowanie (inicjacja) | ✅ | ✅ | ✅ | — | — | — | — | — |
| Brakowanie (akceptacja) | ✅ | ✅ | — | — | — | — | — | — |
| Druk etykiet | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| Raporty operacyjne | ✅ | ✅ | ✅ | — | — | — | ✅ | — |
| Logi audytu | ✅ | ✅ | — | — | — | — | ✅ | — |
| Moduł akt osobowych | ✅ | ✅** | — | — | — | ✅ | ✅** | — |
| Inwentaryzacja | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| Import/eksport danych | ✅ | ✅ | ✅ | — | — | — | — | — |

*OM = wydanie tylko po zatwierdzonym zleceniu
**AT/AU = dostęp do akt osobowych tylko jeśli explicite przyznany

## 2.4 ABAC — rozszerzenie (opcjonalne, rekomendowane)
Oprócz ról, system wspiera atrybutowe reguły dostępu:
- **Firma/tenant**: użytkownik widzi tylko dane swojego tenanta
- **Typ dokumentacji**: np. HR widzi tylko akta osobowe, nie widzi dokumentacji finansowej
- **Poziom poufności**: dokumenty oznaczone jako „poufne" / „ściśle tajne" wymagają dodatkowej roli
- **Dział**: opcjonalny filtr per dział organizacyjny klienta
- **Czasowość**: dostęp ograniczony czasowo (link wygasający, sesja audytorska)

---

# 3. MAPA MODUŁÓW I PRZEPŁYWÓW

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ARCHIVECORE — MODUŁY                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   A. KATALOG  │  │  B. AKTA     │  │ C. DOKUMENTY │              │
│  │   FIZYCZNY    │  │  OSOBOWE     │  │   CYFROWE    │              │
│  │              │  │  (HR)        │  │   (DMS)      │              │
│  │ • Kartony    │  │ • Teczki     │  │ • Skany      │              │
│  │ • Teczki     │  │ • Części A-E │  │ • Pliki      │              │
│  │ • Dokumenty  │  │ • Retencja   │  │ • OCR        │              │
│  │ • Lokalizacje│  │ • Audit log  │  │ • Wersje     │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                  │                      │
│         ▼                 ▼                  ▼                      │
│  ┌─────────────────────────────────────────────────────┐           │
│  │              WARSTWA WSPÓLNA                         │           │
│  │  • Wyszukiwanie (unified search)                    │           │
│  │  • Audyt / logi zdarzeń                             │           │
│  │  • Zarządzanie uprawnieniami (RBAC + ABAC)          │           │
│  └─────────────────────────────────────────────────────┘           │
│         │                 │                  │                      │
│         ▼                 ▼                  ▼                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ D. PORTAL    │  │ E. ETYKIETY  │  │ F. WORKFLOW   │              │
│  │   KLIENTA    │  │   QR+TYTUŁY  │  │   ZLECEŃ     │              │
│  │              │  │              │  │              │              │
│  │ • Przeglad   │  │ • Generator  │  │ • Wydania    │              │
│  │ • Zlecenia   │  │   QR         │  │ • Zwroty     │              │
│  │ • Skany      │  │ • Szablony   │  │ • Chain of   │              │
│  │ • Wnioski    │  │ • Druk PDF   │  │   custody    │              │
│  │ • SSO/2FA    │  │ • Numeracja  │  │ • SLA        │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│                                                                     │
│  ┌──────────────────────────────────────────┐                      │
│  │ G. ADMINISTRACJA                         │                      │
│  │ • Multi-tenant config  • Retencja/polityki│                      │
│  │ • Import/eksport       • Raporty/KPI      │                      │
│  │ • Backup/DR            • Integracje API   │                      │
│  └──────────────────────────────────────────┘                      │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  INFRASTRUKTURA: Auth (SSO/2FA) │ API REST │ DB (PostgreSQL)       │
│  Storage (S3/MinIO) │ Search (Elasticsearch) │ Queue (Redis/RabbitMQ)│
└─────────────────────────────────────────────────────────────────────┘
```

## Przepływy kluczowe

### Przepływ 1: Przyjęcie kartonu
```
Klient dostarcza karton → Operator skanuje/tworzy karton w systemie →
System generuje QR → Operator drukuje etykietę → Operator przypisuje
lokalizację (magazyn/regał/półka) → System loguje zdarzenie „PRZYJĘCIE"
```

### Przepływ 2: Wyszukanie lokalizacji kartonu (3 kliknięcia)
```
[1] Użytkownik wpisuje ID/QR/nazwę w global search →
[2] System pokazuje karton z lokalizacją (breadcrumb: Magazyn > Strefa > Regał > Półka > Pozycja) →
[3] Użytkownik klika „Szczegóły" → pełne metadane + historia + akcje
```

### Przepływ 3: Zlecenie wydania
```
Koordynator klienta tworzy zlecenie → Koordynator archiwum akceptuje →
Operator kompletuje (skanuje QR kartonów) → Zmiana statusu na „WYDANY" →
Potwierdzenie odbioru (podpis/akceptacja) → Chain-of-custody zamknięty
```

### Przepływ 4: Brakowanie (defensible disposition)
```
System generuje raport „kartony z przekroczoną retencją" →
Koordynator archiwum tworzy zlecenie brakowania →
Koordynator klienta akceptuje listę →
(opcjonalnie) Audytor zatwierdza →
Operator realizuje fizyczne zniszczenie →
System loguje protokół brakowania + zamyka rekordy
```

---

# 4. BACKLOG: MVP vs WERSJA DOCELOWA (MoSCoW)

## MVP (Must Have — wersja 1.0)

| # | Funkcjonalność | Moduł | Priorytet |
|---|---|---|---|
| 1 | Rejestracja kartonów/teczek z metadanymi | A | MUST |
| 2 | Hierarchia lokalizacji (magazyn→regał→półka→pozycja) | A | MUST |
| 3 | Wyszukiwanie po ID, QR, metadanych, lokalizacji | A | MUST |
| 4 | Generator QR + druk etykiet PDF | E | MUST |
| 5 | Generator tytułów na etykiety | E | MUST |
| 6 | Przyjęcie, przesunięcie, wydanie, zwrot kartonu | A | MUST |
| 7 | Workflow zlecenia wydania (request→approve→dispatch→confirm) | F | MUST |
| 8 | Chain-of-custody (pełny log transferu) | F | MUST |
| 9 | Multi-tenant (separacja danych, tenant config) | G | MUST |
| 10 | RBAC (role + uprawnienia per tenant) | G | MUST |
| 11 | Rejestr audytu (kto/co/kiedy) | G | MUST |
| 12 | Moduł akt osobowych (teczki, części A-E, wyszukiwanie) | B | MUST |
| 13 | Retencja z auto-kalkulacją dat | G | MUST |
| 14 | Import CSV/XLSX (masowy) | G | MUST |
| 15 | Responsywny UI (desktop + mobile) | — | MUST |
| 16 | Autentykacja (login/hasło + 2FA TOTP) | D | MUST |
| 17 | Skanowanie QR kamerą telefonu (web) | A | MUST |
| 18 | Raporty podstawowe (stan magazynu, kartony per klient, retencja) | G | MUST |

## Should Have (wersja 1.x)

| # | Funkcjonalność | Moduł |
|---|---|---|
| 19 | SSO (SAML 2.0 / OAuth2 / OpenID Connect) | D |
| 20 | ABAC (atrybutowe reguły dostępu) | D |
| 21 | Załączniki cyfrowe (skany) do kartonów/teczek | C |
| 22 | Portal klienta z wnioskami o dostęp | D |
| 23 | Udostępnienia czasowe (wygasające linki) | D |
| 24 | Workflow brakowania z akceptacją wielopoziomową | F |
| 25 | Eksport danych (CSV/XLSX/PDF) | G |
| 26 | Inwentaryzacja (z mobilnym skanowaniem) | A |
| 27 | Raporty zaawansowane + dashboard KPI | G |
| 28 | Powiadomienia (email/in-app: retencja, zlecenia, SLA) | G |
| 29 | Szablony metadanych per klient/per typ | G |
| 30 | Historia wersji metadanych | A |

## Could Have (wersja 2.0)

| # | Funkcjonalność | Moduł |
|---|---|---|
| 31 | OCR + pełnotekstowe wyszukiwanie skanów | C |
| 32 | Auto-klasyfikacja dokumentów (AI) | C |
| 33 | Prognozowanie zapełnienia magazynu | G |
| 34 | Integracja z vendorami offsite (API) | G |
| 35 | Aplikacja mobilna natywna (iOS/Android) | — |
| 36 | Podpis elektroniczny przy odbiorze | F |
| 37 | RFID tracking (opcjonalnie) | A |
| 38 | API publiczne (REST) do integracji | G |
| 39 | Wielojęzyczność (PL/EN) | — |
| 40 | Zaawansowana analityka i BI | G |

## Won't Have (poza zakresem MVP)

- Pełny system ERP/księgowość
- Zarządzanie fizycznym transportem (TMS)
- Moduł fakturowania klientów (do rozważenia osobno)

---

# 5. OPIS KLUCZOWYCH EKRANÓW

## 5.1 Dashboard (strona główna)

**Zawartość:**
- Widgety: liczba kartonów (łącznie / per tenant), zlecenia do realizacji, kartony z przekroczoną retencją, ostatnie operacje
- Quick search bar (ID/QR/słowo kluczowe) — prominentny na górze
- Skróty: „Przyjmij karton", „Nowe zlecenie", „Drukuj etykietę"
- Powiadomienia (zlecenia oczekujące, SLA zbliżający się do terminu)

## 5.2 Wyszukiwanie globalne

**Zawartość:**
- Pole wyszukiwania z autosuggest
- Filtry: firma/tenant, typ dokumentacji, zakres dat, lokalizacja, status, typ jednostki (karton/teczka/dokument)
- Wyniki w tabeli z kolumnami: ID, QR, tytuł, firma, lokalizacja (breadcrumb), status, retencja
- Akcje inline: „Pokaż lokalizację", „Drukuj etykietę", „Zlecenie wydania"
- Wyniki filtrowane wg uprawnień użytkownika (tenant isolation)

## 5.3 Karta kartonu (szczegóły)

**Zawartość:**
- Nagłówek: ID, QR (miniatura), tytuł, firma, status (aktywny/wydany/do brakowania/zniszczony)
- Sekcja lokalizacja: breadcrumb Magazyn → Strefa → Regał → Półka → Pozycja + mapa/schemat (opcja)
- Sekcja metadane: typ dokumentacji, zakres dat, słowa kluczowe, uwagi, retencja (data, polityka)
- Sekcja zawartość: lista teczek/dokumentów wewnątrz kartonu
- Sekcja załączniki: skany/pliki cyfrowe
- Sekcja historia: timeline zdarzeń (przyjęcie, przesunięcia, wydania, zwroty, edycje)
- Akcje: „Przenieś", „Wydaj", „Zwróć", „Drukuj etykietę", „Edytuj", „Brakuj"

## 5.4 Zarządzanie lokalizacjami

**Zawartość:**
- Drzewo hierarchiczne: Magazyn → Strefa → Regał → Półka → Pozycja
- Widok tabeli: zajętość regałów, wolne gniazda, obłożenie procentowe
- Akcje: dodaj/edytuj/dezaktywuj lokalizację, masowe przypisanie
- Filtr: pokaż wolne gniazda, pokaż per klient

## 5.5 Zlecenia (lista + szczegóły)

**Lista:**
- Tabela: nr zlecenia, typ (wydanie/zwrot/przesunięcie), zleceniodawca, data, SLA, status, priorytet
- Filtry: status, typ, firma, data, operator

**Szczegóły zlecenia:**
- Nagłówek: nr, typ, status, SLA (countdown), priorytet
- Lista kartonów/teczek w zleceniu + statusy pozycji
- Chain-of-custody: kto → komu → kiedy → potwierdzenie
- Akcje: akceptuj, kompletuj (skanuj QR), potwierdź odbiór, anuluj

## 5.6 Moduł akt osobowych

**Wyszukiwanie:**
- Pola: imię, nazwisko, PESEL (maskowany — wyświetla się po potwierdzeniu), firma, status zatrudnienia, data zakończenia
- Wyniki: lista teczek personalnych z metadanymi
- Każde wyszukiwanie logowane w audycie

**Karta teczki personalnej:**
- Nagłówek: pracownik (imię, nazwisko, ID), firma, status, daty zatrudnienia
- Zakładki: Część A, Część B, Część C, Część D, Część E
- Każda część: lista dokumentów z datami, paginacja, statusy retencji
- Retencja: data zakończenia zatrudnienia, obliczony termin brakowania, status
- Akcje: dodaj dokument, edytuj, zlecenie wydania, drukuj etykietę

## 5.7 Generator etykiet

**Zawartość:**
- Wybór kartonów (checkbox w liście lub skanowanie QR)
- Wybór szablonu etykiety (rozmiar, układ)
- Podgląd etykiety (live preview)
- Opcje: QR code, tytuł, firma, zakres dat, typ, ID, lokalizacja, retencja
- Eksport do PDF (gotowy do druku na Zebra / laser / A4 z wieloma etykietami)

## 5.8 Inwentaryzacja

**Zawartość:**
- Tworzenie sesji inwentaryzacji (zakres: magazyn/strefa/regał)
- Mobilny widok: skanuj QR → potwierdź obecność → następny
- Raport rozbieżności: brakujące, nadmiarowe, zła lokalizacja
- Podsumowanie: % zgodności, lista niezgodności do rozwiązania

## 5.9 Raporty

**Zawartość:**
- Lista raportów predefiniowanych (patrz sekcja 9)
- Filtry per raport (data, firma, magazyn, typ)
- Eksport: PDF, CSV, XLSX
- Dashboard z wykresami (KPI)

## 5.10 Administracja

**Zawartość:**
- Zarządzanie tenantami (dodaj/edytuj firmę, konfiguracja)
- Zarządzanie użytkownikami (dodaj/edytuj/dezaktywuj, przypisz rolę + tenant)
- Polityki retencji (szablony, reguły per typ dokumentacji)
- Szablony metadanych per tenant
- Konfiguracja lokalizacji (magazyny, regały)
- Import/eksport masowy
- Logi systemowe i audyt

---

# 6. MODEL DANYCH (ERD OPISOWY)

## 6.1 Diagram relacji (uproszczony)

```
Tenant (Firma) ─────────┬──────────── User
    │                    │               │
    │ 1:N                │ N:M           │ N:1
    ▼                    ▼               ▼
  Box (Karton) ──── BoxFolder ──── Role/Permission
    │                (Teczka)
    │ 1:N               │ 1:N
    ▼                    ▼
  Document           HRFolder ──── HRFolderPart
  (Rekord)          (Teczka HR)    (Część A-E)
    │                    │               │ 1:N
    │                    │               ▼
    │                    │          HRDocument
    ▼                    ▼
  Attachment         Location ◄──── LocationHierarchy
  (Załącznik)       (Lokalizacja)   (Magazyn/Strefa/Regał/Półka/Pozycja)
                         │
                         │
  Label ◄────────── LabelTemplate
  (Etykieta)       (Szablon etykiety)

  Order ──────────── OrderItem
  (Zlecenie)        (Pozycja zlecenia)
    │
    ▼
  CustodyEvent ──── AuditLog
  (Łańcuch)         (Zdarzenie audytu)

  RetentionPolicy ─── RetentionRule
  (Polityka)          (Reguła)
```

## 6.2 Encje — szczegółowe pola

### Tenant (Firma/Klient)
```
tenant_id          UUID (PK)
name               VARCHAR(255)        -- nazwa firmy
short_code         VARCHAR(20) UNIQUE  -- skrót (do QR, etykiet)
nip                VARCHAR(13)         -- NIP
address            TEXT
contact_person     VARCHAR(255)
contact_email      VARCHAR(255)
contact_phone      VARCHAR(20)
is_active          BOOLEAN
config_json        JSONB               -- konfiguracja per tenant (szablony, polityki)
created_at         TIMESTAMP
updated_at         TIMESTAMP
```

### User (Użytkownik)
```
user_id            UUID (PK)
tenant_id          UUID (FK → Tenant)  -- NULL dla Super Admin
email              VARCHAR(255) UNIQUE
password_hash      VARCHAR(255)
first_name         VARCHAR(100)
last_name          VARCHAR(100)
phone              VARCHAR(20)
is_active          BOOLEAN
mfa_enabled        BOOLEAN
mfa_secret         VARCHAR(255)
sso_provider       VARCHAR(50)         -- NULL / 'saml' / 'oauth2'
sso_external_id    VARCHAR(255)
last_login_at      TIMESTAMP
created_at         TIMESTAMP
updated_at         TIMESTAMP
```

### Role
```
role_id            UUID (PK)
tenant_id          UUID (FK → Tenant)  -- NULL = rola globalna
name               VARCHAR(100)
code               VARCHAR(50)         -- SA, AT, KA, OM, KK, HR, AU, RO
description        TEXT
is_system          BOOLEAN             -- true = nie do edycji
permissions        JSONB               -- lista uprawnień
created_at         TIMESTAMP
```

### UserRole (M:N)
```
user_id            UUID (FK → User)
role_id            UUID (FK → Role)
assigned_at        TIMESTAMP
assigned_by        UUID (FK → User)
```

### Location (Lokalizacja)
```
location_id        UUID (PK)
parent_id          UUID (FK → Location, NULL dla root)
tenant_id          UUID (FK → Tenant, NULL = współdzielona)
type               ENUM('warehouse','zone','rack','shelf','level','slot')
code               VARCHAR(50)         -- np. "MAG-01", "R-A-03", "P-2-05"
name               VARCHAR(255)
description        TEXT
capacity           INTEGER             -- max kartonów (dla shelf/slot)
current_count      INTEGER             -- aktualnie zajęte
is_active          BOOLEAN
full_path          VARCHAR(500)        -- zmaterializowana ścieżka "MAG-01 > Z-A > R-03 > P-2 > S-05"
sort_order         INTEGER
created_at         TIMESTAMP
updated_at         TIMESTAMP
```
**Indeksy:** `parent_id`, `type`, `code`, `full_path` (GIN trigram), `tenant_id`

### Box (Karton)
```
box_id             UUID (PK)
tenant_id          UUID (FK → Tenant)
location_id        UUID (FK → Location)
qr_code            VARCHAR(100) UNIQUE  -- zakodowana wartość QR
barcode            VARCHAR(100)         -- opcjonalny kod kreskowy
box_number         VARCHAR(50)          -- numer kartonu (per tenant)
title              VARCHAR(500)         -- wygenerowany/ręczny tytuł
description        TEXT
doc_type           VARCHAR(100)         -- typ dokumentacji (np. „Księgowość", „Kadry")
date_from          DATE                 -- zakres dat dokumentów
date_to            DATE
keywords           TEXT[]               -- tagi/słowa kluczowe (array)
status             ENUM('active','checked_out','pending_disposal','disposed','lost','damaged')
retention_policy_id UUID (FK → RetentionPolicy)
retention_date     DATE                 -- obliczona data brakowania
disposal_date      DATE                 -- faktyczna data zniszczenia
notes              TEXT
custom_fields      JSONB                -- pola dodatkowe per tenant
created_at         TIMESTAMP
updated_at         TIMESTAMP
created_by         UUID (FK → User)
```
**Indeksy:** `tenant_id`, `location_id`, `qr_code`, `barcode`, `box_number`, `doc_type`, `status`, `retention_date`, `date_from/date_to`, GIN na `keywords`, GIN trigram na `title`

### Folder (Teczka)
```
folder_id          UUID (PK)
box_id             UUID (FK → Box)
tenant_id          UUID (FK → Tenant)
folder_number      VARCHAR(50)
title              VARCHAR(500)
doc_type           VARCHAR(100)
date_from          DATE
date_to            DATE
description        TEXT
order_in_box       INTEGER              -- kolejność w kartonie
status             ENUM('active','checked_out','disposed')
custom_fields      JSONB
created_at         TIMESTAMP
updated_at         TIMESTAMP
```

### Document (Rekord/Dokument)
```
document_id        UUID (PK)
folder_id          UUID (FK → Folder, nullable)
box_id             UUID (FK → Box, nullable)     -- bezpośrednio w kartonie
tenant_id          UUID (FK → Tenant)
title              VARCHAR(500)
doc_type           VARCHAR(100)
doc_date           DATE
page_count         INTEGER
description        TEXT
confidentiality    ENUM('normal','confidential','strictly_confidential')
order_in_folder    INTEGER
custom_fields      JSONB
created_at         TIMESTAMP
updated_at         TIMESTAMP
```

### Attachment (Załącznik cyfrowy)
```
attachment_id      UUID (PK)
document_id        UUID (FK → Document, nullable)
folder_id          UUID (FK → Folder, nullable)
box_id             UUID (FK → Box, nullable)
tenant_id          UUID (FK → Tenant)
file_name          VARCHAR(500)
file_path          VARCHAR(1000)        -- ścieżka w storage (S3/MinIO)
file_size          BIGINT
mime_type          VARCHAR(100)
checksum_sha256    VARCHAR(64)
version            INTEGER DEFAULT 1
ocr_text           TEXT                 -- wynik OCR (pełnotekstowe)
ocr_status         ENUM('pending','completed','failed','not_applicable')
uploaded_by        UUID (FK → User)
uploaded_at        TIMESTAMP
```

### HRFolder (Teczka akt osobowych)
```
hr_folder_id       UUID (PK)
tenant_id          UUID (FK → Tenant)
box_id             UUID (FK → Box, nullable)     -- fizyczny karton
employee_first_name VARCHAR(100)
employee_last_name  VARCHAR(100)
employee_pesel     VARCHAR(11)          -- szyfrowany w DB
employee_id_number VARCHAR(50)          -- numer ewidencyjny
employment_start   DATE
employment_end     DATE                 -- NULL = aktywny
employment_status  ENUM('active','terminated','retired','deceased')
department         VARCHAR(200)
position           VARCHAR(200)
retention_period   ENUM('10_years','50_years')
retention_base_date DATE                -- data od której liczymy retencję
retention_end_date DATE                 -- obliczona data końca retencji
disposal_status    ENUM('active','pending_review','approved','disposed')
storage_form       ENUM('paper','digital','hybrid')  -- forma przechowywania
litigation_hold    BOOLEAN DEFAULT FALSE              -- blokada na czas postępowania
litigation_hold_until DATE                            -- data końca blokady
litigation_notes   TEXT                               -- opis postępowania
notes              TEXT
created_at         TIMESTAMP
updated_at         TIMESTAMP
```
**Indeksy:** `tenant_id`, `employee_last_name` (trigram), `employee_pesel` (szyfrowany), `employment_status`, `retention_end_date`, `litigation_hold`

**UWAGA:** PESEL przechowywany w formie zaszyfrowanej (AES-256). Wyszukiwanie po PESEL realizowane przez porównanie hashy (HMAC) lub szyfrowane indeksy.

### HRFolderPart (Część akt osobowych)
```
hr_folder_part_id  UUID (PK)
hr_folder_id       UUID (FK → HRFolder)
part_code          ENUM('A','B','C','D','E')
part_subcode       VARCHAR(10)          -- np. "A1", "B2", "E1"
description        TEXT                 -- opis tematyczny podczęści
document_count     INTEGER
created_at         TIMESTAMP
```

### HRDocument (Dokument w aktach osobowych)
```
hr_document_id     UUID (PK)
hr_folder_part_id  UUID (FK → HRFolderPart)
tenant_id          UUID (FK → Tenant)
title              VARCHAR(500)
doc_type           VARCHAR(100)         -- typ dokumentu HR
doc_date           DATE
order_number       INTEGER              -- numer porządkowy w części
page_count         INTEGER
notes              TEXT
attachment_id      UUID (FK → Attachment, nullable)
created_at         TIMESTAMP
updated_at         TIMESTAMP
```

### Order (Zlecenie)
```
order_id           UUID (PK)
tenant_id          UUID (FK → Tenant)
order_number       VARCHAR(50) UNIQUE
order_type         ENUM('checkout','return','transfer','disposal')
status             ENUM('draft','submitted','approved','rejected','in_progress','ready','delivered','completed','cancelled')
priority           ENUM('normal','high','urgent')
requested_by       UUID (FK → User)
approved_by        UUID (FK → User)
assigned_to        UUID (FK → User)     -- operator realizujący
sla_deadline       TIMESTAMP
completed_at       TIMESTAMP
notes              TEXT
created_at         TIMESTAMP
updated_at         TIMESTAMP
```

### OrderItem (Pozycja zlecenia)
```
order_item_id      UUID (PK)
order_id           UUID (FK → Order)
box_id             UUID (FK → Box, nullable)
folder_id          UUID (FK → Folder, nullable)
hr_folder_id       UUID (FK → HRFolder, nullable)
item_status        ENUM('pending','picked','delivered','returned','issue')
picked_at          TIMESTAMP
delivered_at       TIMESTAMP
picked_by          UUID (FK → User)
```

### CustodyEvent (Łańcuch powierzenia)
```
custody_event_id   UUID (PK)
order_id           UUID (FK → Order)
box_id             UUID (FK → Box)
event_type         ENUM('handover','receipt','return','transfer')
from_user_id       UUID (FK → User)
to_user_id         UUID (FK → User)
from_location_id   UUID (FK → Location, nullable)
to_location_id     UUID (FK → Location, nullable)
signature_data     TEXT                 -- podpis elektroniczny (base64)
notes              TEXT
event_at           TIMESTAMP
```

### AuditLog (Dziennik audytu)
```
audit_id           UUID (PK)
tenant_id          UUID (FK → Tenant, nullable)
user_id            UUID (FK → User)
action             VARCHAR(100)         -- 'box.create', 'box.move', 'hr_folder.view', itp.
entity_type        VARCHAR(50)          -- 'box', 'folder', 'hr_folder', 'order', itp.
entity_id          UUID
old_values         JSONB                -- snapshot przed zmianą
new_values         JSONB                -- snapshot po zmianie
ip_address         INET
user_agent         VARCHAR(500)
session_id         VARCHAR(100)
created_at         TIMESTAMP
```
**Indeksy:** `tenant_id`, `user_id`, `action`, `entity_type + entity_id`, `created_at`
**Partycjonowanie:** po `created_at` (miesięczne/kwartalne)

### RetentionPolicy (Polityka retencji)
```
retention_policy_id UUID (PK)
tenant_id           UUID (FK → Tenant, nullable)  -- NULL = globalna
name                VARCHAR(255)
doc_type            VARCHAR(100)
retention_years     INTEGER
retention_trigger   ENUM('creation_date','end_date','event_date','custom')
description         TEXT
is_active           BOOLEAN
created_at          TIMESTAMP
```

### RetentionRule (Reguła retencji — szczegółowa)
```
rule_id            UUID (PK)
policy_id          UUID (FK → RetentionPolicy)
condition_field    VARCHAR(100)         -- pole encji do sprawdzenia
condition_operator VARCHAR(20)          -- '=', '>', '<', 'in', itp.
condition_value    VARCHAR(500)
action             ENUM('dispose','review','transfer','extend')
notify_before_days INTEGER              -- ile dni przed terminem powiadomić
```

### Label (Etykieta — log generacji)
```
label_id           UUID (PK)
box_id             UUID (FK → Box)
template_id        UUID (FK → LabelTemplate)
qr_data            TEXT                 -- dane zakodowane w QR
generated_by       UUID (FK → User)
generated_at       TIMESTAMP
print_count        INTEGER DEFAULT 0
last_printed_at    TIMESTAMP
```

### LabelTemplate (Szablon etykiety)
```
template_id        UUID (PK)
tenant_id          UUID (FK → Tenant, nullable)
name               VARCHAR(255)
width_mm           DECIMAL(6,2)
height_mm          DECIMAL(6,2)
layout_json        JSONB               -- definicja pól i ich pozycji
fields             TEXT[]              -- lista pól do wydruku
qr_size_mm         DECIMAL(6,2)
qr_error_level     ENUM('L','M','Q','H')
is_default         BOOLEAN
created_at         TIMESTAMP
```

---

# 7. SPECYFIKACJA WYSZUKIWANIA

## 7.1 Tryby wyszukiwania

### Global Search (pasek globalny)
- **Wejście**: tekst wolny (min. 2 znaki) lub skan QR
- **Przeszukuje**: `box.qr_code`, `box.barcode`, `box.box_number`, `box.title`, `folder.title`, `document.title`, `hr_folder.employee_last_name`, `hr_folder.employee_first_name`
- **Algorytm**: Elasticsearch / PostgreSQL FTS z trigram matching
- **Ranking**: exact match QR/ID > exact match title > fuzzy match > full-text
- **Filtrowanie uprawnień**: wyniki automatycznie filtrowane wg `tenant_id` użytkownika i jego ról

### Wyszukiwanie zaawansowane (filtry)
| Filtr | Typ | Encje |
|---|---|---|
| Firma/Tenant | Select (multi) | Wszystkie |
| Typ dokumentacji | Select (multi) | Box, Folder, Document |
| Zakres dat (od–do) | Date range | Box, Folder, Document |
| Lokalizacja (magazyn/regał) | Tree select | Box |
| Status | Select (multi) | Box, Order |
| Słowa kluczowe | Text (tags) | Box |
| Numer kartonu | Text (exact/prefix) | Box |
| Imię/Nazwisko pracownika | Text (trigram) | HRFolder |
| PESEL | Text (exact, po potwierdzeniu) | HRFolder |
| Status zatrudnienia | Select | HRFolder |
| Data zakończenia zatrudnienia | Date range | HRFolder |
| Retencja: termin brakowania | Date range | Box, HRFolder |
| Nr zlecenia | Text (exact) | Order |

### Wyszukiwanie lokalizacji
- **Wejście**: skanuj QR lub wpisz ID kartonu
- **Wynik**: natychmiastowy breadcrumb lokalizacji: `Magazyn Główny > Strefa A > Regał 12 > Półka 3 > Pozycja 7`
- **Dodatkowe**: link do mapy/schematu regału (faza 2)

## 7.2 Indeksy i wydajność

| Indeks | Typ | Cel |
|---|---|---|
| `box.qr_code` | B-tree UNIQUE | Lookup po QR — O(1) |
| `box.tenant_id + status` | B-tree composite | Filtrowanie per tenant |
| `box.title` | GIN trigram (pg_trgm) | Fuzzy search po tytule |
| `box.keywords` | GIN array | Szukanie po tagach |
| `box.retention_date` | B-tree | Raporty retencji |
| `location.full_path` | GIN trigram | Szukanie po ścieżce lokalizacji |
| `hr_folder.employee_last_name` | GIN trigram | Fuzzy search po nazwisku |
| `hr_folder.tenant_id + employment_status` | B-tree composite | Filtrowanie akt HR |
| `audit_log.created_at` | B-tree (partitioned) | Zapytania czasowe na logu |
| `audit_log.entity_type + entity_id` | B-tree composite | Historia encji |
| Elasticsearch index | Full-text | Pełnotekstowe po OCR i tytułach |

**Cel wydajnościowy**: < 2s dla typowych zapytań przy 2M kartonów. Osiągalne dzięki:
- PostgreSQL z pg_trgm + GIN indexes
- Opcjonalnie Elasticsearch dla full-text i faceted search
- Materialized views dla raportów agregatowych
- Partycjonowanie tabel `audit_log` i `attachment` po dacie
- Connection pooling (PgBouncer)
- Cache (Redis) dla hot queries (dashboard KPI)

## 7.3 Uprawnienia w wynikach wyszukiwania
- Zapytania SQL zawsze zawierają `WHERE tenant_id = :user_tenant_id` (Row-Level Security w PostgreSQL)
- Moduł HR: dodatkowy filtr `WHERE user HAS_ROLE 'HR' OR 'SA' OR 'AT'` + log dostępu
- PESEL: nigdy nie wyświetlany w wynikach listy — maskowany jako `***********` — pełna wartość dopiero w karcie teczki, po explicit kliknięciu „Pokaż PESEL" (logowane w audycie)
- Dokumenty o poufności `strictly_confidential`: widoczne tylko dla ról SA, AT + explicite uprawnionych

---

# 8. SPECYFIKACJA ETYKIET / QR

## 8.1 Format danych QR

**Zawartość zakodowana w QR:**
```
AC:{tenant_short_code}:{box_id_short}:{checksum}
```

Przykład: `AC:FIRMAXYZ:K-2024-001532:A7B3`

| Element | Opis |
|---|---|
| `AC` | Prefix systemu (ArchiveCore) — umożliwia identyfikację kodu |
| `tenant_short_code` | Skrót firmy (max 10 znaków) |
| `box_id_short` | Numer kartonu (czytelny, np. K-2024-001532) |
| `checksum` | 4-znakowy CRC/checksum (wykrywa błędy w ręcznym wpisywaniu) |

**Parametry QR:**
- Standard: QR Code Model 2
- Error correction: Level M (15% recovery) — domyślnie; Level H (30%) dla warunków magazynowych
- Wersja: auto (zależy od długości danych, typowo Version 3-5)
- Moduł (rozmiar piksela): min. 0.5mm przy druku na etykiecie
- Quiet zone: min. 4 moduły

## 8.2 Szablony etykiet

### Szablon A: Etykieta boczna kartonu (standardowa)
```
┌───────────────────────────────────────┐
│  ┌─────┐  FIRMA XYZ Sp. z o.o.       │
│  │ QR  │  ────────────────────────    │
│  │CODE │  Księgowość / Faktury        │
│  │     │  2020–2023                   │
│  └─────┘  K-2024-001532              │
│           Retencja: 2033-12-31        │
│           MAG-01 > R-A12 > P-3 > S-7 │
└───────────────────────────────────────┘
```
**Wymiary**: 100mm × 50mm (standardowa etykieta boczna)

### Szablon B: Etykieta mała (czołowa)
```
┌─────────────────────┐
│  ┌───┐  K-2024-001  │
│  │QR │  FIRMA XYZ   │
│  └───┘  Księg. 20-23│
└─────────────────────┘
```
**Wymiary**: 60mm × 30mm

### Szablon C: Etykieta pełna (A4, wiele etykiet)
- Układ: siatka etykiet na arkuszu A4 (np. 3×7 = 21 etykiet)
- Kompatybilność: Avery L7160, L7163 i podobne
- Format: PDF z precyzyjnymi marginesami

### Szablon D: Etykieta do drukarki termicznej
- Kompatybilność: Zebra GK420, ZD220, ZD420 i podobne
- Format: ZPL (Zebra Programming Language) lub PDF
- Wymiary: konfigurowalne (typowo 102mm × 51mm)

## 8.3 Generator tytułów

**Reguły nazewnictwa (konfigurowalne per tenant):**

Wzorzec domyślny:
```
[Firma] / [Typ dokumentacji] / [Rok-od]–[Rok-do] / [Seria/Numer]
```

Przykłady:
- `FIRMA XYZ / Księgowość / Faktury zakupu / 2020–2023 / K-001`
- `ABC Sp. z o.o. / Kadry / Akta osobowe A-K / 2015–2024 / AO-012`
- `CORP S.A. / Prawny / Umowy handlowe / 2022–2023 / UH-003`

**Konfiguracja per tenant:**
- Wybór pól w tytule (firma, typ, podtyp, lata, numer, dział, lokalizacja)
- Kolejność pól
- Separatory ( / , - , | )
- Autonumeracja (sekwencyjna per tenant, per rok, per typ)
- Prefiks/sufiks numeru

## 8.4 Druk

**Formaty wyjściowe:**
- **PDF** (domyślny): generowany po stronie serwera, gotowy do druku
- **ZPL**: dla drukarek Zebra (surowy format)
- **HTML → PDF**: alternatywa (Puppeteer/wkhtmltopdf)

**Kompatybilność drukarek:**
- Drukarki etykiet termicznych: Zebra GK/ZD/ZT series, Dymo LabelWriter, Brother QL
- Drukarki laserowe: dowolna z obsługą PDF (Avery templates)
- Drukarki atramentowe: j.w.

**Masowy druk:**
- Zaznacz wiele kartonów → „Drukuj etykiety" → jeden PDF z wieloma etykietami
- Limit: do 500 etykiet w jednym PDF

---

# 9. RAPORTY I KPI

## 9.1 Raporty predefiniowane

| # | Raport | Opis | Moduł |
|---|---|---|---|
| 1 | Stan magazynu | Liczba kartonów per lokalizacja, obłożenie regałów, wolne gniazda | A |
| 2 | Kartony per klient | Zestawienie ilościowe per tenant, per typ dokumentacji | A |
| 3 | Kartony z przekroczoną retencją | Lista kartonów, których data brakowania minęła | A/G |
| 4 | Retencja — zbliżające się terminy | Kartony z retencją wygasającą w ciągu N dni | A/G |
| 5 | Historia wydań i zwrotów | Zestawienie zleceń z datami, SLA, opóźnieniami | F |
| 6 | Chain-of-custody per karton | Pełna historia transferów danego kartonu | F |
| 7 | Raport inwentaryzacji | Wyniki inwentaryzacji: zgodne, brakujące, nadmiarowe | A |
| 8 | Aktywność użytkowników | Logi operacji per użytkownik w okresie | G |
| 9 | Akta osobowe — retencja | Teczki HR z obliczonymi datami brakowania | B |
| 10 | Akta osobowe — dostępy | Kto przeglądał jakie teczki HR (audyt) | B |
| 11 | Zlecenia — SLA compliance | % zleceń zrealizowanych w terminie SLA | F |
| 12 | Nowe przyjęcia per okres | Trendy przyjęć kartonów (dziennie/tygodniowo/miesięcznie) | A |
| 13 | Brakowanie — protokoły | Lista zrealizowanych brakowań z protokołami | A/G |
| 14 | Pojemność magazynu — prognoza | Trend zapełnienia + prognoza (liniowa) | A |
| 15 | Podsumowanie per tenant | Zestawienie zbiorcze dla klienta (do faktury/raportu) | G |

## 9.2 KPI (wskaźniki)

| # | KPI | Metryka | Cel |
|---|---|---|---|
| 1 | Obłożenie magazynu | % zajętych gniazd / total | Monitorowanie pojemności |
| 2 | Średni czas realizacji zlecenia | Czas od złożenia do zakończenia (godziny) | SLA compliance |
| 3 | % zleceń w SLA | Zlecenia zrealizowane w terminie / total | > 95% |
| 4 | Kartony z przekroczoną retencją | Liczba i % kartonów po terminie | → 0 |
| 5 | Niezgodności inwentaryzacji | % kartonów niezgodnych z systemem | < 1% |
| 6 | Wolumen przyjęć (trend) | Kartonów przyjętych / miesiąc | Planowanie pojemności |
| 7 | Wolumen brakowań | Kartonów zniszczonych / miesiąc | Zwalnianie miejsca |
| 8 | Średni czas wyszukiwania | Czas od zapytania do znalezienia kartonu | < 2s |
| 9 | Dostępy do akt HR | Liczba dostępów do modułu HR / okres | Monitoring bezpieczeństwa |
| 10 | Aktywność per tenant | Zlecenia/operacje per klient / miesiąc | Rozliczenia, engagement |
| 11 | Kartony „zagubione" | Liczba kartonów ze statusem 'lost' | → 0 |
| 12 | Czas od przyjęcia do przypisania lokalizacji | Godziny od utworzenia kartonu do przypisania regału | < 4h |

---

# 10. RYZYKA I MITIGACJE

| # | Ryzyko | Prawdopodobieństwo | Wpływ | Mitigacja |
|---|---|---|---|---|
| 1 | **Wyciek danych między tenantami** | Niskie | Krytyczny | Row-Level Security (PostgreSQL RLS), testy penetracyjne per tenant, code review policy |
| 2 | **Wyciek PESEL/danych HR** | Średnie | Krytyczny | Szyfrowanie AES-256 w DB, maskowanie w UI, audit log każdego dostępu, 2FA dla ról HR |
| 3 | **Utrata danych (awaria DB)** | Niskie | Krytyczny | Backup automatyczny (daily full + WAL streaming), replikacja, testowane odtwarzanie co miesiąc |
| 4 | **Niespójność lokalizacji z rzeczywistością** | Wysokie | Wysoki | Regularna inwentaryzacja (wymuszana systemem), walidacja QR przy każdej operacji, raport niezgodności |
| 5 | **Przekroczenie terminów retencji (niezgodność)** | Średnie | Wysoki | Auto-powiadomienia 90/60/30 dni przed terminem, dashboard retencji, eskalacja do koordynatora klienta |
| 6 | **SLA zleceń niespełnione** | Średnie | Wysoki | Timer SLA widoczny na dashboardzie, eskalacja (email + in-app) przy 80% czasu, raporty SLA compliance |
| 7 | **Opór użytkowników (adopcja)** | Średnie | Średni | Prosty UX (3 kliknięcia), szkolenia, onboarding wizard, feedback loop, materiały video |
| 8 | **Problemy z wydajnością przy skali** | Średnie | Wysoki | Indeksowanie, partycjonowanie, cache Redis, load testing przed wdrożeniem, monitorowanie (APM) |
| 9 | **Awaria skanowania QR mobilnego** | Niskie | Średni | Fallback: ręczne wpisanie ID, obsługa słabego oświetlenia (latarka), walidacja checksum |
| 10 | **Migracja danych z Excela/starych systemów** | Wysokie | Średni | Dedykowane narzędzie importu z walidacją, mapowanie pól, dry-run import, raport błędów |
| 11 | **Zmiana regulacji prawnych (retencja, RODO)** | Średnie | Średni | Konfigurowalne polityki retencji, modularność reguł, monitoring zmian prawnych |
| 12 | **Błędy etykiet (zły QR, zły tytuł)** | Średnie | Średni | Podgląd przed drukiem, walidacja QR po wygenerowaniu (skan testowy), checksum w kodzie |
| 13 | **Nieautoryzowany dostęp do systemu** | Niskie | Krytyczny | 2FA obowiązkowe, SSO, sesje wygasające, blokada po N nieudanych prób, IP whitelist (opcja) |
| 14 | **Single point of failure (infrastruktura)** | Niskie | Krytyczny | Architektura HA (min. 2 instancje), health checks, auto-restart, monitoring 24/7 |
| 15 | **Niezgodność chain-of-custody** | Średnie | Wysoki | Wymuszenie sekwencji operacji (nie można pominąć kroku), walidacja statusów, alerty |

---

# 11. PYTANIA DO DOPRECYZOWANIA

1. **Skala początkowa**: Ile firm-klientów i kartonów planujecie obsługiwać na starcie? (wpływa na wybór infrastruktury)

2. **Hosting**: Cloud (AWS/Azure/GCP), własny serwer (on-premise), czy hybrid? Czy są ograniczenia regulacyjne dotyczące lokalizacji danych?

3. **Integracje**: Czy system ma się integrować z istniejącymi systemami klientów (ERP, HR, AD/LDAP)? Jeśli tak, z jakimi?

4. **Fakturowanie**: Czy system ma zawierać moduł rozliczeń z klientami (per karton/per m2/per operację), czy to jest obsługiwane osobno?

5. **Drukarki**: Jakie modele drukarek etykiet są aktualnie w użyciu lub planowane? (wpływa na formaty wydruku)

6. **Akta osobowe — zakres**: Czy moduł HR ma obsługiwać tylko archiwizację (teczki byłych pracowników), czy też bieżące akta osobowe aktywnych pracowników?

7. **Skany/OCR**: Czy digitalizacja (skanowanie) dokumentów ma odbywać się w systemie (bulk scan workflow), czy skany są dostarczane jako gotowe pliki?

8. **Wielojęzyczność**: Czy interfejs ma być od początku dwujęzyczny (PL/EN), czy wystarczy PL z możliwością dodania EN później?

9. **SLA**: Jakie są oczekiwane czasy realizacji zleceń wydania? (np. standard 24h, express 4h, urgent 2h)

10. **Migracja**: Czy istnieją dane do migracji z obecnych systemów/arkuszy? Jeśli tak, w jakim formacie i jakiej objętości?

---

# 12. NAJLEPSZE PRAKTYKI Z RYNKU — SZCZEGÓŁOWE PORÓWNANIE

## 12.1 Porównanie podejść rynkowych

### Śledzenie ruchu i kodowanie (Barcode / QR / RFID)

| Technologia | Zalety | Wady | Rekomendacja |
|---|---|---|---|
| **Barcode 1D** (Code 128/39) | Tani, szerokie wsparcie sprzętu, standard w archiwach | Mała pojemność danych, wymaga skanera liniowego | Opcjonalny fallback |
| **QR Code 2D** | Duża pojemność, skanowanie smartfonem, error correction | Wymaga więcej miejsca na etykiecie | **Rekomendowany jako primary** |
| **RFID** (UHF/HF) | Bulk scan (wiele jednocześnie), bez line-of-sight | Drogi (tag + czytnik), zakłócenia metalowe regały | Faza 2/3, dla premium klientów |

**Rekomendacja**: QR Code jako standard (MVP), barcode 1D jako opcja kompatybilności, RFID jako opcja premium w fazie 2.

### Chain-of-custody

Standardy rynkowe (Iron Mountain, Gimmal, Zasio):
- Check-in / check-out z timestampem i user ID
- Wielopoziomowy workflow akceptacji (request → approve → pick → deliver → confirm)
- Audit trail na poziomie encji (kto zmienił, co, kiedy)
- Gimmal: integracja z Iron Mountain dla offsite custody

**Nasza rekomendacja**: Pełny chain-of-custody z wymuszonym workflow + podpis elektroniczny przy odbiorze (faza 1: checkbox potwierdzenia, faza 2: podpis na ekranie dotykowym).

### Integracje z vendorami offsite

Standardy rynkowe:
- Gimmal Physical: natywna integracja z Iron Mountain (pickup/delivery request)
- GRM BridgePoint: własna sieć magazynów
- Access Corp: portal klienta + API

**Nasza rekomendacja**: API REST do integracji z zewnętrznymi vendorami (faza 2). MVP skupia się na zarządzaniu własnymi magazynami.

### Mobile scanning

Standardy rynkowe:
- SafetyCulture: mobile-first z QR
- Zasio: wymaga dedykowanego skanera barcode (Honeywell, Zebra)
- Iron Mountain: portal webowy, mobilny dostęp ograniczony

**Nasza rekomendacja**: **Mobile-first** — skanowanie QR kamerą smartfona przez przeglądarkę (Web API: `getUserMedia` + biblioteka QR). Brak wymogu dedykowanego skanera. Opcja podłączenia skanera Bluetooth jako upgrade.

### Polityki retencji i brakowanie

Standardy rynkowe:
- Zasio Versatile: auto-kalkulacja dat retencji, litigation hold, event-based retention
- Gimmal: retention schedule enforcement, defensible disposition
- Iron Mountain Smart Sort: automatyczne niszczenie po spełnieniu warunków retencji

**Nasza rekomendacja (MVP)**:
1. Konfigurowalne polityki retencji per tenant / per typ dokumentacji
2. Auto-kalkulacja daty brakowania (od daty zamknięcia / daty końcowej / daty zakończenia zatrudnienia)
3. Event-based retention (np. „10 lat od zakończenia zatrudnienia")
4. Hold: możliwość wstrzymania brakowania (litigation hold, audyt)
5. Workflow brakowania: wygeneruj listę → koordynator klienta akceptuje → archiwum realizuje → protokół
6. Defensible disposition: pełna dokumentacja procesu (kto zatwierdził, kiedy, na jakiej podstawie)

---

# 13. MODUŁ AKT OSOBOWYCH — SZCZEGÓŁY (zgodność z prawem polskim)

## 13.1 Struktura akt osobowych (5 części)

Zgodnie z Rozporządzeniem MRPiPS z 10.12.2018 r. (z późn. zm., w tym dodanie części E w 2023 r.):

### Część A — Ubieganie się o zatrudnienie
- Kwestionariusz osobowy kandydata
- CV, list motywacyjny (kopie)
- Kopie świadectw pracy z poprzednich miejsc
- Kopie dyplomów, certyfikatów, zaświadczeń o kwalifikacjach
- Skierowania na badania lekarskie (wstępne) i orzeczenia lekarskie
- Oświadczenia dotyczące danych osobowych

### Część B — Nawiązanie i przebieg zatrudnienia
- Umowa o pracę (i aneksy)
- Zakres obowiązków
- Zaświadczenia o szkoleniu BHP
- Skierowania na badania okresowe i orzeczenia
- Informacja o warunkach zatrudnienia (art. 29 § 3 KP)
- Dokumenty dotyczące powierzenia mienia
- Oświadczenia pracownika (dane osobowe, PIT-2, itp.)
- Dokumenty urlopowe, delegacje, nagrody
- Zmiana warunków pracy (porozumienia, wypowiedzenia zmieniające)

### Część C — Ustanie zatrudnienia
- Oświadczenie o wypowiedzeniu/rozwiązaniu umowy
- Kopia świadectwa pracy
- Umowa o zakazie konkurencji (jeśli dotyczy)
- Wnioski o sprostowanie świadectwa pracy
- Dokumenty dotyczące egzekucji ze świadczeń

### Część D — Odpowiedzialność porządkowa
- Odpis zawiadomienia o ukaraniu
- Dokumenty dotyczące nałożenia kary porządkowej lub odpowiedzialności określonej w odrębnych przepisach
- Podział na podczęści D1, D2, D3... (per kara)
- **UWAGA KRYTYCZNA**: dokumenty z tej części muszą być **skutecznie i nieodtwarzalnie usunięte** po roku nienagannej pracy pracownika (system musi to obsługiwać automatycznie — przypomnienie + workflow usunięcia + log operacji usunięcia bez zachowania treści)
- Po usunięciu: przenumerowanie pozostałych dokumentów w części D

### Część E — Kontrola trzeźwości (od 2023)
- Dokumenty dotyczące kontroli trzeźwości
- Dokumenty dotyczące kontroli na obecność środków działających podobnie do alkoholu
- Podział na podczęści E1, E2, E3... (per zdarzenie kontroli)

## 13.1a Wymogi prawne — dodatkowe
- **Forma**: pracodawca może prowadzić akta papierowo LUB elektronicznie (nie wymaga się obu form jednocześnie). System obsługuje oba warianty.
- **Numeracja i chronologia**: dokumenty w każdej części muszą być ponumerowane i ułożone chronologicznie. System wymusza `order_number` + `doc_date`.
- **Spis treści**: każda część akt musi mieć spis treści (wykaz dokumentów). System generuje go automatycznie.
- **Kary za nieprowadzenie**: grzywna od 1 000 zł do 30 000 zł za nieprowadzenie, nieprzechowywanie lub przechowywanie w warunkach grożących zniszczeniem (art. 281 KP).
- **Warunki przechowywania**: poufność, integralność, kompletność, dostępność; zabezpieczenie przed uszkodzeniem, zniszczeniem i dostępem osób niepowołanych.
- **Forma mieszana**: dozwolona — starsi pracownicy papierowo, nowsi elektronicznie. System ewidencjonuje formę (`paper` / `digital` / `hybrid`) per teczka.

## 13.2 Retencja akt osobowych

| Scenariusz | Okres | Liczone od | Uwagi |
|---|---|---|---|
| Zatrudnienie od 01.01.2019 | **10 lat** | Koniec roku kalendarzowego, w którym ustał stosunek pracy | Nowy standard |
| Zatrudnienie 01.01.1999–31.12.2018 | **50 lat** (domyślnie) | Dzień zakończenia pracy | Możliwe skrócenie do 10 lat po złożeniu raportów ZUS |
| Zatrudnienie 01.01.1999–31.12.2018 (po skróceniu) | **10 lat** | Koniec roku kalendarzowego po złożeniu raportu informacyjnego ZUS | Wymaga oświadczenia pracodawcy + raportu ZUS RIA |
| Zatrudnienie przed 01.01.1999 | **50 lat** | Dzień zakończenia pracy | Bez możliwości skrócenia |
| Praca górnicza | **50 lat** | Dzień zakończenia pracy | Niezależnie od daty zatrudnienia |
| Postępowanie sądowe/kontrola | **Przedłużenie o 12 mies.** | Po prawomocnym zakończeniu | Gdy dokumentacja stanowi dowód w postępowaniu |

**UWAGA — litigation hold**: Jeżeli dokumentacja stanowi lub może stanowić dowód w postępowaniu, a pracodawca jest stroną — okres przechowywania przedłuża się do czasu prawomocnego zakończenia + 12 miesięcy. System musi obsługiwać `litigation_hold` z datą zakończenia postępowania.

**Implementacja w systemie:**
- Pole `retention_period` w `HRFolder`: enum `10_years` / `50_years`
- Pole `retention_base_date`: data od której liczymy
- Pole `retention_end_date`: obliczona automatycznie
- Uwzględnienie „końca roku kalendarzowego" dla scenariusza 10-letniego
- Konfigurowalne reguły — uwaga na wyjątki branżowe
- Przypomnienia: 12 miesięcy, 6 miesięcy, 3 miesiące, 1 miesiąc przed terminem brakowania

## 13.3 Bezpieczeństwo modułu HR

- **Dostęp**: tylko role HR, SA, AT (z explicit uprawnieniem), AU (read-only z logowaniem)
- **PESEL**: szyfrowany w bazie (AES-256), maskowany w UI (`***-***-**-**`), odsłonięcie wymaga kliknięcia → logowane w audycie
- **Logowanie operacji**: KAŻDA operacja na aktach osobowych logowana (otwarcie teczki, przeglądanie części, wyświetlenie PESEL, edycja, wydruk)
- **Separacja fizyczna danych** (opcja): osobna tabela/schemat dla danych HR, szyfrowanie na poziomie kolumn
- **Sesja**: krótszy timeout sesji dla modułu HR (np. 15 min vs 60 min standardowo)
- **Eksport**: eksport danych HR wymaga dodatkowej autoryzacji (ponowne hasło / 2FA)

---

# 13A. MODUŁ DOKUMENTÓW CYFROWYCH / SKANÓW (C) — SZCZEGÓŁY

## Architektura storage
- **Object storage**: S3 (AWS) / MinIO (self-hosted) / Azure Blob Storage
- **Struktura kluczy**: `/{tenant_id}/{entity_type}/{entity_id}/{attachment_id}/{version}/{filename}`
- **Szyfrowanie**: SSE-S3 (server-side encryption) + opcjonalnie CMK (customer managed keys) per tenant
- **Retencja plików**: powiązana z retencją jednostki archiwalnej — automatyczne usunięcie po brakowaniu

## Obsługiwane formaty
| Kategoria | Formaty | Uwagi |
|---|---|---|
| Obrazy (skany) | PDF, TIFF, JPEG, PNG | PDF preferowany (wielostronicowy) |
| Dokumenty biurowe | DOCX, XLSX, PPTX, ODT, ODS | Konwersja do PDF do podglądu |
| Pliki tekstowe | TXT, CSV, XML, JSON | Bezpośredni podgląd |
| Archiwa | ZIP (tylko jako kontener) | Automatyczna ekstrakcja treści do indeksu |

## Wersjonowanie
- Każdy upload nowego pliku do istniejącego załącznika tworzy nową wersję (`version` +1)
- Poprzednie wersje dostępne w historii (read-only)
- Możliwość przywrócenia starszej wersji (tworzy nową wersję = kopia starej)
- Maksymalnie N wersji (konfigurowalne, domyślnie 10) — starsze archiwizowane do cold storage

## Statusy załącznika
```
draft → active → archived → deleted (soft)
                ↓
            locked (blokada edycji przez admina/audytora)
```

## OCR (faza 2)
- **Silnik**: Tesseract (open-source) lub Google Cloud Vision / AWS Textract
- **Języki**: polski + angielski (domyślnie), konfigurowalne per tenant
- **Przepływ**: upload → queue → OCR worker → wynik do `ocr_text` w tabeli `Attachment` → indeksacja w Elasticsearch
- **Pełnotekstowe wyszukiwanie**: wyniki OCR indeksowane w Elasticsearch, wyszukiwanie z rankingiem trafności
- **Status OCR**: `pending` → `completed` / `failed` — widoczny w UI, retry przy błędach

## Podgląd dokumentów (viewer)
- **PDF**: wbudowany viewer (pdf.js) — bez konieczności pobierania
- **Obrazy**: lightbox z zoom/rotate
- **Office**: konwersja do PDF (LibreOffice headless) → viewer
- **Watermark**: opcjonalnie nakładanie watermarku z danymi użytkownika (kto przeglądał) — dla dokumentów poufnych

## Bulk scan workflow (faza 2)
1. Operator skanuje serię dokumentów skanerem biurkowym (wielostronicowy PDF / batch TIFF)
2. Upload do systemu (drag & drop lub folder watch)
3. System automatycznie dzieli na pojedyncze dokumenty (page separation)
4. Operator przypisuje dokumenty do kartonów/teczek (drag & drop w UI)
5. OCR uruchamiany automatycznie po przypisaniu

## Limity
- Max rozmiar pliku: 100 MB (konfigurowalne)
- Max łączny storage per tenant: konfigurowalne (quota)
- Rate limiting na upload: 50 plików / minutę per user

---

# 13B. MODUŁ UDOSTĘPNIANIA I PORTALU KLIENTA (D) — SZCZEGÓŁY

## Architektura dostępu

### Model RBAC + ABAC (hybrydowy)

**RBAC (Role-Based Access Control)** — warstwa bazowa:
- Użytkownik przypisany do roli (SA, AT, KA, OM, KK, HR, AU, RO)
- Rola definiuje zestaw uprawnień (permissions)
- Uprawnienia granularne: `box.read`, `box.write`, `box.delete`, `order.create`, `hr.view`, itd.

**ABAC (Attribute-Based Access Control)** — warstwa rozszerzona:
- Reguły dostępu oparte o atrybuty kontekstowe:

| Atrybut | Przykład reguły |
|---|---|
| `tenant_id` | Użytkownik widzi tylko dane swojego tenanta |
| `doc_type` | Rola HR widzi tylko `doc_type IN ('akta_osobowe', 'kadry')` |
| `confidentiality` | `strictly_confidential` wymaga roli SA lub AT + explicit grant |
| `department` | Koordynator działu X widzi tylko kartony działu X |
| `date_range` | Audytor widzi tylko dane z okresu audytowego |
| `ip_range` | Dostęp do modułu HR tylko z sieci firmowej (opcja) |

### Implementacja techniczna
- PostgreSQL Row-Level Security (RLS) z politykami per tenant
- Middleware aplikacyjny: sprawdzenie roli + atrybutów przed każdym zapytaniem
- Cache uprawnień w Redis (TTL 5 min, invalidacja przy zmianie roli)

## Portal klienta — funkcjonalności

### Dashboard klienta
- Podsumowanie: liczba kartonów, teczek, akt HR, skanów
- Zlecenia w toku (statusy, SLA countdown)
- Powiadomienia: retencja zbliżająca się, zlecenia do potwierdzenia
- Szybkie akcje: „Nowe zlecenie wydania", „Wyszukaj karton", „Pobierz raport"

### Przeglądanie zasobów
- Lista kartonów/teczek z filtrami (typ, lata, status, lokalizacja)
- Karta kartonu: metadane + zawartość + załączniki (skany do pobrania)
- **Ograniczenie**: klient NIE widzi fizycznej lokalizacji szczegółowej (regał/półka) — tylko „w archiwum" / „wydany" / „w realizacji"

### Zlecenia z portalu
- Formularz zlecenia wydania: wybór kartonów (checkbox/search) + priorytet + uwagi + adres dostawy
- Śledzenie statusu zlecenia (timeline: złożone → zaakceptowane → w kompletacji → wysłane → dostarczone)
- Potwierdzenie odbioru (przycisk w portalu → chain-of-custody zamknięty)
- Zlecenie zwrotu: analogiczny workflow w odwrotną stronę

### Wnioski o dostęp
- Użytkownik klienta może wnioskować o dostęp do dodatkowych zasobów (np. dokumentacja innego działu)
- Workflow: wniosek → akceptacja koordynatora klienta (AT) → przyznanie dostępu (opcjonalnie czasowego)
- Log wszystkich wniosków i decyzji

## Udostępnienia czasowe

### Link wygasający (Expiring Share Link)
- Generowany przez uprawnionego użytkownika (KA, AT)
- Parametry: czas wygaśnięcia (1h / 24h / 7d / custom), zakres (karton / teczka / dokument / skan)
- Link zawiera token kryptograficzny (JWT z expiry)
- Odbiorca: nie wymaga konta w systemie (read-only, z watermarkiem)
- Log: kto wygenerował, dla kogo (email), kiedy użyty, kiedy wygasł

### Dostęp tymczasowy (Temporary Access Grant)
- Przyznanie roli na czas określony (np. audytor na 30 dni)
- Automatyczne odebranie dostępu po upływie terminu
- Powiadomienie przed wygaśnięciem (7 dni, 1 dzień)

## Autentykacja i autoryzacja

### SSO (Single Sign-On)
- **SAML 2.0**: integracja z AD FS, Azure AD, Okta, OneLogin
- **OAuth2 / OpenID Connect**: Google Workspace, Microsoft Entra ID, Keycloak
- **Mapowanie ról**: rola z IdP → rola w systemie (konfigurowalne per tenant)
- **Provisioning**: opcjonalnie SCIM 2.0 (automatyczne tworzenie/dezaktywacja kont)

### 2FA (Two-Factor Authentication)
- **TOTP** (Time-based One-Time Password): Google Authenticator, Authy, Microsoft Authenticator
- **WebAuthn/FIDO2**: klucze sprzętowe (YubiKey) — faza 2
- **Wymuszenie**: 2FA obowiązkowe dla ról SA, AT, HR, AU; opcjonalne dla pozostałych
- **Recovery codes**: 10 jednorazowych kodów przy konfiguracji 2FA

### Polityki haseł (dla loginów lokalnych)
- Minimum 12 znaków, mix: wielkie + małe + cyfry + znaki specjalne
- Brak powtórzeń (ostatnie 12 haseł)
- Wymuszenie zmiany co 90 dni (konfigurowalne)
- Blokada konta po 5 nieudanych próbach (unlock po 30 min lub przez admina)
- Wymuszenie zmiany hasła przy pierwszym logowaniu

## Powiadomienia
| Zdarzenie | Kanał | Odbiorcy |
|---|---|---|
| Nowe zlecenie | Email + in-app | KA, OM |
| Zmiana statusu zlecenia | Email + in-app | Zleceniodawca (KK) |
| SLA ≥ 80% | Email + in-app | OM, KA |
| SLA przekroczony | Email | KA, AT |
| Retencja — 90 dni | Email | KK, AT |
| Retencja — 30 dni | Email + in-app | KK, AT, KA |
| Wniosek o dostęp | Email + in-app | AT |
| Nowy użytkownik | Email | AT |
| Nieudane logowanie (5x) | Email | SA, AT |
| Dostęp do akt HR | In-app (log) | SA |

---

# 13C. MODUŁ WORKFLOW ZLECEŃ (F) — SZCZEGÓŁY

## Typy zleceń

### 1. Zlecenie wydania (Checkout)
```
KLIENT                    ARCHIWUM
  │                          │
  ├─ Tworzy zlecenie ──────► │
  │  (lista kartonów,        │
  │   priorytet, SLA)        │
  │                          ├─ Weryfikuje i akceptuje
  │                          │
  │                          ├─ Operator kompletuje
  │                          │  (skanuje QR kartonów)
  │                          │
  │                          ├─ Pakuje / przygotowuje
  │                          │  do wydania
  │                          │
  │ ◄── Przekazanie ─────────┤
  │     (podpis/akceptacja)  │
  │                          │
  ├─ Potwierdza odbiór ─────►│
  │                          │
  │                          ├─ Status: COMPLETED
  │                          ├─ Box status: checked_out
  │                          ├─ Chain-of-custody: zamknięty
```

### 2. Zlecenie zwrotu (Return)
```
KLIENT                    ARCHIWUM
  │                          │
  ├─ Zgłasza zwrot ─────────►│
  │  (lista kartonów)        │
  │                          │
  │ ──── Dostarcza ──────────►│
  │                          │
  │                          ├─ Operator przyjmuje
  │                          │  (skanuje QR, weryfikuje stan)
  │                          │
  │                          ├─ Przypisuje lokalizację
  │                          │  (ta sama lub nowa)
  │                          │
  │                          ├─ Status: COMPLETED
  │                          ├─ Box status: active
```

### 3. Zlecenie transferu (Transfer)
- Przeniesienie kartonów z lokalizacji A do lokalizacji B (między magazynami lub strefami)
- Wewnętrzne zlecenie archiwum (bez udziału klienta)
- Chain-of-custody: operator wydający → transport → operator przyjmujący

### 4. Zlecenie brakowania (Disposal)
```
SYSTEM (auto/ręczne)      ARCHIWUM               KLIENT
  │                          │                      │
  ├─ Generuje listę ────────►│                      │
  │  kartonów do             │                      │
  │  brakowania              │                      │
  │                          ├─ Tworzy zlecenie ───►│
  │                          │  brakowania          │
  │                          │                      │
  │                          │ ◄── Akceptacja ──────┤
  │                          │     (lub odrzucenie)  │
  │                          │                      │
  │                          ├─ (opcja) Audytor ────┤
  │                          │  zatwierdza          │
  │                          │                      │
  │                          ├─ Operator realizuje  │
  │                          │  fizyczne zniszczenie│
  │                          │                      │
  │                          ├─ Protokół brakowania │
  │                          │  (nr, data, lista,   │
  │                          │   podpisy)           │
  │                          │                      │
  │                          ├─ Status: COMPLETED   │
  │                          ├─ Box status: disposed│
```

## Statusy zleceń — maszyna stanów

```
    ┌──────────┐
    │  DRAFT   │ ← Utworzone, ale nie wysłane
    └────┬─────┘
         │ submit
         ▼
    ┌──────────┐
    │SUBMITTED │ ← Oczekuje na akceptację archiwum
    └────┬─────┘
         │ approve          │ reject
         ▼                  ▼
    ┌──────────┐      ┌──────────┐
    │ APPROVED │      │ REJECTED │
    └────┬─────┘      └──────────┘
         │ start_picking
         ▼
    ┌──────────────┐
    │ IN_PROGRESS  │ ← Operator kompletuje
    └────┬─────────┘
         │ all items picked
         ▼
    ┌──────────────┐
    │   READY      │ ← Skompletowane, do wydania
    └────┬─────────┘
         │ handover
         ▼
    ┌──────────────┐
    │  DELIVERED   │ ← Przekazane, oczekuje potwierdzenia
    └────┬─────────┘
         │ confirm_receipt
         ▼
    ┌──────────────┐
    │  COMPLETED   │ ← Zamknięte
    └──────────────┘

    W każdym stanie (poza COMPLETED):
         │ cancel
         ▼
    ┌──────────────┐
    │  CANCELLED   │
    └──────────────┘
```

## SLA — konfiguracja

| Poziom | Czas realizacji | Użycie |
|---|---|---|
| Standard | 24h robocze | Domyślny |
| High | 8h robocze | Ważne, ale nie pilne |
| Urgent | 4h robocze | Pilne (dodatkowa opłata) |
| Express | 2h robocze | Awaryjne (premium) |

- SLA liczone od momentu `submitted` do `delivered`
- Konfiguracja per tenant: które poziomy SLA dostępne, domyślny poziom
- Godziny robocze: konfigurowalne (domyślnie Pn-Pt 8:00–16:00)
- Timer SLA widoczny w UI (countdown z kolorami: zielony → żółty → czerwony)
- Eskalacja: 80% SLA → powiadomienie operator; 100% → koordynator; 120% → manager

## Chain-of-custody — model szczegółowy

Każde fizyczne przekazanie kartonu rejestrowane jako `CustodyEvent`:

| Pole | Opis |
|---|---|
| `event_type` | `handover` (wydanie), `receipt` (odbiór), `return` (zwrot), `transfer` (przesunięcie) |
| `from_user_id` | Kto przekazuje |
| `to_user_id` | Kto odbiera |
| `from_location_id` | Skąd (lokalizacja w magazynie) |
| `to_location_id` | Dokąd (lokalizacja lub „klient") |
| `signature_data` | Podpis elektroniczny (faza 1: checkbox „potwierdzam", faza 2: podpis na ekranie) |
| `event_at` | Timestamp zdarzenia |
| `notes` | Uwagi (np. „karton uszkodzony przy odbiorze") |

**Łańcuch jest nieprzerwalny**: system nie pozwala na „przeskoczenie" kroku. Każde wydanie musi mieć odbiór, każdy zwrot musi mieć przyjęcie.

**Raport chain-of-custody**: pełna historia kartonu od przyjęcia do brakowania — gotowy do audytu (eksport PDF).

## Obsługa anomalii w zleceniach

| Anomalia | Obsługa |
|---|---|
| Karton nie znaleziony w lokalizacji | Status pozycji → `issue`, powiadomienie KA, eskalacja |
| Karton uszkodzony | Dokumentacja fotograficzna (załącznik), zmiana statusu na `damaged`, powiadomienie klienta |
| Klient nie potwierdza odbioru | Przypomnienie po 24h, eskalacja po 72h, auto-zamknięcie po 7 dniach z flagą |
| Zlecenie częściowo zrealizowane | Możliwość częściowego zamknięcia (zrealizowane pozycje → completed, reszta → nowe zlecenie) |
| Anulowanie w trakcie kompletacji | Zwrot zebranych kartonów na miejsce, log anulowania z powodem |

---

# 14. WYMAGANIA NIEFUNKCJONALNE — PODSUMOWANIE

## Bezpieczeństwo
- TLS 1.3 dla ruchu sieciowego
- Szyfrowanie danych w spoczynku (AES-256 dla wrażliwych pól, encrypted storage)
- PostgreSQL Row-Level Security (tenant isolation)
- Audit log na osobnej partycji / replikowalny
- Backup: daily full + WAL continuous archiving, retencja backupów 90 dni
- DR: RTO < 4h, RPO < 1h
- Penetration testing: przed wdrożeniem produkcyjnym i co 12 miesięcy

## Wydajność
- Wyszukiwanie: < 2s (95. percentyl) przy 2M kartonów
- Generowanie PDF etykiety: < 3s
- Masowy import 10 000 rekordów: < 5 min
- Dashboard load: < 3s
- API response: < 500ms (95. percentyl)

## Skalowalność
- Horizontal scaling: stateless backend (konteneryzacja Docker/K8s)
- Database: PostgreSQL z read-replicas, partycjonowanie
- Storage: S3/MinIO (skalowalny object storage)
- Cache: Redis cluster
- Queue: RabbitMQ / Redis Streams dla operacji asynchronicznych

## Zgodność
- RODO: minimalizacja danych, prawo do informacji, rejestr czynności przetwarzania
- Retencja: konfigurowalne polityki per tenant, auto-kalkulacja, workflow brakowania
- Audit: kompletny, niemodyfikowalny log operacji (append-only)
- Rozporządzenie o dokumentacji pracowniczej (2018, zm. 2023): struktura akt A-E

## Użyteczność
- 3 kliknięcia do „Gdzie jest karton X?"
- 3 kliknięcia do „Drukuj etykietę dla kartonu Y"
- Responsywny UI: desktop (1920px) + tablet (768px) + mobile (375px)
- Skanowanie QR: dostępne z każdego ekranu (persistent button / FAB)
- Onboarding: wizard pierwszego uruchomienia dla nowego tenanta
- Dostępność: WCAG 2.1 AA (minimum)

---

# 15. CO JESZCZE DODAĆ, O CZYM ZWYKLE SIĘ ZAPOMINA

## Lista 25 często pomijanych, a kluczowych punktów

1. **Inwentaryzacja cykliczna** — system musi wymuszać i planować regularne inwentaryzacje (np. co kwartał per strefa). Bez tego lokalizacje w systemie rozjadą się z rzeczywistością w ciągu miesięcy.

2. **Prognozowanie zapełnienia magazynu** — raport trendu: przy obecnym tempie przyjęć, kiedy magazyn się zapełni? Krytyczne dla planowania zakupu regałów / wynajmu dodatkowej przestrzeni.

3. **SLA zróżnicowane per klient i per typ zlecenia** — nie jedno SLA dla wszystkich. Duży klient płaci za 4h express, mały ma 48h standard. System musi to obsługiwać i raportować osobno.

4. **Polityka numeracji kartonów** — ustalenie jednoznacznego, nieedytowalnego schematu numeracji PRZED startem systemu. Zmiana numeracji po wdrożeniu to koszmar migracyjny. Uwzględnić: prefiksy per tenant, per rok, sekwencje.

5. **Szablony metadanych per klient** — różni klienci mają różne wymagania co do opisu kartonów. Firma prawnicza potrzebuje „numer sprawy", firma budowlana „numer projektu". Custom fields per tenant.

6. **Migracja z Excela / starych systemów** — 90% archiwów prowadzi ewidencję w Excelu. Narzędzie importu z walidacją, mapowaniem kolumn i dry-run jest KRYTYCZNE dla wdrożenia. Bez niego wdrożenie potrwa wielokrotnie dłużej.

7. **Zdarzenia wyjątkowe: zniszczony karton** — co jeśli karton jest zalany, spalony, zniszczony? System musi mieć status `damaged` z workflow dokumentowania zdarzenia i powiadomienia klienta.

8. **Brak etykiety / nieczytelna etykieta** — co jeśli etykieta QR odkleiła się lub jest nieczytelna? Workflow: „oznacz jako nieczytelny" → generuj duplikat etykiety → przypisz do kartonu → loguj zdarzenie.

9. **Scalanie / rozdzielanie kartonów** — czasem trzeba przenieść teczki z jednego kartonu do drugiego (np. konsolidacja częściowo pustych kartonów). System musi to obsługiwać z pełnym audytem.

10. **Obsługa kartonów bez przypisanej lokalizacji** — stan „w transporcie", „na stole do opracowania", „w strefie kompletacji". Lokalizacje tymczasowe / statusy tranzytowe.

11. **Powiadomienia eskalacyjne** — zlecenie nie zrealizowane w 80% SLA → powiadomienie operator. 100% SLA → powiadomienie koordynator. 120% → powiadomienie manager. Wielopoziomowa eskalacja.

12. **Raport dla klienta (self-service)** — klient chce wiedzieć: ile mam kartonów, ile zapłacę, kiedy jakie kartony idą do brakowania. Portal klienta z raportami self-service.

13. **Historia edycji metadanych** — nie tylko „kto edytował", ale „co zmienił" (diff). Krytyczne dla audytu i sporów.

14. **Obsługa duplikatów QR** — co jeśli ktoś wydrukuje etykietę dwa razy i naklei na dwa kartony? System musi wykrywać i flagować duplikaty przy skanowaniu.

15. **Timeout skanowania (batch mode)** — przy inwentaryzacji operator skanuje setki kodów. System musi działać w trybie batch z feedbackiem dźwiękowym/wizualnym (sukces/błąd/duplikat).

16. **Obsługa wielu magazynów i transferów między nimi** — zlecenie transferu z Magazynu A do Magazynu B z pełnym trackingiem chain-of-custody w transporcie.

17. **Backup etykiet / reprint** — możliwość wydrukowania duplikatu etykiety w dowolnym momencie, z logowaniem kto i kiedy.

18. **Raporty do fakturowania** — nawet jeśli system nie fakturuje, musi generować dane do faktury: kartono-miesiące, liczba operacji, liczba skanów.

19. **Obsługa dokumentacji niejawnej / poufnej** — oznaczanie kartonów/teczek poziomem poufności, z ograniczeniem kto może je widzieć i obsługiwać. Osobny regał / strefa dla dokumentów poufnych.

20. **Konfiguracja per-tenant workflow** — firma A wymaga 2-stopniowej akceptacji brakowania, firma B wymaga 1-stopniowej. Konfigurowalne workflow per tenant.

21. **Archiwalny QR fallback (offline)** — co jeśli serwer jest niedostępny? Minimalna funkcjonalność offline: odczyt danych z QR (zakodowane w kodzie: tenant, numer, checksum).

22. **Data retention dla logów audytu** — logi audytu też podlegają retencji. Ile lat trzymamy logi? Różne wymagania per typ operacji (HR logi dłużej niż operacyjne).

23. **Obsługa roku przejściowego** — kartony z retencją „koniec 2024" powinny pojawić się w raporcie brakowania na początku 2025. Obsługa przełomu roku w kalkulacji retencji.

24. **Mechanizm „szybkiego wydania" (express)** — dla pilnych zleceń: uproszczony workflow z mniejszą liczbą akceptacji, ale z flagą „express" i audytem.

25. **Test disaster recovery** — nie tylko backup, ale regularne testowanie odtwarzania. System powinien logować datę ostatniego testu DR i przypominać o kolejnym.

---

# ŹRÓDŁA I REFERENCJE RYNKOWE

- [Zasio Physical Records Management](https://zasio.com/technology-solutions/physical-records-management/)
- [Iron Mountain Records Storage](https://www.ironmountain.com/services/offsite-records-storage)
- [Gimmal Physical Records Management](https://gimmal.com/gimmal-physical/)
- [Gartner Peer Insights — Records Management Systems](https://www.gartner.com/reviews/market/records-management-systems)
- [Akta osobowe pracownika 2025 — Infor.pl](https://kadry.infor.pl/zatrudnienie/dokumentacja-pracownicza/6884733,akta-osobowe-pracownika-2025-czesci.html)
- [Prowadzenie dokumentacji pracowniczej 2025 — Centrum Verte](https://centrumverte.pl/blog/prowadzenie-dokumentacji-pracowniczej-w-2025-roku-jak-robic-to-dobrze/)
- [Biznes.gov.pl — Dokumentacja pracownicza](https://www.biznes.gov.pl/pl/portal/00101)
- [Okresy przechowywania dokumentacji pracowniczej](https://poradnikprzedsiebiorcy.pl/-okresy-przechowywania-dokumentacji-pracowniczej)
- [Terminy przechowywania akt pracowniczych — e-prawnik](https://e-prawnik.pl/artykuly/terminy-przechowywania-akt-pracowniczych-od-2019-r-.html)

---

*Dokument wygenerowany: 2026-02-11*
*Wersja: 1.0 — draft do konsultacji*
