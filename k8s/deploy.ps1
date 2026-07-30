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
Write-Host "==========================================================" -ForegroundColor Green
