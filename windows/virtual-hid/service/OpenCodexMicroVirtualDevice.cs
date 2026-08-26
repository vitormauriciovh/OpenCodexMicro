using Microsoft.Win32.SafeHandles;
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.ComponentModel;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class Program
{
    private static readonly Guid DeviceInterfaceGuid = new Guid("73d3dc5e-c3b1-4d2f-9920-2654948db87f");
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly object IoLock = new object();
    private static readonly object StateLock = new object();
    private static readonly StringBuilder RpcInput = new StringBuilder();
    private static SafeFileHandle device;
    private static object lastThreads;
    private static object lastLighting;
    private static DateTime updatedAt = DateTime.UtcNow;
    private static volatile bool stopping;

    private const uint DigcfPresent = 0x00000002;
    private const uint DigcfDeviceInterface = 0x00000010;
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenExisting = 3;
    private const uint IoctlSubmitInputReport = 0x0022A000;
    private const uint IoctlGetOutputReport = 0x00226004;
    private const int ErrorNoMoreItems = 259;
    private const byte ReportId = 0x06;
    private const byte RpcChannel = 0x02;
    private const int ReportSize = 64;
    private const int MaxPayload = 61;

    public static int Main(string[] args)
    {
        if (Array.IndexOf(args, "--self-test") >= 0) return RunSelfTest();
        if (ControlApiIsRunning())
        {
            Console.WriteLine("OpenCodexMicro virtual device is already running.");
            return 0;
        }

        bool createdNew;
        using (Mutex instanceMutex = new Mutex(true, @"Local\OpenCodexMicroVirtualDevice", out createdNew))
        {
            if (!createdNew)
            {
                Console.WriteLine("OpenCodexMicro virtual device is already running.");
                return 0;
            }

            try
            {
                device = OpenDevice();
                Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs eventArgs)
                {
                    eventArgs.Cancel = true;
                    stopping = true;
                };

                HttpListener listener = new HttpListener();
                listener.Prefixes.Add("http://127.0.0.1:17374/");
                listener.Start();
                Thread httpThread = new Thread(delegate() { RunHttpServer(listener); });
                httpThread.IsBackground = true;
                httpThread.Start();

                Console.WriteLine("OpenCodexMicro virtual device connected.");
                Console.WriteLine("Control API: http://127.0.0.1:17374/");
                RunReportLoop();
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error);
                return 1;
            }
            finally
            {
                if (device != null) device.Dispose();
            }
        }
    }

    private static bool ControlApiIsRunning()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:17374/health");
            request.Timeout = 500;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
            {
                return response.StatusCode == HttpStatusCode.OK && reader.ReadToEnd().Contains("\"deviceConnected\":true");
            }
        }
        catch
        {
            return false;
        }
    }

    private static void RunReportLoop()
    {
        while (!stopping)
        {
            byte[] report;
            if (!TryReadOutputReport(out report))
            {
                Thread.Sleep(5);
                continue;
            }

            int offset = report[0] == ReportId ? 1 : 0;
            if (report.Length < offset + 2 || report[offset] != RpcChannel) continue;
            int length = Math.Min(report[offset + 1], report.Length - offset - 2);
            RpcInput.Append(Encoding.UTF8.GetString(report, offset + 2, length));
            TryProcessRpcRequest();
        }
    }

    private static void TryProcessRpcRequest()
    {
        Dictionary<string, object> request;
        try
        {
            request = Json.Deserialize<Dictionary<string, object>>(RpcInput.ToString());
        }
        catch (ArgumentException)
        {
            return;
        }
        catch (InvalidOperationException)
        {
            return;
        }

        RpcInput.Clear();
        SendRpc(BuildRpcResponse(request));
    }

    private static object BuildRpcResponse(Dictionary<string, object> request)
    {
        object methodValue;
        object id;
        request.TryGetValue("method", out methodValue);
        request.TryGetValue("id", out id);
        string method = methodValue as string;
        object result;

        switch (method)
        {
            case "sys.version":
                result = new Dictionary<string, object> { { "version", "0.1.0-open-codex-micro" } };
                break;
            case "device.status":
                result = new Dictionary<string, object>
                {
                    { "version", "0.1.0-open-codex-micro" },
                    { "profile_index", 0 },
                    { "layer_index", 0 },
                    { "battery", 100 },
                    { "is_charging", false }
                };
                break;
            case "v.oai.thstatus":
                lock (StateLock)
                {
                    request.TryGetValue("params", out lastThreads);
                    updatedAt = DateTime.UtcNow;
                }
                result = null;
                break;
            case "v.oai.rgbcfg":
            case "lights.preview":
                lock (StateLock)
                {
                    request.TryGetValue("params", out lastLighting);
                    updatedAt = DateTime.UtcNow;
                }
                result = null;
                break;
            default:
                return new Dictionary<string, object>
                {
                    { "id", id },
                    { "error", new Dictionary<string, object> { { "code", -32601 }, { "message", "Method not found" } } }
                };
        }

        return new Dictionary<string, object> { { "id", id }, { "result", result } };
    }

    private static void SendRpc(object message)
    {
        foreach (byte[] report in CreateReports(message)) SubmitInputReport(report);
    }

    private static List<byte[]> CreateReports(object message)
    {
        byte[] payload = Encoding.UTF8.GetBytes(Json.Serialize(message) + "\n");
        List<byte[]> reports = new List<byte[]>();
        int offset = 0;
        while (offset < payload.Length)
        {
            int chunkLength = Math.Min(MaxPayload, payload.Length - offset);
            byte[] report = new byte[ReportSize];
            report[0] = ReportId;
            report[1] = RpcChannel;
            report[2] = (byte)chunkLength;
            Buffer.BlockCopy(payload, offset, report, 3, chunkLength);
            reports.Add(report);
            offset += chunkLength;
        }
        return reports;
    }

    private static int RunSelfTest()
    {
        Dictionary<string, object> request = new Dictionary<string, object>
        {
            { "method", "sys.version" },
            { "params", null },
            { "id", 42 }
        };
        string builtResponse = Json.Serialize(BuildRpcResponse(request));
        if (builtResponse.IndexOf("0.1.0-open-codex-micro", StringComparison.Ordinal) < 0)
        {
            throw new InvalidOperationException("Self-test RPC dispatch failed");
        }

        object transportResponse = new Dictionary<string, object>
        {
            { "id", 42 },
            { "result", new string('x', 240) }
        };
        List<byte[]> reports = CreateReports(transportResponse);
        if (reports.Count < 4) throw new InvalidOperationException("Self-test did not exercise HID chunking");

        StringBuilder reassembled = new StringBuilder();
        foreach (byte[] report in reports)
        {
            if (report.Length != ReportSize || report[0] != ReportId || report[1] != RpcChannel)
            {
                throw new InvalidOperationException("Self-test produced an invalid HID frame");
            }
            reassembled.Append(Encoding.UTF8.GetString(report, 3, report[2]));
        }

        Dictionary<string, object> decoded = Json.Deserialize<Dictionary<string, object>>(reassembled.ToString().Trim());
        if (!decoded.ContainsKey("result") || Convert.ToInt32(decoded["id"]) != 42)
        {
            throw new InvalidOperationException("Self-test response round trip failed");
        }

        Console.WriteLine("OpenCodexMicro virtual HID protocol self-test passed ({0} report(s)).", reports.Count);
        return 0;
    }

    private static bool TryReadOutputReport(out byte[] report)
    {
        report = new byte[ReportSize];
        int returned;
        bool success;
        lock (IoLock)
        {
            success = DeviceIoControl(device, IoctlGetOutputReport, null, 0, report, report.Length, out returned, IntPtr.Zero);
        }
        if (success)
        {
            if (returned != report.Length) Array.Resize(ref report, returned);
            return true;
        }

        int error = Marshal.GetLastWin32Error();
        if (error == ErrorNoMoreItems) return false;
        throw new Win32Exception(error, "Reading a virtual HID output report failed");
    }

    private static void SubmitInputReport(byte[] report)
    {
        int returned;
        lock (IoLock)
        {
            if (!DeviceIoControl(device, IoctlSubmitInputReport, report, report.Length, null, 0, out returned, IntPtr.Zero))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Submitting a virtual HID input report failed");
            }
        }
    }

    private static void RunHttpServer(HttpListener listener)
    {
        while (!stopping)
        {
            try
            {
                HttpListenerContext context = listener.GetContext();
                HandleHttpRequest(context);
            }
            catch (HttpListenerException)
            {
                if (!stopping) throw;
            }
        }
        listener.Close();
    }

    private static void HandleHttpRequest(HttpListenerContext context)
    {
        try
        {
            string path = context.Request.Url.AbsolutePath;
            if (context.Request.HttpMethod == "GET" && path == "/health")
            {
                WriteJson(context.Response, 200, new Dictionary<string, object>
                {
                    { "ok", true },
                    { "deviceConnected", true },
                    { "codexConnected", true },
                    { "updatedAt", updatedAt.ToString("o") }
                });
                return;
            }
            if (context.Request.HttpMethod == "GET" && path == "/state")
            {
                object threads;
                object lighting;
                DateTime stateUpdatedAt;
                lock (StateLock)
                {
                    threads = lastThreads;
                    lighting = lastLighting;
                    stateUpdatedAt = updatedAt;
                }
                WriteJson(context.Response, 200, new Dictionary<string, object>
                {
                    { "connected", true },
                    { "threads", threads },
                    { "lighting", lighting },
                    { "updatedAt", stateUpdatedAt.ToString("o") }
                });
                return;
            }
            if (context.Request.HttpMethod == "POST" && path == "/notify/hid")
            {
                NameValueCollection query = context.Request.QueryString;
                string key = query["key"];
                if (String.IsNullOrWhiteSpace(key)) throw new ArgumentException("Missing key query parameter");
                Dictionary<string, object> parameters = new Dictionary<string, object> { { "k", key } };
                int value;
                if (Int32.TryParse(query["act"], out value)) parameters["act"] = value;
                if (Int32.TryParse(query["agent"], out value)) parameters["ag"] = value;
                SendRpc(new Dictionary<string, object> { { "method", "v.oai.hid" }, { "params", parameters } });
                WriteJson(context.Response, 200, new Dictionary<string, object> { { "ok", true } });
                return;
            }
            if (context.Request.HttpMethod == "POST" && path == "/notify/joystick")
            {
                double angle;
                double distance;
                if (!Double.TryParse(context.Request.QueryString["angle"], out angle) ||
                    !Double.TryParse(context.Request.QueryString["distance"], out distance))
                {
                    throw new ArgumentException("Missing angle or distance query parameter");
                }
                SendRpc(new Dictionary<string, object>
                {
                    { "method", "v.oai.rad" },
                    { "params", new Dictionary<string, object> { { "a", angle }, { "d", distance } } }
                });
                WriteJson(context.Response, 200, new Dictionary<string, object> { { "ok", true } });
                return;
            }
            WriteJson(context.Response, 404, new Dictionary<string, object> { { "ok", false }, { "error", "Not found" } });
        }
        catch (Exception error)
        {
            WriteJson(context.Response, 400, new Dictionary<string, object> { { "ok", false }, { "error", error.Message } });
        }
    }

    private static void WriteJson(HttpListenerResponse response, int statusCode, object body)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(body) + "\n");
        response.StatusCode = statusCode;
        response.ContentType = "application/json; charset=utf-8";
        response.ContentLength64 = bytes.Length;
        response.OutputStream.Write(bytes, 0, bytes.Length);
        response.Close();
    }

    private static SafeFileHandle OpenDevice()
    {
        Guid interfaceGuid = DeviceInterfaceGuid;
        IntPtr deviceInfo = SetupDiGetClassDevs(ref interfaceGuid, null, IntPtr.Zero, DigcfPresent | DigcfDeviceInterface);
        if (deviceInfo == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            SpDeviceInterfaceData interfaceData = new SpDeviceInterfaceData();
            interfaceData.Size = Marshal.SizeOf(interfaceData);
            if (!SetupDiEnumDeviceInterfaces(deviceInfo, IntPtr.Zero, ref interfaceGuid, 0, ref interfaceData))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenCodexMicro VHF interface was not found");
            }

            int requiredSize;
            SetupDiGetDeviceInterfaceDetail(deviceInfo, ref interfaceData, IntPtr.Zero, 0, out requiredSize, IntPtr.Zero);
            IntPtr detailBuffer = Marshal.AllocHGlobal(requiredSize);
            try
            {
                Marshal.WriteInt32(detailBuffer, IntPtr.Size == 8 ? 8 : 6);
                if (!SetupDiGetDeviceInterfaceDetail(deviceInfo, ref interfaceData, detailBuffer, requiredSize, out requiredSize, IntPtr.Zero))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                }
                string path = Marshal.PtrToStringUni(IntPtr.Add(detailBuffer, 4));
                SafeFileHandle handle = CreateFile(path, GenericRead | GenericWrite, FileShareRead | FileShareWrite, IntPtr.Zero, OpenExisting, 0, IntPtr.Zero);
                if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), "Opening OpenCodexMicro VHF control interface failed");
                return handle;
            }
            finally
            {
                Marshal.FreeHGlobal(detailBuffer);
            }
        }
        finally
        {
            SetupDiDestroyDeviceInfoList(deviceInfo);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SpDeviceInterfaceData
    {
        public int Size;
        public Guid InterfaceClassGuid;
        public int Flags;
        public UIntPtr Reserved;
    }

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SetupDiGetClassDevs(ref Guid classGuid, string enumerator, IntPtr parent, uint flags);

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiEnumDeviceInterfaces(IntPtr deviceInfoSet, IntPtr deviceInfoData, ref Guid interfaceClassGuid, uint memberIndex, ref SpDeviceInterfaceData deviceInterfaceData);

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr deviceInfoSet, ref SpDeviceInterfaceData deviceInterfaceData, IntPtr detailData, int detailDataSize, out int requiredSize, IntPtr deviceInfoData);

    [DllImport("setupapi.dll")]
    private static extern bool SetupDiDestroyDeviceInfoList(IntPtr deviceInfoSet);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeviceIoControl(SafeFileHandle device, uint controlCode, byte[] input, int inputSize, byte[] output, int outputSize, out int bytesReturned, IntPtr overlapped);
}
