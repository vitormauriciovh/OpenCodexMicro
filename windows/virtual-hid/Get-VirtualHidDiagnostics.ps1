[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class CodexMicroHidDiagnostics
{
    private const uint DigcfPresent = 0x00000002;
    private const uint DigcfDeviceInterface = 0x00000010;
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenExisting = 3;

    [StructLayout(LayoutKind.Sequential)]
    private struct SpDeviceInterfaceData
    {
        public int Size;
        public Guid InterfaceClassGuid;
        public int Flags;
        public IntPtr Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HiddAttributes
    {
        public int Size;
        public ushort VendorId;
        public ushort ProductId;
        public ushort VersionNumber;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HidpCaps
    {
        public ushort Usage;
        public ushort UsagePage;
        public ushort InputReportByteLength;
        public ushort OutputReportByteLength;
        public ushort FeatureReportByteLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)]
        public ushort[] Reserved;
        public ushort NumberLinkCollectionNodes;
        public ushort NumberInputButtonCaps;
        public ushort NumberInputValueCaps;
        public ushort NumberInputDataIndices;
        public ushort NumberOutputButtonCaps;
        public ushort NumberOutputValueCaps;
        public ushort NumberOutputDataIndices;
        public ushort NumberFeatureButtonCaps;
        public ushort NumberFeatureValueCaps;
        public ushort NumberFeatureDataIndices;
    }

    public sealed class DeviceInfo
    {
        public string Path { get; set; }
        public ushort VendorId { get; set; }
        public ushort ProductId { get; set; }
        public ushort Release { get; set; }
        public ushort UsagePage { get; set; }
        public ushort Usage { get; set; }
        public ushort InputReportLength { get; set; }
        public ushort OutputReportLength { get; set; }
        public bool ReadWriteOpen { get; set; }
        public int ReadWriteError { get; set; }
    }

    [DllImport("hid.dll")]
    private static extern void HidD_GetHidGuid(out Guid hidGuid);

    [DllImport("hid.dll", SetLastError = true)]
    private static extern bool HidD_GetAttributes(SafeFileHandle device, ref HiddAttributes attributes);

    [DllImport("hid.dll", SetLastError = true)]
    private static extern bool HidD_GetPreparsedData(SafeFileHandle device, out IntPtr preparsedData);

    [DllImport("hid.dll")]
    private static extern bool HidD_FreePreparsedData(IntPtr preparsedData);

    [DllImport("hid.dll")]
    private static extern int HidP_GetCaps(IntPtr preparsedData, ref HidpCaps capabilities);

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern IntPtr SetupDiGetClassDevs(
        ref Guid classGuid, IntPtr enumerator, IntPtr parentWindow, uint flags);

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiEnumDeviceInterfaces(
        IntPtr deviceInfoSet, IntPtr deviceInfoData, ref Guid interfaceClassGuid,
        uint memberIndex, ref SpDeviceInterfaceData deviceInterfaceData);

    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool SetupDiGetDeviceInterfaceDetail(
        IntPtr deviceInfoSet, ref SpDeviceInterfaceData deviceInterfaceData,
        IntPtr detailData, uint detailDataSize, out uint requiredSize, IntPtr deviceInfoData);

    [DllImport("setupapi.dll")]
    private static extern bool SetupDiDestroyDeviceInfoList(IntPtr deviceInfoSet);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern SafeFileHandle CreateFile(
        string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes,
        uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

    public static DeviceInfo[] Enumerate()
    {
        HidD_GetHidGuid(out Guid hidGuid);
        IntPtr deviceInfoSet = SetupDiGetClassDevs(
            ref hidGuid, IntPtr.Zero, IntPtr.Zero, DigcfPresent | DigcfDeviceInterface);
        if (deviceInfoSet == new IntPtr(-1))
            throw new Win32Exception(Marshal.GetLastWin32Error());

        var results = new List<DeviceInfo>();
        try
        {
            for (uint index = 0; ; index++)
            {
                var interfaceData = new SpDeviceInterfaceData {
                    Size = Marshal.SizeOf<SpDeviceInterfaceData>()
                };
                if (!SetupDiEnumDeviceInterfaces(
                    deviceInfoSet, IntPtr.Zero, ref hidGuid, index, ref interfaceData))
                {
                    if (Marshal.GetLastWin32Error() == 259)
                        break;
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                }

                SetupDiGetDeviceInterfaceDetail(
                    deviceInfoSet, ref interfaceData, IntPtr.Zero, 0, out uint requiredSize, IntPtr.Zero);
                IntPtr detailData = Marshal.AllocHGlobal((int)requiredSize);
                try
                {
                    Marshal.WriteInt32(detailData, IntPtr.Size == 8 ? 8 : 6);
                    if (!SetupDiGetDeviceInterfaceDetail(
                        deviceInfoSet, ref interfaceData, detailData, requiredSize,
                        out requiredSize, IntPtr.Zero))
                        throw new Win32Exception(Marshal.GetLastWin32Error());

                    string path = Marshal.PtrToStringUni(IntPtr.Add(detailData, 4));
                    using (SafeFileHandle handle = CreateFile(
                        path, 0, FileShareRead | FileShareWrite, IntPtr.Zero,
                        OpenExisting, 0, IntPtr.Zero))
                    {
                        if (handle.IsInvalid)
                            continue;

                        var attributes = new HiddAttributes { Size = Marshal.SizeOf<HiddAttributes>() };
                        if (!HidD_GetAttributes(handle, ref attributes))
                            continue;
                        if (!HidD_GetPreparsedData(handle, out IntPtr preparsedData))
                            continue;

                        var capabilities = new HidpCaps { Reserved = new ushort[17] };
                        try
                        {
                            if (HidP_GetCaps(preparsedData, ref capabilities) < 0)
                                continue;
                        }
                        finally
                        {
                            HidD_FreePreparsedData(preparsedData);
                        }

                        var result = new DeviceInfo {
                            Path = path,
                            VendorId = attributes.VendorId,
                            ProductId = attributes.ProductId,
                            Release = attributes.VersionNumber,
                            UsagePage = capabilities.UsagePage,
                            Usage = capabilities.Usage,
                            InputReportLength = capabilities.InputReportByteLength,
                            OutputReportLength = capabilities.OutputReportByteLength
                        };
                        using (SafeFileHandle readWriteHandle = CreateFile(
                            path, GenericRead | GenericWrite, FileShareRead | FileShareWrite,
                            IntPtr.Zero, OpenExisting, 0, IntPtr.Zero))
                        {
                            result.ReadWriteOpen = !readWriteHandle.IsInvalid;
                            result.ReadWriteError = result.ReadWriteOpen ? 0 : Marshal.GetLastWin32Error();
                        }
                        results.Add(result);
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(detailData);
                }
            }
        }
        finally
        {
            SetupDiDestroyDeviceInfoList(deviceInfoSet);
        }
        return results.ToArray();
    }
}
'@

$devices = [CodexMicroHidDiagnostics]::Enumerate() |
    Where-Object { $_.VendorId -eq 0x303A -or $_.ProductId -eq 0x8360 }

if (-not $devices) {
    Write-Error 'No Codex Micro HID interface was visible to the Win32 HID API.'
    return
}

$devices | Select-Object Path,
    @{Name = 'CodexPathMatch'; Expression = {
        $_.Path -match '(?i)(vid_303a|dev_vid&02303a)' -and
        $_.Path -match '(?i)(pid_8360|pid&8360)'
    } },
    @{Name = 'VendorId'; Expression = { '0x{0:X4}' -f $_.VendorId } },
    @{Name = 'ProductId'; Expression = { '0x{0:X4}' -f $_.ProductId } },
    @{Name = 'Release'; Expression = { '0x{0:X4}' -f $_.Release } },
    @{Name = 'UsagePage'; Expression = { '0x{0:X4}' -f $_.UsagePage } },
    @{Name = 'Usage'; Expression = { '0x{0:X4}' -f $_.Usage } },
    InputReportLength, OutputReportLength, ReadWriteOpen, ReadWriteError
