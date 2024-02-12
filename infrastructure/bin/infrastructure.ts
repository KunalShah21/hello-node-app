#!/usr/bin/env node
import "source-map-support/register";
import { App, Tags } from "aws-cdk-lib";
import { BaseInfrastructureStack } from "../lib/base-infrastructure-stack";
import { WebHostingStack } from "../lib/web-hosting-stack";

// create the CDK application
const app = new App();

// get aws emvironment name - defaulted to dev
const env = process.env.ENVIRONMENT || "dev"

/**
 * Stack creates:
 *  - VPC
 *  - Public and Private Subnets
 *  - ACM Cert
 *  - KMS Keys
 *  - Various Exports
 */
const baseInfraStack = new BaseInfrastructureStack(app, "BaseInfrastructureStack", env, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

/**
 * Stack creates:
 *  - Security Groups
 *  - ECS Cluster
 *  - Farget Service 
 *  - Fargate Task Definition
 *  - ALB
 *  - CloudFront Distribution
 */
const webHostingStack = new WebHostingStack(app, "WebHostingStack", env, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

// Add a tag to all resources in the stacks
Tags.of(baseInfraStack).add('BusinessLine', 'Murphy');
Tags.of(webHostingStack).add('BusinessLine', 'Murphy');

// TODO - create script to build docker image locally and run the app