#!/bin/bash
# ================================================
# ArchiveCore — Skrypt wdrożenia na serwer
# Uruchom na serwerze: bash deploy.sh
# ================================================
set -e

echo "╔══════════════════════════════════════════╗"
echo "║    ArchiveCore — Deployment Script       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo "❌ Brak pliku .env.production!"
    echo "   Uruchom najpierw: bash generate-env.sh"
    exit 1
fi

# Load env vars
set -a
source .env.production
set +a

echo "1️⃣  Buduję obraz Docker..."
docker compose -f docker-compose.prod.yml build --no-cache app

echo ""
echo "2️⃣  Uruchamiam kontenery..."
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

echo ""
echo "3️⃣  Czekam na gotowość bazy danych..."
sleep 10

echo ""
echo "4️⃣  Uruchamiam migrację bazy danych..."
docker compose -f docker-compose.prod.yml exec -T app prisma db push --accept-data-loss --skip-generate

echo ""
echo "5️⃣  Seeduję dane początkowe (idempotentne — pomija istniejące)..."
docker compose -f docker-compose.prod.yml exec -T app prisma db seed || \
echo "   ⚠️  Seed nie powiódł się lub dane już istnieją — sprawdź logi powyżej."

echo ""
echo "6️⃣  Sprawdzam status..."
docker compose -f docker-compose.prod.yml ps

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         ✅ DEPLOYMENT ZAKOŃCZONY!        ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "🌐 Aplikacja: http://${CORS_ORIGIN#http://}"
echo ""
echo "🔑 Dane logowania:"
echo "   SA:   admin@archivecore.local / Admin123!@#"
echo "   Demo: admin@demo.pl / Admin123!@#"
echo ""
echo "📋 Przydatne komendy:"
echo "   docker compose -f docker-compose.prod.yml logs -f app   — logi aplikacji"
echo "   docker compose -f docker-compose.prod.yml restart app   — restart"
echo "   docker compose -f docker-compose.prod.yml down          — zatrzymaj wszystko"
