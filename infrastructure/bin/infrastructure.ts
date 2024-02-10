#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { InfrastructureStack } from "../lib/infrastructure-stack";

const app = new App();
new InfrastructureStack(app, "InfrastructureStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
