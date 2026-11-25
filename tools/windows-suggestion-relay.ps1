[CmdletBinding()]
param(
    [ValidateSet('Install','Run')][string]$Action = 'Run',
    [uri]$Origin,
    [Security.SecureString]$RelayKey
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$state = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'WRAITER\Suggestion relay'
$keyFile = Join-Path $state 'key.dpapi'
$originFile = Join-Path $state 'origin.txt'
$projectFile = Join-Path $state 'project.txt'

if ($Action -eq 'Install') {
    if (!$RelayKey -or !$Origin -or $Origin.Scheme -ne 'https' -or $Origin.AbsolutePath -ne '/' -or $Origin.Query -or $Origin.Fragment -or $Origin.UserInfo) {
        throw 'An HTTPS site origin and a secure relay key are required.'
    }
    New-Item -ItemType Directory -Force -Path $state | Out-Null
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $state /inheritance:r /grant:r ("*${sid}:(OI)(CI)F") '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE) { throw 'Could not protect the relay folder.' }
    [IO.File]::WriteAllText($keyFile,(ConvertFrom-SecureString $RelayKey))
    [IO.File]::WriteAllText($originFile,$Origin.GetLeftPart('Authority'))
    [IO.File]::WriteAllText($projectFile,$root)
    $runtime = Join-Path $state 'runtime'
    foreach ($relative in 'tools/windows-suggestion-relay.ps1','tools/suggestion-relay.cjs','electron/codex-bridge.cjs') {
        $target = Join-Path $runtime $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
        Copy-Item -LiteralPath (Join-Path $root $relative) -Destination $target -Force
    }
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $launcher = Join-Path $runtime 'tools/windows-suggestion-relay.ps1'
    $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -Action Run'
    $taskName = 'WRAITER suggestion relay'
    $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $actionSpec = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $runtime
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
    $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
    $options = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -Hidden
    Register-ScheduledTask -TaskName $taskName -Action $actionSpec -Trigger $trigger -Principal $principal -Settings $options -Description 'Deliver approved WRAITER suggestions to the local Codex project.' -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Output 'Installed the developer PC relay for the current Windows account.'
    return
}

# Holding this file open prevents a manual start from competing with logon startup.
try { $lock = [IO.File]::Open((Join-Path $state 'running.lock'),'OpenOrCreate','ReadWrite','None') }
catch [IO.IOException] { return }
try {
    $env:WRAITER_SUGGESTION_STATE = $state
    $env:WRAITER_SUGGESTION_ORIGIN = [IO.File]::ReadAllText($originFile)
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    while ($true) {
        $package = Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
        if ($package) { $env:WRAITER_SUGGESTION_CODEX = Join-Path $package.InstallLocation 'app\resources\codex.exe' }
        $secret = ConvertTo-SecureString ([IO.File]::ReadAllText($keyFile))
        $env:WRAITER_SUGGESTION_RELAY_KEY = [Net.NetworkCredential]::new('', $secret).Password
        try {
            $info = [Diagnostics.ProcessStartInfo]::new()
            $info.FileName = $node
            $info.Arguments = '"' + (Join-Path $PSScriptRoot 'suggestion-relay.cjs') + '"'
            $info.WorkingDirectory = $root
            $info.CreateNoWindow = $true
            $info.UseShellExecute = $false
            $child = [Diagnostics.Process]::Start($info)
        } finally { Remove-Item Env:WRAITER_SUGGESTION_RELAY_KEY; $secret.Dispose() }
        $child.WaitForExit()
        $child.Dispose()
        Start-Sleep -Seconds 5
    }
} finally { $lock.Dispose() }
