param([Parameter(Mandatory=$true)][string]$Target, [int]$Milliseconds = 600)

# Called only with a synthetic file by windows-locks.cjs. Read sharing permits
# fingerprint/backup reads, while Windows refuses replacement until release.
$testHandle = [System.IO.File]::Open($Target, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
try {
    [Console]::Out.WriteLine('LOCKED')
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds $Milliseconds
} finally {
    $testHandle.Dispose()
}
