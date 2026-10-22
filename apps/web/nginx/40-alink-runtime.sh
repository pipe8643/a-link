#!/bin/sh
# Se ejecuta en cada arranque del contenedor, antes de Nginx. Escribe SOLO en /tmp (el sistema de archivos puede
# ser de solo lectura).
#   1. /tmp/alink/config.js : configuración de tiempo de ejecución (licencia de ZoomCharts).
#   2. /tmp/alink/tls.crt|key: certificado real montado en /etc/nginx/certs, o uno AUTOFIRMADO solo para pruebas.
set -eu

DIR=/tmp/alink
mkdir -p "$DIR"
chmod 700 "$DIR"

# --- config.js -------------------------------------------------------------------------------------------------
LICENSE="${ZOOMCHARTS_LICENSE:-}"
LICENSE_KEY="${ZOOMCHARTS_LICENSE_KEY:-}"
# Los valores acaban dentro de un literal de cadena de un script JavaScript. Solo se admiten caracteres ASCII
# imprimibles y se rechazan comillas dobles y barras invertidas (falla en lugar de intentar escapar): con ellos, o
# con saltos de línea, el valor podría cerrar la cadena e inyectar código.
for value in "$LICENSE" "$LICENSE_KEY"; do
  case "$value" in
    *[!' '-'~']*|*'"'*|*'\'*)
      echo "ERROR: ZOOMCHARTS_LICENSE / ZOOMCHARTS_LICENSE_KEY contienen caracteres no permitidos." >&2
      exit 1
      ;;
  esac
done
umask 077
printf 'window.__ALINK_CONFIG__={"zoomChartsLicense":"%s","zoomChartsLicenseKey":"%s"};\n' "$LICENSE" "$LICENSE_KEY" >"$DIR/config.js"
chmod 644 "$DIR/config.js"
if [ -z "$LICENSE" ] || [ -z "$LICENSE_KEY" ]; then
  echo "AVISO: sin licencia de ZoomCharts el lienzo del grafo no se dibujará." >&2
fi

# --- TLS -------------------------------------------------------------------------------------------------------
if [ -r /etc/nginx/certs/tls.crt ] && [ -r /etc/nginx/certs/tls.key ]; then
  cp /etc/nginx/certs/tls.crt "$DIR/tls.crt"
  cp /etc/nginx/certs/tls.key "$DIR/tls.key"
else
  echo "AVISO: no hay certificado en /etc/nginx/certs; se genera uno AUTOFIRMADO (solo pruebas, NO producción)." >&2
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -keyout "$DIR/tls.key" -out "$DIR/tls.crt" 2>/dev/null
fi
chmod 600 "$DIR/tls.key"
chmod 644 "$DIR/tls.crt"
