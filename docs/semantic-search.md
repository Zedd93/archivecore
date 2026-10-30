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
Pilot nie stanowi jeszcze kontroli uprawnien aplikacji: uruchamia go tylko
administrator z dostepem do konsoli i bazy. Przed udostepnieniem wynikow
uzytkownikom potrzebne sa pgvector, indeks, kontrola dostepu w API i ocena
trafnosci na polskich zapytaniach.
