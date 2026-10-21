# Import spisów ZO ze skanów

Ta funkcja jest pierwszym krokiem importu AI: działa lokalny OCR oraz ręczna korekta i akceptacja pozycji. **Nie ma jeszcze interpretacji przez model LLM.** Skany i tekst OCR nie są wysyłane do zewnętrznego dostawcy AI ani trwale przechowywane przez ten moduł. Zapisane są tylko zatwierdzone pozycje spisu.

## Wymagania na serwerze Windows (natywne wdrożenie)

1. Zainstaluj Tesseract OCR wraz z pakietami językowymi `pol` i `eng`.
2. Zainstaluj Poppler for Windows (`pdfinfo.exe` i `pdftoppm.exe`) do odczytu PDF. Dla JPG/PNG/TIFF wystarczy Tesseract.
3. Dodaj katalogi obu programów do systemowego `PATH` używanego przez proces `archivecore-server` w PM2. Sprawdź w tej samej powłoce: `tesseract --list-langs`, `pdfinfo -v`, `pdftoppm -v`. Na liście języków muszą być `pol` i `eng`.
4. Uruchom ponownie proces PM2 po zmianie `PATH`, tak aby odziedziczył nowe środowisko. Sam `npm install` tych programów nie instaluje.

Nie trzeba nowej migracji bazy danych. Aktualizację aplikacji wykonaj istniejącym `C:\Apps\update.ps1` po upewnieniu się, że w `PATH` są powyższe programy.

## Użycie i ograniczenia

W **Import danych → Spisy ZO → Skan PDF / zdjęcie** wybierz plik, odczytaj OCR, popraw tekst oraz robocze pozycje, a na końcu potwierdź zgodność z oryginałem. Import nigdy nie zapisuje tekstu OCR automatycznie. Jeśli w osobnej komórce przed kategorią akt odczytano dokładnie „brak dat”, pozycja otrzymuje robocze oznaczenie **Brak dat / wymaga ustalenia**. Można je też zaznaczyć ręcznie. Zaznaczenie czyści wpisane daty; wpisanie daty usuwa oznaczenie. Każdą pozycję trzeba sprawdzić ze skanem. PDF może mieć maksymalnie 3 strony, plik maksymalnie 10 MB, a spis maksymalnie 500 pozycji. Import większego PDF jako jednego spisu wymaga kolejnego etapu prac. Rozpoznanie tabel jest heurystyczne: daty, wielowierszowe tytuły, kategorie i numery kartonów wymagają szczególnej kontroli. Wpisany numer kartonu może utworzyć karton zgodnie z obecną logiką importu spisów.
