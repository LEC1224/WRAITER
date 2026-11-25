using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

// Build as a Windows executable (/target:winexe) so Task Scheduler never
// creates a terminal for the launcher, even in a logged-in user's session.
internal static class BackupLauncher
{
    private static int Main()
    {
        try
        {
            string directory = AppDomain.CurrentDomain.BaseDirectory;
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \""
                    + Path.Combine(directory, "backup-task.ps1") + "\" -Action Run",
                WorkingDirectory = directory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };

            using (var process = Process.Start(start))
            {
                process.StandardInput.Close();
                Task output = process.StandardOutput.BaseStream.CopyToAsync(Stream.Null);
                Task errors = process.StandardError.BaseStream.CopyToAsync(Stream.Null);
                process.WaitForExit();
                Task.WaitAll(output, errors);
                return process.ExitCode;
            }
        }
        catch (Exception)
        {
            // Keep startup failures silent while reporting failure to Task Scheduler.
            return 1;
        }
    }
}
