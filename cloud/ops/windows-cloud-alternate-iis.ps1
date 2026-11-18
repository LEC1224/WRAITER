[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9]+(?:[.-][a-z0-9]+)+$')][string]$SiteHost,
    [Parameter(Mandatory=$true)][ValidateSet('Prepare','Enable')][string]$Action,
    [string]$WinAcme = 'wacs.exe',
    [string]$PrimaryProxyConfig = (Join-Path $env:ProgramData 'WRAITER\proxy\web.config'),
    [string]$WebRoot = (Join-Path $env:ProgramData 'WRAITER\proxy-alternate')
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module WebAdministration
$siteName = 'WRAITER Cloud Alternate'
$webRoot = [IO.Path]::GetFullPath($WebRoot)
$origin = "https://$SiteHost"

if (!(Get-WebConfigurationProperty -PSPath MACHINE/WEBROOT/APPHOST -Filter system.webServer/proxy -Name enabled).Value -or
    !(Get-WebConfigurationProperty -PSPath MACHINE/WEBROOT/APPHOST -Filter system.webServer/proxy -Name preserveHostHeader).Value) {
    throw 'WRAITER needs the existing IIS proxy with Host forwarding.'
}
[xml]$config = Get-Content -LiteralPath $PrimaryProxyConfig -Raw
$restriction = $config.SelectSingleNode('//rewrite/rules/rule[@name="Block direct origin traffic"]/action')
$redirect = $config.SelectSingleNode('//rewrite/rules/rule[@name="WRAITER HTTPS"]/action')
$rewrite = $config.SelectSingleNode('//rewrite/rules/rule[@name="WRAITER Cloud"]')
if (!$restriction -or $restriction.statusCode -ne '403' -or !$redirect -or !$rewrite) { throw 'The original WRAITER proxy rules do not match the expected configuration.' }
$redirect.SetAttribute('url', ($origin + '/{R:1}'))

$site = Get-Website -Name $siteName
if ($site -and ($site.physicalPath -ne $webRoot -or @($site.Bindings.Collection | Where-Object { $_.bindingInformation -notlike "*:$SiteHost" }).Count)) {
    throw 'The alternate site name is already in use for another hostname or directory.'
}
if (!$site -and @(Get-WebBinding | Where-Object { $_.bindingInformation -like "*:$SiteHost" }).Count) { throw 'The hostname already has an IIS binding.' }

if ($Action -eq 'Prepare') {
    # Allow the HTTP certificate challenge, then stop ordinary traffic here
    # until both the hostname-specific certificate and application are ready.
    [xml]$gate = '<rule name="WRAITER setup" stopProcessing="true"><match url=".*" /><action type="CustomResponse" statusCode="503" subStatusCode="0" statusReason="Temporarily unavailable" statusDescription="This site is being configured." /></rule>'
    $rewrite.ParentNode.InsertBefore($config.ImportNode($gate.DocumentElement,$true),$rewrite) | Out-Null
    if (!(Test-Path -LiteralPath $webRoot)) { New-Item -ItemType Directory -Path $webRoot | Out-Null }
    $config.Save((Join-Path $webRoot 'web.config'))
    if (!$site) {
        if (!(Test-Path "IIS:\AppPools\$siteName")) { New-WebAppPool -Name $siteName | Out-Null }
        Set-ItemProperty "IIS:\AppPools\$siteName" -Name managedRuntimeVersion -Value ''
        New-Website -Name $siteName -PhysicalPath $webRoot -ApplicationPool $siteName -Port 80 -HostHeader $SiteHost | Out-Null
    }
    $httpsBinding = Get-WebBinding -Name $siteName -Protocol https -HostHeader $SiteHost
    if (!$httpsBinding) {
        New-WebBinding -Name $siteName -Protocol https -Port 443 -HostHeader $SiteHost -SslFlags 1
        $bootstrap = New-SelfSignedCertificate -DnsName $SiteHost -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddDays(2) -FriendlyName "WRAITER setup $SiteHost"
        (Get-WebBinding -Name $siteName -Protocol https -HostHeader $SiteHost).AddSslCertificate($bootstrap.Thumbprint,'My')
    }
    Start-Website -Name $siteName
    Write-Output 'Prepared the dedicated alternate IIS site for certificate validation.'
    return
}

if (!$site) { throw 'Prepare the alternate site before enabling it.' }
$health = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3020/api/health' -Headers @{Host=$SiteHost} -TimeoutSec 10).Content | ConvertFrom-Json
if (!$health.ok) { throw 'The alternate hostname did not pass the application health check.' }
function Get-AlternateCertificate {
    Get-ChildItem Cert:\LocalMachine\My | Where-Object {
        $_.Subject -eq "CN=$SiteHost" -and $_.Issuer -ne $_.Subject -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(10) -and
        @($_.DnsNameList).Count -eq 1 -and $_.DnsNameList[0].Unicode -eq $SiteHost
    } | Sort-Object NotAfter -Descending | Select-Object -First 1
}
$cert = Get-AlternateCertificate
if (!$cert) {
    & $WinAcme --source iis --siteid ([string]$site.id) --host $SiteHost --commonname $SiteHost --friendlyname $siteName --validation filesystem --webroot $webRoot --manualtargetisiis --store certificatestore --certificatestore My --installation iis --installationsiteid ([string]$site.id) --notaskscheduler
    if ($LASTEXITCODE -ne 0) { throw 'The alternate HTTPS certificate could not be issued.' }
    $cert = Get-AlternateCertificate
}
if (!$cert) { throw 'A valid certificate for only the alternate hostname was not found.' }
(Get-WebBinding -Name $siteName -Protocol https -HostHeader $SiteHost).AddSslCertificate($cert.Thumbprint,'My')
$allowed = @(Get-WebConfiguration -PSPath MACHINE/WEBROOT/APPHOST -Location $siteName -Filter system.webServer/rewrite/allowedServerVariables/add | ForEach-Object {$_.name})
if ($allowed -notcontains 'HTTP_X_FORWARDED_PROTO') {
    Add-WebConfigurationProperty -PSPath MACHINE/WEBROOT/APPHOST -Location $siteName -Filter system.webServer/rewrite/allowedServerVariables -Name '.' -Value @{name='HTTP_X_FORWARDED_PROTO'}
}
$config.Save((Join-Path $webRoot 'web.config'))
Write-Output 'Enabled the alternate IIS proxy with a certificate for its hostname.'
