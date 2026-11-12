# Etap 4, punkt 6: wyszukiwanie semantyczne

## Kontrola przed wdrozeniem

Na serwerze ArchiveCore, w katalogu `C:\Apps\archivecore`, uruchom:

```powershell
npm run db:audit-semantic-readiness
```

Polecenie tylko czyta metadane PostgreSQL i liczniki zalacznikow. Nie odczytuje
tresci dokumentow, nie instaluje rozszerzen i nie zmienia danych. `vectorAvailable`
oznacza, ze pliki pgvector sa dostepne dla tej wersji PostgreSQL; `vectorEnabled`
oznacza, ze rozszerzenie wlaczono w bazie ArchiveCore. Brak pierwszego warunku
wyklucza bezpieczne dodanie migracji `CREATE EXTENSION vector` do zwyklego
`prisma migrate deploy`.

Licznik `withOcrText` pokazuje, ile zalacznikow spoza akt osobowych ma obecnie
tekst nadajacy sie do indeksowania. Sam import skanu spisu ZO wykonuje OCR na
potrzeby podgladu, ale nie wypelnia automatycznie `attachments.ocrText`.

## Kolejnosc prac

1. Potwierdzic obecnosc pgvector na serwerze PostgreSQL oraz kopie zapasowa bazy.
2. Ustalic lokalny model embeddingow z dobrym wsparciem dla jezyka polskiego,
   jego wymiary i wersje. Nie wysylac OCR, PESEL ani akt do zewnetrznego API
   bez osobnej decyzji dotyczacej przetwarzania danych.
3. Dodac osobna tabele fragmentow i wektorow, powiazana z tenantem, zalacznikiem,
   numerem strony, wersja modelu i suma kontrolna zrodla. Migracja ma byc
   wykonywana dopiero po sprawdzeniu rozszerzenia na kopii bazy produkcyjnej.
4. Indeksowac dokumenty partiami, z limitem rozmiaru i mozliwoscia wznowienia.
   Zmiana lub usuniecie zrodla musi uniewazniac jego wektory.
5. Wyszukiwanie musi filtrowac tenant, dzial, powiazanie z aktywnym rekordem
   i dostep do akt **przed** zwroceniem wyniku. Domyslnie nie indeksowac akt
   osobowych. Wynik pokazuje rekord zrodlowy i strone, nie surowe dane wrazliwe.
6. Porownac trafnosc na polskich zapytaniach i przypadkach kontrolnych miedzy
   tenantami. Dopiero po przejsciu tych testow wlaczyc funkcje uzytkownikom.

Do czasu spelnienia tych warunkow obecna wyszukiwarka tekstowa pozostaje bez
zmian. Zadna nowa migracja bazy nie jest uruchamiana przez sam audyt.

## Kontrola dostepu do przyszlych wynikow API

`readableSemanticSources` w module wyszukiwania ponownie sprawdza kandydatow
z indeksu w aktualnej bazie aplikacji. Wymaga kontekstu tenanta oraz uprawnien
do wyszukiwania i odczytu zrodla. Pracownik tenanta bez przypisanego dzialu
nie dostaje wynikow. Dla pracownika dzialowego zwracane sa tylko aktywne teczki
w nieusunietych kartonach jego dzialu; caly spis ZO moze obejmowac wiele
dzialow, wiec nie jest zwracany. Zwracane sa tylko biezace tytuly z bazy
produkcyjnej, jesli suma kontrolna metadanych zgadza sie z indeksem. Nie sa
zwracane tytuly ani punktacja z indeksu. Limit wynosi 100 kandydatow.
Test: `npm run test:semantic-access`.

Trasa `GET /api/search/semantic-pilot?q=...&limit=10` jest domyslnie
wylaczona (404). Po wlaczeniu wymaga zalogowanego Super Admina, wybranego
tenanta i uprawnienia `search.all`. Zapytanie do indeksu ogranicza tenanta,
dzial i dokladny digest lokalnego modelu. Kazdy wynik przechodzi ponowna
kontrole dostepu i aktualnosci w produkcji. Odpowiedz zawiera tylko typ,
identyfikator, aktualny tytul i link. Bez OCR, skanow, akt osobowych,
surowych wektorow i punktacji. Zwykla wyszukiwarka pozostaje bez zmian.

Do jawnego wlaczenia na serwerze potrzebne sa `SEMANTIC_PILOT_ENABLED=true`,
`SEMANTIC_PILOT_DATABASE_URL` wskazujacy wylacznie
`127.0.0.1:55433/archivecore_staging` oraz
`SEMANTIC_PILOT_DATA_DIR=C:\Apps\PostgreSQL-Staging\data`. Aplikacja sprawdza
rowniez rzeczywista sciezke klastra PostgreSQL przed uzyciem indeksu.
**Nie wlaczaj flagi przed testem end-to-end na odrebnej bazie i ocena
jakosci wynikow.** Testy API: `npm run test:semantic-pilot-api`.

## Przygotowanie pgvector na Windows bez Dockera

Serwer produkcyjny ma PostgreSQL 16 w `C:\Program Files\PostgreSQL\16`.
Na tym samym serwerze dziala juz **osobny klaster testowy** PostgreSQL 16.15:
binaria `C:\Apps\PostgreSQL-Staging\16`, dane
`C:\Apps\PostgreSQL-Staging\data`, port `127.0.0.1:55433`, usluga Windows
`archivecore-pgvector-staging` (konto LocalService, start reczny), baza
`archivecore_staging`. Haslo testowej bazy jest zaszyfrowane w
`C:\Apps\PostgreSQL-Staging\staging-password.aes`, z osobnym kluczem w
`C:\Apps\PostgreSQL-Staging\staging-password.key`. Dostep do obu plikow jest
ograniczony do Administratorow i konta System. Nie umieszczaj ich
w repozytorium ani w produkcyjnym `.env`. Wczesniejszy zapis DPAPI przestal
byc odczytywalny w sesji SSH; haslo testowej bazy zostalo odnowione, bez
zmiany hasla produkcyjnego. Skrypt
`server/scripts/setup-pgvector-staging.ps1` dokumentuje utworzenie klastra;
**nie uruchamiaj go ponownie na istniejacej instalacji**. Rozszerzenie
pgvector v0.8.7 jest zainstalowane tylko w testowym `PGROOT`. Druga baza
w klastrze produkcyjnym nie zapewnialaby takiej izolacji.

Na instancji testowej zainstaluj oficjalne narzedzia Visual Studio z obsluga
C++, otworz jako administrator `x64 Native Tools Command Prompt`, a nastepnie
wykonaj [instrukcje pgvector dla Windows](https://github.com/pgvector/pgvector#installation).
`PGROOT` musi wskazywac **testowa**, a nie produkcyjna instalacje PostgreSQL.
Na serwerze Doxart uzyto:

```cmd
set "PGROOT=C:\Apps\PostgreSQL-Staging\16"
git clone --branch v0.8.7 https://github.com/pgvector/pgvector.git
cd pgvector
nmake /F Makefile.win
nmake /F Makefile.win install
```

Nie uruchamiaj `nmake install` ponownie bez sprawdzenia `PGROOT`. Na serwerze
kompilacje przeprowadzono przy uzyciu oficjalnych Visual Studio Build Tools
2022 i zrodla pgvector v0.8.7. Nie uzywaj nieoficjalnych plikow `vector.dll`.

Po instalacji ustaw `DATABASE_URL` na osobna baze testowa (bez wpisywania
hasla w historie konsoli) i uruchom:

```powershell
npm run db:smoke-pgvector-staging -- --staging-db archivecore_staging --staging-data-dir "C:\Apps\PostgreSQL-Staging\data"
```

Test nie wczytuje `.env`, odmawia pracy na porcie 5432 niezaleznie od hosta,
sprawdza rzeczywisty katalog danych instancji i odmawia pracy na znanym
katalogu produkcyjnym. W transakcji tworzy tymczasowa tabele metadanych z
wektorami o 1024 wymiarach oraz indeks HNSW; na koniec wycofuje transakcje.
Sprawdza filtrowanie sztucznych rekordow wedlug tenanta, dzialu, wersji modelu
i usuniecia zrodla. To **nie jest jeszcze test uprawnien API** ani gwarancja
kompletnosci wynikow indeksu przy duzej liczbie rekordow. Przed zwroceniem
wyniku przyszle API musi ponownie sprawdzic dostep do aktywnego zrodla.
Podaj faktyczny katalog danych odrebnej instalacji testowej;
podobna nazwa bazy lub inny port same w sobie nie dowodza izolacji klastra.
Przed instalacja na produkcji trzeba jeszcze wykonac kopie
zapasowa, probe odtworzenia, test migracji na kopii schematu i weryfikacje
uprawnien wyszukiwania miedzy tenantami i dzialami.

## Trwaly indeks tylko w bazie testowej

Skrypt `server/scripts/semantic-index-staging.cjs` przygotowuje oddzielna
tabele `semantic_metadata_index` w bazie testowej: klucz tenanta i zrodla,
znormalizowany dzial, sume SHA-256 metadanych, wersje modelu, wektor 1024
wymiarow i czas indeksowania. Ten sam rekord jest aktualizowany po zmianie
sumy kontrolnej, dzialu lub wersji modelu; po usunieciu zrodla wpis mozna
usunac. Indeksy B-tree i HNSW przyspieszaja filtrowanie i podobienstwo.
Nie ma tu skanow, OCR ani akt osobowych. Kod nie odczytuje bazy produkcyjnej,
nie kopiuje danych klientow i nie dodaje migracji Prisma.

Na serwerze Doxart uruchom ponizszy skrypt. Odczytuje on zaszyfrowane haslo
testowe bez wypisywania go i laczy sie tylko z klastrem `127.0.0.1:55433`:

```powershell
& .\server\scripts\run-semantic-index-staging.ps1 -Action init
& .\server\scripts\run-semantic-index-staging.ps1 -Action smoke
```

`--init` trwale tworzy pusta tabele i rozszerzenie tylko w bazie testowej.
`--smoke` sprawdza zapis, odswiezenie, odfiltrowanie innego tenanta i
usuniecie na sztucznych rekordach w wycofywanej transakcji. Polecenia
sprawdzaja rzeczywisty katalog danych i odmawiaja pracy na znanym katalogu
produkcyjnym oraz na porcie 5432. Testy jednostkowe:
`npm run test:semantic-index-staging`.

Sam schemat nie synchronizuje sie z aplikacja. Ponizszy pilot porownuje sumy
kontrolne i zapisuje identyfikator konkretnego artefaktu modelu; przed
wlaczeniem API trzeba jeszcze sprawdzic wznowienie po przerwaniu, aktualnosc
zrodel oraz uprawnienia i trafnosc na danych pilotowych.
Filtry tenanta i dzialu musza byc w zapytaniu do indeksu, a wyniki dodatkowo
przejsc przez `readableSemanticSources`.

## Odswiezanie metadanych w pilocie

Po zgodzie na pilot mozna odczytac z produkcji tylko tytuly, opisy, typy
dokumentow i dzialy teczek oraz tytuly i notatki spisow ZO. Skrypt
`reconcile-semantic-metadata.cjs` czyta je w transakcji `READ ONLY`; nie
odczytuje akt osobowych, zalacznikow, skanow ani OCR. Tekst trafia tylko do
lokalnego modelu Ollama na `127.0.0.1` i **nie jest zapisywany** w bazie
testowej. Indeks przechowuje wektory, sumy kontrolne i identyfikatory zrodel.
Konsola pokazuje wylacznie liczniki. Pelny przeglad jednego tenanta jest
ograniczony do 10000 rekordow, a jedna proba aktualizuje najwyzej 100.

Na serwerze, z katalogu `C:\Apps\archivecore`, najpierw podglad bez wysylania
tekstu do modelu i bez zapisu:

```powershell
& .\server\scripts\run-semantic-reconcile-staging.ps1 -Tenant SMPOLI -MaxChanges 20
```

Po sprawdzeniu licznikow, ograniczona partia:

```powershell
& .\server\scripts\run-semantic-reconcile-staging.ps1 -Tenant SMPOLI -MaxChanges 20 -Apply
```

Uruchomienie mozna powtorzyc. Nieprzetworzone rekordy pozostaja na kolejna
partie; wpis o niezmienionej sumie i wersji modelu nie jest przeliczany.
Znikniecie zrodla albo jego wylaczenie z indeksowania usuwa wpis z **bazy
testowej**. Skrypt blokuje rownolegle uruchomienia. Czas pracy i zachowanie
po przerwaniu nalezy nadal monitorowac podczas pilota. Testy:
`npm run test:reconcile-semantic-staging`.

Po podgladzie `SMPOLI` (2225 zrodel) wykonano partie 20 wpisow i probe
jednego wpisu w kontekscie SYSTEM. Na serwerze dziala testowe zadanie Windows
`ArchiveCoreSemanticStagingSMPOLI`: do 20 zmian co 15 minut, bez nakladajacych
sie uruchomien, z limitem 5 minut na przebieg. Dotyczy tylko `SMPOLI` i tylko
odrebnej bazy `archivecore_staging`. Nie uruchamia produkcyjnego API.
Stan sprawdzisz na serwerze:

```powershell
Get-ScheduledTaskInfo -TaskName ArchiveCoreSemanticStagingSMPOLI
& .\server\scripts\run-semantic-reconcile-staging.ps1 -Tenant SMPOLI -MaxChanges 20
```

W razie potrzeby zadanie mozna wstrzymac poleceniem
`Disable-ScheduledTask -TaskName ArchiveCoreSemanticStagingSMPOLI`.
Po pierwszym automatycznym przebiegu potwierdz licznik i kod wyniku zadania.

## Lokalny pilot na metadanych

Pilot nie wymaga pgvector i nie zapisuje danych. Dziala wylacznie z konsoli
administratora, na probce maksymalnie 200 teczek i spisow jednego tenanta.
Bez filtra dzialu rezerwuje do 25% probki na spisy ZO, takze gdy samych
teczek jest wiecej niz ustawiony limit.
Model `bge-m3:latest` musi byc uruchomiony lokalnie w Ollama na
`127.0.0.1:11434`. Zapytanie i metadane sa przesylane tylko do tej lokalnej
uslugi; kod nie pozwala podac zewnetrznego adresu. Nie sa czytane akta
osobowe, skany ani tekst OCR. Wyniki pozostaja w konsoli i nie sa widoczne
w wyszukiwarce aplikacji.

Najpierw sam odczyt liczby rekordow:

```powershell
npm run db:pilot-semantic-metadata -- --tenant SMPOLI --dry-run
```

Po zainstalowaniu Ollama i pobraniu modelu `bge-m3:latest`:

```powershell
npm run db:pilot-semantic-metadata -- --tenant SMPOLI --query "dokumentacja finansowa" --max 100 --top 10
```

Na serwerze Windows odizolowany pakiet pilota mozna przygotowac tak:

```powershell
node server/scripts/setup-local-embedding.cjs --install
node server/scripts/setup-local-embedding.cjs --serve
node server/scripts/setup-local-embedding.cjs --pull
```

Pakiet jest pobierany z oficjalnej wersji Ollama i sprawdzany wzgledem SHA-256
podanego przez GitHub. Proces nasluchuje tylko na `127.0.0.1`, nie jest
rejestrowany jako usluga i nie modyfikuje PostgreSQL ani PM2. Windows Server
2022 nie widnieje na oficjalnej liscie wspieranych systemow Ollama; jesli
uruchomienie sie nie powiedzie, nie wlaczaj pilota w aplikacji produkcyjnej.

Opcjonalne `--department "Ksiegowosc"` ogranicza wynik do teczek w kartonach
tego dzialu i nie pokazuje osobnych spisow, ktore obejmuja wiele dzialow.
Nie dolacza tez tytulu wspolnego spisu do tekstu teczki wysylanego do lokalnego
modelu; pozostaja dane samej teczki i jej pozycji w spisie.
Pilot nie stanowi jeszcze kontroli uprawnien aplikacji: uruchamia go tylko
administrator z dostepem do konsoli i bazy. Przed udostepnieniem wynikow
uzytkownikom potrzebne sa pgvector, indeks, kontrola dostepu w API i ocena
trafnosci na polskich zapytaniach.

## Pomiar trafnosci pilota

Przygotuj na serwerze plik JSON z 1-20 recznie sprawdzonymi zapytaniami.
Kazde `relevant` wskazuje teczke lub spis, ktory powinien pojawic sie wsrod
wynikow. Identyfikatory musza nalezec do wybranego tenanta i miescic sie
w probce `--max`; w przeciwnym razie test przerwie sie bez podawania
mylacego wyniku. Przy filtrze `--department` nie podawaj samodzielnego spisu,
poniewaz obejmuje on potencjalnie wiele dzialow.

```json
[
  {
    "query": "faktury za remont budynku",
    "relevant": [
      { "type": "folder", "id": "00000000-0000-0000-0000-000000000001" }
    ]
  }
]
```

Zastap przykladowe UUID rzeczywistym identyfikatorem teczki ze spisu ZO.
Nie wpisuj do pliku PESEL ani tresci dokumentow. Uruchomienie nie zapisuje
danych i uzywa tego samego lokalnego modelu co pilot:

```powershell
npm run db:evaluate-semantic-metadata -- --tenant SMPOLI --file C:\Apps\reconciliation\semantic-cases.json --max 200 --top 10
```

Wynik pokazuje hit-rate (odsetek zapytan z co najmniej jednym oczekiwanym
rekordem w pierwszych 10), sredni recall oraz MRR, czyli jak wysoko pojawil
sie pierwszy trafny wynik. Wynik mierzy tylko wybrana probke metadanych, nie
cale archiwum ani jakosc przyszlego indeksu pgvector. Przed udostepnieniem
funkcji nalezy osobno sprawdzic, czy wyniki nie ujawniaja danych innych
tenantow i dzialow.

Do pojedynczego testu kontrolnego nie trzeba przygotowywac pliku JSON. Po
recznym potwierdzeniu, ze dany rekord jest trafny dla zapytania, podaj jego
typ i UUID:

```powershell
npm run db:evaluate-semantic-metadata -- --tenant SMPOLI --query "faktury kosztowe" --relevant folder:00000000-0000-0000-0000-000000000001 --max 200 --top 10
```

To test jednego zapytania, a nie miarodajna ocena trafnosci dla calego
archiwum. Tryby `--file` oraz `--query`/`--relevant` sa rozlaczne.
Przy teczce mozna pominac `folder:` i podac sam UUID.
Mozna podac kilka par `--query`/`--relevant` w jednym uruchomieniu; kazdy
`--relevant` nalezy do poprzedzajacego go zapytania. Model oblicza wektory
rekordow tylko raz, a wynik pokazuje osobno kazde zapytanie i srednie miary.
