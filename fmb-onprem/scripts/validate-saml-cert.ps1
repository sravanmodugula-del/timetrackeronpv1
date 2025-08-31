
# FMB SAML Certificate Validation Script
param(
    [string]$CertPath = "saml_cert.pem"
)

Write-Host "🔍 FMB SAML Certificate Validation" -ForegroundColor Green

# Check if certificate file exists
if (-not (Test-Path $CertPath)) {
    Write-Host "❌ Certificate file not found: $CertPath" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Certificate file found: $CertPath" -ForegroundColor Green

# Display certificate information
Write-Host "`n📜 Certificate Details:" -ForegroundColor Cyan
$certInfo = openssl x509 -in $CertPath -text -noout

# Extract key information
$subject = $certInfo | Select-String "Subject:" | ForEach-Object { $_.ToString().Trim() }
$issuer = $certInfo | Select-String "Issuer:" | ForEach-Object { $_.ToString().Trim() }
$validity = $certInfo | Select-String "Not Before:|Not After:" | ForEach-Object { $_.ToString().Trim() }

Write-Host $subject -ForegroundColor Yellow
Write-Host $issuer -ForegroundColor Yellow
$validity | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }

# Check certificate validity dates
Write-Host "`n⏰ Certificate Validity Check:" -ForegroundColor Cyan
$validityCheck = openssl x509 -in $CertPath -checkend 0 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Certificate is valid and not expired" -ForegroundColor Green
} else {
    Write-Host "❌ Certificate is expired or invalid" -ForegroundColor Red
}

# Verify certificate format and content
Write-Host "`n🔧 Certificate Format Validation:" -ForegroundColor Cyan
$certContent = Get-Content $CertPath -Raw

if ($certContent -match "-----BEGIN CERTIFICATE-----" -and $certContent -match "-----END CERTIFICATE-----") {
    Write-Host "✅ Certificate format is correct (PEM)" -ForegroundColor Green
} else {
    Write-Host "❌ Certificate format is incorrect - should be PEM format" -ForegroundColor Red
}

# Extract and display the certificate from IDP metadata for comparison
Write-Host "`n📋 Certificate from IDP Metadata:" -ForegroundColor Cyan
$idpCert = "MIICujCCAaKgAwIBAgIGAZjEhvegMA0GCSqGSIb3DQEBCwUAMB4xHDAaBgNVBAMME3RpbWV0cmFj
a2VyLmZtYi5jb20wHhcNMjUwODE5MjI1MDM2WhcNMjkwODE5MjI1MDM2WjAeMRwwGgYDVQQDDBN0
aW1ldHJhY2tlci5mbWIuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsAvUPmwO
4YLQZAPURQyN8e+RJnLtuY2WLwimpjbuZwX/KlwSFnj8vEgU/0wqBZChIu/Vj1/BJphAVlHatwp9
2QKFotDN2lnYii6jNUoizzVb4HSAqk5GBvfecH0h0ZBReado1SWprPhoRH8bz3+K1kFKHphI/Xke
ao07IRnxBLIWiGj713J8O82mPe08CNoM5XmIMjpw4iGS3an8euyNzafVJHEipaeSJyWY8pu3j+qV
d+oWdQvxWBGNC+XVh8lNCmaSGQhtQqfkODjV+NosREIeDldwenXUZbLMJ/IdZkqPgDLYjmXRbjs/
RNv0tuozJ8rRCXOF233XUGfIWoPHjwIDAQABMA0GCSqGSIb3DQEBCwUAA4IBAQBW+ifgz5rpZDoE
SzSm9xtxDZxWnpnefALJ5hagmh17ToFyyx//QEm/TPAyRi87eZOnqBvD3pcM7HppqdVOn4anbJBf
tWs1XM44KN749OWjQJETdw+azUdvbOCJSmt2WuRY5mB1kU7BbcBIaSoRczAp4ylq4Qv0JM4L9lWF
GwwUjHJr+YGWfTA+mv5mDaNuMAUX6cYDO49MDlEZmMIKWM6gKcZblrOmoqCPKbnS/SmhgqvTYeuc
ajyePFkvD7dskv9Xkz9sK6JxZezvGxDLJek/PwTvuHa0wimE+wCmfwhiUgPPvXrgqS6drvFnpWVm
1mpYtlmgU7UR47ipvSkO65Vh"

# Compare certificates (remove whitespace for comparison)
$localCertContent = ($certContent -replace "-----BEGIN CERTIFICATE-----" -replace "-----END CERTIFICATE-----" -replace "`n" -replace "`r" -replace " ").Trim()
$idpCertContent = ($idpCert -replace "`n" -replace "`r" -replace " ").Trim()

Write-Host "`n🔍 Certificate Comparison:" -ForegroundColor Cyan
if ($localCertContent -eq $idpCertContent) {
    Write-Host "✅ Certificate matches IDP metadata exactly!" -ForegroundColor Green
} else {
    Write-Host "❌ Certificate does NOT match IDP metadata" -ForegroundColor Red
    Write-Host "Local cert length: $($localCertContent.Length)" -ForegroundColor Yellow
    Write-Host "IDP cert length: $($idpCertContent.Length)" -ForegroundColor Yellow
}

Write-Host "`n🎯 SAML Configuration Analysis:" -ForegroundColor Cyan
Write-Host "Entity ID: a0tt0vrnu3tt" -ForegroundColor White
Write-Host "SSO URL: https://portal.fmb.com/IdPServlet?idp_id=a0tt0vrnu3tt" -ForegroundColor White
Write-Host "Binding: HTTP-POST" -ForegroundColor White
Write-Host "Supported NameID Formats:" -ForegroundColor White
Write-Host "  - urn:oasis:names:tc:SAML:2.0:nameid-format:persistent (RECOMMENDED)" -ForegroundColor Green
Write-Host "  - urn:oasis:names:tc:SAML:2.0:nameid-format:transient" -ForegroundColor Yellow
Write-Host "  - urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified" -ForegroundColor Yellow
Write-Host "  - urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" -ForegroundColor Yellow
Write-Host "  - urn:oasis:names:tc:SAML:1.1:nameid-format:X509SubjectName" -ForegroundColor Yellow

Write-Host "`n✅ Validation Complete!" -ForegroundColor Green
