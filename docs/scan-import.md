# Import spisów ZO ze skanów

Ta funkcja jest pierwszym krokiem importu AI: działa lokalny OCR oraz ręczna korekta i akceptacja pozycji. **Nie ma jeszcze interpretacji przez model LLM.** Skany i tekst OCR nie są wysyłane do zewnętrznego dostawcy AI ani trwale przechowywane przez ten moduł. Zapisane są tylko zatwierdzone pozycje spisu.

## Wymagania na serwerze Windows (natywne wdrożenie)

PDF zawierający warstwę tekstową jest odczytywany przez aplikację bez dodatkowych programów. Dla PDF będącego skanem obrazu potrzebne są:

1. Tesseract OCR z pakietami językowymi `pol` i `eng`.
2. Poppler for Windows (`pdftoppm.exe`) do przygotowania stron PDF jako obrazów. Dla JPG/PNG/TIFF wystarczy Tesseract.
3. Katalogi tych programów w systemowym `PATH` używanym przez proces `archivecore-server` w PM2. Sprawdź w tej samej powłoce: `tesseract --list-langs` i `pdftoppm -v`. Na liście języków muszą być `pol` i `eng`.
4. Ponowne uruchomienie procesu PM2 po zmianie `PATH`, aby odziedziczył nowe środowisko. Sam `npm install` tych programów nie instaluje.

Nie trzeba nowej migracji bazy danych. Aktualizację aplikacji wykonaj istniejącym `C:\Apps\update.ps1`. Programy zewnętrzne są konieczne tylko dla OCR obrazów.

## Użycie i ograniczenia

W **Import danych → Spisy ZO → Skan PDF / zdjęcie** wybierz plik, odczytaj tekst, popraw go i robocze pozycje, a na końcu potwierdź zgodność z oryginałem. PDF z warstwą tekstową jest odczytywany bez OCR; dla obrazów działa lokalny OCR. Import nigdy nie zapisuje odczytanego tekstu automatycznie. Jeśli w osobnej komórce przed kategorią akt odczytano dokładnie „brak dat”, pozycja otrzymuje robocze oznaczenie **Brak dat / wymaga ustalenia**. Można je też zaznaczyć ręcznie. Zaznaczenie czyści wpisane daty; wpisanie daty usuwa oznaczenie. Każdą pozycję trzeba sprawdzić ze skanem. PDF może mieć maksymalnie 12 stron, plik maksymalnie 10 MB, a spis maksymalnie 500 pozycji. System odczytuje PDF strona po stronie i pokazuje tekst każdej strony osobno. Gdy strona nie da żadnej pozycji, trzeba poprawić jej tekst albo jawnie potwierdzić, że jest bez pozycji. Ponad 500 rozpoznanych pozycji blokuje zapis zamiast ucinać listę. Większy plik trzeba podzielić na mniejsze spisy. Rozpoznanie tabel jest heurystyczne: daty, wielowierszowe tytuły, kategorie i numery kartonów wymagają szczególnej kontroli. Wpisany numer kartonu może utworzyć karton zgodnie z obecną logiką importu spisów.

Robocze wiersze rozpoznają nagłówki takie jak „Znak teczki”, „Tytuł teczki lub tomu”, „Daty skrajne od–do”, „Kat. akt” i „Numer kartonu”, także gdy kategoria nie jest ostatnią kolumną. Dalsza część tytułu w osobnym wierszu jest dołączana tylko do jednoznacznie rozpoznanej poprzedniej pozycji. Niepewne kategorie i daty pozostają puste do ręcznej korekty. Miejsce przechowywania, liczba teczek i data zniszczenia nie są w tym trybie przenoszone automatycznie ze skanu; po imporcie trzeba je sprawdzić w spisie.
