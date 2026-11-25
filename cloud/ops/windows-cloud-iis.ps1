[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9]+(?:[.-][a-z0-9]+)+$')][string]$SiteHost,
    [string]$SiteName = 'WRAITER Cloud',
    [string]$WebRoot = (Join-Path $env:ProgramData 'WRAITER\proxy'),
    [Parameter(Mandatory)][string]$OriginRestrictionTemplate,
    [string]$WinAcme = 'wacs.exe',
    [switch]$IssueCertificate
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module WebAdministration
if (!(Get-WebConfigurationProperty -PSPath MACHINE/WEBROOT/APPHOST -Filter system.webServer/proxy -Name enabled).Value -or
    !(Get-WebConfigurationProperty -PSPath MACHINE/WEBROOT/APPHOST -Filter system.webServer/proxy -Name preserveHostHeader).Value) {
    throw 'IIS ARR with preserveHostHeader must already be enabled. Shared proxy settings were not changed.'
}
$WebRoot = [IO.Path]::GetFullPath($WebRoot)
if ($WebRoot -ne (Join-Path $env:ProgramData 'WRAITER\proxy')) { throw 'This installer manages only the dedicated WRAITER proxy directory.' }
if (!(Test-Path -LiteralPath $WebRoot)) { New-Item -ItemType Directory -Path $WebRoot | Out-Null }
icacls.exe $WebRoot /grant '*S-1-5-32-568:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to grant IIS read access to its proxy directory.' }
[xml]$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'windows-cloud-web.config') -Raw
[xml]$existingConfig = Get-Content -LiteralPath $OriginRestrictionTemplate -Raw
$restriction = $existingConfig.SelectSingleNode('//rewrite/rules/rule[@name="Block direct origin traffic"]')
if (!$restriction -or $restriction.action.statusCode -ne '403') { throw 'The existing Cloudflare origin restriction could not be verified.' }
$redirect = $config.SelectSingleNode('//rewrite/rules/rule[@name="WRAITER HTTPS"]/action')
$redirect.SetAttribute('url', "https://$SiteHost/{R:1}")
$firstRule = $config.SelectSingleNode('//rewrite/rules/rule')
$firstRule.ParentNode.InsertBefore($config.ImportNode($restriction, $true), $firstRule) | Out-Null
$config.Save((Join-Path $WebRoot 'web.config'))
if (!(Test-Path "IIS:\AppPools\$SiteName")) { New-WebAppPool -Name $SiteName | Out-Null }
Set-ItemProperty "IIS:\AppPools\$SiteName" -Name managedRuntimeVersion -Value ''
$site = Get-Website -Name $SiteName
if (!$site) {
    New-Website -Name $SiteName -PhysicalPath $WebRoot -ApplicationPool $SiteName -Port 80 -HostHeader $SiteHost | Out-Null
} elseif ([IO.Path]::GetFullPath($site.physicalPath) -ne $WebRoot) {
    throw 'An existing IIS site with this name uses another directory.'
}
$allowed = @(Get-WebConfiguration -PSPath MACHINE/WEBROOT/APPHOST -Location $SiteName -Filter system.webServer/rewrite/allowedServerVariables/add | ForEach-Object {$_.name})
if ($allowed -notcontains 'HTTP_X_FORWARDED_PROTO') {
    Add-WebConfigurationProperty -PSPath MACHINE/WEBROOT/APPHOST -Location $SiteName -Filter system.webServer/rewrite/allowedServerVariables -Name '.' -Value @{name='HTTP_X_FORWARDED_PROTO'}
}
Start-WebAppPool -Name $SiteName
Start-Website -Name $SiteName
if ($IssueCertificate) {
    $siteId = [string](Get-Website -Name $SiteName).id
    & $WinAcme --source iis --siteid $siteId --host $SiteHost --commonname $SiteHost --friendlyname 'WRAITER Cloud' --validation filesystem --webroot $WebRoot --manualtargetisiis --store certificatestore --certificatestore My --installation iis --installationsiteid $siteId --notaskscheduler
    if ($LASTEXITCODE -ne 0) { throw 'WRAITER certificate issuance failed; unrelated sites were preserved.' }
}
Get-Website -Name $SiteName | Select-Object Name,State,PhysicalPath | ConvertTo-Json -Compress
Get-WebBinding -Name $SiteName | Select-Object protocol,bindingInformation | ConvertTo-Json -Compress
