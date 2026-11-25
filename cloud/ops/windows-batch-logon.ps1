function Grant-WraiterBatchLogon {
    param([Parameter(Mandatory)][string]$AccountName)
    if (!('WraiterBatchLogon' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class WraiterBatchLogon {
    [StructLayout(LayoutKind.Sequential)] struct Attributes {
        public uint Length; public IntPtr RootDirectory; public IntPtr ObjectName;
        public uint Flags; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService;
    }
    [StructLayout(LayoutKind.Sequential)] struct UnicodeString {
        public ushort Length; public ushort MaximumLength; public IntPtr Buffer;
    }
    [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr name, ref Attributes attributes, uint access, out IntPtr handle);
    [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr handle, IntPtr sid, UnicodeString[] rights, uint count);
    [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr handle);
    [DllImport("advapi32.dll")] static extern uint LsaNtStatusToWinError(uint status);
    static void Check(uint status) { if (status != 0) throw new Win32Exception((int)LsaNtStatusToWinError(status)); }
    public static void Grant(string account) {
        var sid = (SecurityIdentifier)new NTAccount(account).Translate(typeof(SecurityIdentifier));
        var bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0);
        IntPtr sidPointer = Marshal.AllocHGlobal(bytes.Length), handle = IntPtr.Zero;
        const string right = "SeBatchLogonRight";
        var value = new UnicodeString { Length = (ushort)(right.Length * 2), MaximumLength = (ushort)(right.Length * 2 + 2), Buffer = Marshal.StringToHGlobalUni(right) };
        try {
            Marshal.Copy(bytes, 0, sidPointer, bytes.Length);
            var attributes = new Attributes { Length = (uint)Marshal.SizeOf(typeof(Attributes)) };
            Check(LsaOpenPolicy(IntPtr.Zero, ref attributes, 0x810, out handle));
            Check(LsaAddAccountRights(handle, sidPointer, new [] { value }, 1));
        } finally {
            if (handle != IntPtr.Zero) LsaClose(handle);
            Marshal.FreeHGlobal(value.Buffer); Marshal.FreeHGlobal(sidPointer);
        }
    }
}
'@
    }
    [WraiterBatchLogon]::Grant($AccountName)
}
