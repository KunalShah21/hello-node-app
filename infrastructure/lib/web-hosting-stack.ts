import { Duration, Fn, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Peer, Port, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import {
  AppProtocol,
  AwsLogDriverMode,
  Cluster,
  ContainerImage,
  CpuArchitecture,
  FargateService,
  FargateTaskDefinition,
  LogDriver,
  OperatingSystemFamily,
} from "aws-cdk-lib/aws-ecs";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup,
  Protocol,
  SslPolicy
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Key } from "aws-cdk-lib/aws-kms";

import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { Distribution, OriginProtocolPolicy, OriginRequestPolicy, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { LoadBalancerV2Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { LogGroup, LogGroupClass, RetentionDays } from "aws-cdk-lib/aws-logs";
import { ARecord, HostedZone } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class WebHostingStack extends Stack {
  constructor(scope: Construct, id: string, env: string, props: StackProps) {
    super(scope, id, props);

    // region is always passed in by us
    const region = props.env?.region as string;

    // get the necessary config into by region and environment
    const regionContext = this.node.tryGetContext(env)[region];

    // get the necessary config info by account only - this is used for config related to AWS global services
    const globalContext = this.node.tryGetContext(env);

    // get CloudFormation exports
    const vpcId = Fn.importValue(this.node.tryGetContext("vpc-id-export-name"));
    const cloudwatchKeyArn = Fn.importValue(this.node.tryGetContext("cloudwatch-kms-key-arn-export-name"));
    const certificateArn = Fn.importValue(this.node.tryGetContext("acm-cert-arn-export-name"));
    const s3AccessLogBucketArn = Fn.importValue(this.node.tryGetContext("s3-access-log-bucket-arn-export-name"));

    // get a reference to the S3 access logs bucket
    const accessLogBucketRef = Bucket.fromBucketArn(this, "hello-s3-access-log-ref", s3AccessLogBucketArn);

    // get a reference to the VPC by vpc id
    let tags: any = {};
    const tagName: string = this.node.tryGetContext("vpc-tag-name");
    tags[tagName] = "true";
    const vpcRef = Vpc.fromLookup(this, "hello-vpc-ref", { isDefault: false, tags, vpcName: 'hello-vpc' });

    // security group for the ALB
    const albSecurityGroup = new SecurityGroup(this, "hello-alb-security-group", {
      vpc: vpcRef,
      securityGroupName: "hello-app-alb-sg",
      description: "Security Group for an internet facing ALB",
    });

    // security group for ECS
    const ecsSecurityGroup = new SecurityGroup(this, "hello-ecs-security-group", {
      vpc: vpcRef,
      securityGroupName: "hello-app-ecs-sg",
      description: "Security Group for a Fargate cluster",
      allowAllOutbound: true,
    });

    // allow all incoming https connections from any ip
    albSecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(443), "allow all incoming https connections from any ip");

    // allow traffic between alb sg and ecs sg
    ecsSecurityGroup.connections.allowFrom(albSecurityGroup,Port.tcp(3030), 'allow inbound traffic from the ALB');

    // create a CloudWatch log group for the ECS container
    const helloAppLogGroup = new LogGroup(this, "hello-app-log-group", {
      encryptionKey: Key.fromKeyArn(this, "hello-cloudwatch-kms-key", cloudwatchKeyArn),
      logGroupClass: LogGroupClass.STANDARD,
      logGroupName: "ecs/container/hello-app",
      removalPolicy: RemovalPolicy.DESTROY,
      retention: RetentionDays.THREE_MONTHS,
    });

    // create an ECS Fargate cluster
    const appCluster = new Cluster(this, "hello-ecs-cluster", {
      clusterName: "hello-app-cluster",
      containerInsights: true,
      vpc: vpcRef
    });

    // create ecs execution role for the task definition
    const ecsTaskExecRole = new Role(this, "hello-task-exec-role", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromManagedPolicyArn(
          this,
          "ecs-task-exec-role-policy",
          this.node.tryGetContext("ecs-task-exec-role-policy-arn")
        ),
      ],
    });

    // create a Fargate task definition
    // alternativley could use ApplicationLoadBalancedFargateService to accomplish the below IaC
    const appTaskDef = new FargateTaskDefinition(this, "hello-app-def", {
      cpu: 256, // using minimal cpu for the basic application, normally this would be fine tuned through analyzing metrics over a period of time
      ephemeralStorageGiB: 21, // using minimal storage
      executionRole: ecsTaskExecRole,
      memoryLimitMiB: 512, // using minimal memory allowed by Fargaet with cpu of 0.25vCPU
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.X86_64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });

    // add a container to the task definition with a health check and port mapping
    const containerName = "hello-app-container";
    appTaskDef.addContainer("hello-app-container", {
      containerName,
      image: ContainerImage.fromRegistry(this.node.tryGetContext("image-url")),
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:3030/ || exit 1"],
        interval: Duration.seconds(30),
        retries: 3,
        startPeriod: Duration.seconds(60),
        timeout: Duration.seconds(10),
      },
      logging: LogDriver.awsLogs({
        streamPrefix: `app/${containerName}/hello`,
        logGroup: helloAppLogGroup,
        mode: AwsLogDriverMode.NON_BLOCKING, // we don't want the app to become unresponsive if lgos back up & we are okay losing logs
      }),
      portMappings: [
        {
          name: "hello-app-port-mapping",
          containerPort: 3030,
          hostPort: 3030,
          appProtocol: AppProtocol.http,
        },
      ],
    });

    // create a Fargate service for ECS
    const appService = new FargateService(this, "hello-fargate-service", {
      taskDefinition: appTaskDef,
      cluster: appCluster,
      assignPublicIp: false,
      desiredCount: 1,
      securityGroups: [ecsSecurityGroup],
      serviceName: "hello-app-service",
    });

    // create an Application Load Balancer
    const appLoadBalancer = new ApplicationLoadBalancer(this, "hello-alb", {
      vpc: vpcRef,
      vpcSubnets: { subnetType: SubnetType.PUBLIC, onePerAz: true },
      internetFacing: true,
      deletionProtection: true,
      securityGroup: albSecurityGroup
    });

    // enable ALB access logs sent to the account's access log bucket
    // appLoadBalancer.logAccessLogs(accessLogBucketRef, regionContext["alb-access-log-prefix"]);

    // add a target group for the ECS cluster with health checks configured to "/" on port 3030 with http
    const appTargetGroup = new ApplicationTargetGroup(this, "hello-app-target-group", {
      vpc: vpcRef,
      healthCheck: {
        enabled: true,
        healthyHttpCodes: "200",
        path: "/",
        port: "3030",
        protocol: Protocol.HTTP,
        timeout: Duration.seconds(10),
      },
      port: 3030,
      protocol: ApplicationProtocol.HTTP,
      targets: [appService],
    });

    // // grab ACM cert created from base-infrastructure-stack
    const acmCertRef = Certificate.fromCertificateArn(this, "hello-cert-ref", certificateArn);

    // add an ALB listener that listens on HTTPS and send straffic to the target group
    const listener = appLoadBalancer.addListener("hello-alb-listener", {
      certificates: [acmCertRef],
      open: true,
      port: 443,
      sslPolicy: SslPolicy.RECOMMENDED_TLS,
      protocol: ApplicationProtocol.HTTPS 
    });

    // create a CloudFront distribution for caching the website
    const cloudFrontDist = new Distribution(this, "myDist", {
      enabled: true,
      domainNames: [globalContext["api-domain-name"]],
      defaultBehavior: {
        origin: new LoadBalancerV2Origin(appLoadBalancer, {
          protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
          // customHeaders: {"restrict-access": "true"} this works to restrict ALB traffic to only the CF Dist but could not configure the rule condition with CDK for the ALB
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER
      },
      certificate: acmCertRef,
      enableLogging: true,
      logBucket: accessLogBucketRef,
      logFilePrefix: regionContext["cloudfront-access-log-prefix"],
    });

    // Setup IPv4 Route 53 Alias Records for CloudFront
    const hostedZoneId = globalContext["hosted-zone-id"];
    const hostedZoneName = globalContext["hosted-zone-name"];
    const apiDomainName = globalContext["api-domain-name"];
    const ipv4Record = new ARecord(this, "hello-a-record", {
      target: {
        aliasTarget: new CloudFrontTarget(cloudFrontDist),
      },
      zone: HostedZone.fromHostedZoneAttributes(this, "hello-hosted-zone", {
        hostedZoneId,
        zoneName: hostedZoneName
      }),
      recordName: apiDomainName,
    });
  }
}
