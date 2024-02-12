#!/bin/bash
# setup env vars
export IMAGE_NAME="hello-node-app"
export TAG="1.0.0"
export APP_PORT="3030";

echo "Building and running the $IMAGE_NAME:$TAG on port $APP_PORT"

# login to docker desktop
docker login

# build docker image into local docker desktop
docker build -f build/Dockerfile -t $IMAGE_NAME:$TAG --build-arg="APP_PORT=$APP_PORT" .

# run the application on port 3030
docker run -d -p $APP_PORT:$APP_PORT $IMAGE_NAME:$TAG