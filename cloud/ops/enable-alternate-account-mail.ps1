[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Configure','Publish','Rollback')][string]$Action,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9]+(?:[.-][a-z0-9]+)+$')][string]$PrimaryHost,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9]+(?:[.-][a-z0-9]+)+$')][string]$AlternateHost,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9._+-]+@[a-z0-9.-]+$')][string]$Sender
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$operatorRoot = (Join-Path $env:ProgramData 'WRAITER\operator') + [IO.Path]::DirectorySeparatorChar
if (!$PSScriptRoot.StartsWith($operatorRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Stage this script in a fresh WRAITER operator directory on the production server.'
}
$root = Join-Path $env:ProgramData 'WRAITER\cloud'
$webRoot = Join-Path $root 'dist-web-alternate'
$settings = Join-Path $root 'config\alternate-site.env'
$previousSettings = Join-Path $PSScriptRoot 'previous-alternate-site.env'
$startup = Join-Path $root 'cloud\ops\windows-cloud-startup.ps1'
$primary = $PrimaryHost
$alternate = $AlternateHost
$senderDomain = ($Sender -split '@')[1]
if ($primary -eq $alternate -or ($alternate -ne $senderDomain -and !$alternate.EndsWith('.' + $senderDomain, [StringComparison]::OrdinalIgnoreCase))) {
    throw 'Use distinct hostnames and a sender on the alternate domain.'
}
$loginOnly = '<style>.web-auth-form form:has(input[autocomplete="current-password"]) :is(.web-text-button,.web-auth-switch){display:none}</style>'
$pages = 'web.html','index.html'
$utf8 = [Text.UTF8Encoding]::new($false, $true)

function Get-Response([string]$SiteHost, [string]$Path) {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3020$Path" -Headers @{Host=$SiteHost} -TimeoutSec 4
}

function Assert-MailHealth([bool]$ExpectedAlternate) {
    $primaryHealth = (Get-Response $primary '/api/health').Content | ConvertFrom-Json
    $alternateHealth = (Get-Response $alternate '/api/health').Content | ConvertFrom-Json
    if (!$primaryHealth.ok -or $primaryHealth.emailConfigured -ne $true -or
        !$alternateHealth.ok -or $alternateHealth.emailConfigured -ne $ExpectedAlternate) {
        throw 'WRAITER did not report the expected account email state on both hostnames.'
    }
}

function Restart-Cloud([bool]$ExpectedAlternate) {
    & $startup -Action Stop
    & $startup -Action Start
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        try { Assert-MailHealth $ExpectedAlternate; return }
        catch { if ([DateTime]::UtcNow -ge $deadline) { throw } }
        Start-Sleep -Milliseconds 350
    } while ($true)
}

function Replace-File([string]$Target, [byte[]]$Bytes, [string]$Backup) {
    $pending = $Target + '.' + [Guid]::NewGuid().ToString('N') + '.pending'
    try {
        [IO.File]::WriteAllBytes($pending, $Bytes)
        if ($Backup) { [IO.File]::Replace($pending, $Target, $Backup) }
        else { [IO.File]::Replace($pending, $Target, [NullString]::Value) }
    } finally {
        if ([IO.File]::Exists($pending)) { [IO.File]::Delete($pending) }
    }
}

function Restore-Page([string]$Name) {
    $backup = Join-Path $PSScriptRoot "previous-$Name"
    $target = Join-Path $webRoot $Name
    if ([IO.File]::Exists($backup)) {
        $before = [IO.File]::ReadAllBytes($backup)
        $current = [IO.File]::ReadAllText($target, $utf8)
        if ($current -cne [IO.File]::ReadAllText($backup, $utf8).Replace($loginOnly, '')) {
            throw "The alternate site page $Name has changed since deployment. Review its backup before restoring."
        }
        Replace-File $target $before $null
        [IO.File]::Delete($backup)
    }
}

switch ($Action) {
    'Configure' {
        Assert-MailHealth $false
        if (Test-Path -LiteralPath $previousSettings) { throw 'An account mail backup already exists in this staging directory.' }
        $key = [Console]::ReadLine()
        if ($key -notmatch '^re_[A-Za-z0-9_-]+$') { throw 'Supply a domain-scoped Resend sending key on standard input.' }
        $existing = [IO.File]::ReadAllText($settings, $utf8)
        $lines = @($existing -split '\r?\n' | Where-Object { $_.Trim() })
        $expected = @("WRAITER_ALIAS_ORIGIN=https://$alternate", "WRAITER_ALIAS_STATIC_DIR=$webRoot", "WRAITER_ALIAS_MAIL_FROM=$Sender")
        if ($lines.Count -ne $expected.Count -or (Compare-Object $expected $lines -CaseSensitive)) {
            throw 'The alternate site account settings have changed. Review them before deploying.'
        }
        $newSettings = $existing.TrimEnd() + "`r`nWRAITER_ALIAS_RESEND_KEY=$key`r`n"
        Replace-File $settings ($utf8.GetBytes($newSettings)) $previousSettings
        try { Restart-Cloud $true }
        catch {
            Replace-File $settings ([IO.File]::ReadAllBytes($previousSettings)) $null
            Restart-Cloud $false
            throw
        }
        Write-Output 'alternate site account email is configured. Verify delivery before publishing the forms.'
    }
    'Publish' {
        Assert-MailHealth $true
        $updated = @{}
        foreach ($name in $pages) {
            $html = [IO.File]::ReadAllText((Join-Path $webRoot $name), $utf8)
            if ([regex]::Matches($html, [regex]::Escape($loginOnly)).Count -ne 1 -or
                (Test-Path -LiteralPath (Join-Path $PSScriptRoot "previous-$name"))) {
                throw "Unexpected alternate site page or backup state for $name."
            }
            $updated[$name] = $html.Replace($loginOnly, '')
        }
        try {
            foreach ($name in $pages) {
                Replace-File (Join-Path $webRoot $name) ($utf8.GetBytes($updated[$name])) (Join-Path $PSScriptRoot "previous-$name")
            }
            foreach ($path in '/', '/web.html') {
                if ((Get-Response $alternate $path).Content.Contains($loginOnly)) { throw "alternate site still serves the login-only style at $path." }
            }
        } catch {
            foreach ($name in $pages) { Restore-Page $name }
            throw
        }
        Write-Output 'Published signup, confirmation resend and password reset on alternate site.'
    }
    'Rollback' {
        if (!(Test-Path -LiteralPath $previousSettings)) { throw 'No previous alternate settings found in this staging directory.' }
        foreach ($name in $pages) { Restore-Page $name }
        Replace-File $settings ([IO.File]::ReadAllBytes($previousSettings)) $null
        Restart-Cloud $false
        Write-Output 'Restored the alternate site login-only configuration.'
    }
}
