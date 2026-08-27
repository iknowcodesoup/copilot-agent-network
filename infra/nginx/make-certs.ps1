# Regenerates the local dev TLS cert used by infra/nginx/nginx.conf.
#
# Run this after installing mkcert's root CA (`mkcert -install`, once per
# machine) or after the LAN IP below changes. Requires mkcert on PATH:
#     winget install FiloSottile.mkcert
#
# A second device on the LAN (phone, other laptop) will show a browser
# warning until it trusts the same root CA. Copy it over and install by hand:
#     mkcert -CAROOT   # prints the folder holding rootCA.pem
# There is no way around this for a bare LAN IP - only a real domain with a
# publicly trusted CA (e.g. Let's Encrypt) skips this step.

param(
    [string[]]$Hosts = @("localhost", "127.0.0.1", "10.0.0.14", "::1")
)

$certDir = Join-Path $PSScriptRoot "certs"
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

Push-Location $certDir
try {
    mkcert -key-file dev-key.pem -cert-file dev-cert.pem @Hosts
}
finally {
    Pop-Location
}
