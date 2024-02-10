import { Stack, StackProps } from "aws-cdk-lib";
import { Vpc, SubnetType, IpAddresses } from "aws-cdk-lib/aws-ec2";

import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class InfrastructureStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // region is always passed in by us
    const region = props.env?.region as string;

    // create VPC with private subnets in each AZ
    // allocate 16 IP addresses -> 11 available for use since 5 get taken by AWS
    const vpc = new Vpc(this, "TheVPC", {
      ipAddresses: IpAddresses.cidr('10.0.0.0/28'),
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
          mapPublicIpOnLaunch: false
        },
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });
  }
}
