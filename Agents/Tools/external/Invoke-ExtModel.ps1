# Runs ONE read-only task on an external model CLI over an exported copy, waits for it, and writes the final answer to -OutFile.
# Neither CLI returns a result you can poll for: this script owns the wait. It starts the process, redirects its streams to
# files beside -OutFile (<OutFile>.log, <OutFile>.err), enforces -TimeoutMinutes by killing only the process tree it started,
# and exits non-zero when no answer file exists: 1 no answer, 2 timeout, 3 provider quota/service error (a usage error such as
# a Workdir inside the repository throws, which also exits non-zero).
#   -Provider codex : codex exec --ephemeral -s read-only, the prompt on stdin, the answer via -o. Model default gpt-6.1-sol
#                     (needs a current CLI and account; on "model not supported" check `codex --version` and the cached model list).
#   -Provider agy   : agy --print --mode plan with the prompt as the argument (the Windows limit is about 32k characters, so
#                     a longer task must be written to a file in -Workdir and the prompt must tell the model to read it).
#                     Headless agy auto-denies shell tools: the task must be answerable by reading files.
# -Workdir must be a copy made by Export-ExtSnapshot.ps1, never the repository. The answer is an AI-authored input, not an
# accepted report: verify decision-critical claims against source.
param(
    [Parameter(Mandatory)][ValidateSet('codex', 'agy')][string]$Provider,
    [Parameter(Mandatory)][string]$Workdir,
    [Parameter(Mandatory)][string]$PromptFile,
    [Parameter(Mandatory)][string]$OutFile,
    [string]$Model,
    [ValidateSet('low', 'medium', 'high', 'xhigh')][string]$Effort = 'high',
    [ValidateRange(1, 120)][int]$TimeoutMinutes = 30
)
$ErrorActionPreference = 'Stop'
$Workdir = [IO.Path]::GetFullPath($Workdir)
$OutFile = [IO.Path]::GetFullPath($OutFile)
$repoRoot = (git rev-parse --show-toplevel 2>$null)
if ($repoRoot) {
    # The repository root and any folder inside it are refused; a sibling such as <root>-copy is allowed.
    $repoFull = [IO.Path]::GetFullPath($repoRoot.Trim()).TrimEnd('\')
    if (($Workdir.TrimEnd('\') + '\').StartsWith($repoFull + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Workdir is inside the repository: export a copy with Export-ExtSnapshot.ps1.' }
}
if (-not (Test-Path -LiteralPath $Workdir -PathType Container)) { throw "Workdir $Workdir not found." }
if (-not (Test-Path -LiteralPath $PromptFile)) { throw "Prompt file $PromptFile not found." }
Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
$log = "$OutFile.log"
$err = "$OutFile.err"

if ($Provider -eq 'codex') {
    if (-not $Model) { $Model = 'gpt-6.1-sol' }
    $exe = (Get-Command codex -ErrorAction Stop).Source
    $argList = @('exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-m', $Model,
        '-c', "model_reasoning_effort=`"$Effort`"", '-C', $Workdir, '-o', $OutFile, '-')
    $process = Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory $Workdir -NoNewWindow -PassThru `
        -RedirectStandardInput $PromptFile -RedirectStandardOutput $log -RedirectStandardError $err
} else {
    if (-not $Model) { $Model = 'gemini-3.8-flash-high' }
    $prompt = (Get-Content -LiteralPath $PromptFile -Raw) + "

This headless session auto-denies every shell/command tool: do not call one; use only the file-read, directory-list and content-search tools."
    if ($prompt.Length -gt 28000) { throw 'Prompt too long for the command line: put the task in a file under Workdir and prompt "read ./task.md and answer".' }
    $exe = (Get-Command agy -ErrorAction Stop).Source
    # Start-Process joins the list with spaces without quoting, so the prompt is quoted here (a backslash before a quote is doubled).
    $quoted = '"' + ($prompt -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
    $argList = @('--model', $Model, '--mode', 'plan', '--print', $quoted)
    $process = Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory $Workdir -NoNewWindow -PassThru `
        -RedirectStandardOutput $OutFile -RedirectStandardError $err
}
$started = Get-Date
if (-not $process.WaitForExit($TimeoutMinutes * 60000)) {
    # Kill only the process tree this script started.
    & taskkill.exe /PID $process.Id /T /F | Out-Null
    # Console error stream, not Write-Error: under ErrorActionPreference Stop Write-Error terminates and the exit code below would be lost.
    [Console]::Error.WriteLine("Timed out after $TimeoutMinutes minutes (provider $Provider, model $Model).")
    exit 2
}
$seconds = [int]((Get-Date) - $started).TotalSeconds
if ((Test-Path -LiteralPath $err) -and (Select-String -LiteralPath $err -Pattern 'AGY_ERROR|RESOURCE_EXHAUSTED|usage limit' -Quiet)) {
    [Console]::Error.WriteLine("Provider reported an error (quota or service); the answer file may be truncated: see $err")
    exit 3
}
if (-not (Test-Path -LiteralPath $OutFile) -or (Get-Item -LiteralPath $OutFile).Length -eq 0) {
    [Console]::Error.WriteLine("No answer produced (exit $($process.ExitCode)); see $err")
    exit 1
}
Write-Output "OK provider=$Provider model=$Model seconds=$seconds out=$OutFile bytes=$((Get-Item -LiteralPath $OutFile).Length)"
