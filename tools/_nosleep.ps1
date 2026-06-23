# Anti-sleep keeper — holds the Windows execution-state flag so the machine does
# not sleep (system OR display) while long GPU art-generation batches run.
# ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x1) | ES_DISPLAY_REQUIRED (0x2)
# To stop: kill this process; the flag clears automatically when the thread exits.
Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint e);' -Name Keep -Namespace Anti
while ($true) {
  [Anti.Keep]::SetThreadExecutionState(0x80000003) | Out-Null
  Start-Sleep -Seconds 50
}
