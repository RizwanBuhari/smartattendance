# Running Smart Attendance on Kubernetes

This project runs on Kubernetes only — Docker Compose is not used. Docker is
still needed to *build* the images, but nothing is *run* with Compose.

Three services run in the cluster: **redis**, **backend**, **dashboard**.
Firestore, Firebase Auth and Cloud Messaging stay in the cloud as before.

---

## One-time setup

**1. Start a cluster.** Docker Desktop → **Kubernetes** → **Create cluster**
(single node). Confirm it is up:

```bash
kubectl get nodes        # one node, STATUS Ready
```

**2. Deploy.** From the repository root:

```bash
./k8s/deploy.sh
```

That builds both images, creates the namespace and secrets, applies the
manifests, and waits for the pods. On Windows use Git Bash, or run the
[manual steps](#manual-steps) below.

---

## Everyday use

| Task | Command |
|---|---|
| Deploy after changing code | `./k8s/deploy.sh` |
| Re-apply manifests only | `./k8s/deploy.sh --no-build` |
| Watch pods | `kubectl get pods -n smartattendance -w` |
| Backend logs | `kubectl logs -n smartattendance deploy/backend -f` |
| Restart something | `kubectl rollout restart deployment/backend -n smartattendance` |
| Stop everything | `kubectl delete -f k8s/01-redis.yaml -f k8s/02-backend.yaml -f k8s/03-dashboard.yaml` |

### Where things are

| What | URL |
|---|---|
| Dashboard | http://localhost:30080 |
| Backend | http://localhost:30300 |
| Backend, from a phone | `http://<this-machine's-LAN-IP>:30300` |

These are **NodePort** services, so no `kubectl port-forward` is needed. That
matters for the mobile app: a port-forward binds only to localhost (a phone
could never reach it) and dies whenever the pod restarts. A NodePort is
published on the machine itself and survives restarts.

Redis is deliberately **not** exposed — it is internal-only, reachable by the
backend at `redis:6379` and by nothing else.

---

## Two URLs must match the NodePorts

Both are compile-time constants, so changing them means **rebuilding**, not
restarting:

| File | Set to | Rebuild with |
|---|---|---|
| `dashboard/.env` → `VITE_API_BASE_URL` | `http://localhost:30300` | `./k8s/deploy.sh` |
| `mobile/lib/core/constants/api_constants.dart` → `baseUrl` | `http://<LAN-IP>:30300` | `flutter run` |

The dashboard calls the backend **from the browser**, and the mobile app from a
phone — neither runs inside the cluster, so neither can use the internal
`backend:3000` address.

---

## Manual steps

What `deploy.sh` does, if you prefer to run it yourself:

```bash
# 1. Build (plain docker — Docker Desktop's Kubernetes shares this image store,
#    so there is no registry and nothing to push)
docker build -t smartattendance-backend:latest ./backend
docker build -t smartattendance-dashboard:latest ./dashboard

# 2. Namespace + secrets (never committed — created from files on disk)
kubectl create namespace smartattendance
kubectl create secret generic backend-env \
  --from-env-file=backend/.env -n smartattendance
kubectl create secret generic backend-key \
  --from-file=serviceAccountKey.json=backend/serviceAccountKey.json -n smartattendance

# 3. Deploy
kubectl apply -f k8s/

# 4. Because the tag is :latest and never changes, a rebuild alone will not
#    restart anything — force it
kubectl rollout restart deployment/backend deployment/dashboard -n smartattendance
```

---

## The things Kubernetes gives you

```bash
# Self-healing — delete a pod, watch it come back
kubectl delete pod -n smartattendance <backend-pod-name>

# Scaling — several backends behind one address
kubectl scale deployment backend --replicas=3 -n smartattendance

# Zero-downtime update — new pod must pass its health check before the old
# one is removed
kubectl rollout restart deployment/backend -n smartattendance
kubectl rollout status  deployment/backend -n smartattendance
```

---

## Troubleshooting

**`ImagePullBackOff`** — the image is not in the local store. Run
`./k8s/deploy.sh` (or the two `docker build` commands), then
`kubectl rollout restart deployment/<name> -n smartattendance`.

**`CreateContainerConfigError`** — a Secret is missing. This happens after
`kubectl delete -f k8s/`, which removes the namespace **and the secrets inside
it**. Re-run `./k8s/deploy.sh`, which recreates them.

**`CrashLoopBackOff`** — read the reason:
```bash
kubectl logs -n smartattendance deploy/backend
```

**Code changes are not showing up** — the `:latest` tag does not change when you
rebuild, so Kubernetes keeps the old image. `deploy.sh` handles this with a
`rollout restart`; doing it by hand needs the same.

**Phone cannot reach the backend** — check the phone is on the same Wi-Fi, that
`api_constants.dart` uses the machine's LAN IP with port **30300**, and that
Windows Firewall allows it.

**`kubectl exec` fails** with `server gave HTTP response to HTTPS client` — a
Docker Desktop bug. Inspect Redis instead with:
```bash
kubectl port-forward --address 0.0.0.0 -n smartattendance svc/redis 6379:6379
docker run --rm redis:7-alpine redis-cli -h host.docker.internal -p 6379 KEYS '*'
```
