#!/bin/bash
# ================================================
# ArchiveCore — Generator pliku .env.production
# Uruchom: bash generate-env.sh
# ================================================

echo "🔐 Generuję bezpieczne hasła..."

DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
JWT_SECRET=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)
JWT_REFRESH_SECRET=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)
ENCRYPTION_KEY=$(openssl rand -hex 16)
MINIO_ACCESS_KEY="archivecore-$(openssl rand -hex 4)"
MINIO_SECRET_KEY=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)

read -p "🌐 Podaj domenę lub IP serwera (np. archivecore.example.com lub 18.198.55.12): " DOMAIN

cat > .env.production << EOF
# ================================================
# ArchiveCore — KONFIGURACJA PRODUKCYJNA
# Wygenerowano: $(date)
# ================================================

# Database
DB_PASSWORD=${DB_PASSWORD}

# MinIO / S3
MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
MINIO_SECRET_KEY=${MINIO_SECRET_KEY}

# JWT
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}

# Szyfrowanie PESEL (AES-256)
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# Domena
CORS_ORIGIN=http://${DOMAIN}
EOF

echo ""
echo "✅ Plik .env.production został utworzony!"
echo ""
echo "📋 Twoje dane logowania do bazy danych:"
echo "   Użytkownik: archivecore"
echo "   Hasło:      ${DB_PASSWORD}"
echo ""
echo "📋 Twoja domena: ${DOMAIN}"
echo ""
echo "⚠️  ZAPISZ TE DANE W BEZPIECZNYM MIEJSCU!"
echo "⚠️  Plik .env.production zawiera wrażliwe dane — nigdy go nie commituj do gita!"
