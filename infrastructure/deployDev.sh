#!/bin/bash
if [ -z "$1" ]
  then
    echo "No AWS region supplied"
fi

if [ -z "$2" ]
  then
    echo "No AWS profile supplied"
fi

echo "Synthesising and deploying with CDK for region: $1 and profile $2 on the AWS DEV environment"

# deploy feature branch infrastructure to production account
export CDK_DEFAULT_REGION=$2
export CDK_DEFAULT_ACCOUNT="565731953403"
export ENVIRONMENT="dev"

echo "CDK_DEFAULT_REGION = $CDK_DEFAULT_REGION"
echo "CDK_DEFAULT_ACCOUNT = $CDK_DEFAULT_ACCOUNT"
echo "ENVIRONMENT = $ENVIRONMENT"

cdk synth BaseInfrastructureStack --role "arn:aws:iam::${CDK_DEFAULT_ACCOUNT}:role/czero-cdk-deployment-role" --profile $2 --debug
cdk deploy BaseInfrastructureStack --role "arn:aws:iam::${CDK_DEFAULT_ACCOUNT}:role/czero-cdk-deployment-role" --profile $2 --debug

cdk synth WebHostingStack --role "arn:aws:iam::${CDK_DEFAULT_ACCOUNT}:role/czero-cdk-deployment-role" --profile $2 --debug
cdk deploy WebHostingStack --role "arn:aws:iam::${CDK_DEFAULT_ACCOUNT}:role/czero-cdk-deployment-role" --profile $2 --debug