# ArchiveCore — Instrukcja wdrożenia na AWS (krok po kroku)

> Wyobraź sobie, że wynajmujesz komputer w chmurze (serwer), kopiujesz na niego aplikację, i ją uruchamiasz. To w zasadzie tyle.

---

## Co będziesz potrzebować

- Karta kredytowa/debetowa (AWS wymaga do rejestracji, pierwszy rok dużo rzeczy za darmo)
- 15-30 minut czasu
- Ten folder z aplikacją

---

## KROK 1: Załóż konto AWS

1. Otwórz: **https://aws.amazon.com/**
2. Kliknij **"Create an AWS Account"** (pomarańczowy przycisk)
3. Wypełnij formularz: email, hasło, nazwa konta
4. Podaj kartę (nie zostaniesz obciążony — pierwszy rok jest darmowy dla małych instancji)
5. Wybierz plan **"Basic Support — Free"**
6. Gotowe — zaloguj się do **AWS Console**

---

## KROK 2: Uruchom serwer (EC2)

> EC2 = "Elastic Compute Cloud" = wynajęty komputer w chmurze

1. W AWS Console, na górze jest **wyszukiwarka** — wpisz **EC2** i kliknij
2. Kliknij pomarańczowy przycisk **"Launch instance"**
3. Wypełnij:

| Pole | Co wpisać |
|------|-----------|
| **Name** | `ArchiveCore` |
| **OS** | Kliknij **Ubuntu** (powinien być wybrany domyślnie) |
| **Instance type** | `t3.small` (2 vCPU, 2GB RAM) — kosztuje ~$0.02/h ≈ ~60 PLN/miesiąc |
| **Key pair** | Kliknij **"Create new key pair"** → nazwa: `archivecore-key` → typ: **RSA** → format: **.pem** → kliknij **Create** → PLIK SIĘ POBIERZE — **nie zgub go!** |
| **Network settings** | Kliknij **Edit**, zaznacz: ✅ Allow SSH (22), ✅ Allow HTTP (80), ✅ Allow HTTPS (443) |
| **Storage** | Zmień na **30 GB** (domyślne 8 to za mało) |

4. Kliknij **"Launch instance"**
5. Poczekaj ~1 minutę aż status będzie **"Running"**

---

## KROK 3: Znajdź adres IP swojego serwera

1. W EC2 → kliknij **"Instances"** w menu po lewej
2. Kliknij na swoją instancję **ArchiveCore**
3. Skopiuj **"Public IPv4 address"** — np. `18.198.55.12`
4. **ZAPISZ TEN ADRES** — będziesz go potrzebować wielokrotnie

---

## KROK 4: Połącz się z serwerem

### Na Macu (Terminal):

```bash
# 1. Idź do folderu gdzie pobrałeś klucz (pewnie Downloads)
cd ~/Downloads

# 2. Ustaw uprawnienia klucza (wymagane!)
chmod 400 archivecore-key.pem

# 3. Połącz się z serwerem (wstaw swoje IP zamiast 18.198.55.12)
ssh -i archivecore-key.pem ubuntu@18.198.55.12
```

> Jeśli zapyta "Are you sure you want to continue connecting?" — wpisz **yes** i Enter.

**Powinieneś zobaczyć coś takiego:**
```
ubuntu@ip-172-31-xx-xx:~$
```

🎉 **Jesteś na serwerze!** Wszystkie następne komendy wpisujesz tutaj.

---

## KROK 5: Zainstaluj Docker na serwerze

Kopiuj i wklej **CAŁOŚĆ** jednym razem:

```bash
# Instalacja Dockera (kopiuj CAŁOŚĆ i wklej)
sudo apt-get update && \
sudo apt-get install -y ca-certificates curl && \
sudo install -m 0755 -d /etc/apt/keyrings && \
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc && \
sudo chmod a+r /etc/apt/keyrings/docker.asc && \
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null && \
sudo apt-get update && \
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin && \
sudo usermod -aG docker $USER
```

**Ważne!** Po instalacji wyloguj się i zaloguj ponownie:
```bash
exit
ssh -i archivecore-key.pem ubuntu@18.198.55.12
```

Sprawdź czy działa:
```bash
docker --version
```
Powinno wypisać coś jak: `Docker version 27.x.x`

---

## KROK 6: Prześlij aplikację na serwer

Otwórz **NOWE okno Terminala** na swoim Macu (nie na serwerze!) i wpisz:

```bash
# Spakuj aplikację (na Macu)
cd ~/Desktop
tar -czf archivecore.tar.gz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='dist' \
  Aplikacja/

# Wyślij na serwer (wstaw swoje IP!)
scp -i ~/Downloads/archivecore-key.pem \
  archivecore.tar.gz \
  ubuntu@18.198.55.12:~/
```

Teraz wróć do okna z **serwerem** (SSH) i rozpakuj:

```bash
# Na serwerze — rozpakuj
cd ~
tar -xzf archivecore.tar.gz
mv Aplikacja archivecore
cd archivecore
```

---

## KROK 7: Wygeneruj bezpieczne hasła

```bash
# Na serwerze — w folderze archivecore
bash generate-env.sh
```

Skrypt zapyta o domenę/IP — **wpisz IP serwera** (np. `18.198.55.12`).

Skrypt stworzy plik `.env.production` z losowymi, bezpiecznymi hasłami.

---

## KROK 8: Uruchom aplikację!

```bash
bash deploy.sh
```

**To zajmie 3-5 minut** (budowanie obrazu Docker). Na końcu zobaczysz:

```
╔══════════════════════════════════════════╗
║         ✅ DEPLOYMENT ZAKOŃCZONY!        ║
╚══════════════════════════════════════════╝

🌐 Aplikacja: http://18.198.55.12
```

---

## KROK 9: Otwórz w przeglądarce

Wejdź na:

```
http://TWOJE-IP
```

np. `http://18.198.55.12`

Powinieneś zobaczyć stronę logowania ArchiveCore.

**Zaloguj się:**
- Email: `admin@demo.pl`
- Hasło: `Admin123!@#`

---

## 🎉 GOTOWE! Aplikacja działa w internecie!

---

## BONUS: Własna domena (opcjonalnie)

Jeśli chcesz mieć ładny adres zamiast numeru IP (np. `archivecore.mojafirma.pl`):

### 1. Kup domenę
- Na **OVH.pl**, **nazwa.pl**, lub **home.pl** — koszt: ~40-60 PLN/rok

### 2. Ustaw DNS
- W panelu domeny, dodaj rekord **A**:
  - Nazwa: `@` (lub puste)
  - Typ: `A`
  - Wartość: `18.198.55.12` (IP twojego serwera)
  - TTL: `300`
- Poczekaj 5-30 minut na propagację DNS

### 3. Włącz HTTPS (darmowy certyfikat SSL)
```bash
# Na serwerze
cd ~/archivecore

# Zaktualizuj nginx.conf — zamień "server_name _" na swoją domenę:
# np. server_name archivecore.mojafirma.pl;

# Wygeneruj certyfikat
docker compose -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  -d archivecore.mojafirma.pl \
  --email twoj@email.pl \
  --agree-tos \
  --no-eff-email

# Odkomentuj blok HTTPS w nginx.conf (ten zakomentowany na dole)
# i zamień "twoja-domena.pl" na swoją domenę

# Restart nginx
docker compose -f docker-compose.prod.yml restart nginx
```

---

## Przydatne komendy (ściągawka)

| Co chcesz zrobić | Komenda |
|---|---|
| **Sprawdź status** | `docker compose -f docker-compose.prod.yml ps` |
| **Zobacz logi** | `docker compose -f docker-compose.prod.yml logs -f app` |
| **Restart aplikacji** | `docker compose -f docker-compose.prod.yml restart app` |
| **Zatrzymaj wszystko** | `docker compose -f docker-compose.prod.yml down` |
| **Uruchom ponownie** | `docker compose -f docker-compose.prod.yml --env-file .env.production up -d` |
| **Aktualizuj aplikację** | Wyślij nowe pliki, potem `docker compose -f docker-compose.prod.yml build app && docker compose -f docker-compose.prod.yml up -d app` |

---

## Ile to kosztuje?

| Usługa | Koszt/miesiąc |
|--------|---------------|
| EC2 t3.small (2 vCPU, 2GB) | ~$15 (~60 PLN) |
| Dysk 30GB EBS | ~$3 (~12 PLN) |
| Transfer danych | ~$0-5 (mały ruch) |
| **RAZEM** | **~$18-23 (~75-95 PLN/mies.)** |

> Pierwszy rok: `t3.micro` (1 vCPU, 1GB) jest **ZA DARMO** w ramach Free Tier. Może wystarczyć do testów, ale dla produkcji lepiej `t3.small`.

---

## Gdy coś nie działa

### "Strona się nie ładuje"
```bash
# Sprawdź czy kontenery działają
docker compose -f docker-compose.prod.yml ps

# Sprawdź logi
docker compose -f docker-compose.prod.yml logs app
```

### "Connection refused"
- Sprawdź w AWS Console → EC2 → Security Groups czy porty 80 i 443 są otwarte

### "Baza danych error"
```bash
# Sprawdź logi bazy
docker compose -f docker-compose.prod.yml logs postgres

# Ponownie uruchom migrację
docker compose -f docker-compose.prod.yml exec app npx prisma db push
```

### "Chcę zacząć od zera"
```bash
docker compose -f docker-compose.prod.yml down -v   # -v kasuje dane!
bash deploy.sh
```
