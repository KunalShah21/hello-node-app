# Setup Arguments
# Port to expose the app
ARG APP_PORT

# Use a base image
FROM registry.access.redhat.com/ubi8/nodejs-18-minimal:latest

# Set node env to production to allow passing secrets and other runtime configs
# Would not be necessary in this specific hello world use case
ENV NODE_ENV production

# Install build dependencies if any

# Create a non-root user
# RUN groupadd -r nonroot && useradd -r -g nonroot nonroot

# Create and set a working directory
WORKDIR /app

# Set work directory permissions to non-root user
# RUN chown -R nonroot:nonroot /app/

# Copy application directory that include source code & dependency info
COPY /application .

# Install dependencies from the package lock
RUN npm ci

# Expose port 3000 for the application
EXPOSE $APP_PORT

# Set to non-root user
USER 1001

# Command to run the application
CMD ["npm", "start"]