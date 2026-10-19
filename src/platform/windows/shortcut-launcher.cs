using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Threading;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

// GUI subsystem entry point: never allocate a console, even when Windows
// Terminal is the default console host. Only run on an explicit shortcut click.
internal static class CodexUlanziLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        // Keep separate test/user data roots independent, but serialize clicks
        // for this installation. A second click never issues another close.
        string key;
        using (var hash = SHA256.Create())
            key = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(LogPath().ToUpperInvariant()))).Replace("-", "");
        using (var mutex = new Mutex(false, "Local\\OpenCodexMicro.CodexShortcut." + key))
        {
            bool acquired;
            try { acquired = mutex.WaitOne(0); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) return 0;
            try { return Run(args); }
            finally { mutex.ReleaseMutex(); }
        }
    }

    private static string LogPath()
    {
        string localData = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (String.IsNullOrEmpty(localData)) localData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(localData,
            "OpenCodexMicro", "codex", "shortcut-launch.log");
    }

    private static int Run(string[] args)
    {
        string log = LogPath();
        try
        {
            if ((args.Length != 2 && args.Length != 3) || (args.Length == 3 && args[2] != "--restart" && args[2] != "--force-restart") || !Path.IsPathRooted(args[0]) || !Path.IsPathRooted(args[1]) ||
                !File.Exists(args[0]) || !File.Exists(args[1]))
                throw new InvalidOperationException("O atalho precisa dos caminhos completos do Node e de scripts/windows.mjs.");
            Directory.CreateDirectory(Path.GetDirectoryName(log));
            if (File.Exists(log) && new FileInfo(log).Length > 64000) File.WriteAllText(log, "");
            File.AppendAllText(log, DateTimeOffset.Now.ToString("o") + " Starting Codex with Ulanzi bridge.\r\n");
            var info = new ProcessStartInfo(args[0], Quote(args[1]) + " open codex" + (args.Length == 3 ? " " + args[2] : ""));
            info.WorkingDirectory = Path.GetDirectoryName(args[1]);
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            using (var process = Process.Start(info))
            {
                Task<string> output = process.StandardOutput.ReadToEndAsync();
                Task<string> errors = process.StandardError.ReadToEndAsync();
                process.WaitForExit();
                Task.WaitAll(output, errors);
                string details = output.Result + errors.Result;
                if (details.Length > 16000) details = details.Substring(details.Length - 16000);
                File.AppendAllText(log, "Exit code: " + process.ExitCode + "\r\n" + details);
                if (process.ExitCode != 0)
                    throw new InvalidOperationException(details.Length > 2000 ? details.Substring(details.Length - 2000) : details);
                return 0;
            }
        }
        catch (Exception error)
        {
            try { File.AppendAllText(log, "\r\n" + error.Message); } catch { }
            MessageBox.Show("Nao foi possivel abrir o Codex com a ponte Ulanzi.\r\n\r\n" + error.Message +
                "\r\n\r\nLog: " + log, "Codex com Ulanzi", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static string Quote(string value)
    {
        if (value.IndexOf('"') >= 0) throw new ArgumentException("Invalid shortcut path");
        return "\"" + value + "\"";
    }
}
