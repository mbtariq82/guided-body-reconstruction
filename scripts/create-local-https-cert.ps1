param(
  [string]$LanIp = "",
  [string]$Passphrase = "guided-body-reconstruction"
)

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $rootDir ".certs"
$publicCertPath = Join-Path $rootDir "public\guided-body-reconstruction-local-root-ca.cer"
$rootName = "Guided Body Reconstruction Local Dev Root CA"
$serverName = "guided-body-reconstruction.local"

if (-not $LanIp) {
  $LanIp = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.PrefixOrigin -ne "WellKnown" -and
      $_.InterfaceOperationalStatus -eq "Up"
    } |
    Select-Object -ExpandProperty IPAddress -First 1
}

if (-not $LanIp) {
  throw "Could not detect a LAN IPv4 address. Pass one explicitly with -LanIp."
}

New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$existingRoot = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.Subject -eq "CN=$rootName" } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if ($existingRoot) {
  $rootCert = $existingRoot
} else {
  $rootCert = New-SelfSignedCertificate `
    -Subject "CN=$rootName" `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears(3) `
    -KeyUsage CertSign, CRLSign, DigitalSignature `
    -TextExtension @("2.5.29.19={critical}{text}ca=1&pathlength=0")
}

$serverCert = New-SelfSignedCertificate `
  -Subject "CN=$serverName" `
  -Signer $rootCert `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(1) `
  -KeyUsage DigitalSignature, KeyEncipherment `
  -TextExtension @(
    "2.5.29.17={text}ipaddress=$LanIp&dns=localhost&dns=$serverName",
    "2.5.29.37={text}1.3.6.1.5.5.7.3.1",
    "2.5.29.19={critical}{text}ca=0"
  )

$securePassphrase = ConvertTo-SecureString -String $Passphrase -Force -AsPlainText
$pfxPath = Join-Path $certDir "guided-body-reconstruction-local.pfx"
$rootCertPath = Join-Path $certDir "guided-body-reconstruction-local-root-ca.cer"

Export-PfxCertificate -Cert $serverCert -FilePath $pfxPath -Password $securePassphrase -Force | Out-Null
Export-Certificate -Cert $rootCert -FilePath $rootCertPath -Force | Out-Null
Copy-Item -LiteralPath $rootCertPath -Destination $publicCertPath -Force

[pscustomobject]@{
  LanIp = $LanIp
  HttpsUrl = "https://$($LanIp):3443"
  RootCertificateFile = $publicCertPath
  RootCertificateDownloadUrl = "http://$($LanIp):3000/guided-body-reconstruction-local-root-ca.cer"
  PfxFile = $pfxPath
}
