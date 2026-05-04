# Imagem base do monorepo apps/n03ap01 (e potencialmente outras apps Cloudfy
# que estendem @cloudfy/corp). Conteudo da imagem: Node 24 + JDK 17 + locale
# pt_BR + ImageMagick + node_modules instalado a partir do package.json
# AGREGADO (gerado pelo workflow GHA via gen-aggregated-package.mjs).
#
# Codigo da app (dist/, Reports/, SQL/, conf/) NAO entra na imagem — vem por
# PVC EFS, copiado pelo Job efemero do K8s a cada deploy. node_modules vive
# DENTRO da imagem; @cloudfy/corp e simbolizado pra /usr/src/app/packages/corp
# que e populado pelo PVC em runtime.

# Trixie (Debian 13) — GLIBC 2.40+, necessario pelo java-bridge native binding
# que e compilado contra GLIBC 2.39. Bookworm (2.36) nao suporta.
FROM node:24-trixie-slim
LABEL maintainer="José Carlos de Oliveira Junior"
LABEL version="Produção - monorepo Cloudfy"

RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-21-jdk-headless \
    cabextract \
    xfonts-utils \
    fontconfig \
    fonts-dejavu-core \
    fonts-liberation \
    libharfbuzz0b \
    libfreetype6 \
    libfontconfig1 \
    libjpeg62-turbo \
    libpng16-16 \
    libtiff6 \
    libxrender1 \
    libxext6 \
    libxi6 \
    libxtst6 \
    imagemagick \
    locales \
    curl \
    tini \
    ca-certificates \
    git \
    rsync \
    netcat-openbsd \
    gettext-base \
 && sed -i '/pt_BR.UTF-8/s/^# //g' /etc/locale.gen && locale-gen \
 && curl -fsSL https://curl.se/ca/cacert.pem -o /etc/ssl/certs/cacert.pem \
 && rm -rf /var/lib/apt/lists/*

# Microsoft core fonts (Arial, Times New Roman, Verdana, Courier New, etc.)
# usados pelos JRXML do Cloudfy. Esta em contrib (nao-livre) — habilitamos
# o repo, aceitamos a EULA via debconf e instalamos. fc-cache regenera
# o indice de fontes pra Java/fontconfig encontrarem em runtime.
RUN echo 'deb http://deb.debian.org/debian trixie contrib' > /etc/apt/sources.list.d/contrib.list \
 && echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" \
        | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends ttf-mscorefonts-installer \
 && fc-cache -fv \
 && rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/contrib.list

ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/cacert.pem \
    LANG=pt_BR.UTF-8 \
    LANGUAGE=pt_BR:pt \
    LC_ALL=pt_BR.UTF-8 \
    JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
    NODE_ENV=production \
    TZ=America/Sao_Paulo

# package.json AGREGADO entra aqui (gerado pelo workflow GHA via
# gen-aggregated-package.mjs). Se nao for fornecido, npm install falha.
WORKDIR /usr/src/app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Estrutura @cloudfy/corp como diretorio REAL dentro de node_modules.
# Sem symlink — Node ESM resolve direto. Os 3 mountpoints sao populados
# em runtime: dist/ + java-deps/ via PVC, package.json via ConfigMap.
RUN mkdir -p /usr/src/app/apps/n03ap01 \
             /usr/src/app/node_modules/@cloudfy/corp/dist \
             /usr/src/app/node_modules/@cloudfy/corp/java-deps \
             /jwt /var/www \
 && chmod 777 /jwt /var/www

WORKDIR /usr/src/app/apps/n03ap01

EXPOSE 3090
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/Main.js"]
