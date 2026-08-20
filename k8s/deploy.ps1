# PowerShell script to build images and deploy Smart Attendance to Kubernetes
Param(
    [switch]$NoBuild
)

$ErrorActionPreference = "Stop"
$NS = "smartattendance"
$RootDir = Split-Path -Parent $PSScriptRoot

Set-Location $RootDir

Write-Host "==> Checking Kubernetes cluster status..." -ForegroundColor Cyan
try {
    kubectl cluster-info | Out-Null
} catch {
    Write-Host "No Kubernetes cluster reachable." -ForegroundColor Red
    Write-Host "Start it in Docker Desktop -> Settings -> Kubernetes -> Enable Kubernetes, then re-run." -ForegroundColor Yellow
    exit 1
}

if (-not $NoBuild) {
    Write-Host "==> Building Docker images..." -ForegroundColor Cyan
    docker.exe build -t smartattendance-backend:latest ./backend
    docker.exe build -t smartattendance-dashboard:latest ./dashboard
}

Write-Host "==> Ensuring namespace $NS..." -ForegroundColor Cyan
kubectl create namespace $NS --dry-run=client -o yaml | kubectl apply -f -

Write-Host "==> Creating Secrets from backend config..." -ForegroundColor Cyan
kubectl create secret generic backend-env --from-env-file=backend/.env -n $NS --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic backend-key --from-file=serviceAccountKey.json=backend/serviceAccountKey.json -n $NS --dry-run=client -o yaml | kubectl apply -f -

Write-Host "==> Applying Kubernetes Manifests..." -ForegroundColor Cyan
kubectl apply -f k8s/

if (-not $NoBuild) {
    Write-Host "==> Rolling out new images..." -ForegroundColor Cyan
    kubectl rollout restart deployment/backend deployment/dashboard -n $NS
}

Write-Host "==> Waiting for pods to become ready..." -ForegroundColor Cyan
kubectl rollout status deployment/redis -n $NS --timeout=120s
kubectl rollout status deployment/backend -n $NS --timeout=300s
kubectl rollout status deployment/dashboard -n $NS --timeout=120s

# Ollama last, and with a much longer timeout: on the FIRST deploy its
# initContainer downloads the model (~2.6 GB) before the server starts, which
# can easily outlast the 300s the backend gets. Later deploys find the model
# already in the PVC and become ready in seconds.
#
# Not fatal if it times out — the rest of the stack works without it, only the
# chat panel is affected, and the download continues in the background. So this
# warns rather than exiting, and points at the log that shows progress.
Write-Host "==> Waiting for Ollama (first run downloads the model)..." -ForegroundColor Cyan

# The preference is relaxed for this one command. With $ErrorActionPreference =
# "Stop", PowerShell 7.4+ turns a non-zero exit from a NATIVE command into a
# terminating error, so the timeout would abort the script before the $LASTEXITCODE
# check below could report it nicely. Windows PowerShell 5.1 does not do this,
# which is why the existing rollout waits above never needed it.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
kubectl rollout status deployment/ollama -n $NS --timeout=900s
$ollamaReady = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevEap

if (-not $ollamaReady) {
    Write-Host ""
    Write-Host "Ollama is not ready yet. The rest of the stack is up and usable;" -ForegroundColor Yellow
    Write-Host "only the dashboard assistant needs it. Watch the download with:" -ForegroundColor Yellow
    Write-Host "  kubectl logs -n $NS deploy/ollama -c pull-model -f" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host ""
kubectl get pods -n $NS
Write-Host ""

$LanIp = "192.168.0.174"
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Smart Attendance Kubernetes Cluster Deployment Complete! " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Dashboard:  http://localhost:30080" -ForegroundColor Yellow
Write-Host " Backend:    http://localhost:30300" -ForegroundColor Yellow
Write-Host " From Phone: http://${LanIp}:30300" -ForegroundColor Yellow
if ($ollamaReady) {
    Write-Host " Assistant:  ready (qwen3:4b, in-cluster, CPU)" -ForegroundColor Yellow
} else {
    Write-Host " Assistant:  still pulling the model - see above" -ForegroundColor Yellow
}
Write-Host "==========================================================" -ForegroundColor Green
