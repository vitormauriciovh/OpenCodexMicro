using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

public static class RestrictedProcessLauncher
{
    private const uint TokenAllRequired = 0x0001 | 0x0002 | 0x0008 | 0x0080 | 0x0100;
    private const int TokenIntegrityLevel = 25;
    private const int TokenUser = 1;
    private const int TokenDefaultDacl = 6;
    private const uint CreateUnicodeEnvironment = 0x00000400;

    [StructLayout(LayoutKind.Sequential)]
    private struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }

    [StructLayout(LayoutKind.Sequential)]
    private struct TokenMandatoryLabel { public SidAndAttributes Label; }

    [StructLayout(LayoutKind.Sequential)]
    private struct TokenUserInformation { public SidAndAttributes User; }

    [StructLayout(LayoutKind.Sequential)]
    private struct TokenDefaultDaclInformation { public IntPtr DefaultDacl; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool CreateRestrictedToken(IntPtr existingToken, uint flags, uint disableSidCount, IntPtr sidsToDisable, uint deletePrivilegeCount, IntPtr privilegesToDelete, uint restrictedSidCount, IntPtr sidsToRestrict, out IntPtr newToken);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetTokenInformation(IntPtr tokenHandle, int tokenInformationClass, IntPtr tokenInformation, int tokenInformationLength);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr tokenHandle, int tokenInformationClass, IntPtr tokenInformation, int tokenInformationLength, out int returnLength);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSidToSid(string stringSid, out IntPtr sid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern int GetLengthSid(IntPtr sid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern IntPtr GetSidSubAuthority(IntPtr sid, uint subAuthority);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessAsUser(IntPtr token, string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref StartupInfo startupInfo, out ProcessInformation processInformation);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessWithTokenW(IntPtr token, uint logonFlags, string applicationName, StringBuilder commandLine, uint creationFlags, IntPtr environment, string currentDirectory, ref StartupInfo startupInfo, out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    public static int LastIntegrityRid { get; private set; }

    public static int Start(string filePath, string arguments, string workingDirectory)
    {
        IntPtr sourceToken = IntPtr.Zero;
        IntPtr restrictedToken = IntPtr.Zero;
        IntPtr mediumSid = IntPtr.Zero;
        IntPtr administratorsSid = IntPtr.Zero;
        IntPtr disabledSidBuffer = IntPtr.Zero;
        IntPtr labelBuffer = IntPtr.Zero;
        ProcessInformation processInformation = new ProcessInformation();

        try
        {
            Check(OpenProcessToken(GetCurrentProcess(), TokenAllRequired, out sourceToken));
            Check(ConvertStringSidToSid("S-1-5-32-544", out administratorsSid));
            SidAndAttributes disabledSid = new SidAndAttributes { Sid = administratorsSid, Attributes = 0 };
            int disabledSidSize = Marshal.SizeOf(typeof(SidAndAttributes));
            disabledSidBuffer = Marshal.AllocHGlobal(disabledSidSize);
            Marshal.StructureToPtr(disabledSid, disabledSidBuffer, false);
            Check(CreateRestrictedToken(sourceToken, 0, 1, disabledSidBuffer, 0, IntPtr.Zero, 0, IntPtr.Zero, out restrictedToken));
            SetDefaultDacl(restrictedToken);
            Check(ConvertStringSidToSid("S-1-16-8192", out mediumSid));
            TokenMandatoryLabel label = new TokenMandatoryLabel
            {
                Label = new SidAndAttributes { Sid = mediumSid, Attributes = 0x20 }
            };
            int labelSize = Marshal.SizeOf(typeof(TokenMandatoryLabel));
            labelBuffer = Marshal.AllocHGlobal(labelSize);
            Marshal.StructureToPtr(label, labelBuffer, false);
            Check(SetTokenInformation(restrictedToken, TokenIntegrityLevel, labelBuffer, labelSize + GetLengthSid(mediumSid)));
            LastIntegrityRid = ReadIntegrityRid(restrictedToken);
            if (LastIntegrityRid != 8192)
            {
                throw new InvalidOperationException("Restricted token integrity verification failed: " + LastIntegrityRid);
            }

            StartupInfo startupInfo = new StartupInfo
            {
                cb = Marshal.SizeOf(typeof(StartupInfo)),
                lpDesktop = "winsta0\\default"
            };
            StringBuilder commandLine = new StringBuilder(Quote(filePath) + " " + arguments);
            bool created = CreateProcessAsUser(restrictedToken, filePath, commandLine, IntPtr.Zero, IntPtr.Zero, false, CreateUnicodeEnvironment, IntPtr.Zero, workingDirectory, ref startupInfo, out processInformation);
            if (!created)
            {
                int firstError = Marshal.GetLastWin32Error();
                commandLine = new StringBuilder(Quote(filePath) + " " + arguments);
                created = CreateProcessWithTokenW(restrictedToken, 0, filePath, commandLine, CreateUnicodeEnvironment, IntPtr.Zero, workingDirectory, ref startupInfo, out processInformation);
                if (!created)
                {
                    int secondError = Marshal.GetLastWin32Error();
                    throw new Win32Exception(secondError, "Restricted launch failed; CreateProcessAsUser error was " + firstError + "; CreateProcessWithTokenW error was " + secondError);
                }
            }
            return processInformation.dwProcessId;
        }
        finally
        {
            if (processInformation.hThread != IntPtr.Zero) CloseHandle(processInformation.hThread);
            if (processInformation.hProcess != IntPtr.Zero) CloseHandle(processInformation.hProcess);
            if (labelBuffer != IntPtr.Zero) Marshal.FreeHGlobal(labelBuffer);
            if (disabledSidBuffer != IntPtr.Zero) Marshal.FreeHGlobal(disabledSidBuffer);
            if (administratorsSid != IntPtr.Zero) LocalFree(administratorsSid);
            if (mediumSid != IntPtr.Zero) LocalFree(mediumSid);
            if (restrictedToken != IntPtr.Zero) CloseHandle(restrictedToken);
            if (sourceToken != IntPtr.Zero) CloseHandle(sourceToken);
        }
    }

    private static void Check(bool result)
    {
        if (!result) throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    private static int ReadIntegrityRid(IntPtr token)
    {
        int requiredLength;
        GetTokenInformation(token, TokenIntegrityLevel, IntPtr.Zero, 0, out requiredLength);
        IntPtr buffer = Marshal.AllocHGlobal(requiredLength);
        try
        {
            Check(GetTokenInformation(token, TokenIntegrityLevel, buffer, requiredLength, out requiredLength));
            TokenMandatoryLabel label = (TokenMandatoryLabel)Marshal.PtrToStructure(buffer, typeof(TokenMandatoryLabel));
            uint count = Marshal.ReadByte(GetSidSubAuthorityCount(label.Label.Sid));
            return Marshal.ReadInt32(GetSidSubAuthority(label.Label.Sid, count - 1));
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static void SetDefaultDacl(IntPtr token)
    {
        int requiredLength;
        GetTokenInformation(token, TokenUser, IntPtr.Zero, 0, out requiredLength);
        IntPtr userBuffer = Marshal.AllocHGlobal(requiredLength);
        IntPtr aclBuffer = IntPtr.Zero;
        IntPtr daclBuffer = IntPtr.Zero;
        try
        {
            Check(GetTokenInformation(token, TokenUser, userBuffer, requiredLength, out requiredLength));
            TokenUserInformation tokenUser = (TokenUserInformation)Marshal.PtrToStructure(userBuffer, typeof(TokenUserInformation));
            SecurityIdentifier userSid = new SecurityIdentifier(tokenUser.User.Sid);
            SecurityIdentifier systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
            RawAcl acl = new RawAcl(GenericAcl.AclRevision, 2);
            acl.InsertAce(0, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, unchecked((int)0x10000000), userSid, false, null));
            acl.InsertAce(1, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, unchecked((int)0x10000000), systemSid, false, null));
            byte[] aclBytes = new byte[acl.BinaryLength];
            acl.GetBinaryForm(aclBytes, 0);
            aclBuffer = Marshal.AllocHGlobal(aclBytes.Length);
            Marshal.Copy(aclBytes, 0, aclBuffer, aclBytes.Length);

            TokenDefaultDaclInformation information = new TokenDefaultDaclInformation { DefaultDacl = aclBuffer };
            int informationSize = Marshal.SizeOf(typeof(TokenDefaultDaclInformation));
            daclBuffer = Marshal.AllocHGlobal(informationSize);
            Marshal.StructureToPtr(information, daclBuffer, false);
            Check(SetTokenInformation(token, TokenDefaultDacl, daclBuffer, informationSize));
        }
        finally
        {
            if (daclBuffer != IntPtr.Zero) Marshal.FreeHGlobal(daclBuffer);
            if (aclBuffer != IntPtr.Zero) Marshal.FreeHGlobal(aclBuffer);
            Marshal.FreeHGlobal(userBuffer);
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
