import { Stack, StackProps, Fn, Duration } from "aws-cdk-lib";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup,
  Protocol,
  SslPolicy,
  TargetType,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Vpc, SecurityGroup, Connections, Peer, Port } from "aws-cdk-lib/aws-ec2";
import {
  AppProtocol,
  Cluster,
  ContainerImage,
  CpuArchitecture,
  FargateService,
  FargateTaskDefinition,
  LogDriver,
  OperatingSystemFamily,
} from "aws-cdk-lib/aws-ecs";
import { Key } from "aws-cdk-lib/aws-kms";

import { Construct } from "constructs";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class WebHostingStack extends Stack {
  constructor(scope: Construct, id: string, env: string, props: StackProps) {
    super(scope, id, props);

    // region is always passed in by us
    const region = props.env?.region as string;

    // get the necessary config into by region and environment
    const regionContext = this.node.tryGetContext(env)[region];

    // get CloudFormation exports
    const vpcId = Fn.importValue(this.node.tryGetContext("vpc-id-export-name"));
    const cloudwatchKeyArn = Fn.importValue(this.node.tryGetContext("cloudwatch-kms-key-arn-export-name"));
    const certificateArn = Fn.importValue(this.node.tryGetContext("acm-cert-arn-export-name"));

    // get a reference to the VPC by vpc id
    const vpcRef = Vpc.fromLookup(this, "hello-world-vpc-ref", { vpcId });

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

    // only allow outgoing traffic to the ECS SG over any TCP connection
    albSecurityGroup.addEgressRule(Peer.securityGroupId(ecsSecurityGroup.securityGroupId), Port.tcp(3030));

    // allow all incoming connections from the ALB SG on port 3030
    ecsSecurityGroup.addIngressRule(Peer.securityGroupId(ecsSecurityGroup.securityGroupId), Port.tcp(3030));

    // create an ECS Fargate cluster
    const appCluster = new Cluster(this, "hello-ecs-cluster", {
      clusterName: "hello-app-cluster",
      containerInsights: true,
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
    const appTaskDef = new FargateTaskDefinition(this, "hello-app-def", {
      cpu: 256, // using minimal cpu for the basic application, normally this would be fine tuned through analyzing metrics over a period of time
      ephemeralStorageGiB: 1, // using minimal storage
      executionRole: ecsTaskExecRole,
      memoryLimitMiB: 256,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.X86_64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });

    // add a container to the task definition with a health check and port mapping
    appTaskDef.addContainer("hello-app-container", {
      image: ContainerImage.fromRegistry(this.node.tryGetContext("image-url")),
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:3030/ || exit 1"],
        interval: Duration.seconds(30),
        retries: 3,
        startPeriod: Duration.seconds(60),
        timeout: Duration.seconds(10),
      },
      logging: LogDriver.awsLogs,
      portMappings: [
        {
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
    const alb = new ApplicationLoadBalancer(this, "LB", {
      vpc: vpcRef,
      internetFacing: true,
      deletionProtection: true,
      securityGroup: albSecurityGroup,
    });

    // add a target group for the ECS cluster with health checks configured to "/" on port 3030 with http
    const appTargetGroup = new ApplicationTargetGroup(this, "app-target-group", {
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

    const listener = alb.addListener("hello-alb-listener", {
      certificates: [Certificate.fromCertificateArn(this, "hello-cert-arn", certificateArn)],
      defaultTargetGroups: [appTargetGroup],
      open: true,
      port: 443,
      sslPolicy: SslPolicy.RECOMMENDED_TLS
    });
  }
}
