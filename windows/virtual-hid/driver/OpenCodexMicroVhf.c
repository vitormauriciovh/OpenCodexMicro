#include <initguid.h>
#include "OpenCodexMicroVhf.h"

static UCHAR OcmReportDescriptor[] = {
    0x06, 0x00, 0xFF, 0x09, 0x01, 0xA1, 0x01, 0x85, OCM_REPORT_ID,
    0x09, 0x01, 0x15, 0x00, 0x26, 0xFF, 0x00, 0x75, 0x08, 0x95, 0x3F,
    0x81, 0x02, 0x09, 0x01, 0x91, 0x02, 0xC0
};

NTSTATUS DriverEntry(_In_ PDRIVER_OBJECT DriverObject, _In_ PUNICODE_STRING RegistryPath)
{
    WDF_DRIVER_CONFIG config;

    WDF_DRIVER_CONFIG_INIT(&config, OcmEvtDeviceAdd);
    return WdfDriverCreate(
        DriverObject, RegistryPath, WDF_NO_OBJECT_ATTRIBUTES, &config, WDF_NO_HANDLE);
}

NTSTATUS OcmEvtDeviceAdd(_In_ WDFDRIVER Driver, _Inout_ PWDFDEVICE_INIT DeviceInit)
{
    WDF_OBJECT_ATTRIBUTES deviceAttributes;
    WDF_OBJECT_ATTRIBUTES lockAttributes;
    WDF_IO_QUEUE_CONFIG queueConfig;
    WDFDEVICE device;
    PDEVICE_CONTEXT context;
    VHF_CONFIG vhfConfig;
    NTSTATUS status;
    UNREFERENCED_PARAMETER(Driver);
    WdfDeviceInitSetDeviceType(DeviceInit, FILE_DEVICE_UNKNOWN);
    WdfDeviceInitSetExclusive(DeviceInit, FALSE);

    WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&deviceAttributes, DEVICE_CONTEXT);
    deviceAttributes.EvtCleanupCallback = OcmEvtDeviceContextCleanup;
    status = WdfDeviceCreate(&DeviceInit, &deviceAttributes, &device);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    context = OcmGetDeviceContext(device);
    context->VhfHandle = NULL;
    context->OutputHead = 0;
    context->OutputTail = 0;
    context->OutputCount = 0;
    RtlZeroMemory(context->OutputLengths, sizeof(context->OutputLengths));
    RtlZeroMemory(context->OutputReports, sizeof(context->OutputReports));

    WDF_OBJECT_ATTRIBUTES_INIT(&lockAttributes);
    lockAttributes.ParentObject = device;
    status = WdfSpinLockCreate(&lockAttributes, &context->ReportLock);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    status = WdfDeviceCreateDeviceInterface(
        device, &GUID_DEVINTERFACE_OPEN_CODEX_MICRO_VHF, NULL);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    WDF_IO_QUEUE_CONFIG_INIT_DEFAULT_QUEUE(&queueConfig, WdfIoQueueDispatchParallel);
    queueConfig.EvtIoDeviceControl = OcmEvtIoDeviceControl;
    status = WdfIoQueueCreate(
        device, &queueConfig, WDF_NO_OBJECT_ATTRIBUTES, WDF_NO_HANDLE);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    VHF_CONFIG_INIT(
        &vhfConfig, WdfDeviceWdmGetDeviceObject(device),
        sizeof(OcmReportDescriptor), OcmReportDescriptor);
    vhfConfig.VhfClientContext = context;
    vhfConfig.VendorID = 0x303A;
    vhfConfig.ProductID = 0x8360;
    vhfConfig.VersionNumber = 0x0100;
    vhfConfig.EvtVhfAsyncOperationWriteReport = OcmEvtVhfWriteReport;
    status = VhfCreate(&vhfConfig, &context->VhfHandle);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    return VhfStart(context->VhfHandle);
}

VOID OcmEvtDeviceContextCleanup(_In_ WDFOBJECT DeviceObject)
{
    PDEVICE_CONTEXT context = OcmGetDeviceContext(DeviceObject);
    if (context->VhfHandle != NULL) {
        VhfDelete(context->VhfHandle, TRUE);
        context->VhfHandle = NULL;
    }
}

VOID OcmEvtVhfWriteReport(
    _In_ PVOID VhfClientContext,
    _In_ VHFOPERATIONHANDLE VhfOperationHandle,
    _In_opt_ PVOID VhfOperationContext,
    _In_ PHID_XFER_PACKET HidTransferPacket)
{
    PDEVICE_CONTEXT context = (PDEVICE_CONTEXT)VhfClientContext;
    ULONG copyLength;
    NTSTATUS status = STATUS_INVALID_BUFFER_SIZE;

    UNREFERENCED_PARAMETER(VhfOperationContext);
    if (HidTransferPacket != NULL && HidTransferPacket->reportBuffer != NULL &&
        HidTransferPacket->reportBufferLen > 0) {
        copyLength = min(HidTransferPacket->reportBufferLen, OCM_REPORT_SIZE);
        WdfSpinLockAcquire(context->ReportLock);
        if (context->OutputCount == OCM_OUTPUT_QUEUE_CAPACITY) {
            context->OutputHead = (context->OutputHead + 1) % OCM_OUTPUT_QUEUE_CAPACITY;
            context->OutputCount--;
        }
        RtlZeroMemory(context->OutputReports[context->OutputTail], OCM_REPORT_SIZE);
        RtlCopyMemory(context->OutputReports[context->OutputTail],
            HidTransferPacket->reportBuffer, copyLength);
        context->OutputLengths[context->OutputTail] = copyLength;
        context->OutputTail = (context->OutputTail + 1) % OCM_OUTPUT_QUEUE_CAPACITY;
        context->OutputCount++;
        WdfSpinLockRelease(context->ReportLock);
        status = STATUS_SUCCESS;
    }
    VhfAsyncOperationComplete(VhfOperationHandle, status);
}

VOID OcmEvtIoDeviceControl(
    _In_ WDFQUEUE Queue,
    _In_ WDFREQUEST Request,
    _In_ size_t OutputBufferLength,
    _In_ size_t InputBufferLength,
    _In_ ULONG IoControlCode)
{
    PDEVICE_CONTEXT context = OcmGetDeviceContext(WdfIoQueueGetDevice(Queue));
    NTSTATUS status;
    size_t information = 0;

    UNREFERENCED_PARAMETER(OutputBufferLength);
    UNREFERENCED_PARAMETER(InputBufferLength);
    if (IoControlCode == IOCTL_OCM_SUBMIT_INPUT_REPORT) {
        PUCHAR inputBuffer;
        size_t inputLength;
        HID_XFER_PACKET packet;

        status = WdfRequestRetrieveInputBuffer(
            Request, OCM_REPORT_SIZE, (PVOID*)&inputBuffer, &inputLength);
        if (NT_SUCCESS(status)) {
            if (inputLength != OCM_REPORT_SIZE || inputBuffer[0] != OCM_REPORT_ID) {
                status = STATUS_INVALID_PARAMETER;
            } else {
                packet.reportBuffer = inputBuffer;
                packet.reportBufferLen = OCM_REPORT_SIZE;
                packet.reportId = OCM_REPORT_ID;
                status = VhfReadReportSubmit(context->VhfHandle, &packet);
                if (NT_SUCCESS(status)) {
                    information = OCM_REPORT_SIZE;
                }
            }
        }
    } else if (IoControlCode == IOCTL_OCM_GET_OUTPUT_REPORT) {
        PUCHAR outputBuffer;
        size_t outputLength;

        status = WdfRequestRetrieveOutputBuffer(
            Request, OCM_REPORT_SIZE, (PVOID*)&outputBuffer, &outputLength);
        if (NT_SUCCESS(status)) {
            WdfSpinLockAcquire(context->ReportLock);
            if (context->OutputCount == 0) {
                status = STATUS_NO_MORE_ENTRIES;
            } else {
                RtlZeroMemory(outputBuffer, outputLength);
                RtlCopyMemory(outputBuffer, context->OutputReports[context->OutputHead],
                    context->OutputLengths[context->OutputHead]);
                information = context->OutputLengths[context->OutputHead];
                context->OutputLengths[context->OutputHead] = 0;
                context->OutputHead = (context->OutputHead + 1) % OCM_OUTPUT_QUEUE_CAPACITY;
                context->OutputCount--;
                status = STATUS_SUCCESS;
            }
            WdfSpinLockRelease(context->ReportLock);
        }
    } else {
        status = STATUS_INVALID_DEVICE_REQUEST;
    }
    WdfRequestCompleteWithInformation(Request, status, information);
}
