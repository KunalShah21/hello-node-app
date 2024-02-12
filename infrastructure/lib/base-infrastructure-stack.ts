import { CfnOutput, Duration, Stack, StackProps, Tags } from "aws-cdk-lib";
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager";
import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import {
  AccountRootPrincipal,
  ArnPrincipal,
  Effect,
  PolicyDocument,
  PolicyStatement,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { PublicHostedZone } from "aws-cdk-lib/aws-route53";

import { BlockPublicAccess, Bucket, BucketAccessControl, BucketEncryption, StorageClass } from "aws-cdk-lib/aws-s3";
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
      // ipAddresses: IpAddresses.cidr("192.168.0.0/28"),
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
    // adding a tag to easily lookup VPC in the web-hosting-stack during cdk synth
    // cdk cannot resolve the value of the vpc id via CF export since it doesn't exist yet and the reference function
    // cannot work with a Token (unresolved value)
    //https://github.com/aws/aws-cdk/issues/3600
    Tags.of(vpc).add(this.node.tryGetContext("vpc-tag-name"), "true");

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

    // create KMS Key for cloudwatch and ensure it allows cloudwatch to use the key to write logs
    const cloudWatchKey = this.createKMSKey(this, "CloudWatch", globalContext);
    cloudWatchKey.addToResourcePolicy(
      new PolicyStatement({
        sid: "Allow access logs to be written",
        actions: ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"],
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal(`logs.${region}.amazonaws.com`)],
        resources: ["*"],
      })
    );

    // create KMS key for S3 and ensure it allows services to write logs even though it is encrypted
    const s3Key = this.createKMSKey(this, "S3", globalContext);
    s3Key.addToResourcePolicy(
      new PolicyStatement({
        sid: "Allow access logs to be written",
        actions: ["kms:GenerateDataKey*"],
        effect: Effect.ALLOW,
        principals: [
          new ServicePrincipal("delivery.logs.amazonaws.com"),
          new ServicePrincipal("logging.s3.amazonaws.com"),
        ],
        resources: ["*"],
      })
    );

    // create s3 buckets for access logs
    // will transition to S3 IA after 30 days
    // will transition to Glacier after 90 days
    const accessLogBucket = new Bucket(this, "hello-logging-bucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      accessControl: BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
      encryption: BucketEncryption.KMS,
      encryptionKey: s3Key,
      versioned: false, // access logs do not need to be versioned
      lifecycleRules: [
        {
          id: "Store Access Logs in IA and Glacier",
          enabled: true,
          transitions: [
            { storageClass: StorageClass.INFREQUENT_ACCESS, transitionAfter: Duration.days(30) },
            { storageClass: StorageClass.GLACIER, transitionAfter: Duration.days(90) },
          ],
        },
      ],
    });
    // add a bucket policy statement that allows AWS to store S3 access logs into the bucket
    accessLogBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [`${accessLogBucket.bucketArn}/*`],
        principals: [new ServicePrincipal("logging.s3.amazonaws.com")],
      })
    );

    // add a bucket policy statement that allows AWS to store ALB access logs into the bucket
    accessLogBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [`${accessLogBucket.bucketArn}/${regionContext["alb-access-log-prefix"]}/*`],
        principals: [new AccountRootPrincipal()],
      })
    );

    // add a bucket policy statement that allows AWS to store CloudFront access logs into the bucket
    accessLogBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [`${accessLogBucket.bucketArn}/${regionContext["cloudfront-access-log-prefix"]}/*`],
        principals: [new ServicePrincipal("delivery.logs.amazonaws.com")],
      })
    );

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

    // create a CloudFormation output for the s3 access log bucket arn
    new CfnOutput(this, "hello-s3-access-log-arn-export", {
      exportName: this.node.tryGetContext("s3-access-log-bucket-arn-export-name"),
      value: accessLogBucket.bucketArn,
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
    const awsServiceLC = awsService.toLowerCase();

    // create a KMS key
    const kmsKey = new Key(stack, `hello-app-${awsServiceLC}-kms-cm-key`, {
      alias: `aws-${awsServiceLC}-kms-cm-key`,
      description: `KMS Key for ${awsServiceLC}`,
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
            principals: [new ArnPrincipal(globalContext["aws-sso-power-user-arn"]), new AccountRootPrincipal()],
            resources: ["*"],
          }),
          // allow the account and sso power user to use the key with AWS services
          new PolicyStatement({
            sid: "Allow attachment of persistent resources",
            actions: ["kms:CreateGrant", "kms:ListGrants", "kms:RevokeGrant"],
            effect: Effect.ALLOW,
            principals: [new ArnPrincipal(globalContext["aws-sso-power-user-arn"]), new AccountRootPrincipal()],
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

    new CfnOutput(stack, `hello-app-${awsServiceLC}-kms-cm-key-arn-export`, {
      exportName: `hello-${awsServiceLC}-kms-key-arn-export`,
      value: kmsKey.keyArn,
    });

    return kmsKey;
  }
}
