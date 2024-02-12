# Hello Node App

<https://czero.atlassian.net/wiki/spaces/TD/pages/116260865/Hello+Node+App>

* * *

## Overview

The goal is to create a simple node web app hosted with ECS Fargate.

This document will run through:

* Infrastructure - Design Considerations
* Infrastructure - Diagram
* Infrastructure - Future Considerations
* Application - Image
* Application - Steps to Build the Image Locally
* Application - Steps to Build the Image via CI/CD

## Infrastructure - Design Considerations

* Multi-region arch was not considered for this simple application but it can be made possible by having another load balancer and fargate cluster in the us-west region. The CDK was set up to handle this future implementation.
* Alarms and metrics should be created for this application

## Infrastructure - Diagram

The infrastructure diagram can be found under ./Hello World Node App Infrastructure.png

### Flow

1. The website can be hit from [https://dev.celeryfinance.com/](https://dev.celeryfinance.com/) and it gets routed to a CloudFront Distribution
    1. This was created to allow caching of the webpage to help alleviate traffic going to ECS resulting in a performance increase and cost reduction
    2. The Distribution utilizes an ACM certificate and an alternative domain name for dev.celeryfinance.com
2. CloudFront forwards the request to an Application Load Balancer origin
    1. The ALB is placed in a public subnet and accepts only HTTPS traffic
    2. Access logs for the ALB need to be enabled. The bucket is setup but I was working through an access error.
    3. The ALB terminates SSL at the load balancer and so any subsequent traffic to the target is over HTTP
    4. The ALB is deployed across 3 AZs
    5. ALB has health checks enabled at `/` on port 3030 over HTTPS
3. ALB routes traffic to an ECS Fargate Service placed within a private subnet
    1. We did not want anyone to access our ECS cluster directly so it was placed across private subnets.
    2. The cluster is deployed across three AZs with minimal resources assigned to it for a simple application
    3. The AWS Log Driver is enabled on each container to allow logs to be delivered to CloudWatch
    4. Container health checks are enabled at `http://localhost:3030/`
4. Any outgoing traffic needed for the Cluster will be through a NAT Gateway
    1. This is used to reach out to GitHub Container Registry
    2. NAT Gateway is only deployed in a single AZ for cost purposes. This will result in an additional cost for data transfer across AZs but with minimal traffic, it should be negligible.
5. Egress traffic will go out to the internet over the NAT Gateway

### Additional Infra

* A CloudWatch Logs Group is created to store logs from the containers.
    * The log group is encrypted to protect data and so a KMS CMK was created to encrypt any CloudWatch logs
    * Retains data for 90 days
        * We likely will not need to troubleshoot logs that are a fiscal quarter old
* S3 Bucket for Access Logs
    * Encrypted with SSE-S3 due to ALB limitations
    * Used for CloudFront access logs
    * I could not set ALB access logs, I kept having a permission error even after setting the appropriate bucket policy and ensuring the bucket only had SSE-S3 encryption and not SSE-KMS
    * Lifecycle Policy that transfers to IA after 30 days
    * Lifecycle Bucket Policy that transfers to Glacier after 90 days

## Infrastructure - Future Considerations

* Add alarms surrounding ECS
    * [https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cloudwatch-metrics.html](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cloudwatch-metrics.html)
* Add alarms surrounding ALB
    * [https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-cloudwatch-metrics.html](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-cloudwatch-metrics.html)
* Add alarms surrounding CloudFront
    * [https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/monitoring-using-cloudwatch.html](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/monitoring-using-cloudwatch.html)
* Resolve the issue with ALB access logs

## Application - Image

* The application image is based on `registry.access.redhat.com/ubi8/nodejs-18-minimal:latest`
* The image copies the application source code and then installs dependencies
* Next, it switches the user back to the pre-defined Node user (1001) to ensure the image doesn’t run with the root user
* Lastly, it starts the application with npm commands specified in the package.json

## Application - Steps to Build the Image Locally

1. Ensure that Docker Desktop is installed and running
2. Ensure that no other process is using port 3030 on your machine
3. Locate the shell script located at buildAndRunImage.sh
4. Run the script: ./buildAndRunImage.sh
    1. The script will spin up the container running at http://localhost:3030
5. Navigate to [http://localhost:3030](http://localhost:3030) and you will see the application is up and running

## Application - Steps to Build the Image via CI/CD

1. GitHub workflow is created to build and deploy the image to the GitHub Container Registry at [ghcr.io/kunalshah21/hello-node-app:latest](http://ghcr.io/kunalshah21/hello-node-app:latest)
2. The workflow can be triggered by a push to the main branch or manually
3. The workflow utilizes the following pre-defined actions created by Docker
    1. [https://github.com/docker/login-action](https://github.com/docker/login-action)
        1. Logs into the GHCR with the GitHub Token configured by the GitLab for the repo
        2. The token has permissive privileges to allow reading AND writing to packages
    2. [https://github.com/docker/build-push-action](https://github.com/docker/build-push-action)
        1. When pushing the image, it gets tagged with the IMAGE_TAG that should be updated each time the docker image is updated
        2. When pushing the image, it gets tagged with the latest tag
        3. When pushing the image, the workflow adds informative labels for metadata tracking and allows others to understand the purpose of the image
        4. There is no scanning implemented yet by the pipeline but if I had the time, I would implement two container scan solutions.
            1. Two solutions help ensure that there are no false flags between the two scanning solutions. This is an ideal scenario and we’d have to consider removing duplicate vulnerabilities as well to create one consolidated report.

## Application - Deploy AWS CDK via CI/CD

There was no explicit call out to deploy CDK with CICD under the Requirements → CICD Pipeline section so I’ve instead been deploying to AWS locally to one of my DEV AWS accounts that is configured under an Org with SSO enabled.

The script runs CDK Synth and CDK Deploy on both of the CloudFormation Stacks. First, the Base Infrastructure Stack gets deployed and then the Web Hosting Stack gets deployed.

1. Ensure you have an AWS CLIv2 profile set up with the appropriate credentials
    1. For me, this is accomplished through **aws configure sso**
2. Locate the shell script located at infrastructure/deployDev.sh
3. The script takes two arguments, region and profile.
    1. If you don’t provide either of these arguments, the script will gracefully error out
4. Run the script: ./infrastructure/deployDev.sh <region> <profile>