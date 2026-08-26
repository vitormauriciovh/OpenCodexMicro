using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

internal static class OpenCodexMicroDriverInstaller
{
    private const string HardwareId = "Root\\OpenCodexMicroUde";
    private static readonly Guid UsbClassGuid = new Guid("36FC9E60-C465-11CF-8056-444553540000");
    private const uint DigcfPresent = 0x2;
    private const uint DigcfAllClasses = 0x4;
    private const uint SpdrpHardwareId = 0x1;
    private const uint DicdGenerateId = 0x1;
    private const uint DifRemove = 0x5;
    private const uint DifRegisterDevice = 0x19;
    private const uint InstallFlagForce = 0x1;
    private const int ErrorNoMoreItems = 259;

    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 2 && args[0].Equals("install", StringComparison.OrdinalIgnoreCase))
            {
                bool reboot = Install(args[1]);
                Console.WriteLine(reboot ? "Driver installed; restart required." : "Driver installed.");
                return reboot ? 3010 : 0;
            }
            if (args.Length == 1 && args[0].Equals("uninstall", StringComparison.OrdinalIgnoreCase))
            {
                Uninstall();
                Console.WriteLine("Driver device removed.");
                return 0;
            }
            Console.Error.WriteLine("Usage: OpenCodexMicroDriverInstaller.exe install <inf> | uninstall");
            return 2;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    private static bool Install(string infPath)
    {
        RemoveDevices();
        CreateRootDevice();
        bool reboot = false;
        if (!UpdateDriverForPlugAndPlayDevices(IntPtr.Zero, HardwareId, System.IO.Path.GetFullPath(infPath), InstallFlagForce, ref reboot))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Updating the OpenCodexMicro driver failed");
        return reboot;
    }

    private static void CreateRootDevice()
    {
        Guid classGuid = UsbClassGuid;
        IntPtr devices = SetupDiCreateDeviceInfoList(ref classGuid, IntPtr.Zero);
        if (devices == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            SpDevInfoData device = new SpDevInfoData { Size = Marshal.SizeOf(typeof(SpDevInfoData)) };
            if (!SetupDiCreateDeviceInfo(devices, "OpenCodexMicroUde", ref classGuid, "OpenCodexMicro Virtual USB Host", IntPtr.Zero, DicdGenerateId, ref device))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Creating the OpenCodexMicro root device failed");
            byte[] hardwareIds = Encoding.Unicode.GetBytes(HardwareId + "\0\0");
            if (!SetupDiSetDeviceRegistryProperty(devices, ref device, SpdrpHardwareId, hardwareIds, hardwareIds.Length))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Setting the OpenCodexMicro hardware id failed");
            if (!SetupDiCallClassInstaller(DifRegisterDevice, devices, ref device))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Registering the OpenCodexMicro root device failed");
        }
        finally
        {
            SetupDiDestroyDeviceInfoList(devices);
        }
    }

    private static void Uninstall()
    {
        RemoveDevices();
    }

    private static void RemoveDevices()
    {
        Guid classGuid = Guid.Empty;
        IntPtr devices = SetupDiGetClassDevs(ref classGuid, null, IntPtr.Zero, DigcfPresent | DigcfAllClasses);
        if (devices == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            RemoveMatchingDevices(devices);
        }
        finally
        {
            SetupDiDestroyDeviceInfoList(devices);
        }
    }

    private static void RemoveMatchingDevices(IntPtr devices)
    {
        for (uint index = 0; ; index++)
        {
            SpDevInfoData device = new SpDevInfoData { Size = Marshal.SizeOf(typeof(SpDevInfoData)) };
            if (!SetupDiEnumDeviceInfo(devices, index, ref device))
            {
                int error = Marshal.GetLastWin32Error();
                if (error == ErrorNoMoreItems) return;
                throw new Win32Exception(error);
            }
            if (!HardwareIds(devices, ref device).Equals(HardwareId, StringComparison.OrdinalIgnoreCase)) continue;
            if (!SetupDiCallClassInstaller(DifRemove, devices, ref device))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Removing the OpenCodexMicro root device failed");
        }
    }

    private static string HardwareIds(IntPtr devices, ref SpDevInfoData device)
    {
        byte[] buffer = new byte[4096];
        uint required;
        uint type;
        if (!SetupDiGetDeviceRegistryProperty(devices, ref device, SpdrpHardwareId, out type, buffer, (uint)buffer.Length, out required))
            return String.Empty;
        return Encoding.Unicode.GetString(buffer, 0, (int)Math.Min(required, (uint)buffer.Length)).TrimEnd('\0').Split('\0')[0];
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SpDevInfoData { public int Size; public Guid ClassGuid; public uint DevInst; public IntPtr Reserved; }

    [DllImport("setupapi.dll", SetLastError = true)] private static extern IntPtr SetupDiGetClassDevs(ref Guid classGuid, string enumerator, IntPtr parent, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)] private static extern IntPtr SetupDiCreateDeviceInfoList(ref Guid classGuid, IntPtr parent);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool SetupDiCreateDeviceInfo(IntPtr devices, string name, ref Guid classGuid, string description, IntPtr parent, uint flags, ref SpDevInfoData device);
    [DllImport("setupapi.dll", SetLastError = true)] private static extern bool SetupDiSetDeviceRegistryProperty(IntPtr devices, ref SpDevInfoData device, uint property, byte[] buffer, int size);
    [DllImport("setupapi.dll", SetLastError = true)] private static extern bool SetupDiCallClassInstaller(uint function, IntPtr devices, ref SpDevInfoData device);
    [DllImport("setupapi.dll", SetLastError = true)] private static extern bool SetupDiEnumDeviceInfo(IntPtr devices, uint index, ref SpDevInfoData device);
    [DllImport("setupapi.dll", SetLastError = true)] private static extern bool SetupDiGetDeviceRegistryProperty(IntPtr devices, ref SpDevInfoData device, uint property, out uint propertyType, byte[] buffer, uint size, out uint required);
    [DllImport("setupapi.dll", SetLastError = true)] private static extern bool SetupDiDestroyDeviceInfoList(IntPtr devices);
    [DllImport("newdev.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool UpdateDriverForPlugAndPlayDevices(IntPtr parent, string hardwareId, string infPath, uint flags, ref bool reboot);
}
