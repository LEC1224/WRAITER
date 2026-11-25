[CmdletBinding()]
param(
    [ValidateSet('Run','Install','Status')][string]$Action = 'Run',
    [string]$BackupRoot = (Join-Path $env:ProgramData 'WRAITER\backup'),
    [ValidatePattern('^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$')][string]$Server,
    [string]$IdentityFile,
    [string]$KnownHostsFile
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$BackupRoot = [IO.Path]::GetFullPath($BackupRoot)
if ($BackupRoot -ne (Join-Path $env:ProgramData 'WRAITER\backup')) { throw 'Use the dedicated WRAITER backup directory.' }
$connectionFile = Join-Path $BackupRoot 'connection.json'
$taskName = 'WRAITER Cloud backup'
$statusFile = Join-Path $BackupRoot 'status.json'
$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$scp = Join-Path $env:WINDIR 'System32\OpenSSH\scp.exe'
function Get-BackupTask {
    $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue
    # Update existing installations in place so no old hourly task is left running.
    if (!$task) { $task = Get-ScheduledTask -TaskPath '\' -TaskName 'WRAITER Cloud hourly backup' -ErrorAction SilentlyContinue }
    return $task
}
function Invoke-BackgroundProcess([string]$FilePath,[string[]]$Arguments) {
    $start = [Diagnostics.ProcessStartInfo]::new($FilePath)
    # Windows PowerShell uses one argument string. Escape quotes and their
    # preceding backslashes, then double backslashes before the closing quote.
    $start.Arguments = ($Arguments | ForEach-Object { '"' + (($_ -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"' }) -join ' '
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($start)
    try {
        $process.StandardInput.Close()
        $output = $process.StandardOutput.ReadToEndAsync()
        $errors = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        return [pscustomobject]@{ExitCode=$process.ExitCode; Output=$output.GetAwaiter().GetResult(); ErrorOutput=$errors.GetAwaiter().GetResult()}
    } finally {
        $process.Dispose()
    }
}
function Invoke-ServerScript([string]$Script) {
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Script))
    $result = Invoke-BackgroundProcess $ssh @('-i',$IdentityFile,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',('UserKnownHostsFile=' + $KnownHostsFile),'-o','ConnectTimeout=20',$Server,'powershell.exe','-NoProfile','-NonInteractive','-EncodedCommand',$encoded)
    if ($result.ExitCode -ne 0) { throw 'The backup SSH operation failed.' }
    return $result.Output
}
function Remove-BackupWorkDirectory([string]$Directory) {
    $resolved = [IO.Path]::GetFullPath($Directory)
    if (![IO.Path]::GetDirectoryName($resolved).Equals($BackupRoot,[StringComparison]::OrdinalIgnoreCase) -or !([IO.Path]::GetFileName($resolved) -match '^\.(incoming-[a-f0-9]+|previous)$')) { throw 'Refused to remove a directory outside the backup staging area.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
switch ($Action) {
    'Install' {
        if (!$Server -or !$IdentityFile -or !$KnownHostsFile) { throw 'Provide -Server, -IdentityFile and -KnownHostsFile when installing the backup.' }
        $IdentityFile = (Resolve-Path -LiteralPath $IdentityFile -ErrorAction Stop).Path
        $KnownHostsFile = (Resolve-Path -LiteralPath $KnownHostsFile -ErrorAction Stop).Path
        $existing = Get-BackupTask
        if ($existing.State -eq 'Running') { throw 'Wait for the current backup to finish before installing.' }
        if ($existing) { $taskName = $existing.TaskName }
        if (!(Test-Path -LiteralPath $BackupRoot)) { New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null }
        $operator = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        $acl = Invoke-BackgroundProcess (Join-Path $env:WINDIR 'System32\icacls.exe') @($BackupRoot,'/inheritance:r','/grant:r',($operator + ':(OI)(CI)F'),'*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F')
        if ($acl.ExitCode -ne 0) { throw 'Unable to protect the local backup directory.' }
        $connection = [ordered]@{server=$Server;identityFile=$IdentityFile;knownHostsFile=$KnownHostsFile}
        [IO.File]::WriteAllText($connectionFile, ($connection | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
        $taskLauncher = Join-Path $BackupRoot 'backup-launcher.exe'
        $framework = if ([Environment]::Is64BitOperatingSystem) { 'Framework64' } else { 'Framework' }
        $compiler = Join-Path $env:WINDIR "Microsoft.NET\$framework\v4.0.30319\csc.exe"
        $build = Invoke-BackgroundProcess $compiler @('/nologo','/target:winexe','/optimize+',('/out:' + $taskLauncher),(Join-Path $PSScriptRoot 'BackupLauncher.cs'))
        if ($build.ExitCode -ne 0) { throw ('Could not build the backup launcher. ' + $build.Output + $build.ErrorOutput) }
        $taskScript = Join-Path $BackupRoot 'backup-task.ps1'
        if ([IO.Path]::GetFullPath($PSCommandPath) -ne $taskScript) { Copy-Item -LiteralPath $PSCommandPath -Destination $taskScript -Force }
        $taskAction = New-ScheduledTaskAction -Execute $taskLauncher -WorkingDirectory $BackupRoot
        $at = [DateTime]::Today.AddHours(5)
        if ($at -le [DateTime]::Now) { $at = $at.AddDays(1) }
        $daily = New-ScheduledTaskTrigger -Daily -At $at
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)
        $description = 'Pull one verified WRAITER Cloud backup daily at 5:00 AM in the background.'
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $administrator = [Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        $mode = 'interactive'
        if ($administrator) {
            Register-ScheduledTask -TaskPath '\' -TaskName $taskName -Action $taskAction -Trigger $daily -User SYSTEM -RunLevel Highest -Settings $settings -Description $description -Force | Out-Null
            $mode = 'system'
        } elseif ($existing) {
            Register-ScheduledTask -TaskPath '\' -TaskName $taskName -Action $taskAction -Trigger $daily -Principal $existing.Principal -Settings $existing.Settings -Description $description -Force | Out-Null
            if ($existing.Principal.LogonType -eq 'ServiceAccount') { $mode = 'system' }
        } else {
            $principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
            Register-ScheduledTask -TaskPath '\' -TaskName $taskName -Action $taskAction -Trigger $daily -Principal $principal -Settings $settings -Description $description | Out-Null
        }
        [IO.File]::WriteAllText((Join-Path $BackupRoot 'schedule.json'),([ordered]@{taskName=$taskName;mode=$mode;frequency='daily';localTime='05:00';installedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
        Write-Output ('Installed the 5:00 AM WRAITER Cloud backup to ' + $BackupRoot + ' (' + $mode + ' logon).')
    }
    'Status' {
        $task = Get-BackupTask
        if (!$task) { throw 'The WRAITER Cloud backup task is not installed.' }
        $task | Select-Object TaskName,State | ConvertTo-Json -Compress
        $task | Get-ScheduledTaskInfo | Select-Object LastRunTime,LastTaskResult,NextRunTime | ConvertTo-Json -Compress
        if (Test-Path -LiteralPath $statusFile) { Get-Content -LiteralPath $statusFile -Raw }
    }
    'Run' {
        if (!(Test-Path -LiteralPath $BackupRoot)) { throw 'Install the protected backup directory first.' }
        $connection = Get-Content -LiteralPath $connectionFile -Raw -ErrorAction Stop | ConvertFrom-Json
        $Server = $connection.server
        $IdentityFile = $connection.identityFile
        $KnownHostsFile = $connection.knownHostsFile
        $runId = [Guid]::NewGuid().ToString('N')
        $incoming = Join-Path $BackupRoot ('.incoming-' + $runId)
        $previous = Join-Path $BackupRoot '.previous'
        $current = Join-Path $BackupRoot 'current'
        New-Item -ItemType Directory -Path $incoming | Out-Null
        $remoteDirectory = 'C:/ProgramData/WRAITER/cloud/.backup-transfer/' + $runId
        $remoteScript = @'
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
$stage='__REMOTE_STAGE__'
New-Item -ItemType Directory -Path $stage | Out-Null
& 'C:/Program Files/nodejs/node.exe' --no-warnings 'C:/ProgramData/WRAITER/cloud/cloud/backup.cjs' --data-dir C:/ProgramData/WRAITER/cloud/data --output ($stage + '/wraiter.sqlite') | Out-Null
if($LASTEXITCODE -ne 0) { throw 'SQLite backup generation failed.' }
Copy-Item -LiteralPath C:/ProgramData/WRAITER/cloud/config/server.env -Destination ($stage + '/server.env')
Copy-Item -LiteralPath C:/ProgramData/WRAITER/proxy/web.config -Destination ($stage + '/web.config')
$files=@('wraiter.sqlite','server.env','web.config')
$manifest=[ordered]@{version=1; createdAt=[DateTime]::UtcNow.ToString('o'); source=$env:COMPUTERNAME; files=@(foreach($name in $files) { $file=Join-Path $stage $name; [ordered]@{name=$name; size=(Get-Item -LiteralPath $file).Length; sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()} })}
$json=$manifest | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText(($stage + '/backup.json'),$json,[Text.UTF8Encoding]::new($false))
Write-Output $json
'@
        $remoteScript = $remoteScript.Replace('__REMOTE_STAGE__',$remoteDirectory)
        $cleanupScript = @'
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
$target=[IO.Path]::GetFullPath('__REMOTE_STAGE__')
if([IO.Path]::GetDirectoryName($target) -ne 'C:\ProgramData\WRAITER\cloud\.backup-transfer' -or [IO.Path]::GetFileName($target) -notmatch '^[a-f0-9]{32}$') { throw 'Invalid backup transfer cleanup path.' }
if(Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
'@
        try {
            $manifest = Invoke-ServerScript $remoteScript | ConvertFrom-Json
            foreach ($name in @('wraiter.sqlite','server.env','web.config','backup.json')) {
                $transfer = Invoke-BackgroundProcess $scp @('-q','-B','-i',$IdentityFile,'-o','StrictHostKeyChecking=yes','-o',('UserKnownHostsFile=' + $KnownHostsFile),'-o','ConnectTimeout=20',($Server + ':' + $remoteDirectory + '/' + $name),(Join-Path $incoming $name))
                if ($transfer.ExitCode -ne 0) { throw 'A backup file could not be transferred.' }
            }
            foreach ($file in $manifest.files) {
                if ($file.name -notin @('wraiter.sqlite','server.env','web.config')) { throw 'Unexpected backup manifest filename.' }
                $local = Join-Path $incoming $file.name
                if ((Get-Item -LiteralPath $local).Length -ne $file.size -or (Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'A backup checksum or size did not match.' }
            }
            Remove-BackupWorkDirectory $previous
            if (Test-Path -LiteralPath $current) { Move-Item -LiteralPath $current -Destination $previous }
            try { Move-Item -LiteralPath $incoming -Destination $current } catch { if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $current }; throw }
            Remove-BackupWorkDirectory $previous
            [IO.File]::WriteAllText($statusFile,([ordered]@{ok=$true; completedAt=[DateTime]::UtcNow.ToString('o'); source=$manifest.source; databaseBytes=($manifest.files | Where-Object name -eq 'wraiter.sqlite').size; databaseSha256=($manifest.files | Where-Object name -eq 'wraiter.sqlite').sha256} | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
            Write-Output 'Verified WRAITER Cloud backup completed.'
        } catch {
            [IO.File]::WriteAllText($statusFile,([ordered]@{ok=$false; failedAt=[DateTime]::UtcNow.ToString('o'); message='Backup did not complete; the previous verified copy was preserved.'} | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
            throw
        } finally {
            Remove-BackupWorkDirectory $incoming
            Invoke-ServerScript ($cleanupScript.Replace('__REMOTE_STAGE__',$remoteDirectory)) | Out-Null
        }
    }
}
