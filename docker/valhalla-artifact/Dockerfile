FROM ghcr.io/nilsnolde/docker-valhalla/valhalla:latest

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-boto3 python3-botocore zstd ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY scripts/valhalla_artifact_bootstrap.py /usr/local/bin/valhalla_artifact_bootstrap.py
COPY docker/valhalla-artifact/start.sh /usr/local/bin/start-valhalla-artifact.sh

RUN chmod +x /usr/local/bin/valhalla_artifact_bootstrap.py /usr/local/bin/start-valhalla-artifact.sh

ENTRYPOINT ["/usr/local/bin/start-valhalla-artifact.sh"]
