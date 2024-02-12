import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Vpc, SubnetType, IpAddresses } from "aws-cdk-lib/aws-ec2";
import { PublicHostedZone } from "aws-cdk-lib/aws-route53";
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager";
import { Key } from "aws-cdk-lib/aws-kms";
import { PolicyDocument, PolicyStatement, AccountRootPrincipal, Effect } from "aws-cdk-lib/aws-iam";

import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class BaseInfrastructureStack extends Stack {
  constructor(scope: Construct, id: string, env: string, props: StackProps) {
    super(scope, id, props);

    // region is always passed in by us
    const region = props.env?.region as string;

    // get the necessary config into by region and environment
    const regionContext = this.node.tryGetContext(env)[region];

    // get the necessary config info by account only - this is used for config related to AWS global services
    const globalContext = this.node.tryGetContext(env);

    // create VPC with private and public subnets across 3 AZs
    // allocate 16 IP addresses -> 11 available for use since 5 get taken by AWS
    const vpc = new Vpc(this, "hello-vpc", {
      vpcName: "hello-vpc",
      ipAddresses: IpAddresses.cidr("10.0.0.0/28"),
      natGateways: 0,
      maxAzs: 3,
      subnetConfiguration: [
        {
          name: "Private Subnet",
          subnetType: SubnetType.PRIVATE_ISOLATED,
        },
        {
          name: "Public Subnet",
          subnetType: SubnetType.PUBLIC,
          mapPublicIpOnLaunch: false,
        },
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // get hosted zone information
    const hostedZoneId = globalContext["hosted-zone-id"];
    const apiDomainName = globalContext["api-domain-name"];

    // get an existing hosted zone
    const hostedZone = PublicHostedZone.fromHostedZoneAttributes(this, "hello-route53-hz", {
      hostedZoneId: hostedZoneId,
      zoneName: apiDomainName,
    });

    // create an ACM cert & validate it with the DNS of the hosted zone
    const certificate = new Certificate(this, "hello-acm-cert", {
      domainName: apiDomainName,
      validation: CertificateValidation.fromDns(hostedZone),
    });

    const cloudWatchKey = this.createKMSKey(this, "CloudWatch", globalContext);

    // create a CloudFormation output for the VPC Id
    new CfnOutput(this, "hello-vpc-id-export", {
      exportName: this.node.tryGetContext("vpc-id-export-name"),
      value: vpc.vpcId,
    });

    // create a CloudFormation output for the certificate arn
    new CfnOutput(this, "hello-cert-arn-export", {
      exportName: this.node.tryGetContext("acm-cert-arn-export-name"),
      value: certificate.certificateArn,
    });
  }

  /**
   *  - Creates a KMS key following the standard AWS Key policies that allow
   *    - allow the account to use the key and access its details
   *    - allow the account and the sso power user to use the KMS Key
   *    - allow the account and sso power user to use the key with AWS services
   *  - Creates a key alias for the key named "aws-<awsService>-kms-cm-key"
   *  - Creates a CF Output for the KMS Key ARN
   * @param stack - stack context
   * @param awsService - aws service that the key will be used for
   * @param globalContext - config info for the account - region agnostic
   * @returns KMS Key construct
   */
  createKMSKey(stack: Stack, awsService: string, globalContext: any): Key {
    // create a KMS key
    const kmsKey = new Key(stack, `hello-app-${awsService}-kms-cm-key`, {
      alias: `aws-${awsService}-kms-cm-key`,
      description: `KMS Key for ${awsService}`,
      enableKeyRotation: true,
      policy: new PolicyDocument({
        statements: [
          // allow the account to use the key and access its details
          new PolicyStatement({
            sid: "Enable IAM User Permissions",
            actions: ["kms:*"],
            effect: Effect.ALLOW,
            principals: [new AccountRootPrincipal()],
            resources: ["*"],
          }),
          // allow the account and the sso power user to use the KMS Key
          new PolicyStatement({
            sid: "Allow use of the key",
            actions: ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"],
            effect: Effect.ALLOW,
            principals: [globalContext["aws-sso-power-user-arn"], new AccountRootPrincipal()],
            resources: ["*"],
          }),
          // allow the account and sso power user to use the key with AWS services
          new PolicyStatement({
            sid: "Allow attachment of persistent resources",
            actions: ["kms:CreateGrant", "kms:ListGrants", "kms:RevokeGrant"],
            effect: Effect.ALLOW,
            principals: [globalContext["aws-sso-power-user-arn"], new AccountRootPrincipal()],
            resources: ["*"],
            conditions: {
              Bool: {
                "kms:GrantIsForAWSResource": "true",
              },
            },
          }),
        ],
      }),
    });

    new CfnOutput(stack, `hello-app-${awsService}-kms-cm-key-arn-export`, {
      exportName: stack.node.tryGetContext("cloudwatch-kms-key-arn-export-name"),
      value: kmsKey.keyArn,
    });

    return kmsKey
  }
}
