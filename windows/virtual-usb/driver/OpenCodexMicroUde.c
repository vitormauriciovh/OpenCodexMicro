#include <initguid.h>
#include "OpenCodexMicroUde.h"

static const UCHAR OcmDeviceDescriptor[] = {
    0x12, USB_DEVICE_DESCRIPTOR_TYPE, 0x00, 0x02,
    0x00, 0x00, 0x00, 0x40,
    0x3A, 0x30, 0x60, 0x83, 0x00, 0x01,
    0x01, 0x02, 0x03, 0x01
};

static const UCHAR OcmConfigurationDescriptor[] = {
    0x09, USB_CONFIGURATION_DESCRIPTOR_TYPE, 0x29, 0x00,
    0x01, 0x01, 0x00, 0x80, 0x32,
    0x09, USB_INTERFACE_DESCRIPTOR_TYPE, 0x00, 0x00,
    0x02, USB_DEVICE_CLASS_HUMAN_INTERFACE, 0x00, 0x00, 0x00,
    0x09, 0x21, 0x11, 0x01, 0x00, 0x01, 0x22, 0x1B, 0x00,
    0x07, USB_ENDPOINT_DESCRIPTOR_TYPE, OCM_ENDPOINT_OUT, USB_ENDPOINT_TYPE_INTERRUPT,
    OCM_REPORT_SIZE, 0x00, 0x01,
    0x07, USB_ENDPOINT_DESCRIPTOR_TYPE, OCM_ENDPOINT_IN, USB_ENDPOINT_TYPE_INTERRUPT,
    OCM_REPORT_SIZE, 0x00, 0x01
};

static const UCHAR OcmLanguageDescriptor[] = { 0x04, USB_STRING_DESCRIPTOR_TYPE, 0x09, 0x04 };
static const UCHAR OcmReportDescriptor[] = {
    0x06, 0x00, 0xFF, 0x09, 0x01, 0xA1, 0x01, 0x85, OCM_REPORT_ID,
    0x09, 0x01, 0x15, 0x00, 0x26, 0xFF, 0x00, 0x75, 0x08, 0x95, 0x3F,
    0x81, 0x02, 0x09, 0x01, 0x91, 0x02, 0xC0
};

DECLARE_CONST_UNICODE_STRING(OcmManufacturer, L"Work Louder");
DECLARE_CONST_UNICODE_STRING(OcmProduct, L"Codex Micro");
DECLARE_CONST_UNICODE_STRING(OcmSerial, L"OCM0001");

static VOID OcmQueuePush(_Inout_ POCM_REPORT_QUEUE Queue, _In_reads_(OCM_REPORT_SIZE) const UCHAR* Report)
{
    if (Queue->Count == OCM_REPORT_QUEUE_CAPACITY) {
        Queue->Head = (Queue->Head + 1) % OCM_REPORT_QUEUE_CAPACITY;
        Queue->Count--;
    }
    RtlCopyMemory(Queue->Reports[Queue->Tail], Report, OCM_REPORT_SIZE);
    Queue->Tail = (Queue->Tail + 1) % OCM_REPORT_QUEUE_CAPACITY;
    Queue->Count++;
}

static VOID OcmDrainInputReports(_In_ WDFDEVICE Device)
{
    PDEVICE_CONTEXT context = OcmGetDeviceContext(Device);
    WDFREQUEST request;
    PUCHAR transferBuffer;
    ULONG transferLength;
    UCHAR report[OCM_REPORT_SIZE];
    NTSTATUS status;

    for (;;) {
        WdfSpinLockAcquire(context->ReportLock);
        if (context->InputReports.Count == 0) {
            WdfSpinLockRelease(context->ReportLock);
            return;
        }
        RtlCopyMemory(report, context->InputReports.Reports[context->InputReports.Head], OCM_REPORT_SIZE);
        WdfSpinLockRelease(context->ReportLock);

        status = WdfIoQueueRetrieveNextRequest(context->InputEndpointQueue, &request);
        if (!NT_SUCCESS(status)) {
            return;
        }

        status = UdecxUrbRetrieveBuffer(request, &transferBuffer, &transferLength);
        if (!NT_SUCCESS(status) || transferLength < OCM_REPORT_SIZE) {
            UdecxUrbCompleteWithNtStatus(request, NT_SUCCESS(status) ? STATUS_BUFFER_TOO_SMALL : status);
            continue;
        }

        RtlCopyMemory(transferBuffer, report, OCM_REPORT_SIZE);
        WdfSpinLockAcquire(context->ReportLock);
        context->InputReports.Head = (context->InputReports.Head + 1) % OCM_REPORT_QUEUE_CAPACITY;
        context->InputReports.Count--;
        WdfSpinLockRelease(context->ReportLock);
        UdecxUrbSetBytesCompleted(request, OCM_REPORT_SIZE);
        UdecxUrbCompleteWithNtStatus(request, STATUS_SUCCESS);
    }
}

static NTSTATUS OcmCreateEndpoint(
    _In_ WDFDEVICE Device,
    _In_ UCHAR EndpointAddress,
    _In_ WDFQUEUE Queue,
    _Out_ UDECXUSBENDPOINT* Endpoint)
{
    PDEVICE_CONTEXT context = OcmGetDeviceContext(Device);
    PUDECXUSBENDPOINT_INIT endpointInit;
    UDECX_USB_ENDPOINT_CALLBACKS callbacks;
    NTSTATUS status;

    endpointInit = UdecxUsbSimpleEndpointInitAllocate(context->UsbDevice);
    if (endpointInit == NULL) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }
    UdecxUsbEndpointInitSetEndpointAddress(endpointInit, EndpointAddress);
    UDECX_USB_ENDPOINT_CALLBACKS_INIT(&callbacks, OcmEvtEndpointReset);
    UdecxUsbEndpointInitSetCallbacks(endpointInit, &callbacks);
    status = UdecxUsbEndpointCreate(&endpointInit, WDF_NO_OBJECT_ATTRIBUTES, Endpoint);
    if (!NT_SUCCESS(status)) {
        if (endpointInit != NULL) {
            UdecxUsbEndpointInitFree(endpointInit);
        }
        return status;
    }
    UdecxUsbEndpointSetWdfIoQueue(*Endpoint, Queue);
    return STATUS_SUCCESS;
}

static NTSTATUS OcmCreateVirtualUsbDevice(_In_ WDFDEVICE Device)
{
    PDEVICE_CONTEXT context = OcmGetDeviceContext(Device);
    PUDECXUSBDEVICE_INIT deviceInit;
    UDECX_USB_DEVICE_STATE_CHANGE_CALLBACKS callbacks;
    WDF_IO_QUEUE_CONFIG queueConfig;
    WDFQUEUE controlQueue;
    NTSTATUS status;

    deviceInit = UdecxUsbDeviceInitAllocate(Device);
    if (deviceInit == NULL) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }
    UDECX_USB_DEVICE_CALLBACKS_INIT(&callbacks);
    UdecxUsbDeviceInitSetStateChangeCallbacks(deviceInit, &callbacks);
    UdecxUsbDeviceInitSetSpeed(deviceInit, UdecxUsbFullSpeed);
    UdecxUsbDeviceInitSetEndpointsType(deviceInit, UdecxEndpointTypeSimple);

    status = UdecxUsbDeviceInitAddDescriptor(deviceInit, (PUCHAR)OcmDeviceDescriptor, sizeof(OcmDeviceDescriptor));
    if (!NT_SUCCESS(status)) goto Failure;
    status = UdecxUsbDeviceInitAddDescriptor(deviceInit, (PUCHAR)OcmConfigurationDescriptor, sizeof(OcmConfigurationDescriptor));
    if (!NT_SUCCESS(status)) goto Failure;
    status = UdecxUsbDeviceInitAddDescriptorWithIndex(deviceInit, (PUCHAR)OcmLanguageDescriptor, sizeof(OcmLanguageDescriptor), 0);
    if (!NT_SUCCESS(status)) goto Failure;
    status = UdecxUsbDeviceInitAddStringDescriptor(deviceInit, &OcmManufacturer, 1, 0x0409);
    if (!NT_SUCCESS(status)) goto Failure;
    status = UdecxUsbDeviceInitAddStringDescriptor(deviceInit, &OcmProduct, 2, 0x0409);
    if (!NT_SUCCESS(status)) goto Failure;
    status = UdecxUsbDeviceInitAddStringDescriptor(deviceInit, &OcmSerial, 3, 0x0409);
    if (!NT_SUCCESS(status)) goto Failure;
    status = UdecxUsbDeviceCreate(&deviceInit, WDF_NO_OBJECT_ATTRIBUTES, &context->UsbDevice);
    if (!NT_SUCCESS(status)) goto Failure;

    WDF_IO_QUEUE_CONFIG_INIT(&queueConfig, WdfIoQueueDispatchSequential);
    queueConfig.EvtIoInternalDeviceControl = OcmEvtControlUrb;
    status = WdfIoQueueCreate(Device, &queueConfig, WDF_NO_OBJECT_ATTRIBUTES, &controlQueue);
    if (!NT_SUCCESS(status)) return status;

    WDF_IO_QUEUE_CONFIG_INIT(&queueConfig, WdfIoQueueDispatchManual);
    status = WdfIoQueueCreate(Device, &queueConfig, WDF_NO_OBJECT_ATTRIBUTES, &context->InputEndpointQueue);
    if (!NT_SUCCESS(status)) return status;
    status = WdfIoQueueReadyNotify(context->InputEndpointQueue, OcmEvtInputQueueReady, NULL);
    if (!NT_SUCCESS(status)) return status;

    WDF_IO_QUEUE_CONFIG_INIT(&queueConfig, WdfIoQueueDispatchSequential);
    queueConfig.EvtIoInternalDeviceControl = OcmEvtOutputUrb;
    status = WdfIoQueueCreate(Device, &queueConfig, WDF_NO_OBJECT_ATTRIBUTES, &context->OutputEndpointQueue);
    if (!NT_SUCCESS(status)) return status;

    status = OcmCreateEndpoint(Device, USB_DEFAULT_ENDPOINT_ADDRESS, controlQueue, &context->ControlEndpoint);
    if (!NT_SUCCESS(status)) return status;
    status = OcmCreateEndpoint(Device, OCM_ENDPOINT_IN, context->InputEndpointQueue, &context->InputEndpoint);
    if (!NT_SUCCESS(status)) return status;
    return OcmCreateEndpoint(Device, OCM_ENDPOINT_OUT, context->OutputEndpointQueue, &context->OutputEndpoint);

Failure:
    if (deviceInit != NULL) {
        UdecxUsbDeviceInitFree(deviceInit);
    }
    return status;
}

NTSTATUS DriverEntry(_In_ PDRIVER_OBJECT DriverObject, _In_ PUNICODE_STRING RegistryPath)
{
    WDF_DRIVER_CONFIG config;
    WDF_DRIVER_CONFIG_INIT(&config, OcmEvtDeviceAdd);
    return WdfDriverCreate(DriverObject, RegistryPath, WDF_NO_OBJECT_ATTRIBUTES, &config, WDF_NO_HANDLE);
}

NTSTATUS OcmEvtDeviceAdd(_In_ WDFDRIVER Driver, _Inout_ PWDFDEVICE_INIT DeviceInit)
{
    WDF_PNPPOWER_EVENT_CALLBACKS powerCallbacks;
    WDF_OBJECT_ATTRIBUTES attributes;
    WDF_OBJECT_ATTRIBUTES lockAttributes;
    WDF_IO_QUEUE_CONFIG queueConfig;
    WDF_FILEOBJECT_CONFIG fileConfig;
    UDECX_WDF_DEVICE_CONFIG udecxConfig;
    WDFDEVICE device;
    PDEVICE_CONTEXT context;
    UNICODE_STRING hostReference;
    DECLARE_CONST_UNICODE_STRING(deviceName, L"\\Device\\OpenCodexMicroUde0");
    DECLARE_CONST_UNICODE_STRING(symbolicLink, L"\\DosDevices\\OpenCodexMicroUde0");
    NTSTATUS status;

    UNREFERENCED_PARAMETER(Driver);
    WDF_PNPPOWER_EVENT_CALLBACKS_INIT(&powerCallbacks);
    powerCallbacks.EvtDeviceD0Entry = OcmEvtDeviceD0Entry;
    WdfDeviceInitSetPnpPowerEventCallbacks(DeviceInit, &powerCallbacks);

    WDF_FILEOBJECT_CONFIG_INIT(
        &fileConfig, WDF_NO_EVENT_CALLBACK, WDF_NO_EVENT_CALLBACK, WDF_NO_EVENT_CALLBACK);
    fileConfig.FileObjectClass = WdfFileObjectWdfCannotUseFsContexts;
    WdfDeviceInitSetFileObjectConfig(DeviceInit, &fileConfig, WDF_NO_OBJECT_ATTRIBUTES);
    status = WdfDeviceInitAssignSDDLString(DeviceInit, &SDDL_DEVOBJ_SYS_ALL_ADM_RWX_WORLD_RW_RES_R);
    if (!NT_SUCCESS(status)) return status;
    status = UdecxInitializeWdfDeviceInit(DeviceInit);
    if (!NT_SUCCESS(status)) return status;

    status = WdfDeviceInitAssignName(DeviceInit, &deviceName);
    if (!NT_SUCCESS(status)) return status;

    WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&attributes, DEVICE_CONTEXT);
    status = WdfDeviceCreate(&DeviceInit, &attributes, &device);
    if (!NT_SUCCESS(status)) return status;

    status = WdfDeviceCreateSymbolicLink(device, &symbolicLink);
    if (!NT_SUCCESS(status)) return status;
    RtlInitUnicodeString(&hostReference, L"GUID_DEVINTERFACE_USB_HOST_CONTROLLER");
    status = WdfDeviceCreateDeviceInterface(
        device, (LPGUID)&GUID_DEVINTERFACE_USB_HOST_CONTROLLER, &hostReference);
    if (!NT_SUCCESS(status)) return status;

    context = OcmGetDeviceContext(device);
    RtlZeroMemory(context, sizeof(*context));
    WDF_OBJECT_ATTRIBUTES_INIT(&lockAttributes);
    lockAttributes.ParentObject = device;
    status = WdfSpinLockCreate(&lockAttributes, &context->ReportLock);
    if (!NT_SUCCESS(status)) return status;

    status = WdfDeviceCreateDeviceInterface(device, &GUID_DEVINTERFACE_OPEN_CODEX_MICRO_VHF, NULL);
    if (!NT_SUCCESS(status)) return status;

    UDECX_WDF_DEVICE_CONFIG_INIT(&udecxConfig, OcmEvtQueryUsbCapability);
    status = UdecxWdfDeviceAddUsbDeviceEmulation(device, &udecxConfig);
    if (!NT_SUCCESS(status)) return status;

    WDF_IO_QUEUE_CONFIG_INIT_DEFAULT_QUEUE(&queueConfig, WdfIoQueueDispatchParallel);
    queueConfig.EvtIoDeviceControl = OcmEvtIoDeviceControl;
    queueConfig.PowerManaged = WdfFalse;
    status = WdfIoQueueCreate(device, &queueConfig, WDF_NO_OBJECT_ATTRIBUTES, WDF_NO_HANDLE);
    if (!NT_SUCCESS(status)) return status;

    return OcmCreateVirtualUsbDevice(device);
}

NTSTATUS OcmEvtDeviceD0Entry(_In_ WDFDEVICE Device, _In_ WDF_POWER_DEVICE_STATE PreviousState)
{
    PDEVICE_CONTEXT context = OcmGetDeviceContext(Device);
    UDECX_USB_DEVICE_PLUG_IN_OPTIONS options;
    NTSTATUS status;
    UNREFERENCED_PARAMETER(PreviousState);

    if (context->PluggedIn) return STATUS_SUCCESS;
    UDECX_USB_DEVICE_PLUG_IN_OPTIONS_INIT(&options);
    options.Usb20PortNumber = 1;
    status = UdecxUsbDevicePlugIn(context->UsbDevice, &options);
    if (NT_SUCCESS(status)) context->PluggedIn = TRUE;
    return status;
}

VOID OcmEvtIoDeviceControl(
    _In_ WDFQUEUE Queue,
    _In_ WDFREQUEST Request,
    _In_ size_t OutputBufferLength,
    _In_ size_t InputBufferLength,
    _In_ ULONG IoControlCode)
{
    WDFDEVICE device = WdfIoQueueGetDevice(Queue);
    PDEVICE_CONTEXT context = OcmGetDeviceContext(device);
    NTSTATUS status;
    size_t information = 0;

    UNREFERENCED_PARAMETER(OutputBufferLength);
    UNREFERENCED_PARAMETER(InputBufferLength);
    if (IoControlCode == IOCTL_OCM_SUBMIT_INPUT_REPORT) {
        PUCHAR inputBuffer;
        size_t inputLength;
        status = WdfRequestRetrieveInputBuffer(Request, OCM_REPORT_SIZE, (PVOID*)&inputBuffer, &inputLength);
        if (NT_SUCCESS(status)) {
            if (inputLength != OCM_REPORT_SIZE || inputBuffer[0] != OCM_REPORT_ID) {
                status = STATUS_INVALID_PARAMETER;
            } else {
                WdfSpinLockAcquire(context->ReportLock);
                OcmQueuePush(&context->InputReports, inputBuffer);
                WdfSpinLockRelease(context->ReportLock);
                information = OCM_REPORT_SIZE;
                OcmDrainInputReports(device);
            }
        }
    } else if (IoControlCode == IOCTL_OCM_GET_OUTPUT_REPORT) {
        PUCHAR outputBuffer;
        size_t outputLength;
        status = WdfRequestRetrieveOutputBuffer(Request, OCM_REPORT_SIZE, (PVOID*)&outputBuffer, &outputLength);
        if (NT_SUCCESS(status)) {
            WdfSpinLockAcquire(context->ReportLock);
            if (context->OutputReports.Count == 0) {
                status = STATUS_NO_MORE_ENTRIES;
            } else {
                RtlCopyMemory(outputBuffer, context->OutputReports.Reports[context->OutputReports.Head], OCM_REPORT_SIZE);
                context->OutputReports.Head = (context->OutputReports.Head + 1) % OCM_REPORT_QUEUE_CAPACITY;
                context->OutputReports.Count--;
                information = OCM_REPORT_SIZE;
            }
            WdfSpinLockRelease(context->ReportLock);
        }
    } else if (UdecxWdfDeviceTryHandleUserIoctl(device, Request)) {
        return;
    } else {
        status = STATUS_INVALID_DEVICE_REQUEST;
    }
    WdfRequestCompleteWithInformation(Request, status, information);
}

VOID OcmEvtControlUrb(
    _In_ WDFQUEUE Queue,
    _In_ WDFREQUEST Request,
    _In_ size_t OutputBufferLength,
    _In_ size_t InputBufferLength,
    _In_ ULONG IoControlCode)
{
    WDF_USB_CONTROL_SETUP_PACKET setup;
    PUCHAR transferBuffer = NULL;
    ULONG transferLength = 0;
    ULONG completed = 0;
    NTSTATUS status;

    UNREFERENCED_PARAMETER(Queue);
    UNREFERENCED_PARAMETER(OutputBufferLength);
    UNREFERENCED_PARAMETER(InputBufferLength);
    if (IoControlCode != IOCTL_INTERNAL_USB_SUBMIT_URB) {
        UdecxUrbCompleteWithNtStatus(Request, STATUS_INVALID_DEVICE_REQUEST);
        return;
    }
    status = UdecxUrbRetrieveControlSetupPacket(Request, &setup);
    if (!NT_SUCCESS(status)) goto Complete;
    status = UdecxUrbRetrieveBuffer(Request, &transferBuffer, &transferLength);
    if (!NT_SUCCESS(status)) {
        transferBuffer = NULL;
        transferLength = 0;
        status = STATUS_SUCCESS;
    }

    if (setup.Packet.bm.Request.Type == BmRequestStandard &&
        setup.Packet.bm.Request.Dir == BmRequestDeviceToHost &&
        setup.Packet.bRequest == USB_REQUEST_GET_DESCRIPTOR &&
        setup.Packet.wValue.Bytes.HiByte == 0x22 && transferBuffer != NULL) {
        completed = min(transferLength, (ULONG)sizeof(OcmReportDescriptor));
        RtlCopyMemory(transferBuffer, OcmReportDescriptor, completed);
    } else if (setup.Packet.bm.Request.Type == BmRequestClass &&
        setup.Packet.bm.Request.Recipient == BmRequestToInterface) {
        switch (setup.Packet.bRequest) {
        case 0x01:
            if (transferBuffer == NULL || transferLength == 0) {
                status = STATUS_BUFFER_TOO_SMALL;
            } else {
                RtlZeroMemory(transferBuffer, transferLength);
                transferBuffer[0] = OCM_REPORT_ID;
                completed = min(transferLength, (ULONG)OCM_REPORT_SIZE);
            }
            break;
        case 0x02:
        case 0x03:
            if (transferBuffer == NULL || transferLength == 0) {
                status = STATUS_BUFFER_TOO_SMALL;
            } else {
                transferBuffer[0] = 0;
                completed = 1;
            }
            break;
        case 0x09:
        case 0x0A:
        case 0x0B:
            completed = transferLength;
            break;
        default:
            status = STATUS_INVALID_DEVICE_REQUEST;
            break;
        }
    } else {
        status = STATUS_INVALID_DEVICE_REQUEST;
    }

Complete:
    if (NT_SUCCESS(status)) UdecxUrbSetBytesCompleted(Request, completed);
    UdecxUrbCompleteWithNtStatus(Request, status);
}

VOID OcmEvtOutputUrb(
    _In_ WDFQUEUE Queue,
    _In_ WDFREQUEST Request,
    _In_ size_t OutputBufferLength,
    _In_ size_t InputBufferLength,
    _In_ ULONG IoControlCode)
{
    PDEVICE_CONTEXT context = OcmGetDeviceContext(WdfIoQueueGetDevice(Queue));
    PUCHAR transferBuffer;
    ULONG transferLength;
    UCHAR report[OCM_REPORT_SIZE];
    NTSTATUS status;

    UNREFERENCED_PARAMETER(OutputBufferLength);
    UNREFERENCED_PARAMETER(InputBufferLength);
    if (IoControlCode != IOCTL_INTERNAL_USB_SUBMIT_URB) {
        UdecxUrbCompleteWithNtStatus(Request, STATUS_INVALID_DEVICE_REQUEST);
        return;
    }
    status = UdecxUrbRetrieveBuffer(Request, &transferBuffer, &transferLength);
    if (NT_SUCCESS(status) && transferLength > 0) {
        RtlZeroMemory(report, sizeof(report));
        RtlCopyMemory(report, transferBuffer, min(transferLength, (ULONG)OCM_REPORT_SIZE));
        WdfSpinLockAcquire(context->ReportLock);
        OcmQueuePush(&context->OutputReports, report);
        WdfSpinLockRelease(context->ReportLock);
        UdecxUrbSetBytesCompleted(Request, transferLength);
    }
    UdecxUrbCompleteWithNtStatus(Request, status);
}

VOID OcmEvtInputQueueReady(_In_ WDFQUEUE Queue, _In_ WDFCONTEXT Context)
{
    UNREFERENCED_PARAMETER(Context);
    OcmDrainInputReports(WdfIoQueueGetDevice(Queue));
}

VOID OcmEvtEndpointReset(_In_ UDECXUSBENDPOINT Endpoint, _In_ WDFREQUEST Request)
{
    UNREFERENCED_PARAMETER(Endpoint);
    WdfRequestComplete(Request, STATUS_SUCCESS);
}

NTSTATUS OcmEvtQueryUsbCapability(
    _In_ WDFDEVICE Device,
    _In_ PGUID CapabilityType,
    _In_ ULONG OutputBufferLength,
    _Out_writes_to_opt_(OutputBufferLength, *ResultLength) PVOID OutputBuffer,
    _Out_ PULONG ResultLength)
{
    UNREFERENCED_PARAMETER(Device);
    UNREFERENCED_PARAMETER(CapabilityType);
    UNREFERENCED_PARAMETER(OutputBufferLength);
    UNREFERENCED_PARAMETER(OutputBuffer);
    *ResultLength = 0;
    return STATUS_NOT_SUPPORTED;
}
