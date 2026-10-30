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

## Przygotowanie pgvector na Windows bez Dockera

Serwer produkcyjny ma PostgreSQL 16 w `C:\Program Files\PostgreSQL\16`.
Nie ma obecnie `nmake`, wiec nie nalezy uruchamiac instalacji rozszerzenia
na tej instancji. Najpierw przygotuj **osobna instancje testowa** PostgreSQL
16 na innym serwerze lub w izolowanej instalacji z innym katalogiem danych,
portem i `PGROOT`. Druga baza w tym samym klastrze produkcyjnym nie jest
izolacja: `nmake install` kopiuje pliki rozszerzenia do wspolnego `PGROOT`.

Na instancji testowej zainstaluj oficjalne narzedzia Visual Studio z obsluga
C++, otworz jako administrator `x64 Native Tools Command Prompt`, a nastepnie
wykonaj [instrukcje pgvector dla Windows](https://github.com/pgvector/pgvector#installation).
`PGROOT` musi wskazywac **testowa**, a nie produkcyjna instalacje PostgreSQL:

```cmd
set "PGROOT=C:\Program Files\PostgreSQL\16"
git clone --branch v0.8.7 https://github.com/pgvector/pgvector.git
cd pgvector
nmake /F Makefile.win
nmake /F Makefile.win install
```

Powyzszy `PGROOT` to tylko przyklad, jesli taka jest sciezka instalacji
testowej. Przed `nmake install` sprawdz ja ponownie. Nie uzywaj
nieoficjalnych plikow `vector.dll` z przypadkowych repozytoriow.

Po instalacji ustaw `DATABASE_URL` na osobna baze testowa (bez wpisywania
hasla w historie konsoli) i uruchom:

```powershell
npm run db:smoke-pgvector-staging -- --staging-db archivecore_staging
```

Test nie wczytuje `.env`, odmawia pracy na lokalnym porcie produkcyjnym 5432,
tworzy tylko sztuczne wektory w transakcji i na koniec ja wycofuje. Samo
sprawdzenie nazwy bazy nie dowodzi izolacji klastra: operator musi potwierdzic
osobna instancje. Przed instalacja na produkcji trzeba jeszcze wykonac kopie
zapasowa, probe odtworzenia, test migracji na kopii schematu i weryfikacje
uprawnien wyszukiwania miedzy tenantami i dzialami.

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
