# Getting /api/docs live

## Why you got a 404

You hit `http://192.168.0.173:30300/api/docs` — the Kubernetes NodePort service.
The pod behind it is running `smartattendance-backend:latest` as it was built
**before** the Swagger code existed, so the route genuinely isn't in that image.

The 404 is actually the reassuring outcome: the app answered, it just doesn't
have the route. Had `@nestjs/swagger` been missing from a *rebuilt* image, the
process would have crashed on the import instead and you'd have got no response
at all.

## Do this

```bash
cd backend
npm install          # installs @nestjs/swagger  (lockfile is already updated)
npm run start:dev
```

Then open **http://localhost:3000/api/docs** to confirm it works locally before
touching the cluster.

Once that's good, rebuild the image and roll the pods:

```powershell
cd ..
.\k8s\deploy.ps1
```

`deploy.ps1` rebuilds both images, reapplies the manifests, and runs
`kubectl rollout restart`. Afterwards the docs are at:

- **http://192.168.0.173:30300/api/docs**
- **http://192.168.0.173:30300/api/docs-json**

## One gotcha that would have stopped the build

`backend/Dockerfile` installs with `npm ci`, which fails outright if
`package.json` and `package-lock.json` disagree — it does not fall back to
resolving. `@nestjs/swagger` had been added to `package.json` but not to the
lockfile, so the Docker build would have died at line 11 with:

```
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json are in sync.
```

The lockfile is now updated (`@nestjs/swagger@11.4.6` plus 6 transitive
dependencies, 874 → 880 packages), so this is already handled. Mentioning it
because the error message points at the lockfile rather than at the real cause,
and it is a confusing ten minutes if you hit it cold.

## If it still 404s after redeploying

Work down this list:

1. **Did the image actually rebuild?** `deploy.ps1 -NoBuild` skips the build
   entirely. Run it without that flag.
2. **Is the new image running?**
   `kubectl get pods -n smartattendance` — check the backend pod's `AGE` is
   younger than your rebuild. `imagePullPolicy: Always` re-resolves the tag on
   pod start, so a restart is enough once the image is rebuilt.
3. **Is `SWAGGER_ENABLED=false` set?** `deploy.ps1` builds the `backend-env`
   secret from `backend/.env`. The switch defaults to on and is not in your
   `.env`, so this only applies if someone adds it.
4. **Check the pod logs**: `kubectl logs -n smartattendance deployment/backend`.
   A boot failure shows up here — if `@nestjs/swagger` were somehow missing you'd
   see `Cannot find module '@nestjs/swagger'` and the pod would be crash-looping,
   which is a different symptom from a 404.

## Demoing a guarded endpoint

The docs page lists every route without a token, but calling one needs auth:

1. Sign in on the dashboard or mobile app and copy the Firebase ID token.
2. On the docs page click **Authorize** → paste it under `firebase`.
3. Mobile-only routes also want `X-Session-Id` (the value the backend minted at
   login) under `session`.

`persistAuthorization` is on, so the token survives a page reload while you're
testing.
