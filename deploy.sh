#!/bin/bash
set -e

REPO_URL="${1:-}"
APP_DIR="${2:-/opt/claude-chat}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${GREEN}[+]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[x]${NC} $1"; exit 1; }

if [ -z "$REPO_URL" ]; then
    error "Kullanım: ./deploy.sh <github-repo-url> [kurulum-dizini]\nÖrnek: ./deploy.sh https://github.com/kullanici/repo.git"
fi

# -----------------------------------------------------------
# 1. Docker kur (yoksa)
# -----------------------------------------------------------
if ! command -v docker &>/dev/null; then
    info "Docker kuruluyor..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    info "Docker kuruldu."
else
    info "Docker zaten kurulu: $(docker --version)"
fi

# -----------------------------------------------------------
# 2. Repoyu klonla veya güncelle
# -----------------------------------------------------------
if [ -d "$APP_DIR/.git" ]; then
    info "Repo güncelleniyor: $APP_DIR"
    git -C "$APP_DIR" pull
else
    info "Repo klonlanıyor: $REPO_URL → $APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

# -----------------------------------------------------------
# 3. .env dosyasını oluştur
# -----------------------------------------------------------
if [ ! -f ".env" ]; then
    warn ".env dosyası bulunamadı. Oluşturuluyor..."
    cp .env.example .env

    echo ""
    warn "Lütfen aşağıdaki değerleri .env dosyasına girin:"
    echo ""

    read -rp "  ANTHROPIC_API_KEY (sk-ant-...): " ANTHROPIC_KEY
    read -rsp "  POSTGRES_PASSWORD (güçlü şifre): " PG_PASS
    echo ""

    sed -i "s|ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${ANTHROPIC_KEY}|" .env
    sed -i "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PASS}|" .env

    info ".env dosyası oluşturuldu."
else
    info ".env zaten mevcut, atlanıyor."
fi

# -----------------------------------------------------------
# 4. Docker imajlarını oluştur ve başlat
# -----------------------------------------------------------
info "Docker imajları derleniyor (bu birkaç dakika sürebilir)..."
docker compose build

info "Servisler başlatılıyor..."
docker compose up -d

# -----------------------------------------------------------
# 5. Durum kontrolü
# -----------------------------------------------------------
echo ""
info "Dağıtım tamamlandı!"
echo ""
docker compose ps
echo ""
info "Uygulama şu adreste çalışıyor: http://$(hostname -I | awk '{print $1}')"
echo ""
warn "Güvenlik duvarında 80 numaralı porta izin vermeyi unutmayın:"
echo "  ufw allow 80/tcp"
echo ""
warn "HTTPS için Certbot kullanabilirsiniz:"
echo "  apt install certbot python3-certbot-nginx"
echo "  certbot --nginx -d alanadiniz.com"
