# Running Smart Attendance on Kubernetes

Local deployment on Docker Desktop's built-in Kubernetes. The same three
services as `docker-compose.yml` (redis, backend, dashboard), expressed as
Kubernetes objects.

Firestore, Firebase Auth and FCM stay in the cloud exactly as before — only the
backend, dashboard and cache run in the cluster.

---

## 0. Prerequisites

Enable Kubernetes in **Docker Desktop → Kubernetes → Create cluster**
(single-node is enough). Then confirm the cluster is up:

```bash
kubectl get nodes
```

You should see one node with STATUS `Ready`.

The container images come from your local Docker image store — Docker Desktop's
Kubernetes shares it, so **no registry and no `docker push` is needed**. Build
them first if you haven't:

```bash
docker compose build
```

---

## 1. Free the ports

The Kubernetes pods themselves do **not** take host ports — the Services are
ClusterIP, so they are only reachable inside the cluster. The conflict is
narrower than it looks: it is `kubectl port-forward` (step 4) that binds host
ports 3000/6379/8080, and Compose publishes those same ports.

So Compose and Kubernetes *can* both be running. What you cannot do is
port-forward to a port Compose is already using. Before step 4:

```bash
docker compose down
```

If results ever look inconsistent, check who is answering:

```bash
docker ps --filter name=sa-      # anything listed = Compose is the one replying
```

---

## 2. Create the secrets

These hold credentials, so they are **created by command, never committed**.
Run from the repository root:

```bash
kubectl create namespace smartattendance

kubectl create secret generic backend-env \
  --from-env-file=backend/.env \
  -n smartattendance

kubectl create secret generic backend-key \
  --from-file=serviceAccountKey.json=backend/serviceAccountKey.json \
  -n smartattendance
```

Verify (this prints only names and sizes, never values):

```bash
kubectl get secrets -n smartattendance
```

---

## 3. Deploy

```bash
kubectl apply -f k8s/
```

Watch the pods come up:

```bash
kubectl get pods -n smartattendance -w
```

Wait until all three show `1/1  Running`, then press Ctrl+C.

---

## 4. Access the app

Kubernetes does not publish ports to your machine the way Compose does, so
forward them. Run each in its **own terminal** (they stay open):

```bash
kubectl port-forward -n smartattendance svc/backend   3000:3000
kubectl port-forward -n smartattendance svc/dashboard 8080:80
```

Then open:

| URL | What |
|---|---|
| http://localhost:8080 | Dashboard |
| http://localhost:3000/health | Backend health check |

The backend **must** be forwarded to port 3000 — the dashboard image has
`VITE_API_BASE_URL=http://localhost:3000` baked in at build time, and the
browser (not the cluster) is what calls it.

---

## 5. Verify Redis is working

> **Note:** `kubectl exec` is broken on Docker Desktop's Kubernetes (it fails
> with `http: server gave HTTP response to HTTPS client` — a Docker Desktop bug,
> not a problem with these manifests). Use the port-forward approach below.

Forward Redis, binding all interfaces so a container can reach it:

```bash
kubectl port-forward --address 0.0.0.0 -n smartattendance svc/redis 6379:6379
```

Then, in another terminal, talk to it with a throwaway `redis-cli` container:

```bash
docker run --rm redis:7-alpine redis-cli -h host.docker.internal -p 6379 KEYS '*'
docker run --rm redis:7-alpine redis-cli -h host.docker.internal -p 6379 INFO stats | grep keyspace
```

After logging in you should see `admin:<your-email>` and, after any check-in or
locations read, `locations:all`.

**Proving the cache works** — call the same endpoint three times and watch the
timing collapse once the answer is cached:

```bash
curl -s -o /dev/null -w "%{time_total}s\n" http://localhost:3000/locations   # slow: Firestore
curl -s -o /dev/null -w "%{time_total}s\n" http://localhost:3000/locations   # fast: Redis
```

`keyspace_hits` should climb by one per cached call.

---

## 6. The things Compose cannot do

**Self-healing** — delete a pod and watch Kubernetes replace it automatically:

```bash
kubectl get pods -n smartattendance
kubectl delete pod -n smartattendance <backend-pod-name>
kubectl get pods -n smartattendance     # a new one is already starting
```

**Scaling** — run three backends behind one Service, load-balanced:

```bash
kubectl scale deployment backend --replicas=3 -n smartattendance
kubectl get pods -n smartattendance
```

Scale back with `--replicas=1`.

**Rolling update** — ship new code with zero downtime:

```bash
docker compose build backend                       # rebuild the image
kubectl rollout restart deployment/backend -n smartattendance
kubectl rollout status  deployment/backend -n smartattendance
```

---

## 7. Tear down

**You usually do not need to.** To go back to Compose, just stop the
port-forwards (Ctrl+C) and run `docker compose up -d`. The pods can keep running
harmlessly — they hold no host ports.

If you do want to remove things:

```bash
# Remove only the workloads, KEEPING the namespace and secrets:
kubectl delete -f k8s/01-redis.yaml -f k8s/02-backend.yaml -f k8s/03-dashboard.yaml

# Remove absolutely everything (this DELETES THE SECRETS too):
kubectl delete -f k8s/
```

> ⚠️ `kubectl delete -f k8s/` includes `00-namespace.yaml`, and deleting a
> namespace deletes everything inside it — **including the two secrets**. After
> that, redeploying requires re-running the secret commands in step 2 first,
> otherwise the backend pod fails with `CreateContainerConfigError`.

---

## Troubleshooting

**Pod stuck in `ImagePullBackOff`** — the image isn't in the local store.
Run `docker compose build`, then `kubectl rollout restart deployment/<name> -n smartattendance`.

**Pod in `CrashLoopBackOff`** — read the logs:
```bash
kubectl logs -n smartattendance deploy/backend
```
Most likely the secrets are missing or misnamed; re-check step 2.

**`CreateContainerConfigError`** — a referenced Secret does not exist. Confirm
with `kubectl get secrets -n smartattendance`.

**Port-forward drops** — it dies when the pod restarts. Just run it again.

**`kubectl exec` fails with `server gave HTTP response to HTTPS client`** — a
Docker Desktop Kubernetes bug. Work around it with `kubectl port-forward` plus a
throwaway client container, as shown in step 5.

**The app "works" but you suspect you are hitting Compose, not Kubernetes** —
both bind ports 3000/6379/8080, and Compose wins if it is running. Check with
`docker ps --filter name=sa-`; if anything is listed, run `docker compose down`.
This is the single most confusing failure mode when switching between the two.
