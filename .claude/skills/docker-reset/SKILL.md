---
name: docker-reset
description: Tear down all containers and DB volume, then rebuild and restart the full stack clean
disable-model-invocation: true
---

Run the following command from the repo root to wipe all containers, volumes, and rebuild from scratch:

```bash
docker-compose down -v && docker-compose up --build
```

This removes the postgres_data volume (wiping the DB) and rebuilds both backend and frontend images before starting.
