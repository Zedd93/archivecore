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
