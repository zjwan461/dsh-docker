# Image for the dsh admin panel: a small FastAPI app that reads the dsh
# container's startup log through the Docker socket and shows the current login
# token plus a ready-to-click login URL. See admin/README.md.
#
# Build context is admin/ — start it from the deployment directory with:
#     docker compose --profile admin up -d --build admin

FROM python:3.12-slim-bookworm

# Reading another container's log means talking to the daemon over the mounted
# /var/run/docker.sock, so this user must be in the socket's group on the host:
#     stat -c '%g' /var/run/docker.sock
# Pass it as ADMIN_DOCKER_GID (compose.yaml forwards it from .env). `-o` is
# deliberate: the base image may already use that numeric GID for another group,
# and a duplicate GID is fine here.
ARG ADMIN_DOCKER_GID=999
ARG ADMIN_UID=10002

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    ADMIN_BIND_HOST=0.0.0.0 \
    ADMIN_BIND_PORT=8642

RUN groupadd -o -g "${ADMIN_DOCKER_GID}" docker-socket \
 && useradd -m -u "${ADMIN_UID}" -G docker-socket appuser

WORKDIR /app

# Dependencies first, so editing application code does not reinstall them.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY static ./static

# Not root: the socket group membership is all this needs.
USER appuser

EXPOSE 8642

# /healthz needs no auth and carries no deployment facts, so it is safe here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8642/healthz', timeout=4).getcode() == 200 else 1)"]

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8642", "--no-access-log"]