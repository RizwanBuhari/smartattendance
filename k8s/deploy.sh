#!/usr/bin/env bash
# Build the images and deploy everything to Kubernetes. No Docker Compose.
#
#   ./k8s/deploy.sh            build images + apply manifests (+ create secrets
#                              on first run) and restart the pods
#   ./k8s/deploy.sh --no-build just re-apply the manifests
#
# Run from the repository root. Requires a running cluster
# (Docker Desktop -> Kubernetes -> Create cluster).
set -euo pipefail

NS=smartattendance
BUILD=true
[[ "${1:-}" == "--no-build" ]] && BUILD=false

cd "$(dirname "$0")/.."

if ! kubectl cluster-info >/dev/null 2>&1; then
  echo "No Kubernetes cluster reachable."
  echo "Start it in Docker Desktop -> Kubernetes -> Create cluster, then re-run."
  exit 1
fi

if $BUILD; then
  echo "==> Building images"
  # Plain docker build — Docker Desktop's Kubernetes reads from this same local
  # image store, so there is no registry and nothing to push.
  docker build -t smartattendance-backend:latest ./backend
  docker build -t smartattendance-dashboard:latest ./dashboard
fi

echo "==> Namespace"
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

echo "==> Secrets"
# Recreated from the files on disk. --dry-run|apply makes this idempotent, so
# re-running picks up an edited .env instead of erroring "already exists".
kubectl create secret generic backend-env \
  --from-env-file=backend/.env -n "$NS" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic backend-key \
  --from-file=serviceAccountKey.json=backend/serviceAccountKey.json -n "$NS" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "==> Manifests"
kubectl apply -f k8s/

if $BUILD; then
  # Deployments reference the :latest tag, which does not change when the image
  # is rebuilt — so Kubernetes sees no reason to restart. Force it.
  echo "==> Rolling out the new images"
  kubectl rollout restart deployment/backend deployment/dashboard -n "$NS"
fi

echo "==> Waiting for pods"
kubectl rollout status deployment/redis     -n "$NS" --timeout=120s
kubectl rollout status deployment/backend   -n "$NS" --timeout=180s
kubectl rollout status deployment/dashboard -n "$NS" --timeout=120s

echo
kubectl get pods -n "$NS"
echo
LAN_IP=$(ipconfig 2>/dev/null | grep -A1 "Wireless LAN adapter Wi-Fi" | grep "IPv4" | awk -F': ' '{print $2}' | tr -d '\r' | head -1)
[[ -z "$LAN_IP" ]] && LAN_IP="<this-machine's-LAN-IP>"
cat <<EOF

Ready.

  Dashboard   http://localhost:30080
  Backend     http://localhost:30300
  From phone  http://${LAN_IP}:30300   <- put this in
                                          mobile/lib/core/constants/api_constants.dart

No port-forward needed: both are NodePort services, so they survive pod
restarts and are reachable from other devices on the same Wi-Fi.
EOF
