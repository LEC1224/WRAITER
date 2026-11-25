[CmdletBinding()]
param(
    [ValidateSet('Install','Start','Stop','Status')][string]$Action = 'Status',
    [string]$AppRoot = (Join-Path $env:ProgramData 'WRAITER\cloud'),
    [string]$TaskName = 'WRAITER Cloud',
    [string]$ServiceUser = 'wraiter_cloud'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$AppRoot = [IO.Path]::GetFullPath($AppRoot)
if ($AppRoot -ne (Join-Path $env:ProgramData 'WRAITER\cloud')) { throw 'Use the dedicated WRAITER cloud installation directory.' }
$runtime = Join-Path $AppRoot '.runtime'
$supervisor = Join-Path $AppRoot 'cloud\ops\windows-cloud-supervisor.mjs'
switch ($Action) {
    'Install' {
        foreach ($relative in @('cloud\server.cjs','cloud\backup.cjs','cloud\ops\windows-cloud-supervisor.mjs','config\server.env','dist-web\index.html')) {
            if (!(Test-Path -LiteralPath (Join-Path $AppRoot $relative) -PathType Leaf)) { throw "Prepare the application before installing startup: $relative" }
        }
        foreach ($relative in @('data','.runtime','.backup-transfer')) { New-Item -ItemType Directory -Path (Join-Path $AppRoot $relative) -Force | Out-Null }
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        $accountName = $env:COMPUTERNAME + '\' + $ServiceUser
        $existingUser = Get-LocalUser -Name $ServiceUser -ErrorAction SilentlyContinue
        $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($existingUser -and (!$existingTask -or $existingTask.Principal.UserId -notin @($accountName,$ServiceUser,[string]$existingUser.SID))) { throw 'An existing service account is not owned by this WRAITER task.' }
        $bytes = New-Object byte[] 48
        $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
        $password = 'Aa1!' + [Convert]::ToBase64String($bytes)
        [Array]::Clear($bytes,0,$bytes.Length)
        if (!$existingUser) {
            New-LocalUser -Name $ServiceUser -Password (ConvertTo-SecureString $password -AsPlainText -Force) -AccountNeverExpires -PasswordNeverExpires -UserMayNotChangePassword -Description 'WRAITER Cloud limited runtime account' | Out-Null
            Add-LocalGroupMember -Group (Get-LocalGroup -SID S-1-5-32-545) -Member $ServiceUser
        } else {
            if ($existingTask.Principal.RunLevel -ne 'Limited' -or $existingTask.Principal.LogonType -ne 'Password') { throw 'The existing WRAITER principal is not a limited password task.' }
            Set-LocalUser -Name $ServiceUser -Password (ConvertTo-SecureString $password -AsPlainText -Force)
        }
        . (Join-Path $PSScriptRoot 'windows-batch-logon.ps1')
        Grant-WraiterBatchLogon -AccountName $accountName
        $operator = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        icacls.exe $AppRoot /inheritance:r /grant:r ($operator + ':(OI)(CI)F') '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' ($accountName + ':(OI)(CI)RX') | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Unable to protect the WRAITER application directory.' }
        foreach ($relative in @('data','.runtime')) {
            icacls.exe (Join-Path $AppRoot $relative) /grant:r ($accountName + ':(OI)(CI)M') /T /Q | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Unable to grant runtime access to $relative." }
        }
        icacls.exe (Join-Path $AppRoot '.backup-transfer') /inheritance:r /grant:r ($operator + ':(OI)(CI)F') '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Unable to protect backup transfer data.' }
        $taskAction = New-ScheduledTaskAction -Execute $node -Argument ('"' + $supervisor + '"') -WorkingDirectory $AppRoot
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
        try {
            Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger (New-ScheduledTaskTrigger -AtStartup) -User $accountName -Password $password -RunLevel Limited -Settings $settings -Description 'WRAITER Cloud: private manuscript storage and web application.' -Force | Out-Null
        } finally { $password = $null }
        Write-Output 'Installed WRAITER Cloud under a dedicated limited account.'
    }
    'Start' { Start-ScheduledTask -TaskName $TaskName; Write-Output 'WRAITER Cloud startup requested.' }
    'Stop' {
        $task = Get-ScheduledTask -TaskName $TaskName
        if ($task.State -eq 'Running') {
            [IO.File]::WriteAllText((Join-Path $runtime 'stop'),[DateTime]::UtcNow.ToString('o'))
            $deadline = [DateTime]::UtcNow.AddSeconds(30)
            do { Start-Sleep -Milliseconds 500; $task = Get-ScheduledTask -TaskName $TaskName } while ($task.State -eq 'Running' -and [DateTime]::UtcNow -lt $deadline)
            if ($task.State -eq 'Running') { throw 'WRAITER did not stop within 30 seconds; inspect its logs.' }
        }
        Write-Output 'WRAITER Cloud stopped.'
    }
    'Status' {
        Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State | ConvertTo-Json -Compress
        Get-ScheduledTaskInfo -TaskName $TaskName | Select-Object LastRunTime,LastTaskResult,NextRunTime | ConvertTo-Json -Compress
        if (Test-Path -LiteralPath (Join-Path $runtime 'state.json')) { Get-Content -LiteralPath (Join-Path $runtime 'state.json') -Raw }
    }
}
